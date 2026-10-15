use super::conversations::dm_related_conversation_ids;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub(crate) fn attachments_column_value(msg: &Value) -> Option<String> {
    if let Some(arr) = msg.get("attachments").and_then(|v| v.as_array()) {
        let ids: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).filter(|s| !s.is_empty()).collect();
        if !ids.is_empty() {
            return Some(serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into()));
        }
    }
    msg.get("file_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|fid| serde_json::to_string(&vec![fid]).unwrap_or_else(|_| "[]".into()))
}

pub(crate) fn parse_attachments_field(raw: Option<String>, file_id: Option<String>) -> Value {
    if let Some(s) = raw.as_deref().filter(|s| !s.is_empty()) {
        if let Ok(v) = serde_json::from_str::<Value>(s) {
            if v.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                return v;
            }
        }
    }
    if let Some(fid) = file_id.filter(|s| !s.is_empty()) {
        return serde_json::json!([fid]);
    }
    serde_json::json!([])
}

/// Stable DM conversation id shared by both peers (must match encryption AD).
pub fn insert_message(conn: &Connection, msg: &Value) -> Result<bool, String> {
    let id = msg["id"].as_str().unwrap_or("");
    let incoming_kind = msg["kind"].as_str().unwrap_or("text");
    let existing: Option<String> = conn
        .query_row(
            "SELECT kind FROM messages WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(ref kind) = existing {
        // Don't revive a tombstone; don't clobber an existing non-delete row.
        if kind == "deleted" || incoming_kind != "deleted" {
            if incoming_kind == "deleted" && kind != "deleted" {
                tombstone_message(conn, id)?;
                return Ok(true);
            }
            return Ok(false);
        }
    }
    let created = msg["created_at"].as_str().unwrap_or("");
    // sort_at: local timeline so skewed peer clocks cannot reorder the chat.
    // Incoming delivers should pass local "now"; outbound uses created_at.
    let sort_at = msg
        .get("sort_at")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(created);
    if incoming_kind == "deleted" {
        // Ensure tombstone row exists even if original never arrived.
        conn.execute(
            r#"INSERT OR REPLACE INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, attachments, created_at, delivered, reply_to, sort_at)
               VALUES (?1,?2,?3,'deleted','','','{}','',NULL,NULL,?4,0,NULL,?5)"#,
            params![
                id,
                msg["conversation_id"].as_str().unwrap_or(""),
                msg["sender_id"].as_str().unwrap_or(""),
                created,
                sort_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        return Ok(true);
    }
    let attachments = attachments_column_value(msg);
    let file_id = msg
        .get("file_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            msg.get("attachments")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
        });
    conn.execute(
        r#"INSERT INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, attachments, created_at, delivered, reply_to, sort_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)"#,
        params![
            id,
            msg["conversation_id"].as_str().unwrap_or(""),
            msg["sender_id"].as_str().unwrap_or(""),
            incoming_kind,
            msg["ciphertext"].as_str().unwrap_or(""),
            msg["nonce"].as_str().unwrap_or(""),
            msg.get("wrapped_keys").map(|v| v.to_string()).unwrap_or_else(|| "{}".into()),
            msg["signature"].as_str().unwrap_or(""),
            file_id,
            attachments,
            created,
            msg.get("delivered").and_then(|v| v.as_bool()).unwrap_or(false) as i64,
            msg.get("reply_to").and_then(|v| v.as_str()),
            sort_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    // Side-effects for reaction / pin sync messages.
    apply_control_message(conn, msg)?;
    Ok(true)
}

/// Replace ciphertext for an existing text message (edit sync).
pub fn apply_message_edit(conn: &Connection, msg: &Value) -> Result<(), String> {
    let id = msg["id"].as_str().unwrap_or("");
    if id.is_empty() {
        return Err("missing message id".into());
    }
    let kind: Option<String> = conn
        .query_row("SELECT kind FROM messages WHERE id=?1", params![id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(kind) = kind else {
        // Original never arrived — insert as normal.
        insert_message(conn, msg)?;
        return Ok(());
    };
    if kind == "deleted" || kind != "text" {
        return Ok(());
    }
    let edited_at = msg
        .get("edited_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            msg.get("created_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    conn.execute(
        r#"UPDATE messages SET ciphertext=?2, nonce=?3, wrapped_keys=?4, signature=?5, edited_at=?6
           WHERE id=?1"#,
        params![
            id,
            msg["ciphertext"].as_str().unwrap_or(""),
            msg["nonce"].as_str().unwrap_or(""),
            msg.get("wrapped_keys")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "{}".into()),
            msg["signature"].as_str().unwrap_or(""),
            edited_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn apply_control_message(conn: &Connection, msg: &Value) -> Result<(), String> {
    let kind = msg["kind"].as_str().unwrap_or("");
    let sender = msg["sender_id"].as_str().unwrap_or("");
    let cid = msg["conversation_id"].as_str().unwrap_or("");
    let target = msg
        .get("reply_to")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let created = msg["created_at"].as_str().unwrap_or("");
    match kind {
        "reaction" => {
            let emoji = msg["ciphertext"].as_str().unwrap_or("").trim();
            if target.is_empty() || emoji.is_empty() || sender.is_empty() {
                return Ok(());
            }
            let remove = msg
                .get("remove_reaction")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if remove {
                let _ = conn.execute(
                    "DELETE FROM message_reactions WHERE message_id=?1 AND user_id=?2 AND emoji=?3",
                    params![target, sender, emoji],
                );
            } else {
                // Toggle: if same reaction exists, remove; else add (and clear other emoji from user on that message).
                let exists: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM message_reactions WHERE message_id=?1 AND user_id=?2 AND emoji=?3",
                        params![target, sender, emoji],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if exists > 0 {
                    let _ = conn.execute(
                        "DELETE FROM message_reactions WHERE message_id=?1 AND user_id=?2 AND emoji=?3",
                        params![target, sender, emoji],
                    );
                } else {
                    let _ = conn.execute(
                        "DELETE FROM message_reactions WHERE message_id=?1 AND user_id=?2",
                        params![target, sender],
                    );
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO message_reactions(message_id, user_id, emoji, created_at) VALUES (?1,?2,?3,?4)",
                        params![target, sender, emoji, created],
                    );
                }
            }
        }
        "pin" => {
            if !target.is_empty() {
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO message_pins(conversation_id, message_id, pinned_by, pinned_at) VALUES (?1,?2,?3,?4)",
                    params![cid, target, sender, created],
                );
            }
        }
        "unpin" => {
            if !target.is_empty() {
                let _ = conn.execute(
                    "DELETE FROM message_pins WHERE conversation_id=?1 AND message_id=?2",
                    params![cid, target],
                );
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn list_messages(
    conn: &Connection,
    conversation_id: &str,
    viewer_id: &str,
) -> Result<Vec<Value>, String> {
    let related = dm_related_conversation_ids(conn, conversation_id, viewer_id)?;
    let placeholders = related
        .iter()
        .map(|_| "?".to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        r#"SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.ciphertext,
                  m.nonce, m.wrapped_keys, m.signature, m.file_id, m.attachments, m.created_at,
                  m.delivered, m.reply_to, m.edited_at,
                  CASE
                    WHEN (SELECT COUNT(*) FROM outbox o
                          WHERE o.id LIKE m.id || ':%') > 0
                     AND (SELECT COUNT(*) FROM message_reads mr
                          WHERE mr.message_id=m.id) >=
                         (SELECT COUNT(*) FROM outbox o
                          WHERE o.id LIKE m.id || ':%')
                    THEN 1 ELSE 0
                  END AS is_read
           FROM messages m
           LEFT JOIN hidden_messages h
             ON h.message_id=m.id AND h.user_id=?1
           WHERE m.conversation_id IN ({placeholders})
             AND h.message_id IS NULL
             AND m.kind NOT IN ('reaction','pin','unpin')
           ORDER BY COALESCE(NULLIF(m.sort_at,''), m.created_at) ASC, m.created_at ASC, m.id ASC"#
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(1 + related.len());
    params_vec.push(&viewer_id);
    for id in &related {
        params_vec.push(id);
    }
    let rows = stmt
        .query_map(params_vec.as_slice(), |r| {
            let wraps: String = r.get(6)?;
            let wrapped_keys: Value = serde_json::from_str(&wraps).unwrap_or(serde_json::json!({}));
            let file_id: Option<String> = r.get(8)?;
            let attachments_raw: Option<String> = r.get(9)?;
            let attachments = parse_attachments_field(attachments_raw, file_id.clone());
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "conversation_id": r.get::<_, String>(1)?,
                "sender_id": r.get::<_, String>(2)?,
                "kind": r.get::<_, String>(3)?,
                "ciphertext": r.get::<_, String>(4)?,
                "nonce": r.get::<_, String>(5)?,
                "wrapped_keys": wrapped_keys,
                "signature": r.get::<_, String>(7)?,
                "file_id": file_id,
                "attachments": attachments,
                "created_at": r.get::<_, String>(10)?,
                "delivered": r.get::<_, i64>(11)? == 1,
                "reply_to": r.get::<_, Option<String>>(12)?,
                "edited_at": r.get::<_, Option<String>>(13)?,
                "read": r.get::<_, i64>(14)? == 1,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let mut msg = row.map_err(|e| e.to_string())?;
        let mid = msg["id"].as_str().unwrap_or("").to_string();
        let msg_cid = msg["conversation_id"]
            .as_str()
            .unwrap_or(conversation_id)
            .to_string();
        let (pending_count, attempts, last_error, outbox_created): (
            i64,
            i64,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(MAX(attempts),0), MAX(last_error), MIN(created_at) FROM outbox WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
                params![mid.as_str(), format!("{mid}:%")],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap_or((0, 0, None, None));
        let queued =
            pending_count > 0 && !msg["delivered"].as_bool().unwrap_or(false);
        // Soft network failures stay Queued. Only age out after 2 days, or fail
        // immediately on security/identity errors.
        let security = last_error
            .as_deref()
            .map(|e| e.contains("[SECURITY]"))
            .unwrap_or(false);
        let stale = outbox_created
            .as_deref()
            .or(msg["created_at"].as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|ts| {
                chrono::Utc::now()
                    .signed_duration_since(ts.with_timezone(&chrono::Utc))
                    .num_hours()
                    >= 48
            })
            .unwrap_or(false);
        let failed = security || (queued && stale);
        msg["failed"] = serde_json::json!(failed);
        msg["queued"] = serde_json::json!(queued && !failed);
        msg["attempts"] = serde_json::json!(attempts);
        msg["last_error"] = serde_json::json!(last_error);
        msg["reactions"] = serde_json::json!(list_reactions_for(conn, &mid).unwrap_or_default());
        msg["pinned"] =
            serde_json::json!(is_message_pinned(conn, &msg_cid, &mid).unwrap_or(false));
        out.push(msg);
    }
    Ok(out)
}

pub fn mark_message_read(conn: &Connection, message_id: &str, user_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO message_reads(message_id, user_id, read_at) VALUES (?1,?2,?3)",
        params![message_id, user_id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_reactions_for(conn: &Connection, message_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT emoji, user_id FROM message_reactions WHERE message_id=?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![message_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut map: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
    for row in rows {
        let (emoji, uid) = row.map_err(|e| e.to_string())?;
        map.entry(emoji).or_default().push(uid);
    }
    Ok(map
        .into_iter()
        .map(|(emoji, users)| {
            serde_json::json!({ "emoji": emoji, "users": users, "count": users.len() })
        })
        .collect())
}

pub fn is_message_pinned(
    conn: &Connection,
    conversation_id: &str,
    message_id: &str,
) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM message_pins WHERE conversation_id=?1 AND message_id=?2",
            params![conversation_id, message_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn list_pinned_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT message_id, pinned_by, pinned_at FROM message_pins WHERE conversation_id=?1 ORDER BY pinned_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |r| {
            Ok(serde_json::json!({
                "message_id": r.get::<_, String>(0)?,
                "pinned_by": r.get::<_, String>(1)?,
                "pinned_at": r.get::<_, String>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn delete_saved_by_message_id(conn: &Connection, message_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM saved_items WHERE message_id=?1",
        params![message_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn hide_message(conn: &Connection, user_id: &str, message_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO hidden_messages(user_id, message_id, hidden_at) VALUES (?1,?2,?3)",
        params![user_id, message_id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    // Saved is a shortcut into chat — drop it when the message is gone for me.
    let _ = delete_saved_by_message_id(conn, message_id);
    Ok(())
}

pub fn get_message(conn: &Connection, message_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, attachments, created_at, delivered FROM messages WHERE id=?1",
        params![message_id],
        |r| {
            let wraps: String = r.get(6)?;
            let wrapped_keys: Value = serde_json::from_str(&wraps).unwrap_or(serde_json::json!({}));
            let file_id: Option<String> = r.get(8)?;
            let attachments_raw: Option<String> = r.get(9)?;
            let attachments = parse_attachments_field(attachments_raw, file_id.clone());
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "conversation_id": r.get::<_, String>(1)?,
                "sender_id": r.get::<_, String>(2)?,
                "kind": r.get::<_, String>(3)?,
                "ciphertext": r.get::<_, String>(4)?,
                "nonce": r.get::<_, String>(5)?,
                "wrapped_keys": wrapped_keys,
                "signature": r.get::<_, String>(7)?,
                "file_id": file_id,
                "attachments": attachments,
                "created_at": r.get::<_, String>(10)?,
                "delivered": r.get::<_, i64>(11)? == 1,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn tombstone_message(conn: &Connection, message_id: &str) -> Result<(), String> {
    conn.execute(
        r#"UPDATE messages
           SET kind='deleted',
               ciphertext='',
               nonce='',
               wrapped_keys='{}',
               signature='',
               file_id=NULL,
               attachments=NULL
           WHERE id=?1"#,
        params![message_id],
    )
    .map_err(|e| e.to_string())?;
    let _ = delete_saved_by_message_id(conn, message_id);
    Ok(())
}

