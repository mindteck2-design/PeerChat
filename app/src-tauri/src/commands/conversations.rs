#![allow(unused_imports)]
use crate::commands::settings::board_slug;
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
pub fn set_conversation_pinned(
    state: State<AppState>,
    conversation_id: String,
    pinned: bool,
) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_conversation_pinned(&conn, &conversation_id, pinned)
}

#[tauri::command]
pub fn set_conversation_muted(
    state: State<AppState>,
    conversation_id: String,
    muted: bool,
) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_conversation_muted(&conn, &conversation_id, muted)
}

#[tauri::command]
pub fn list_pinned_messages(
    state: State<AppState>,
    conversation_id: String,
) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_pinned_messages(&conn, &conversation_id)
}

#[tauri::command]
pub fn conversation_is_muted(state: State<AppState>, conversation_id: String) -> Result<bool, String> {
    let conn = state.db.lock();
    db::conversation_muted(&conn, &conversation_id)
}

#[tauri::command]
pub fn list_conversations(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_conversations(&conn)
}

#[tauri::command]
pub fn open_dm(state: State<AppState>, peer_id: String) -> Result<Value, String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let id = db::ensure_dm(&conn, &me, &peer_id)?;
    let peer_name = db::get_peer(&conn, &peer_id)?
        .and_then(|p| p["display_name"].as_str().map(|s| s.to_string()));
    Ok(json!({
        "id": id,
        "kind": "dm",
        "peer_id": peer_id,
        "peer_name": peer_name,
        "created_at": now(),
    }))
}

#[tauri::command]
pub fn mark_conversation_read(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let unread = db::unread_incoming(&conn, &conversation_id, &me)?;
    let mut by_sender: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (message_id, sender_id) in unread {
        db::mark_message_read(&conn, &message_id, &me)?;
        by_sender.entry(sender_id).or_default().push(message_id);
    }
    for (sender_id, ids) in by_sender {
        let oid = format!("read-{}:{sender_id}", uuid::Uuid::new_v4());
        let payload = json!({
            "reader_id": me,
            "read_receipts": ids,
        });
        db::enqueue_outbox(
            &conn,
            &oid,
            &sender_id,
            &conversation_id,
            &payload.to_string(),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
pub fn delete_conversation_local(
    state: State<AppState>,
    conversation_id: String,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("");
    let kind: Option<String> = conn
        .query_row(
            "SELECT kind FROM conversations WHERE id=?1",
            rusqlite::params![conversation_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(kind) = kind else {
        return Err("conversation not found".into());
    };
    if kind == "group" {
        let still_member = db::member_ids(&conn, &conversation_id)?
            .iter()
            .any(|id| id == me);
        if still_member {
            return Err("Leave the group before removing it from your chat list".into());
        }
    }
    db::delete_conversation_local(&conn, &conversation_id)
}

#[tauri::command]
pub fn ensure_announcement_boards(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if me.is_empty() {
        return Err("no profile".into());
    }
    let team = profile["team"].as_str().unwrap_or("").to_string();
    let mut out = Vec::new();
    out.push(db::ensure_announcement_board(
        &conn,
        "board:org",
        "Org updates",
        &me,
    )?);
    if let Some(slug) = board_slug(&team) {
        let title = format!("{} · Announcements", team.trim());
        out.push(db::ensure_announcement_board(
            &conn,
            &format!("board:team:{slug}"),
            &title,
            &me,
        )?);
    }
    Ok(out)
}

/// Add discovered peers that share our team onto the team announcement board.
#[tauri::command]
pub fn sync_team_announcement_members(
    state: State<AppState>,
    peer_ids: Vec<String>,
    wrapped_group_keys: Value,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let team = profile["team"].as_str().unwrap_or("").to_string();
    let Some(slug) = board_slug(&team) else {
        return Ok(());
    };
    let board_id = format!("board:team:{slug}");
    let _ = db::ensure_announcement_board(
        &conn,
        &board_id,
        &format!("{} · Announcements", team.trim()),
        &me,
    )?;
    let wraps = wrapped_group_keys
        .as_object()
        .cloned()
        .unwrap_or_default();
    let mut pairs: Vec<(String, String)> = Vec::new();
    for pid in peer_ids {
        if pid == me || pid.is_empty() {
            continue;
        }
        if let Some(w) = wraps.get(&pid).and_then(|v| v.as_str()) {
            pairs.push((pid, w.to_string()));
        }
    }
    if pairs.is_empty() {
        return Ok(());
    }
    // Reuse add path: upsert members + wraps, notify via existing add_group_members logic is heavier;
    // here we only upsert local membership/wraps — peers get wraps when they sync their own board.
    for (uid, wrap) in &pairs {
        db::upsert_member(&conn, &board_id, uid, Some(wrap.as_str()), None)?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_conversation_messages(
    state: State<AppState>,
    conversation_id: String,
    include_files: bool,
) -> Result<(), String> {
    let conn = state.db.lock();
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversations WHERE id=?1",
            rusqlite::params![conversation_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err("conversation not found".into());
    }
    db::clear_conversation_messages(&conn, &conversation_id, include_files)
}

