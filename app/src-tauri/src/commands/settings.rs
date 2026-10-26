#![allow(unused_imports)]
use crate::commands::files::{autostart_enabled, set_autostart};
pub(crate) const SETTING_KEYS: &[&str] = &[
    "theme",
    "games_enabled",
    "download_dir",
    "scan_frequency",
    "notification_sound",
    "profile_designation",
    "profile_emp_id",
    "profile_status",
    "profile_status_msg",
];

/// Dynamic keys stored in app_settings (prefix match). Used for per-group crypto history.
fn is_allowed_setting_key(key: &str) -> bool {
    SETTING_KEYS.contains(&key) || key.starts_with("group_key_history:")
}
use base64::Engine;
use rusqlite::OptionalExtension;
use crate::tls_cert;
use crate::discovery::{self, DiscoveryHub, PeerBeacon};
use crate::db;
use crate::runtime;
use crate::state::AppState;
use crate::util;
use crate::peer_http::{self, SharedDb};
use crate::bundle;
use parking_lot::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::util::*;
use crate::runtime::outbox::{kick_flush, kick_flush_for_peer, flush_outbox};
use crate::runtime::group_events::{enqueue_group_event, enqueue_group_event_extra};
use crate::runtime::bootstrap::{start_runtime_inner, show_main_window};

#[tauri::command]
pub fn get_notifications_enabled(state: State<AppState>) -> Result<bool, String> {
    let conn = state.db.lock();
    Ok(db::get_setting(&conn, "notifications_enabled")?
        .map(|v| v != "0")
        .unwrap_or(true))
}

#[tauri::command]
pub fn set_notifications_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_setting(&conn, "notifications_enabled", if enabled { "1" } else { "0" })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) links can be opened".into());
    }
    if url.chars().any(|c| c.is_control() || c == '"' || c == '\'') {
        return Err("Invalid link".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn board_slug(team: &str) -> Option<String> {
    let slug: String = team
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect();
    if slug.is_empty() {
        None
    } else {
        Some(slug)
    }
}

#[tauri::command]
pub fn get_app_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    if !is_allowed_setting_key(&key) {
        return Err("unknown setting".into());
    }
    let conn = state.db.lock();
    db::get_setting(&conn, &key)
}

#[tauri::command]
pub fn set_app_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    if !is_allowed_setting_key(&key) {
        return Err("unknown setting".into());
    }
    if key == "theme" && value != "dark" && value != "light" {
        return Err("theme must be dark or light".into());
    }
    if key == "games_enabled" && value != "0" && value != "1" {
        return Err("games_enabled must be 0 or 1".into());
    }
    if key == "download_dir" && !value.trim().is_empty() {
        let path = PathBuf::from(value.trim());
        if !path.is_absolute() {
            return Err("invalid destination: download directory must be an absolute path".into());
        }
        std::fs::create_dir_all(&path).map_err(explain_io)?;
    }
    if key == "scan_frequency" {
        let val = value.trim();
        if val != "30s" && val != "1m" && val != "5m" && val != "10m" && val != "manual" {
            return Err("invalid scan_frequency value".into());
        }
    }
    if key == "notification_sound" && value != "0" && value != "1" {
        return Err(format!("{key} must be 0 or 1"));
    }
    let conn = state.db.lock();
    db::set_setting(&conn, &key, value.trim())
}

#[tauri::command]
pub fn save_item(state: State<AppState>, row: Value) -> Result<(), String> {
    let preview = row["preview"].as_str().unwrap_or("");
    if preview.chars().count() > 4000 {
        return Err("saved preview is too long".into());
    }
    let conn = state.db.lock();
    db::save_item(&conn, &row)
}

#[tauri::command]
pub fn delete_saved_item(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock();
    db::delete_saved_item(&conn, &id)
}

#[tauri::command]
pub fn list_saved_items(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_saved_items(&conn)
}

#[tauri::command]
pub fn get_autostart_enabled() -> Result<bool, String> {
    Ok(autostart_enabled())
}

#[tauri::command]
pub fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    set_autostart(enabled)
}

// ─── Windows Firewall (LAN discovery) ─────────────────────────────────────────

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ─── Windows shell integration ("Share in PeerChat" right-click) ──────────────

/// Write HKCU shell verb so "Share in PeerChat" appears on right-click for all files.
/// exe_path should be the full path to PeerChat.exe.
#[tauri::command]
pub fn install_shell_extension(_exe_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let exe_path = _exe_path;
    #[cfg(target_os = "windows")]
    {
        shell_verb_write(&exe_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Shell integration is only available on Windows".into())
    }
}

/// Remove the HKCU shell verb.
#[tauri::command]
pub fn uninstall_shell_extension() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        shell_verb_remove()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Shell integration is only available on Windows".into())
    }
}

#[cfg(target_os = "windows")]
pub fn shell_verb_write(exe_path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let verb_key = r"HKCU\Software\Classes\*\shell\ShareInPeerChat";
    let cmd_key = format!(r"{verb_key}\command");

    let run = |args: &[&str]| -> bool {
        std::process::Command::new("reg")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    run(&["add", verb_key, "/ve", "/d", "Share in PeerChat", "/f"]);
    run(&["add", verb_key, "/v", "Icon", "/d", &format!("{exe_path},0"), "/f"]);
    let cmd_val = format!("\"{exe_path}\" --share \"%1\"");
    run(&["add", &cmd_key, "/ve", "/d", &cmd_val, "/f"]);

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn shell_verb_remove() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let _ = std::process::Command::new("reg")
        .args(["delete", r"HKCU\Software\Classes\*\shell\ShareInPeerChat", "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    Ok(())
}

/// Check whether the shell verb is currently registered.
#[tauri::command]
pub fn shell_extension_installed() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Classes\*\shell\ShareInPeerChat"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

fn log_file_path(state: &AppState) -> PathBuf {
    state.data_dir.join("peerchat.log")
}

#[tauri::command]
pub fn app_log_path(state: State<AppState>) -> Result<String, String> {
    Ok(log_file_path(&state).to_string_lossy().into_owned())
}

#[tauri::command]
pub fn append_app_log(state: State<AppState>, line: String) -> Result<(), String> {
    use std::io::Write;
    let path = log_file_path(&state);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let cleaned = line.replace('\r', " ").replace('\n', " ");
    writeln!(f, "{cleaned}").map_err(|e| e.to_string())?;
    Ok(())
}

