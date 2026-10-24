#![allow(unused_imports)]
use crate::db;
use crate::runtime::outbox::kick_flush;
use crate::state::AppState;
use crate::util::{from_peer_json, now};
use serde_json::{json, Value};
use tauri::State;
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

const CAL_CONV: &str = "calendar:share";

fn participant_id_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn enqueue_calendar_share(
    conn: &rusqlite::Connection,
    from_peer: &Value,
    recipient_id: &str,
    share: &Value,
) -> Result<(), String> {
    let oid = format!("cal-{}:{}", Uuid::new_v4(), recipient_id);
    let payload = json!({
        "from_peer": from_peer,
        "conversation_id": CAL_CONV,
        "calendar_share": share,
    });
    db::enqueue_outbox(conn, &oid, recipient_id, CAL_CONV, &payload.to_string())
}

fn fanout_to_participants(
    state: &AppState,
    me: &str,
    from_peer: &Value,
    recipients: &[String],
    share: &Value,
) -> Result<(), String> {
    if recipients.is_empty() {
        return Ok(());
    }
    {
        let conn = state.db.lock();
        for rid in recipients {
            if rid == me {
                continue;
            }
            enqueue_calendar_share(&conn, from_peer, rid, share)?;
        }
    }
    kick_flush(state);
    Ok(())
}

fn reject_past_restricted(kind: &str, day: &str) -> Result<(), String> {
    let today = db::local_today();
    if day < today.as_str() && matches!(kind, "reminder" | "todo" | "meeting") {
        return Err("cannot create or edit reminders, to-dos, or meetings on past days".into());
    }
    Ok(())
}

/// Keep check state from previous options when the owner renames/reorders the checklist.
fn merge_checklist_preserve_checks(incoming: &Value, previous: &Value) -> Value {
    let prev_map: std::collections::HashMap<String, Value> = previous
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|o| {
                    let id = o.get("id").and_then(|v| v.as_str())?.to_string();
                    Some((id, o.clone()))
                })
                .collect()
        })
        .unwrap_or_default();
    let Some(arr) = incoming.as_array() else {
        return previous.clone();
    };
    let merged: Vec<Value> = arr
        .iter()
        .filter_map(|o| {
            let id = o.get("id").and_then(|v| v.as_str())?;
            let label = o.get("label").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if label.trim().is_empty() {
                return None;
            }
            if let Some(old) = prev_map.get(id) {
                Some(json!({
                    "id": id,
                    "label": label,
                    "checked_by": old.get("checked_by").cloned().unwrap_or_else(|| json!([])),
                    "check_at": old.get("check_at").cloned().unwrap_or_else(|| json!({})),
                }))
            } else {
                Some(json!({
                    "id": id,
                    "label": label,
                    "checked_by": [],
                    "check_at": {},
                }))
            }
        })
        .collect();
    json!(merged)
}

#[tauri::command]
pub fn list_calendar_items(
    state: State<'_, AppState>,
    from_day: String,
    to_day: String,
) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_calendar_items(&conn, &from_day, &to_day)
}

#[tauri::command]
pub async fn upsert_calendar_item(
    state: State<'_, AppState>,
    item: Value,
) -> Result<Value, String> {
    let (me, from_peer, row) = {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("").to_string();
        if me.is_empty() {
            return Err("no profile".into());
        }
        let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
        let mut row = item;
        let id = row
            .get("id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        row["id"] = json!(id);
        if let Some(existing) = db::get_calendar_item(&conn, &id)? {
            let owner = existing["created_by"].as_str().unwrap_or("");
            if owner != me {
                return Err("only the owner can edit this calendar item".into());
            }
            // Keep original owner.
            row["created_by"] = json!(owner);
            // Preserve live checklist checks / acks unless explicitly replaced for structure edits.
            if row.get("acks").is_none() {
                row["acks"] = existing.get("acks").cloned().unwrap_or_else(|| json!({}));
            }
            if row.get("checklist").is_none() {
                row["checklist"] = existing
                    .get("checklist")
                    .cloned()
                    .unwrap_or_else(|| json!([]));
            } else if existing["kind"].as_str() == Some("todo") {
                // Merge: keep checked_by / check_at from existing options with same id.
                let incoming = row.get("checklist").cloned().unwrap_or_else(|| json!([]));
                let prev = existing.get("checklist").cloned().unwrap_or_else(|| json!([]));
                row["checklist"] = merge_checklist_preserve_checks(&incoming, &prev);
            }
        } else if row
            .get("created_by")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .is_empty()
        {
            row["created_by"] = json!(me);
        }
        let stamp = now();
        if row
            .get("created_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .is_empty()
        {
            row["created_at"] = json!(stamp);
        }
        row["updated_at"] = json!(stamp);
        let kind = row["kind"].as_str().unwrap_or("note").to_string();
        let day = row["day"].as_str().unwrap_or("").to_string();
        reject_past_restricted(&kind, &day)?;
        if kind == "todo" {
            let checklist = row.get("checklist").cloned().unwrap_or_else(|| json!([]));
            let opts = checklist.as_array().cloned().unwrap_or_default();
            let labeled: Vec<_> = opts
                .into_iter()
                .filter(|o| {
                    o.get("label")
                        .and_then(|v| v.as_str())
                        .map(|s| !s.trim().is_empty())
                        .unwrap_or(false)
                })
                .collect();
            if labeled.is_empty() {
                return Err("Add at least one option".into());
            }
            row["checklist"] = json!(labeled);
            row["body"] = json!("");
        }
        let mut parts = participant_id_list(&row["participant_ids"]);
        parts.retain(|p| p != &me);
        parts.sort();
        parts.dedup();
        row["participant_ids"] = json!(parts);
        row["shared"] = json!(!parts.is_empty());
        db::upsert_calendar_item(&conn, &row)?;
        let saved = db::get_calendar_item(&conn, row["id"].as_str().unwrap_or(""))?
            .ok_or("failed to read calendar item")?;
        (me, from_peer, saved)
    };

    let recipients = participant_id_list(&row["participant_ids"]);
    if !recipients.is_empty() {
        fanout_to_participants(
            &state,
            &me,
            &from_peer,
            &recipients,
            &json!({ "op": "upsert", "item": row }),
        )?;
    }
    Ok(row)
}

#[tauri::command]
pub async fn delete_calendar_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let (me, from_peer, recipients, tombstone) = {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("").to_string();
        let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
        let existing = db::get_calendar_item(&conn, &id)?.ok_or("calendar item not found")?;
        let owner = existing["created_by"].as_str().unwrap_or("");
        if owner != me {
            return Err("only the owner can delete this calendar item".into());
        }
        let recipients = participant_id_list(&existing["participant_ids"]);
        let tombstone = json!({
            "id": id,
            "title": existing["title"],
            "day": existing["day"],
            "created_by": existing["created_by"],
        });
        db::delete_calendar_item(&conn, &id)?;
        (me, from_peer, recipients, tombstone)
    };
    if !recipients.is_empty() {
        fanout_to_participants(
            &state,
            &me,
            &from_peer,
            &recipients,
            &json!({ "op": "delete", "item": tombstone }),
        )?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_calendar_todo_done(
    state: State<'_, AppState>,
    id: String,
    done: bool,
) -> Result<Value, String> {
    let conn = state.db.lock();
    db::set_calendar_todo_done(&conn, &id, done)?;
    db::get_calendar_item(&conn, &id)?.ok_or_else(|| "calendar item not found".into())
}

#[tauri::command]
pub async fn toggle_calendar_checklist_option(
    state: State<'_, AppState>,
    id: String,
    option_id: String,
    checked: bool,
) -> Result<Value, String> {
    let stamp = now();
    let (me, from_peer, recipients, saved) = {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("").to_string();
        let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
        let saved = db::apply_checklist_toggle(&conn, &id, &option_id, &me, checked, &stamp)?;
        let mut recipients = participant_id_list(&saved["participant_ids"]);
        let owner = saved["created_by"].as_str().unwrap_or("");
        if !owner.is_empty() && owner != me && !recipients.iter().any(|r| r == owner) {
            recipients.push(owner.to_string());
        }
        (me, from_peer, recipients, saved)
    };
    fanout_to_participants(
        &state,
        &me,
        &from_peer,
        &recipients,
        &json!({
            "op": "checklist_toggle",
            "item_id": id,
            "option_id": option_id,
            "user_id": me,
            "checked": checked,
            "updated_at": stamp,
        }),
    )?;
    Ok(saved)
}

#[tauri::command]
pub async fn ack_calendar_item(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let stamp = now();
    let (me, from_peer, recipients, saved) = {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("").to_string();
        let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
        let saved = db::apply_calendar_ack(&conn, &id, &me, &stamp)?;
        let mut recipients = participant_id_list(&saved["participant_ids"]);
        let owner = saved["created_by"].as_str().unwrap_or("");
        if !owner.is_empty() && owner != me && !recipients.iter().any(|r| r == owner) {
            recipients.push(owner.to_string());
        }
        (me, from_peer, recipients, saved)
    };
    fanout_to_participants(
        &state,
        &me,
        &from_peer,
        &recipients,
        &json!({
            "op": "ack",
            "item_id": id,
            "user_id": me,
            "at": stamp,
        }),
    )?;
    Ok(saved)
}

/// Check due reminders/meetings and fire desktop toasts once each.
#[tauri::command]
pub fn poll_calendar_due(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<u32, String> {
    use chrono::Local;
    let local = Local::now();
    let now_local = local.format("%Y-%m-%dT%H:%M").to_string();
    let due = {
        let conn = state.db.lock();
        db::due_calendar_items(&conn, &now_local)?
    };
    let mut n = 0u32;
    for item in due {
        let id = item["id"].as_str().unwrap_or("");
        let title = item["title"].as_str().unwrap_or("Reminder");
        let kind = item["kind"].as_str().unwrap_or("reminder");
        let day = item["day"].as_str().unwrap_or("");
        let time = item.get("time").and_then(|v| v.as_str()).unwrap_or("");
        let body = if time.is_empty() {
            format!("{kind} · {day}")
        } else {
            format!("{kind} · {day} {time}")
        };
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(&body)
            .show();
        {
            let conn = state.db.lock();
            let _ = db::mark_calendar_notified(&conn, id);
        }
        n += 1;
    }
    Ok(n)
}
