#![allow(unused_imports)]
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
pub fn get_profile(state: State<AppState>) -> Result<Option<Value>, String> {
    let conn = state.db.lock();
    Ok(db::get_profile(&conn)?.map(|p| with_local_avatar(&conn, p)))
}

#[tauri::command]
pub fn set_avatar_id(state: State<AppState>, avatar_id: String) -> Result<Value, String> {
    let id = util::normalize_avatar_id(&avatar_id);
    let (profile, fingerprint) = {
        let conn = state.db.lock();
        db::set_setting(&conn, "avatar_id", &id)?;
        let profile = with_local_avatar(&conn, db::get_profile(&conn)?.ok_or("no profile")?);
        let fp = state.fingerprint.lock().clone();
        let me = profile["id"].as_str().unwrap_or("").to_string();
        let from_peer = from_peer_json(&profile, &fp);
        let peers = db::list_peers(&conn).unwrap_or_default();
        for p in peers {
            let rid = p["user_id"].as_str().unwrap_or("");
            if rid.is_empty() || rid == me {
                continue;
            }
            let oid = format!("profile-{}:{}", uuid::Uuid::new_v4(), rid);
            let payload = json!({
                "from_peer": from_peer,
                "profile_update": true,
            });
            let _ = db::enqueue_outbox(&conn, &oid, rid, "", &payload.to_string());
        }
        (profile, fp)
    };
    let _ = fingerprint;
    *state.live_avatar_id.lock() = id;
    kick_flush(&state);
    Ok(profile)
}

#[tauri::command]
pub fn setup_profile(
    app: AppHandle,
    state: State<AppState>,
    display_name: String,
    user_id: String,
    x25519_public: String,
    ed25519_public: String,
    listen_port: Option<i64>,
    team: Option<String>,
) -> Result<Value, String> {
    // Never replace an existing profile id on upgrade / accidental re-setup.
    {
        let conn = state.db.lock();
        if let Some(existing) = db::keep_existing_profile(&conn)? {
            return Ok(existing);
        }
    }
    // New installs: stable per-machine id so wipe+reinstall keeps the same person.
    // Ignore client-provided random UUIDs; keep arg for API compat only.
    let _ = user_id;
    let user_id = crate::device_id::stable_device_id();
    let preferred = listen_port.unwrap_or(9876) as u16;
    let port = peer_http::allocate_listen_port(preferred)?;
    let team_name = team.unwrap_or_default().trim().to_string();
    {
        let conn = state.db.lock();
        db::upsert_profile(
            &conn,
            &user_id,
            &display_name,
            &x25519_public,
            &ed25519_public,
            port as i64,
            &team_name,
        )?;
    }
    start_runtime_inner(
        &app,
        &state,
        &user_id,
        &display_name,
        &x25519_public,
        &ed25519_public,
        port,
    )?;
    let conn = state.db.lock();
    Ok(with_local_avatar(
        &conn,
        db::get_profile(&conn)?.ok_or("profile missing")?,
    ))
}

#[tauri::command]
pub fn update_display_name(
    state: State<AppState>,
    display_name: String,
    team: Option<String>,
) -> Result<Value, String> {
    let name = display_name.trim();
    if name.is_empty() {
        return Err("display name required".into());
    }
    let (profile, fingerprint) = {
        let conn = state.db.lock();
        let profile = with_local_avatar(&conn, db::get_profile(&conn)?.ok_or("no profile")?);
        let id = profile["id"].as_str().unwrap_or("");
        let team_name = team
            .as_deref()
            .map(|t| t.trim().to_string())
            .unwrap_or_else(|| {
                profile["team"]
                    .as_str()
                    .unwrap_or("")
                    .to_string()
            });
        db::upsert_profile(
            &conn,
            id,
            name,
            profile["x25519_public"].as_str().unwrap_or(""),
            profile["ed25519_public"].as_str().unwrap_or(""),
            profile["listen_port"].as_i64().unwrap_or(9876),
            &team_name,
        )?;
        let updated = with_local_avatar(&conn, db::get_profile(&conn)?.ok_or_else(|| "profile missing".to_string())?);
        let fp = state.fingerprint.lock().clone();
        // Fan-out name to known peers so lists update without waiting for chat traffic.
        let me = updated["id"].as_str().unwrap_or("").to_string();
        let from_peer = from_peer_json(&updated, &fp);
        let peers = db::list_peers(&conn).unwrap_or_default();
        for p in peers {
            let rid = p["user_id"].as_str().unwrap_or("");
            if rid.is_empty() || rid == me {
                continue;
            }
            let oid = format!("profile-{}:{}", uuid::Uuid::new_v4(), rid);
            let payload = json!({
                "from_peer": from_peer,
                "profile_update": true,
            });
            let _ = db::enqueue_outbox(&conn, &oid, rid, "", &payload.to_string());
        }
        (updated, fp)
    };
    let _ = fingerprint;
    *state.live_display_name.lock() = name.to_string();
    *state.live_team.lock() = profile["team"].as_str().unwrap_or("").to_string();
    kick_flush(&state);
    Ok(profile)
}

#[tauri::command]
pub fn my_fingerprint(state: State<AppState>) -> String {
    state.fingerprint.lock().clone()
}

/// Keep SQLite profile pubs aligned with the JS identity used to sign messages.
/// Drift made beacons advertise key A while the UI signed with key B — peers then
/// failed signature checks / decrypt while /v1/typing (unsigned) still worked.
#[tauri::command]
pub fn sync_profile_keys(
    state: State<AppState>,
    x25519_public: String,
    ed25519_public: String,
) -> Result<Value, String> {
    let x = x25519_public.trim();
    let e = ed25519_public.trim();
    if x.is_empty() || e.is_empty() {
        return Err("public keys required".into());
    }
    let conn = state.db.lock();
    let profile = with_local_avatar(&conn, db::get_profile(&conn)?.ok_or("no profile")?);
    let id = profile["id"].as_str().unwrap_or("");
    let cur_x = profile["x25519_public"].as_str().unwrap_or("");
    let cur_e = profile["ed25519_public"].as_str().unwrap_or("");
    if cur_x == x && cur_e == e {
        return Ok(profile);
    }
    db::upsert_profile(
        &conn,
        id,
        profile["display_name"].as_str().unwrap_or(""),
        x,
        e,
        profile["listen_port"].as_i64().unwrap_or(9876),
        profile["team"].as_str().unwrap_or(""),
    )?;
    Ok(with_local_avatar(
        &conn,
        db::get_profile(&conn)?.ok_or("profile missing")?,
    ))
}

/// Soft network posture for Settings — never blocks messaging.
#[tauri::command]
pub fn network_hint() -> Value {
    let lan_ip = discovery::lan_ip();
    let corp_friendly = util::is_corp_friendly_lan_ip(&lan_ip);
    json!({
        "lan_ip": lan_ip,
        "corp_friendly": corp_friendly,
    })
}

#[tauri::command]
pub fn accept_pending_identity(state: State<AppState>, user_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    db::accept_pending_identity(&conn, &user_id)
}

