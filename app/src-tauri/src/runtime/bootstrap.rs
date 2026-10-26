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
    Ok(())
}


#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Allow inbound TCP/UDP for this PeerChat.exe so LAN beacons and DMs work.
#[cfg(windows)]
pub(crate) fn ensure_windows_firewall_rules(data_dir: &std::path::Path) {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(exe_str) = exe.to_str() else {
        return;
    };
    let marker = data_dir.join(".firewall_ok");
    if marker.exists() {
        return;
    }
    let _ = std::process::Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "delete",
            "rule",
            "name=PeerChat LAN",
        ])
        .creation_flags(0x08000000)
        .output();
    for proto in ["UDP", "TCP"] {
        let _ = std::process::Command::new("netsh")
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
    }
    let _ = std::fs::write(&marker, b"1");
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub(crate) fn ensure_windows_firewall_rules(_data_dir: &std::path::Path) {}

