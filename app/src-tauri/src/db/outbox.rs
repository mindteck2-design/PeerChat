use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub fn reset_outbox_attempts(conn: &Connection, message_id: &str) -> Result<u64, String> {
    let n = conn
        .execute(
            "UPDATE outbox SET attempts=0, last_error=NULL, last_attempt_at=NULL, next_retry_at=NULL WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
            params![message_id, format!("{message_id}:%")],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u64)
}

pub fn enqueue_outbox(
    conn: &Connection,
    id: &str,
    recipient_id: &str,
    conversation_id: &str,
    payload: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO outbox(id, recipient_id, conversation_id, payload, created_at) VALUES (?1,?2,?3,?4,?5)",
        params![id, recipient_id, conversation_id, payload, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn pending_outbox(conn: &Connection) -> Result<Vec<Value>, String> {
    // Filter by next_retry_at in SQL so the index can skip non-due rows.
    // Rows that have never failed (next_retry_at IS NULL) are always included.
    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn
        .prepare(
            r#"SELECT id, recipient_id, conversation_id, payload, created_at, attempts, last_error, last_attempt_at
               FROM outbox
               WHERE delivered_at IS NULL
                 AND (next_retry_at IS NULL OR next_retry_at <= ?1)
               ORDER BY created_at ASC
               LIMIT 100"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![now], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "recipient_id": r.get::<_, String>(1)?,
                "conversation_id": r.get::<_, String>(2)?,
                "payload": r.get::<_, String>(3)?,
                "created_at": r.get::<_, String>(4)?,
                "attempts": r.get::<_, i64>(5)?,
                "last_error": r.get::<_, Option<String>>(6)?,
                "last_attempt_at": r.get::<_, Option<String>>(7)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Items due for delivery to a specific peer (respects next_retry_at backoff).
pub fn pending_outbox_for_peer(conn: &Connection, recipient_id: &str) -> Result<Vec<Value>, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn
        .prepare(
            r#"SELECT id, recipient_id, conversation_id, payload, created_at, attempts, last_error, last_attempt_at
               FROM outbox
               WHERE delivered_at IS NULL
                 AND recipient_id=?1
                 AND (next_retry_at IS NULL OR next_retry_at <= ?2)
               ORDER BY created_at ASC
               LIMIT 50"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![recipient_id, now], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "recipient_id": r.get::<_, String>(1)?,
                "conversation_id": r.get::<_, String>(2)?,
                "payload": r.get::<_, String>(3)?,
                "created_at": r.get::<_, String>(4)?,
                "attempts": r.get::<_, i64>(5)?,
                "last_error": r.get::<_, Option<String>>(6)?,
                "last_attempt_at": r.get::<_, Option<String>>(7)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Immediately re-enable delivery attempts for all pending items to a given peer.
/// Called when a peer is rediscovered at a new address so the backoff window is bypassed.
pub fn clear_peer_outbox_backoff(conn: &Connection, recipient_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE outbox SET next_retry_at=NULL WHERE delivered_at IS NULL AND recipient_id=?1",
        params![recipient_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn mark_outbox_delivered(conn: &Connection, id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE outbox SET delivered_at=?2 WHERE id=?1",
        params![id, now],
    )
    .map_err(|e| e.to_string())?;
    // Outbox ids are "{message_id}:{recipient}". Mark the chat row delivered
    // only after every recipient copy has gone out.
    let msg_id = id.split(':').next().unwrap_or(id);
    let still: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM outbox WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
            params![msg_id, format!("{msg_id}:%")],
            |r| r.get(0),
        )
        .unwrap_or(1);
    if still == 0 {
        conn.execute("UPDATE messages SET delivered=1 WHERE id=?1", params![msg_id])
            .ok();
    }
    Ok(())
}

pub fn bump_outbox_error(conn: &Connection, id: &str, err: &str) -> Result<(), String> {
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();
    // Read current attempts so we can compute the correct next delay.
    let attempts: i64 = conn
        .query_row("SELECT attempts FROM outbox WHERE id=?1", params![id], |r| r.get(0))
        .unwrap_or(0);
    let new_attempts = attempts + 1;
    // Exponential backoff with ±25 % jitter, then settle at 5 minutes so offline
    // peers (app closed on LAN) stay queued without a hot retry loop.
    // Jitter uses FNV-1a hash of the id so different items for the same peer
    // don't all retry at exactly the same moment (thundering-herd avoidance).
    let base_delay = if new_attempts <= 6 {
        (1i64 << new_attempts).min(60)
    } else {
        300
    };
    let jitter_range = (base_delay / 4).max(1);
    let hash: u64 = id.bytes().fold(14_695_981_039_346_656_037_u64, |acc, b| {
        acc.wrapping_mul(1_099_511_628_211).wrapping_add(b as u64)
    });
    let jitter = (hash % (jitter_range as u64 * 2)) as i64 - jitter_range;
    let delay = (base_delay + jitter).max(1);
    let next_retry_at = (now + chrono::Duration::seconds(delay)).to_rfc3339();
    conn.execute(
        "UPDATE outbox SET attempts=attempts+1, last_error=?2, last_attempt_at=?3, next_retry_at=?4 WHERE id=?1",
        params![id, err, now_str, next_retry_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn cancel_outbox_for_message(conn: &Connection, message_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM outbox WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
        params![message_id, format!("{message_id}:%")],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn latest_outbox_error(conn: &Connection, recipient_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT last_error, attempts, created_at FROM outbox WHERE recipient_id=?1 AND delivered_at IS NULL AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        params![recipient_id],
        |r| {
            Ok(serde_json::json!({
                "last_error": r.get::<_, Option<String>>(0)?,
                "attempts": r.get::<_, i64>(1)?,
                "created_at": r.get::<_, String>(2)?,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

