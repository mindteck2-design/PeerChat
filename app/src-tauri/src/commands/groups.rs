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
pub fn create_group(
    state: State<AppState>,
    title: String,
    member_ids: Vec<String>,
    wrapped_group_keys: Value,
) -> Result<Value, String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let mut members = vec![(
        me.clone(),
        wrapped_group_keys
            .get(me.as_str())
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    )];
    for mid in &member_ids {
        members.push((
            mid.clone(),
            wrapped_group_keys
                .get(mid.as_str())
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        ));
    }
    db::create_group(&conn, &id, &title, &me, &members)?;
    Ok(json!({
        "id": id,
        "kind": "group",
        "title": title,
        "created_at": now(),
    }))
}

#[tauri::command]
pub fn get_group_key(state: State<AppState>, conversation_id: String) -> Result<Option<String>, String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    db::get_wrapped_group_key(&conn, &conversation_id, &me)
}

/// Persist / repair the signed-in user's wrapped group key (e.g. solo group).
#[tauri::command]
pub fn set_my_group_key(
    state: State<AppState>,
    conversation_id: String,
    wrapped_group_key: String,
) -> Result<(), String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if me.is_empty() {
        return Err("no profile".into());
    }
    if !db::is_conversation_member(&conn, &conversation_id, &me)? {
        return Err("not a member of this group".into());
    }
    db::update_member_wraps(
        &conn,
        &conversation_id,
        &[(me, wrapped_group_key)],
    )
}

#[tauri::command]
pub fn member_ids(state: State<AppState>, conversation_id: String) -> Result<Vec<String>, String> {
    let conn = state.db.lock();
    db::member_ids(&conn, &conversation_id)
}

#[tauri::command]
pub fn list_group_members(state: State<AppState>, conversation_id: String) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_members(&conn, &conversation_id)
}

#[tauri::command]
pub fn add_group_members(
    state: State<AppState>,
    conversation_id: String,
    wrapped_group_keys: Value,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let is_admin = db::is_group_admin(&conn, &conversation_id, &me)?;
    let can_add = is_admin
        || (db::is_conversation_member(&conn, &conversation_id, &me).unwrap_or(false)
            && db::members_can_add(&conn, &conversation_id)?);
    if !can_add {
        return Err("Only admins can add members in this group".into());
    }
    let title = db::conversation_title(&conn, &conversation_id)?
        .unwrap_or_else(|| "Group".into());
    if let Some(map) = wrapped_group_keys.as_object() {
        for (uid, wrapv) in map {
            if uid == &me {
                continue;
            }
            let wrap = wrapv.as_str();
            let name = db::display_name_for(&conn, uid);
            db::upsert_member(&conn, &conversation_id, uid, wrap, Some(name.as_str()))?;
        }
    }
    let roster = Value::Array(
        db::list_members(&conn, &conversation_id)?
            .into_iter()
            .collect(),
    );
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    let members = db::member_ids(&conn, &conversation_id)?;
    for rid in members {
        if rid == me {
            continue;
        }
        let wrap = db::get_wrapped_group_key(&conn, &conversation_id, &rid)?;
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            wrap,
            &roster,
            "sync",
            None,
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
pub fn remove_group_member(
    state: State<AppState>,
    conversation_id: String,
    user_id: String,
    wrapped_group_keys: Option<Value>,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if user_id == me {
        return Err("use leave to exit the group".into());
    }
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can remove members".into());
    }
    let title = db::conversation_title(&conn, &conversation_id)?
        .unwrap_or_else(|| "Group".into());
    let notify = db::member_ids(&conn, &conversation_id)?;
    db::delete_member(&conn, &conversation_id, &user_id)?;
    let _ = db::ensure_group_admin(&conn, &conversation_id)?;
    // Rotate group key for remaining members when wraps are provided.
    if let Some(wraps) = wrapped_group_keys.as_ref().and_then(|v| v.as_object()) {
        let pairs: Vec<(String, String)> = wraps
            .iter()
            .filter_map(|(uid, w)| w.as_str().map(|s| (uid.clone(), s.to_string())))
            .filter(|(uid, _)| uid != &user_id)
            .collect();
        db::update_member_wraps(&conn, &conversation_id, &pairs)?;
    }
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in notify {
        if rid == me || rid == user_id {
            // Still notify removed user of removal; remaining get new wraps.
        }
        if rid == me {
            continue;
        }
        let wrap = db::get_wrapped_group_key(&conn, &conversation_id, &rid)?;
        let op = if rid == user_id { "remove" } else { "sync" };
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            wrap,
            &roster,
            op,
            Some(user_id.as_str()),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
pub fn leave_group(
    state: State<AppState>,
    conversation_id: String,
    wrapped_group_keys: Option<Value>,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let title = db::conversation_title(&conn, &conversation_id)?
        .unwrap_or_else(|| "Group".into());
    let notify = db::member_ids(&conn, &conversation_id)?;
    db::delete_member(&conn, &conversation_id, &me)?;
    let _ = db::ensure_group_admin(&conn, &conversation_id)?;
    if let Some(wraps) = wrapped_group_keys.as_ref().and_then(|v| v.as_object()) {
        let pairs: Vec<(String, String)> = wraps
            .iter()
            .filter_map(|(uid, w)| w.as_str().map(|s| (uid.clone(), s.to_string())))
            .filter(|(uid, _)| uid != &me)
            .collect();
        db::update_member_wraps(&conn, &conversation_id, &pairs)?;
    }
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in notify {
        if rid == me {
            continue;
        }
        let wrap = db::get_wrapped_group_key(&conn, &conversation_id, &rid)?;
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            wrap,
            &roster,
            "sync",
            Some(me.as_str()),
        )?;
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            None,
            &roster,
            "remove",
            Some(me.as_str()),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
pub fn rename_group(
    state: State<AppState>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("title required".into());
    }
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can rename".into());
    }
    db::set_conversation_title(&conn, &conversation_id, &title)?;
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in db::member_ids(&conn, &conversation_id)? {
        if rid == me {
            continue;
        }
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            None,
            &roster,
            "rename",
            None,
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
pub fn delete_group(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can delete the group".into());
    }
    let title = db::conversation_title(&conn, &conversation_id)?.unwrap_or_else(|| "Group".into());
    let notify = db::member_ids(&conn, &conversation_id)?;
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in &notify {
        if rid == &me {
            continue;
        }
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            rid,
            &title,
            None,
            &roster,
            "delete",
            None,
        )?;
    }
    db::delete_conversation_local(&conn, &conversation_id)?;
    drop(conn);
    kick_flush(&state);
    Ok(())
}

/// Clear messages in a chat on this device only (does not notify peers).
/// Remove a conversation from this device only (e.g. a group after leaving).
#[tauri::command]
pub fn set_group_members_can_add(
    state: State<AppState>,
    conversation_id: String,
    allowed: bool,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can change this setting".into());
    }
    db::set_members_can_add(&conn, &conversation_id, allowed)?;
    let title = db::conversation_title(&conn, &conversation_id)?.unwrap_or_else(|| "Group".into());
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in db::member_ids(&conn, &conversation_id)? {
        if rid == me {
            continue;
        }
        enqueue_group_event_extra(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            None,
            &roster,
            "settings",
            None,
            Some(json!({ "members_can_add": allowed })),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
pub fn set_group_member_role(
    state: State<AppState>,
    conversation_id: String,
    user_id: String,
    role: String,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can change roles".into());
    }
    db::set_member_role(&conn, &conversation_id, &user_id, &role)?;
    let title = db::conversation_title(&conn, &conversation_id)?.unwrap_or_else(|| "Group".into());
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in db::member_ids(&conn, &conversation_id)? {
        if rid == me {
            continue;
        }
        enqueue_group_event_extra(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            None,
            &roster,
            "role",
            Some(user_id.as_str()),
            Some(json!({ "role": role })),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

