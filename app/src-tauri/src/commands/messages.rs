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
pub fn list_messages(
    state: State<AppState>,
    conversation_id: String,
    limit: Option<u32>,
    before_sort_key: Option<String>,
    before_id: Option<String>,
) -> Result<Value, String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // Default page size for UI; pass a very large limit only for rare full scans.
    let lim = limit.unwrap_or(80) as i64;
    let page = db::list_messages_page(
        &conn,
        &conversation_id,
        &me,
        Some(lim),
        before_sort_key.as_deref(),
        before_id.as_deref(),
    )?;
    Ok(json!({
        "messages": page.messages,
        "has_more_older": page.has_more_older,
    }))
}

#[tauri::command]
pub fn retry_message(state: State<AppState>, message_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let n = db::reset_outbox_attempts(&conn, &message_id)?;
    if n == 0 {
        return Err("No pending delivery to retry".into());
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
pub fn delete_message_for_me(state: State<AppState>, message_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    db::hide_message(&conn, &me, &message_id)
}

#[tauri::command]
pub fn delete_message_for_everyone(
    state: State<AppState>,
    message_id: String,
) -> Result<Value, String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let msg = db::get_message(&conn, &message_id)?.ok_or("message missing")?;
    if msg["sender_id"].as_str() != Some(me.as_str()) {
        return Err("Only the sender can delete for everyone".into());
    }
    if msg["kind"].as_str() == Some("deleted") {
        return Ok(msg);
    }
    let conversation_id = msg["conversation_id"].as_str().unwrap_or("").to_string();
    let created_at = msg["created_at"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if !same_local_calendar_day(&created_at) {
        return Err("Cannot delete this message".into());
    }
    db::cancel_outbox_for_message(&conn, &message_id)?;
    db::tombstone_message(&conn, &message_id)?;
    let tombstone = json!({
        "id": message_id,
        "conversation_id": conversation_id,
        "sender_id": me,
        "kind": "deleted",
        "ciphertext": "",
        "nonce": "",
        "wrapped_keys": {},
        "signature": "",
        "file_id": Value::Null,
        "created_at": created_at,
        "delivered": false,
    });
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    let members = db::member_ids(&conn, &conversation_id)?;
    for rid in members {
        if rid == me {
            continue;
        }
        let oid = format!("del-{}:{}", uuid::Uuid::new_v4(), rid);
        let payload = json!({
            "message": tombstone,
            "from_peer": from_peer,
            "conversation_id": conversation_id,
            "delete_for_everyone": true,
        });
        db::enqueue_outbox(
            &conn,
            &oid,
            &rid,
            &conversation_id,
            &payload.to_string(),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(tombstone)
}

#[tauri::command]
pub fn send_message(
    state: State<AppState>,
    conversation_id: String,
    message: Value,
    recipient_ids: Vec<String>,
    edit: Option<bool>,
) -> Result<Value, String> {
    let is_edit = edit.unwrap_or(false);
    let mut msg = message;
    if msg.get("id").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        if is_edit {
            return Err("edit requires message id".into());
        }
        msg["id"] = json!(uuid::Uuid::new_v4().to_string());
    }
    if msg.get("created_at").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        msg["created_at"] = json!(now());
    }
    if is_edit {
        msg["edited_at"] = json!(now());
    }
    msg["conversation_id"] = json!(conversation_id);
    msg["delivered"] = json!(false);
    if msg.get("sort_at").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        msg["sort_at"] = msg["created_at"].clone();
    }

    let fingerprint = state.fingerprint.lock().clone();
    let profile = {
        let conn = state.db.lock();
        // Refuse outbound DMs to a blocked peer.
        {
            let kind: Option<String> = conn
                .query_row(
                    "SELECT kind FROM conversations WHERE id=?1",
                    rusqlite::params![conversation_id],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let is_dm = kind.as_deref() == Some("dm") || conversation_id.starts_with("dm:");
            if is_dm {
                for rid in &recipient_ids {
                    if db::peer_blocked(&conn, rid).unwrap_or(false) {
                        return Err("This person is blocked. Unblock them to send messages.".into());
                    }
                }
            }
        }
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        let result = (|| -> Result<Value, String> {
            let profile = db::get_profile(&conn)?.ok_or("no profile")?;
            let me = profile["id"].as_str().unwrap_or("");
            if is_edit {
                let mid = msg["id"].as_str().unwrap_or("");
                let existing = db::get_message(&conn, mid)?.ok_or("message missing")?;
                if existing["sender_id"].as_str() != Some(me) {
                    return Err("Only the sender can edit".into());
                }
                let created = existing["created_at"].as_str().unwrap_or("");
                if !same_local_calendar_day(created) {
                    return Err("Cannot edit this message".into());
                }
                db::apply_message_edit(&conn, &msg)?;
            } else {
                db::insert_message(&conn, &msg)?;
            }
            let from_peer = json!({
                "user_id": profile["id"],
                "display_name": profile["display_name"],
                "x25519_public": profile["x25519_public"],
                "ed25519_public": profile["ed25519_public"],
                "last_port": profile["listen_port"],
                "tls_fingerprint": fingerprint,
                "last_ip": discovery::lan_ip(),
            });
            let title = conn
                .query_row(
                    "SELECT title FROM conversations WHERE id=?1",
                    rusqlite::params![conversation_id.as_str()],
                    |r| r.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten();
            let is_group = conn
                .query_row(
                    "SELECT kind FROM conversations WHERE id=?1",
                    rusqlite::params![conversation_id.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .ok()
                .flatten()
                .as_deref()
                == Some("group")
                || conversation_id.starts_with("group:");
            for rid in &recipient_ids {
                if rid == me {
                    continue;
                }
                let out_id = msg["id"].as_str().unwrap_or("").to_string();
                let oid = if is_edit {
                    format!("edit-{}:{}:{}", out_id, uuid::Uuid::new_v4(), rid)
                } else {
                    format!("{out_id}:{rid}")
                };
                let mut payload = json!({
                    "message": msg,
                    "from_peer": from_peer,
                    "conversation_id": conversation_id,
                });
                if is_edit {
                    payload["edit"] = json!(true);
                }
                // Ship all attachment file metadata so peers can download album/media bundles.
                let mut file_ids: Vec<String> = msg
                    .get("attachments")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .filter(|s| !s.is_empty())
                            .collect()
                    })
                    .unwrap_or_default();
                if file_ids.is_empty() {
                    if let Some(fid) = msg
                        .get("file_id")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                    {
                        file_ids.push(fid.to_string());
                    }
                }
                let mut files_out = Vec::new();
                for fid in &file_ids {
                    if let Ok(Some(mut file)) = db::get_file(&conn, fid) {
                        file["staging_dir"] = Value::Null;
                        file["local_path"] = Value::Null;
                        files_out.push(file);
                    }
                }
                if let Some(first) = files_out.first() {
                    payload["file"] = first.clone();
                }
                if files_out.len() > 1 {
                    payload["files"] = Value::Array(files_out);
                } else if files_out.len() == 1 {
                    // Still include files array for newer clients.
                    payload["files"] = Value::Array(files_out);
                }
                if let Ok(Some(w)) = db::get_wrapped_group_key(&conn, conversation_id.as_str(), rid) {
                    payload["wrapped_group_key"] = json!(w);
                } else if is_group {
                    eprintln!(
                        "[GroupSync:send_message:missing_wrap] group_id={} msg_id={} sender={} recipient={} — recipient may not decrypt until wrap is repaired",
                        conversation_id, out_id, me, rid
                    );
                }
                if let Some(ref t) = title {
                    payload["group_title"] = json!(t);
                }
                if is_group {
                    if let Ok(roster) = db::list_members(&conn, conversation_id.as_str()) {
                        payload["members"] = json!(roster);
                    }
                    println!(
                        "[GroupSync:send_message] group_id={} msg_id={} sender={} recipient={} has_wrap={} roster_len={}",
                        conversation_id,
                        out_id,
                        me,
                        rid,
                        payload.get("wrapped_group_key").is_some(),
                        payload.get("members").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0)
                    );
                }
                db::enqueue_outbox(
                    &conn,
                    &oid,
                    rid,
                    conversation_id.as_str(),
                    &payload.to_string(),
                )?;
            }
            let mut ack_ids: Vec<String> = msg
                .get("attachments")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            if ack_ids.is_empty() {
                if let Some(fid) = msg
                    .get("file_id")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                {
                    ack_ids.push(fid.to_string());
                }
            }
            for fid in ack_ids {
                let _ = db::ack_file(&conn, &fid, me);
            }
            Ok(profile)
        })();
        match result {
            Ok(p) => {
                conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                p
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
    };

    let _ = profile;
    {
        let conn = state.db.lock();
        for rid in &recipient_ids {
            let _ = db::clear_peer_outbox_backoff(&conn, rid);
        }
    }
    kick_flush(&state);
    Ok(msg)
}

