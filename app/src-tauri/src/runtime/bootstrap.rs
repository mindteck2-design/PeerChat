#![allow(unused_imports)]
use crate::db;
use crate::tls_cert;
use crate::discovery::{self, DiscoveryHub, PeerBeacon};
use crate::peer_http::{self, SharedDb};
use crate::state::AppState;
use crate::util::*;
use crate::runtime::keep_awake::KeepAwakeGuard;
use crate::runtime::outbox::{flush_outbox, kick_flush};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

pub(crate) fn show_main_window(app: &AppHandle) {
    crate::runtime::tray_flash::stop_tray_flash(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        // Windows often blocks focus steals from background processes; always-on-top
        // for a tick is enough to surface the tray-restored window.
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
        let _ = window.set_always_on_top(false);
    }
}

pub(crate) const APP_ID: &str = "com.peerchat.app";
pub(crate) const LEGACY_APP_ID: &str = "com.lanmsg.app";

pub(crate) fn drain_pending_show(app: &AppHandle) {
    let Ok(local) = std::env::var("LOCALAPPDATA") else {
        return;
    };
    for id in [APP_ID, LEGACY_APP_ID] {
        let path = PathBuf::from(&local).join(id).join("pending-show");
        if path.exists() {
            let _ = std::fs::remove_file(&path);
            show_main_window(app);
            return;
        }
    }
}

pub(crate) fn drain_pending_share(app: &AppHandle) {
    let Ok(local) = std::env::var("LOCALAPPDATA") else {
        return;
    };
    for id in [APP_ID, LEGACY_APP_ID] {
        let path = PathBuf::from(&local).join(id).join("pending-share.json");
        if !path.exists() {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let _ = std::fs::remove_file(&path);
        let Ok(files) = serde_json::from_str::<Vec<String>>(&raw) else {
            continue;
        };
        if files.is_empty() {
            continue;
        }
        show_main_window(app);
        let _ = app.emit("share-files", files);
        return;
    }
}

/// Poll flags left by a second Start Menu / Apps launch (or --share).
pub(crate) fn drain_second_instance_signals(app: &AppHandle) {
    drain_pending_show(app);
    drain_pending_share(app);
}

pub(crate) fn start_runtime_inner(
    app: &AppHandle,
    state: &AppState,
    user_id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    preferred_port: u16,
) -> Result<(), String> {
    {
        let started = state.started.lock();
        if *started {
            return Ok(());
        }
    }
    let port = peer_http::allocate_listen_port(preferred_port)?;
    {
        let conn = state.db.lock();
        let _ = conn.execute(
            "UPDATE profile SET listen_port=?1",
            rusqlite::params![port as i64],
        );
    }
    let cert = tls_cert::ensure(&state.data_dir)?;
    *state.fingerprint.lock() = cert.fingerprint.clone();
    *state.live_display_name.lock() = display_name.to_string();
    let team_label = {
        let conn = state.db.lock();
        db::get_profile(&conn)
            .ok()
            .flatten()
            .and_then(|p| p["team"].as_str().map(|s| s.to_string()))
            .unwrap_or_default()
    };
    *state.live_team.lock() = team_label.clone();
    let avatar_id = {
        let conn = state.db.lock();
        db::get_setting(&conn, "avatar_id")
            .ok()
            .flatten()
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    *state.live_avatar_id.lock() = avatar_id.clone();
    peer_http::spawn_listener(
        cert.clone(),
        port,
        state.db.clone(),
        user_id.to_string(),
        app.clone(),
    )?;

    // Best-effort firewall allow for LAN discovery (UDP 41234) + peer TLS (TCP listen).
    // Run in background with delay + marker cache so system login startup impact is minimized.
    #[cfg(windows)]
    {
        let data_dir = state.data_dir.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(6)).await;
            ensure_windows_firewall_rules(&data_dir);
        });
    }

    let (tx, rx) = tokio::sync::watch::channel(false);
    *state.stop_tx.lock() = Some(tx);
    let hub = state.discovery.clone();
    let live_name = state.live_display_name.clone();
    let live_team = state.live_team.clone();
    let live_avatar = state.live_avatar_id.clone();
    let disc_db = state.db.clone();
    let beacon = PeerBeacon {
        magic: "PEERCHAT".into(),
        v: "4".into(),
        kind: "peer".into(),
        ip: discovery::lan_ip(),
        port,
        user_id: user_id.into(),
        display_name: display_name.into(),
        fingerprint: cert.fingerprint.clone(),
        x25519_public: x25519_public.into(),
        ed25519_public: ed25519_public.into(),
        team: team_label,
        avatar_id,
        ts: 0.0,
    };
    tauri::async_runtime::spawn(async move {
        discovery::run_beacon(
            hub,
            port,
            41234,
            rx,
            beacon,
            live_name,
            live_team,
            live_avatar,
            disc_db,
        )
        .await;
    });

    // outbox flusher
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            flush_outbox(&db).await;
        }
    });

    // Stay reachable for LAN transfers even if the screen is locked / window is in tray.
    *state.keep_awake.lock() = Some(KeepAwakeGuard::acquire());
    *state.started.lock() = true;
    // Catch-up delivers after listen/discovery must not queue OS notification sounds.
    crate::runtime::notify_gate::mark_runtime_started();
    Ok(())
}


#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Allow inbound TCP/UDP for this PeerChat.exe so LAN beacons and DMs work.
///
/// Startup (Windows): silent `netsh` only — never auto UAC / RunAs (creepy admin feel).
/// If silent fails, leave `.firewall_needed` so Settings can offer one consent elevate.
#[cfg(windows)]
pub(crate) fn ensure_windows_firewall_rules(data_dir: &std::path::Path) {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(exe_str) = exe.to_str() else {
        return;
    };
    let marker = data_dir.join(".firewall_ok");
    let needed = data_dir.join(".firewall_needed");
    let marker_ok = std::fs::read_to_string(&marker)
        .ok()
        .map(|s| s.trim() == exe_str)
        .unwrap_or(false);
    if marker_ok && firewall_rule_covers_exe(exe_str) {
        let _ = std::fs::remove_file(&needed);
        return;
    }

    if apply_firewall_rules_silent(exe_str) {
        let _ = std::fs::write(&marker, exe_str.as_bytes());
        let _ = std::fs::remove_file(&needed);
    } else {
        // Do not elevate from background. Flag for Settings / soft prompt.
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::write(&needed, exe_str.as_bytes());
    }
}

/// Status for Settings UI (Windows-only; Linux reports available=false).
#[derive(serde::Serialize, Clone)]
pub struct WindowsFirewallStatus {
    pub available: bool,
    pub ok: bool,
    pub declined: bool,
    pub needed: bool,
}

pub(crate) fn windows_firewall_status(data_dir: &std::path::Path) -> WindowsFirewallStatus {
    #[cfg(windows)]
    {
        let declined = data_dir.join(".firewall_declined").is_file();
        let needed_marker = data_dir.join(".firewall_needed").is_file();
        let Ok(exe) = std::env::current_exe() else {
            return WindowsFirewallStatus {
                available: true,
                ok: false,
                declined,
                needed: needed_marker,
            };
        };
        let Some(exe_str) = exe.to_str() else {
            return WindowsFirewallStatus {
                available: true,
                ok: false,
                declined,
                needed: needed_marker,
            };
        };
        let marker = data_dir.join(".firewall_ok");
        let marker_ok = std::fs::read_to_string(&marker)
            .ok()
            .map(|s| s.trim() == exe_str)
            .unwrap_or(false);
        let ok = marker_ok && firewall_rule_covers_exe(exe_str);
        WindowsFirewallStatus {
            available: true,
            ok,
            declined,
            needed: !ok && (needed_marker || !declined),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = data_dir;
        WindowsFirewallStatus {
            available: false,
            ok: true,
            declined: false,
            needed: false,
        }
    }
}

/// User-initiated elevate (Settings). One hidden UAC helper; never elevates PeerChat.exe.
pub(crate) fn enable_windows_firewall_rules(data_dir: &std::path::Path) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe
            .to_str()
            .ok_or_else(|| "exe path is not valid UTF-8".to_string())?;
        let ok = apply_firewall_rules_silent(exe_str) || apply_firewall_rules_elevated(exe_str);
        if ok {
            let _ = std::fs::write(data_dir.join(".firewall_ok"), exe_str.as_bytes());
            let _ = std::fs::remove_file(data_dir.join(".firewall_needed"));
            let _ = std::fs::remove_file(data_dir.join(".firewall_declined"));
        }
        Ok(ok)
    }
    #[cfg(not(windows))]
    {
        let _ = data_dir;
        Err("Windows Firewall rules are only available on Windows".into())
    }
}

pub(crate) fn decline_windows_firewall(data_dir: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = std::fs::write(data_dir.join(".firewall_declined"), b"1");
        let _ = std::fs::remove_file(data_dir.join(".firewall_needed"));
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = data_dir;
        Ok(())
    }
}

#[cfg(windows)]
fn firewall_rule_covers_exe(exe_str: &str) -> bool {
    let Ok(out) = std::process::Command::new("netsh")
        .args(["advfirewall", "firewall", "show", "rule", "name=PeerChat LAN", "verbose"])
        .creation_flags(0x08000000)
        .output()
    else {
        return false;
    };
    let text = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
    let exe_l = exe_str.to_ascii_lowercase();
    let has_in = text.lines().any(|l| {
        let l = l.trim();
        l.starts_with("direction:") && l.ends_with("in")
    });
    let has_out = text.lines().any(|l| {
        let l = l.trim();
        l.starts_with("direction:") && l.ends_with("out")
    });
    text.contains(&exe_l) && text.contains("enabled:") && text.contains("yes") && has_in && has_out
}

#[cfg(windows)]
fn apply_firewall_rules_silent(exe_str: &str) -> bool {
    let _ = std::process::Command::new("netsh")
        .args(["advfirewall", "firewall", "delete", "rule", "name=PeerChat LAN"])
        .creation_flags(0x08000000)
        .output();
    let _ = std::process::Command::new("netsh")
        .args(["advfirewall", "firewall", "delete", "rule", "name=PeerChat Ports"])
        .creation_flags(0x08000000)
        .output();

    let mut ok = true;
    for proto in ["UDP", "TCP"] {
        let out = std::process::Command::new("netsh")
            .args([
                "advfirewall",
                "firewall",
                "add",
                "rule",
                "name=PeerChat LAN",
                "dir=in",
                "action=allow",
                &format!("program={exe_str}"),
                &format!("protocol={proto}"),
                "profile=any",
                "enable=yes",
            ])
            .creation_flags(0x08000000)
            .output();
        ok = ok && matches!(out, Ok(ref o) if o.status.success());
        let out_rule = std::process::Command::new("netsh")
            .args([
                "advfirewall",
                "firewall",
                "add",
                "rule",
                "name=PeerChat LAN",
                "dir=out",
                "action=allow",
                &format!("program={exe_str}"),
                &format!("protocol={proto}"),
                "profile=any",
                "enable=yes",
            ])
            .creation_flags(0x08000000)
            .output();
        ok = ok && matches!(out_rule, Ok(ref o) if o.status.success());
    }
    // Port rules as a safety net when program path changes (updates / sideloads).
    let tcp_ports = std::process::Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "name=PeerChat Ports",
            "dir=in",
            "action=allow",
            "protocol=TCP",
            "localport=9876-9899",
            "profile=any",
            "enable=yes",
        ])
        .creation_flags(0x08000000)
        .output();
    let udp_port = std::process::Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "name=PeerChat Ports",
            "dir=in",
            "action=allow",
            "protocol=UDP",
            "localport=41234",
            "profile=any",
            "enable=yes",
        ])
        .creation_flags(0x08000000)
        .output();
    let tcp_out = std::process::Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "name=PeerChat Ports",
            "dir=out",
            "action=allow",
            "protocol=TCP",
            "remoteport=9876-9899",
            "profile=any",
            "enable=yes",
        ])
        .creation_flags(0x08000000)
        .output();
    let udp_out = std::process::Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "name=PeerChat Ports",
            "dir=out",
            "action=allow",
            "protocol=UDP",
            "remoteport=41234",
            "profile=any",
            "enable=yes",
        ])
        .creation_flags(0x08000000)
        .output();
    ok = ok
        && matches!(tcp_ports, Ok(ref o) if o.status.success())
        && matches!(udp_port, Ok(ref o) if o.status.success())
        && matches!(tcp_out, Ok(ref o) if o.status.success())
        && matches!(udp_out, Ok(ref o) if o.status.success());
    ok && firewall_rule_covers_exe(exe_str)
}

/// One Windows UAC consent prompt — user must Approve (Settings only).
/// Elevated helper runs hidden so PeerChat.exe itself never looks "admin".
#[cfg(windows)]
fn apply_firewall_rules_elevated(exe_str: &str) -> bool {
    // Escape for PowerShell single-quoted string (double any ').
    let exe_ps = exe_str.replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
         function HNetsh([string[]]$a) {{ Start-Process netsh.exe -ArgumentList $a -WindowStyle Hidden -Wait | Out-Null }}; \
         HNetsh @('advfirewall','firewall','delete','rule','name=PeerChat LAN'); \
         HNetsh @('advfirewall','firewall','delete','rule','name=PeerChat Ports'); \
         HNetsh @('advfirewall','firewall','add','rule','name=PeerChat LAN','dir=in','action=allow','program={exe_ps}','protocol=TCP','profile=any','enable=yes'); \
         HNetsh @('advfirewall','firewall','add','rule','name=PeerChat LAN','dir=in','action=allow','program={exe_ps}','protocol=UDP','profile=any','enable=yes'); \
         HNetsh @('advfirewall','firewall','add','rule','name=PeerChat LAN','dir=out','action=allow','program={exe_ps}','protocol=TCP','profile=any','enable=yes'); \
         HNetsh @('advfirewall','firewall','add','rule','name=PeerChat LAN','dir=out','action=allow','program={exe_ps}','protocol=UDP','profile=any','enable=yes'); \
         HNetsh @('advfirewall','firewall','add','rule','name=PeerChat Ports','dir=in','action=allow','protocol=TCP','localport=9876-9899','profile=any','enable=yes'); \
         HNetsh @('advfirewall','firewall','add','rule','name=PeerChat Ports','dir=in','action=allow','protocol=UDP','localport=41234','profile=any','enable=yes'); \
         HNetsh @('advfirewall','firewall','add','rule','name=PeerChat Ports','dir=out','action=allow','protocol=TCP','remoteport=9876-9899','profile=any','enable=yes'); \
         HNetsh @('advfirewall','firewall','add','rule','name=PeerChat Ports','dir=out','action=allow','protocol=UDP','remoteport=41234','profile=any','enable=yes');"
    );
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &format!(
                "Start-Process -FilePath powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-Command',{arg}",
                arg = powershell_single_quote(&script)
            ),
        ])
        .creation_flags(0x08000000)
        .output();
    matches!(out, Ok(ref o) if o.status.success()) && firewall_rule_covers_exe(exe_str)
}

#[cfg(windows)]
fn powershell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub(crate) fn ensure_windows_firewall_rules(_data_dir: &std::path::Path) {}

