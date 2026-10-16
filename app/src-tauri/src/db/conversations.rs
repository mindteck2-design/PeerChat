use super::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub fn dm_conversation_id(user_a: &str, user_b: &str) -> String {
    let (a, b) = if user_a <= user_b {
        (user_a, user_b)
    } else {
        (user_b, user_a)
    };
    format!("dm:{a}:{b}")
}

pub(crate) fn dm_id_for_peer(conn: &Connection, peer: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM conversations WHERE kind='dm' AND peer_id=?1 LIMIT 1",
        params![peer],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn conversation_message_count(conn: &Connection, conversation_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE conversation_id=?1",
        params![conversation_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn rekey_conversation_id(conn: &Connection, old: &str, new: &str) -> Result<(), String> {
    if old == new {
        return Ok(());
    }
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM conversations WHERE id=?1",
            params![new],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    if exists {
        return Ok(());
    }
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| e.to_string())?;
    let tables = [
        "conversation_members",
        "messages",
        "outbox",
        "files",
        "message_pins",
    ];
    for table in tables {
        conn.execute(
            &format!("UPDATE {table} SET conversation_id=?1 WHERE conversation_id=?2"),
            params![new, old],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE conversations SET id=?1 WHERE id=?2",
        params![new, old],
    )
    .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn ensure_dm_row(conn: &Connection, id: &str, peer: &str, me: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    // Insert without peer_id first so a unique peer index on another row cannot block us.
    conn.execute(
        "INSERT OR IGNORE INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm',NULL,?2)",
        params![id, now],
    )
    .map_err(|e| e.to_string())?;
    detach_dm_peer_links(conn, peer, Some(id))?;
    conn.execute(
        "UPDATE conversations SET peer_id=?1 WHERE id=?2 AND kind='dm'",
        params![peer, id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?3)",
        params![id, me, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?3)",
        params![id, peer, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn detach_dm_peer_links(conn: &Connection, peer: &str, keep_id: Option<&str>) -> Result<(), String> {
    if let Some(keep) = keep_id {
        conn.execute(
            "UPDATE conversations SET peer_id=NULL WHERE kind='dm' AND peer_id=?1 AND id!=?2",
            params![peer, keep],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE conversations SET peer_id=NULL WHERE kind='dm' AND peer_id=?1",
            params![peer],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Conversation ids that belong to the same 1:1 thread (legacy random UUIDs + canonical).
pub(crate) fn dm_related_conversation_ids(
    conn: &Connection,
    conversation_id: &str,
    me: &str,
) -> Result<Vec<String>, String> {
    let mut ids = vec![conversation_id.to_string()];
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT kind, peer_id FROM conversations WHERE id=?1",
            params![conversation_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((kind, peer_id)) = row else {
        return Ok(ids);
    };
    if kind != "dm" {
        return Ok(ids);
    }
    let peer = peer_id.or_else(|| {
        // Canonical form dm:{a}:{b}
        let rest = conversation_id.strip_prefix("dm:")?;
        let (a, b) = rest.split_once(':')?;
        if a == me {
            Some(b.to_string())
        } else if b == me {
            Some(a.to_string())
        } else {
            None
        }
    });
    let Some(peer) = peer else {
        return Ok(ids);
    };

    let mut stmt = conn
        .prepare(
            r#"SELECT DISTINCT cm.conversation_id
               FROM conversation_members cm
               JOIN conversations c ON c.id = cm.conversation_id
               WHERE c.kind = 'dm'
                 AND cm.user_id = ?1
                 AND cm.conversation_id IN (
                   SELECT conversation_id FROM conversation_members WHERE user_id = ?2
                 )"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![peer.as_str(), me], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for r in rows {
        let id = r.map_err(|e| e.to_string())?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    // Detached legacy rows may still hold messages under old ids.
    let mut stmt2 = conn
        .prepare(
            "SELECT id FROM conversations WHERE kind='dm' AND (peer_id=?1 OR id=?2)",
        )
        .map_err(|e| e.to_string())?;
    let rows2 = stmt2
        .query_map(params![peer.as_str(), conversation_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for r in rows2 {
        let id = r.map_err(|e| e.to_string())?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// Align local DM metadata with an inbound message's conversation_id (crypto AD must match row).
pub fn reconcile_dm_on_deliver(
    conn: &Connection,
    me: &str,
    sender_id: &str,
    incoming_conv_id: &str,
) -> Result<(), String> {
    if sender_id.is_empty() || incoming_conv_id.is_empty() || sender_id == me {
        return Ok(());
    }
    if let Ok(kind) = conn.query_row(
        "SELECT kind FROM conversations WHERE id=?1",
        params![incoming_conv_id],
        |r| r.get::<_, String>(0),
    ) {
        if kind == "group" {
            return Ok(());
        }
    }

    // Keep inbound conversation_id for crypto AD; prefer canonical as the People/open link.
    let canonical = dm_conversation_id(me, sender_id);
    ensure_dm_row(conn, incoming_conv_id, sender_id, me)?;
    if canonical != incoming_conv_id {
        // Members on inbound id (already), plus a canonical row linked for UI/send.
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm',NULL,?2)",
            params![canonical.as_str(), now],
        );
        let _ = conn.execute(
            "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?3)",
            params![canonical.as_str(), me, now],
        );
        let _ = conn.execute(
            "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?3)",
            params![canonical.as_str(), sender_id, now],
        );
        detach_dm_peer_links(conn, sender_id, Some(&canonical))?;
        let _ = conn.execute(
            "UPDATE conversations SET peer_id=?1 WHERE id=?2",
            params![sender_id, canonical.as_str()],
        );
    }
    Ok(())
}

/// Mark peers not recently seen as offline (PeerTalk contacts stay listable).
pub fn ensure_dm(conn: &Connection, me: &str, peer: &str) -> Result<String, String> {
    let canonical = dm_conversation_id(me, peer);
    // Always send/open on the shared canonical id. Legacy random UUID threads stay readable
    // via dm_related_conversation_ids in list_messages (crypto AD must keep old ids on rows).
    detach_dm_peer_links(conn, peer, Some(&canonical))?;
    if let Some(existing) = dm_id_for_peer(conn, peer)? {
        if existing != canonical {
            detach_dm_peer_links(conn, peer, None)?;
        }
    }
    // Re-link any empty legacy row by rekey when safe (no messages / no id clash).
    let legacy: Vec<String> = {
        let mut stmt = conn
            .prepare(
                r#"SELECT c.id FROM conversations c
                   JOIN conversation_members m1 ON m1.conversation_id=c.id AND m1.user_id=?1
                   JOIN conversation_members m2 ON m2.conversation_id=c.id AND m2.user_id=?2
                   WHERE c.kind='dm' AND c.id!=?3"#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![me, peer, canonical.as_str()], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut v = Vec::new();
        for r in rows {
            v.push(r.map_err(|e| e.to_string())?);
        }
        v
    };
    for old in legacy {
        if conversation_message_count(conn, &old)? == 0 {
            let _ = rekey_conversation_id(conn, &old, &canonical);
        }
    }
    ensure_dm_row(conn, &canonical, peer, me)?;
    Ok(canonical)
}

pub fn create_group(
    conn: &Connection,
    id: &str,
    title: &str,
    creator: &str,
    members: &[(String, Option<String>)],
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO conversations(id, kind, title, created_at) VALUES (?1,'group',?2,?3)",
        params![id, title, now],
    )
    .map_err(|e| e.to_string())?;
    for (uid, wrap) in members {
        let name = display_name_for(conn, uid);
        let role = if uid == creator { "admin" } else { "member" };
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, wrapped_group_key, display_name, role, joined_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, uid, wrap, name, role, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn is_announcement_board_id(id: &str) -> bool {
    id == "board:org" || id.starts_with("board:team:")
}

/// Create or reopen a local announcement board conversation for this user.
pub fn ensure_announcement_board(
    conn: &Connection,
    id: &str,
    title: &str,
    me: &str,
) -> Result<Value, String> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversations WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        create_group(conn, id, title, me, &[(me.to_string(), None)])?;
    } else {
        conn.execute(
            "UPDATE conversations SET title=?2 WHERE id=?1",
            params![id, title],
        )
        .map_err(|e| e.to_string())?;
        upsert_member(conn, id, me, None, None)?;
        // First member who created the board stays admin; ensure at least one admin.
        let _ = ensure_group_admin(conn, id);
    }
    Ok(serde_json::json!({
        "id": id,
        "kind": "group",
        "title": title,
        "peer_id": Value::Null,
        "peer_name": Value::Null,
        "created_at": chrono::Utc::now().to_rfc3339(),
        "is_announcement_board": true,
    }))
}

pub fn list_conversations(conn: &Connection) -> Result<Vec<Value>, String> {
    let me = get_profile(conn)?
        .and_then(|p| p["id"].as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    // Subquery: pick the single most-recent visible message per conversation using
    // a window function so we get kind + sender alongside the timestamp.
    let mut stmt = conn
        .prepare(
            r#"SELECT c.id, c.kind, c.title, c.peer_id, c.created_at, c.pinned_at,
                      COALESCE(c.muted,0), COALESCE(c.members_can_add,1),
                      lm.kind, lm.created_at, lm.sender_id,
                      lm.ciphertext, lm.nonce, lm.wrapped_keys
               FROM conversations c
               LEFT JOIN (
                 SELECT conversation_id, kind, created_at, sender_id, ciphertext, nonce, wrapped_keys
                 FROM (
                   SELECT conversation_id, kind, created_at, sender_id, ciphertext, nonce, wrapped_keys,
                          ROW_NUMBER() OVER (
                            PARTITION BY conversation_id
                            ORDER BY COALESCE(NULLIF(sort_at,''), created_at) DESC, id DESC
                          ) AS rn
                   FROM messages
                   WHERE kind NOT IN ('reaction','pin','unpin','deleted','game_move','poll_vote')
                 ) ranked
                 WHERE rn = 1
               ) lm ON lm.conversation_id = c.id
               ORDER BY (c.pinned_at IS NULL),
                        c.pinned_at DESC,
                        COALESCE(lm.created_at, c.created_at) DESC"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, Option<String>>(9)?,
                r.get::<_, Option<String>>(10)?,
                r.get::<_, Option<String>>(11)?,
                r.get::<_, Option<String>>(12)?,
                r.get::<_, Option<String>>(13)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (id, kind, title, peer_id, created_at, pinned_at, muted, members_can_add,
             last_kind, last_at, last_sender, last_ct, last_nonce, last_wraps) =
            row.map_err(|e| e.to_string())?;
        let last_wrapped_keys: Value = last_wraps
            .as_deref()
            .filter(|s| !s.is_empty())
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::json!({}));
        // Hide detached legacy DM shells (peer_id cleared after canonical migration).
        if kind == "dm" && peer_id.is_none() {
            continue;
        }
        // Announcement boards have their own nav page.
        if is_announcement_board_id(&id) {
            continue;
        }
        let peer_name = peer_id.as_ref().and_then(|pid| {
            conn.query_row(
                "SELECT display_name FROM peers WHERE user_id=?1",
                params![pid],
                |x| x.get::<_, String>(0),
            )
            .ok()
        });
        let unread = if me.is_empty() {
            0
        } else {
            unread_count(conn, &id, &me).unwrap_or(0)
        };
        // DMs: always "in". Groups: false after leave/removal so UI can offer Remove left group.
        let i_am_member = if kind == "group" && !me.is_empty() {
            is_conversation_member(conn, &id, &me).unwrap_or(false)
        } else {
            true
        };
        out.push(serde_json::json!({
            "id": id,
            "kind": kind,
            "title": title,
            "peer_id": peer_id,
            "peer_name": peer_name,
            "created_at": created_at,
            "pinned_at": pinned_at,
            "muted": muted == 1,
            "members_can_add": members_can_add == 1,
            "i_am_member": i_am_member,
            "unread_count": unread,
            "last_message_kind": last_kind,
            "last_message_at": last_at,
            "last_message_sender": last_sender,
            "last_message_ciphertext": last_ct,
            "last_message_nonce": last_nonce,
            "last_message_wrapped_keys": last_wrapped_keys,
        }));
    }
    Ok(out)
}

/// Returns `true` when a new row was written (used to avoid duplicate OS toasts).
pub fn set_conversation_title(
    conn: &Connection,
    conversation_id: &str,
    title: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET title=?2 WHERE id=?1 AND kind='group'",
        params![conversation_id, title],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_members_can_add(
    conn: &Connection,
    conversation_id: &str,
    allowed: bool,
) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET members_can_add=?2 WHERE id=?1 AND kind='group'",
        params![conversation_id, allowed as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn members_can_add(conn: &Connection, conversation_id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COALESCE(members_can_add,1) FROM conversations WHERE id=?1",
            params![conversation_id],
            |r| r.get(0),
        )
        .unwrap_or(1);
    Ok(n == 1)
}

/// Delete all messages in a chat on this device. Keeps the conversation row.
/// When `include_files` is true, also removes file records and staging folders.
pub fn clear_conversation_messages(
    conn: &Connection,
    conversation_id: &str,
    include_files: bool,
) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "DELETE FROM message_pins WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM hidden_messages WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM messages WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM outbox WHERE conversation_id=?1",
        params![conversation_id],
    );
    if include_files {
        let mut stmt = conn
            .prepare("SELECT id FROM files WHERE conversation_id=?1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(params![conversation_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for id in ids {
            let _ = delete_file_record(conn, &id);
        }
    }
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Wipe a group conversation and related rows for this device.
pub fn delete_conversation_local(conn: &Connection, conversation_id: &str) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "DELETE FROM message_pins WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM hidden_messages WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM messages WHERE conversation_id=?1",
        params![conversation_id],
    );
    // Always purge files when removing the whole conversation.
    {
        let mut stmt = conn
            .prepare("SELECT id FROM files WHERE conversation_id=?1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(params![conversation_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for id in ids {
            let _ = delete_file_record(conn, &id);
        }
    }
    let _ = conn.execute(
        "DELETE FROM outbox WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM conversation_members WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM conversations WHERE id=?1",
        params![conversation_id],
    );
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn unread_message_filter_sql() -> &'static str {
    // User-visible chat items only (skip reactions / pin control / deletes).
    "m.kind IN ('text','forwarded','file_notice','system')"
}

pub fn unread_count(
    conn: &Connection,
    conversation_id: &str,
    my_user_id: &str,
) -> Result<i64, String> {
    let related = dm_related_conversation_ids(conn, conversation_id, my_user_id)?;
    let mut total: i64 = 0;
    for cid in related {
        let n: i64 = conn
            .query_row(
                &format!(
                    r#"SELECT COUNT(*)
                       FROM messages m
                       LEFT JOIN message_reads r
                         ON r.message_id=m.id AND r.user_id=?2
                       WHERE m.conversation_id=?1
                         AND m.sender_id<>?2
                         AND r.message_id IS NULL
                         AND {}"#,
                    unread_message_filter_sql()
                ),
                params![cid.as_str(), my_user_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        total += n;
    }
    Ok(total)
}

pub fn unread_incoming(
    conn: &Connection,
    conversation_id: &str,
    my_user_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let related = dm_related_conversation_ids(conn, conversation_id, my_user_id)?;
    let mut out = Vec::new();
    for cid in related {
        let mut stmt = conn
            .prepare(&format!(
                r#"SELECT m.id, m.sender_id
                   FROM messages m
                   LEFT JOIN message_reads r
                     ON r.message_id=m.id AND r.user_id=?2
                   WHERE m.conversation_id=?1
                     AND m.sender_id<>?2
                     AND r.message_id IS NULL
                     AND {}"#,
                unread_message_filter_sql()
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cid.as_str(), my_user_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

/// Soft cap for pinned chats in the sidebar.
pub const MAX_PINNED_CONVERSATIONS: i64 = 5;

pub fn count_pinned_conversations(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM conversations WHERE pinned_at IS NOT NULL",
        [],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn set_conversation_pinned(
    conn: &Connection,
    conversation_id: &str,
    pinned: bool,
) -> Result<(), String> {
    if pinned {
        let already: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM conversations WHERE id=?1 AND pinned_at IS NOT NULL",
                params![conversation_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if already == 0 {
            let n = count_pinned_conversations(conn)?;
            if n >= MAX_PINNED_CONVERSATIONS {
                return Err(format!(
                    "Pin limit reached ({MAX_PINNED_CONVERSATIONS}). Unpin a chat first."
                ));
            }
        }
        conn.execute(
            "UPDATE conversations SET pinned_at=?2 WHERE id=?1",
            params![conversation_id, chrono::Utc::now().to_rfc3339()],
        )
    } else {
        conn.execute(
            "UPDATE conversations SET pinned_at=NULL WHERE id=?1",
            params![conversation_id],
        )
    }
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_conversation_muted(
    conn: &Connection,
    conversation_id: &str,
    muted: bool,
) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET muted=?2 WHERE id=?1",
        params![conversation_id, muted as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn conversation_muted(conn: &Connection, conversation_id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COALESCE(muted,0) FROM conversations WHERE id=?1",
            params![conversation_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(n == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn insert_message_is_idempotent() {
        let conn = mem();
        let msg = serde_json::json!({
            "id": "m1",
            "conversation_id": "c1",
            "sender_id": "u1",
            "kind": "text",
            "ciphertext": "aaa",
            "nonce": "n",
            "wrapped_keys": {},
            "signature": "s",
            "created_at": "2026-01-01T00:00:00Z",
            "delivered": false
        });
        insert_message(&conn, &msg).unwrap();
        let mut msg2 = msg.clone();
        msg2["ciphertext"] = serde_json::json!("bbb");
        insert_message(&conn, &msg2).unwrap();
        let ct: String = conn
            .query_row("SELECT ciphertext FROM messages WHERE id='m1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ct, "aaa");
    }

    #[test]
    fn tombstone_blocks_revive() {
        let conn = mem();
        let msg = serde_json::json!({
            "id": "m2",
            "conversation_id": "c1",
            "sender_id": "u1",
            "kind": "text",
            "ciphertext": "aaa",
            "nonce": "n",
            "wrapped_keys": {},
            "signature": "s",
            "created_at": "2026-01-01T00:00:00Z",
            "delivered": false
        });
        insert_message(&conn, &msg).unwrap();
        tombstone_message(&conn, "m2").unwrap();
        insert_message(&conn, &msg).unwrap();
        let kind: String = conn
            .query_row("SELECT kind FROM messages WHERE id='m2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kind, "deleted");
    }

    #[test]
    fn migrate_sets_user_version() {
        let conn = mem();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert!(v >= 10);
    }

    #[test]
    fn dm_conversation_id_is_symmetric_and_stable() {
        let a = "user-aaa";
        let b = "user-bbb";
        assert_eq!(dm_conversation_id(a, b), dm_conversation_id(b, a));
        assert_eq!(dm_conversation_id(a, b), "dm:user-aaa:user-bbb");
    }

    #[test]
    fn ensure_dm_uses_shared_id() {
        let conn = mem();
        let id_a = ensure_dm(&conn, "alice", "bob").unwrap();
        let id_b = ensure_dm(&conn, "bob", "alice").unwrap();
        assert_eq!(id_a, id_b);
        assert_eq!(id_a, dm_conversation_id("alice", "bob"));
    }

    #[test]
    fn reconcile_dm_on_deliver_creates_thread_for_inbound() {
        let conn = mem();
        let cid = "dm:alice:bob";
        reconcile_dm_on_deliver(&conn, "bob", "alice", cid).unwrap();
        let peer_row: String = conn
            .query_row(
                "SELECT id FROM conversations WHERE kind='dm' AND peer_id='alice'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(peer_row, cid);
    }

    #[test]
    fn legacy_dm_uuid_still_lists_under_canonical() {
        let conn = mem();
        let legacy = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm','bob',?2)",
            params![legacy, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,'alice','member',?2), (?1,'bob','member',?2)",
            params![legacy, now],
        )
        .unwrap();
        insert_message(
            &conn,
            &serde_json::json!({
                "id": "m-legacy",
                "conversation_id": legacy,
                "sender_id": "bob",
                "kind": "text",
                "ciphertext": "x",
                "nonce": "n",
                "wrapped_keys": {},
                "signature": "s",
                "created_at": now,
                "delivered": true
            }),
        )
        .unwrap();

        let canonical = ensure_dm(&conn, "alice", "bob").unwrap();
        assert_eq!(canonical, dm_conversation_id("alice", "bob"));
        assert_ne!(canonical, legacy);

        let msgs = list_messages(&conn, &canonical, "alice").unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["id"], "m-legacy");
        assert_eq!(msgs[0]["conversation_id"], legacy);
    }

    #[test]
    fn ensure_dm_prefers_canonical_even_if_legacy_has_messages() {
        let conn = mem();
        let legacy = "11111111-2222-3333-4444-555555555555";
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm','bob',?2)",
            params![legacy, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, joined_at) VALUES (?1,'alice',?2), (?1,'bob',?2)",
            params![legacy, now],
        )
        .unwrap();
        insert_message(
            &conn,
            &serde_json::json!({
                "id": "m1",
                "conversation_id": legacy,
                "sender_id": "alice",
                "kind": "text",
                "ciphertext": "x",
                "nonce": "n",
                "wrapped_keys": {},
                "signature": "s",
                "created_at": now,
                "delivered": false
            }),
        )
        .unwrap();
        let id = ensure_dm(&conn, "alice", "bob").unwrap();
        assert_eq!(id, dm_conversation_id("alice", "bob"));
    }

    #[test]
    fn admin_succession_promotes_earliest() {
        let conn = mem();
        create_group(
            &conn,
            "g1",
            "G",
            "u1",
            &[
                ("u1".into(), None),
                ("u2".into(), None),
                ("u3".into(), None),
            ],
        )
        .unwrap();
        assert!(is_group_admin(&conn, "g1", "u1").unwrap());
        delete_member(&conn, "g1", "u1").unwrap();
        let promoted = ensure_group_admin(&conn, "g1").unwrap();
        assert_eq!(promoted.as_deref(), Some("u2"));
        assert!(is_group_admin(&conn, "g1", "u2").unwrap());
    }

    #[test]
    fn outbox_backoff_skips_hot_loop() {
        let conn = mem();
        enqueue_outbox(&conn, "m9:u2", "u2", "c1", "{}").unwrap();
        // Simulate failed attempts via bump_outbox_error so next_retry_at is set.
        for _ in 0..3 {
            bump_outbox_error(&conn, "m9:u2", "test error").unwrap();
        }
        let pending = pending_outbox(&conn).unwrap();
        assert!(pending.iter().all(|p| p["id"].as_str() != Some("m9:u2")));
    }

    #[test]
    fn outbox_fresh_item_is_immediately_due() {
        let conn = mem();
        enqueue_outbox(&conn, "m-fresh:u3", "u3", "c1", "{}").unwrap();
        let pending = pending_outbox(&conn).unwrap();
        assert!(pending.iter().any(|p| p["id"].as_str() == Some("m-fresh:u3")));
    }

    #[test]
    fn bump_outbox_error_stores_next_retry_at() {
        let conn = mem();
        enqueue_outbox(&conn, "m-err:u4", "u4", "c1", "{}").unwrap();
        bump_outbox_error(&conn, "m-err:u4", "network error").unwrap();
        // next_retry_at should be in the future
        let next: Option<String> = conn
            .query_row("SELECT next_retry_at FROM outbox WHERE id='m-err:u4'", [], |r| r.get(0))
            .unwrap();
        assert!(next.is_some(), "next_retry_at should be set after bump");
        let ts = chrono::DateTime::parse_from_rfc3339(next.as_deref().unwrap()).unwrap();
        assert!(ts > chrono::Utc::now(), "next_retry_at should be in the future");
    }

    #[test]
    fn reset_outbox_attempts_clears_next_retry_at() {
        let conn = mem();
        enqueue_outbox(&conn, "m-reset:u5", "u5", "c1", "{}").unwrap();
        bump_outbox_error(&conn, "m-reset:u5", "err").unwrap();
        // Item should be in backoff
        let pending_before = pending_outbox(&conn).unwrap();
        assert!(!pending_before.iter().any(|p| p["id"].as_str() == Some("m-reset:u5")));
        // Reset should clear backoff
        reset_outbox_attempts(&conn, "m-reset").unwrap();
        let pending_after = pending_outbox(&conn).unwrap();
        assert!(pending_after.iter().any(|p| p["id"].as_str() == Some("m-reset:u5")));
    }

    #[test]
    fn clear_peer_outbox_backoff_unblocks_items() {
        let conn = mem();
        enqueue_outbox(&conn, "m-kick:u6", "u6", "c1", "{}").unwrap();
        bump_outbox_error(&conn, "m-kick:u6", "err").unwrap();
        // Peer comes back online — clear backoff
        clear_peer_outbox_backoff(&conn, "u6").unwrap();
        let pending = pending_outbox(&conn).unwrap();
        assert!(pending.iter().any(|p| p["id"].as_str() == Some("m-kick:u6")));
    }

    #[test]
    fn group_delivery_requires_all_recipients() {
        let conn = mem();
        // Two per-recipient outbox rows for the same message
        enqueue_outbox(&conn, "mg1:u1", "u1", "g1", "{}").unwrap();
        enqueue_outbox(&conn, "mg1:u2", "u2", "g1", "{}").unwrap();
        // Insert the message row (delivered=0)
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO messages(id,conversation_id,sender_id,kind,ciphertext,nonce,wrapped_keys,signature,created_at,delivered) VALUES ('mg1','g1','me','text','','','{}','',?1,0)",
            params![now],
        ).unwrap();
        // Deliver to u1 only — message should still be undelivered
        mark_outbox_delivered(&conn, "mg1:u1").unwrap();
        let delivered: i64 = conn
            .query_row("SELECT delivered FROM messages WHERE id='mg1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(delivered, 0, "delivered must stay 0 until all recipients acked");
        // Deliver to u2 — now message should be marked delivered
        mark_outbox_delivered(&conn, "mg1:u2").unwrap();
        let delivered: i64 = conn
            .query_row("SELECT delivered FROM messages WHERE id='mg1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(delivered, 1, "delivered must be 1 after all recipients acked");
    }

    #[test]
    fn duplicate_deliver_is_idempotent() {
        let conn = mem();
        enqueue_outbox(&conn, "dup1:u1", "u1", "c1", "{}").unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO messages(id,conversation_id,sender_id,kind,ciphertext,nonce,wrapped_keys,signature,created_at,delivered) VALUES ('dup1','c1','me','text','','','{}','',?1,0)",
            params![now],
        ).unwrap();
        mark_outbox_delivered(&conn, "dup1:u1").unwrap();
        // Second call must not error or corrupt state
        mark_outbox_delivered(&conn, "dup1:u1").unwrap();
        let delivered: i64 = conn
            .query_row("SELECT delivered FROM messages WHERE id='dup1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(delivered, 1);
    }

    #[test]
    fn pending_outbox_for_peer_returns_correct_subset() {
        let conn = mem();
        enqueue_outbox(&conn, "mp1:ua", "ua", "c1", "{}").unwrap();
        enqueue_outbox(&conn, "mp2:ub", "ub", "c1", "{}").unwrap();
        let for_ua = pending_outbox_for_peer(&conn, "ua").unwrap();
        assert_eq!(for_ua.len(), 1);
        assert_eq!(for_ua[0]["id"].as_str(), Some("mp1:ua"));
        let for_ub = pending_outbox_for_peer(&conn, "ub").unwrap();
        assert_eq!(for_ub.len(), 1);
        assert_eq!(for_ub[0]["id"].as_str(), Some("mp2:ub"));
    }

    #[test]
    fn mark_stale_peers_offline_works() {
        let conn = mem();
        upsert_peer(
            &conn,
            "u1",
            "A",
            "x",
            "e",
            Some("10.0.0.1"),
            Some(4000),
            Some("fp"),
            true,
        )
        .unwrap();
        let old = (chrono::Utc::now() - chrono::Duration::seconds(120)).to_rfc3339();
        conn.execute(
            "UPDATE peers SET last_seen_at=?1 WHERE user_id='u1'",
            params![old],
        )
        .unwrap();
        let n = mark_stale_peers_offline(&conn, 45).unwrap();
        assert!(n >= 1);
        let online: i64 = conn
            .query_row("SELECT online FROM peers WHERE user_id='u1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(online, 0);
    }

    #[test]
    fn receive_progress_resume() {
        let conn = mem();
        upsert_receive_progress(&conn, "f1", 3, Some("/tmp/f1.part")).unwrap();
        let (next, path) = get_receive_progress(&conn, "f1").unwrap().unwrap();
        assert_eq!(next, 3);
        assert_eq!(path.as_deref(), Some("/tmp/f1.part"));
        clear_receive_progress(&conn, "f1").unwrap();
        assert!(get_receive_progress(&conn, "f1").unwrap().is_none());
    }
}

pub fn conversation_title(conn: &Connection, conversation_id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT title FROM conversations WHERE id=?1",
        params![conversation_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|o| o.flatten())
    .map_err(|e| e.to_string())
}

pub fn is_conversation_member(conn: &Connection, conversation_id: &str, user_id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversation_members WHERE conversation_id=?1 AND user_id=?2",
            params![conversation_id, user_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

