use super::conversations::dm_related_conversation_ids;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};

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
                // Soft cap: if this chat is full, drop the oldest pin so inbound
                // pins from peers still apply (local UI refuses before sending).
                let already: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM message_pins WHERE conversation_id=?1 AND message_id=?2",
                        params![cid, target],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if already == 0 {
                    let n = count_pinned_messages(conn, cid).unwrap_or(0);
                    if n >= MAX_PINNED_MESSAGES_PER_CHAT {
                        let _ = conn.execute(
                            "DELETE FROM message_pins WHERE conversation_id=?1 AND message_id=(
                               SELECT message_id FROM message_pins
                               WHERE conversation_id=?1
                               ORDER BY pinned_at ASC, message_id ASC
                               LIMIT 1
                             )",
                            params![cid],
                        );
                    }
                }
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

pub struct MessagePage {
    pub messages: Vec<Value>,
    pub has_more_older: bool,
}

/// Full history (tests / legacy). Prefer `list_messages_page` for UI.
#[allow(dead_code)]
pub fn list_messages(
    conn: &Connection,
    conversation_id: &str,
    viewer_id: &str,
) -> Result<Vec<Value>, String> {
    Ok(list_messages_page(conn, conversation_id, viewer_id, None, None, None)?.messages)
}

/// Cursor-paginated messages. `limit = None` → all (ASC). With limit, newest page
/// older than optional before-cursor, returned ASC for the chat UI.
pub fn list_messages_page(
    conn: &Connection,
    conversation_id: &str,
    viewer_id: &str,
    limit: Option<i64>,
    before_sort_key: Option<&str>,
    before_id: Option<&str>,
) -> Result<MessagePage, String> {
    let related = dm_related_conversation_ids(conn, conversation_id, viewer_id)?;
    let placeholders = related
        .iter()
        .map(|_| "?".to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sort_expr = "COALESCE(NULLIF(m.sort_at,''), m.created_at)";

    let mut sql = format!(
        r#"SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.ciphertext,
                  m.nonce, m.wrapped_keys, m.signature, m.file_id, m.attachments, m.created_at,
                  m.delivered, m.reply_to, m.edited_at, {sort_expr} AS sort_key
           FROM messages m
           LEFT JOIN hidden_messages h
             ON h.message_id=m.id AND h.user_id=?1
           WHERE m.conversation_id IN ({placeholders})
             AND h.message_id IS NULL
             AND m.kind NOT IN ('reaction','pin','unpin')"#
    );

    let mut params_owned: Vec<String> = Vec::new();
    params_owned.push(viewer_id.to_string());
    for id in &related {
        params_owned.push(id.clone());
    }

    if let (Some(bsk), Some(bid)) = (before_sort_key, before_id) {
        let p_sk = params_owned.len() + 1;
        let p_id = params_owned.len() + 2;
        sql.push_str(&format!(
            " AND ({sort_expr} < ?{p_sk} OR ({sort_expr} = ?{p_sk} AND m.id < ?{p_id}))"
        ));
        params_owned.push(bsk.to_string());
        params_owned.push(bid.to_string());
    }

    if let Some(lim) = limit {
        let p = params_owned.len() + 1;
        sql.push_str(&format!(
            " ORDER BY {sort_expr} DESC, m.created_at DESC, m.id DESC LIMIT ?{p}"
        ));
        params_owned.push(lim.to_string());
    } else {
        sql.push_str(&format!(
            " ORDER BY {sort_expr} ASC, m.created_at ASC, m.id ASC"
        ));
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params_owned
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |r| {
            let wraps: String = r.get(6)?;
            let wrapped_keys: Value =
                serde_json::from_str(&wraps).unwrap_or(serde_json::json!({}));
            let file_id: Option<String> = r.get(8)?;
            let attachments_raw: Option<String> = r.get(9)?;
            let attachments = parse_attachments_field(attachments_raw, file_id.clone());
            let sort_key: String = r.get(14)?;
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
                "sort_at": sort_key,
                "read": false,
            }))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }

    let has_more_older = limit.map(|lim| out.len() as i64 >= lim).unwrap_or(false);
    if limit.is_some() {
        out.reverse();
    }

    enrich_messages_batch(conn, &mut out)?;
    Ok(MessagePage {
        messages: out,
        has_more_older,
    })
}

fn enrich_messages_batch(conn: &Connection, messages: &mut [Value]) -> Result<(), String> {
    if messages.is_empty() {
        return Ok(());
    }
    let ids: Vec<String> = messages
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();
    let id_set: HashSet<&str> = ids.iter().map(|s| s.as_str()).collect();

    // Reactions — one query.
    let mut reactions_by_msg: HashMap<String, BTreeMap<String, Vec<String>>> = HashMap::new();
    {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT message_id, emoji, user_id FROM message_reactions WHERE message_id IN ({placeholders}) ORDER BY created_at ASC"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (mid, emoji, uid) = row.map_err(|e| e.to_string())?;
            reactions_by_msg
                .entry(mid)
                .or_default()
                .entry(emoji)
                .or_default()
                .push(uid);
        }
    }

    // Pins for these message ids.
    let mut pinned: HashSet<String> = HashSet::new();
    {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT message_id FROM message_pins WHERE message_id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(params.as_slice(), |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            pinned.insert(row.map_err(|e| e.to_string())?);
        }
    }

    struct PendingInfo {
        count: i64,
        attempts: i64,
        last_error: Option<String>,
        outbox_created: Option<String>,
    }
    let mut pending: HashMap<String, PendingInfo> = HashMap::new();
    let mut outbox_total: HashMap<String, i64> = HashMap::new();

    // Outbox rows for this page only (OR id LIKE '{mid}:%'), chunked.
    {
        for chunk in ids.chunks(40) {
            let mut clauses = Vec::with_capacity(chunk.len() * 2);
            let mut like_params: Vec<String> = Vec::with_capacity(chunk.len() * 2);
            for mid in chunk {
                clauses.push("id = ?");
                like_params.push(mid.clone());
                clauses.push("id LIKE ?");
                like_params.push(format!("{mid}:%"));
            }
            let sql = format!(
                "SELECT id, attempts, last_error, created_at, delivered_at FROM outbox WHERE {}",
                clauses.join(" OR ")
            );
            let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
            let prefs: Vec<&dyn rusqlite::ToSql> = like_params
                .iter()
                .map(|s| s as &dyn rusqlite::ToSql)
                .collect();
            let rows = stmt
                .query_map(prefs.as_slice(), |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, Option<String>>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                let (oid, attempts, last_error, created, delivered_at) =
                    row.map_err(|e| e.to_string())?;
                let mid = oid.split(':').next().unwrap_or(oid.as_str());
                if !id_set.contains(mid) {
                    continue;
                }
                *outbox_total.entry(mid.to_string()).or_default() += 1;
                if delivered_at.is_some() {
                    continue;
                }
                let e = pending.entry(mid.to_string()).or_insert(PendingInfo {
                    count: 0,
                    attempts: 0,
                    last_error: None,
                    outbox_created: None,
                });
                e.count += 1;
                e.attempts = e.attempts.max(attempts);
                if e.last_error.is_none() {
                    e.last_error = last_error;
                }
                match &e.outbox_created {
                    Some(prev) if prev.as_str() <= created.as_str() => {}
                    _ => e.outbox_created = Some(created),
                }
            }
        }
    }

    let mut reads_count: HashMap<String, i64> = HashMap::new();
    {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT message_id, COUNT(*) FROM message_reads WHERE message_id IN ({placeholders}) GROUP BY message_id"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(params.as_slice(), |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (mid, n) = row.map_err(|e| e.to_string())?;
            reads_count.insert(mid, n);
        }
    }

    for msg in messages.iter_mut() {
        let mid = msg["id"].as_str().unwrap_or("").to_string();
        let delivered = msg["delivered"].as_bool().unwrap_or(false);
        let total = *outbox_total.get(&mid).unwrap_or(&0);
        let reads = *reads_count.get(&mid).unwrap_or(&0);
        msg["read"] = serde_json::json!(total > 0 && reads >= total);

        let pinfo = pending.get(&mid);
        let queued = pinfo.map(|p| p.count > 0).unwrap_or(false) && !delivered;
        let last_error = pinfo.and_then(|p| p.last_error.clone());
        let attempts = pinfo.map(|p| p.attempts).unwrap_or(0);
        let security = last_error
            .as_deref()
            .map(|e| e.contains("[SECURITY]"))
            .unwrap_or(false);
        let stale = pinfo
            .and_then(|p| p.outbox_created.as_deref())
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
        msg["pinned"] = serde_json::json!(pinned.contains(&mid));
        let reactions = reactions_by_msg
            .remove(&mid)
            .unwrap_or_default()
            .into_iter()
            .map(|(emoji, users)| {
                serde_json::json!({ "emoji": emoji, "users": users, "count": users.len() })
            })
            .collect::<Vec<_>>();
        msg["reactions"] = serde_json::json!(reactions);
    }
    Ok(())
}

pub fn mark_message_read(conn: &Connection, message_id: &str, user_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO message_reads(message_id, user_id, read_at) VALUES (?1,?2,?3)",
        params![message_id, user_id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
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

/// Soft cap for pinned messages shown in the chat banner.
pub const MAX_PINNED_MESSAGES_PER_CHAT: i64 = 3;

#[allow(dead_code)]
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

pub fn count_pinned_messages(conn: &Connection, conversation_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM message_pins WHERE conversation_id=?1",
        params![conversation_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
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



#[cfg(test)]
mod page_tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO profile(id, display_name, x25519_public, ed25519_public, listen_port, created_at) VALUES ('u1','T','x','e',1,datetime('now'))",
            [],
        ).ok();
        conn.execute(
            "INSERT INTO conversations(id, kind, created_at) VALUES ('c1','group',datetime('now'))",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, joined_at) VALUES ('c1','u1',datetime('now'))",
            [],
        ).unwrap();
        for i in 0..250 {
            let id = format!("m{i:04}");
            let created = format!("2024-06-01T12:{:02}:{:02}Z", i / 60, i % 60);
            conn.execute(
                "INSERT INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, created_at, delivered, sort_at) VALUES (?1,'c1','u1','text','c','n','{}','s',?2,1,?2)",
                rusqlite::params![id, created],
            ).unwrap();
        }
        conn
    }

    #[test]
    fn page_returns_newest_limit_and_has_more() {
        let conn = setup();
        let page = list_messages_page(&conn, "c1", "u1", Some(80), None, None).unwrap();
        assert_eq!(page.messages.len(), 80);
        assert!(page.has_more_older);
        assert_eq!(page.messages[0]["id"], "m0170");
        assert_eq!(page.messages[79]["id"], "m0249");
        let older = list_messages_page(
            &conn,
            "c1",
            "u1",
            Some(80),
            page.messages[0]["sort_at"].as_str(),
            page.messages[0]["id"].as_str(),
        )
        .unwrap();
        assert_eq!(older.messages.len(), 80);
        assert!(older.has_more_older);
        assert!(older.messages.iter().all(|m| {
            let id = m["id"].as_str().unwrap();
            id < "m0170"
        }));
    }

    #[test]
    fn page_stays_fast_at_10k() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO profile(id, display_name, x25519_public, ed25519_public, listen_port, created_at) VALUES ('u1','T','x','e',1,datetime('now'))",
            [],
        )
        .ok();
        conn.execute(
            "INSERT INTO conversations(id, kind, created_at) VALUES ('c1','group',datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, joined_at) VALUES ('c1','u1',datetime('now'))",
            [],
        )
        .unwrap();
        let n = 10_000i64;
        let tx = conn.unchecked_transaction().unwrap();
        for i in 0..n {
            let id = format!("m{i:08}");
            let created = format!("2024-01-01T{:02}:{:02}:{:02}.{:03}Z", (i / 3600) % 24, (i / 60) % 60, i % 60, i % 1000);
            tx.execute(
                "INSERT INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, created_at, delivered, sort_at) VALUES (?1,'c1','u1','text','c','n','{}','s',?2,1,?2)",
                rusqlite::params![id, created],
            )
            .unwrap();
        }
        tx.commit().unwrap();
        let t0 = std::time::Instant::now();
        let page = list_messages_page(&conn, "c1", "u1", Some(80), None, None).unwrap();
        let ms = t0.elapsed().as_millis();
        assert_eq!(page.messages.len(), 80);
        assert!(page.has_more_older);
        assert!(ms < 2_000, "newest page at 10k took {ms}ms");
        eprintln!("10k newest-page list_messages_page: {ms}ms");
    }
}
