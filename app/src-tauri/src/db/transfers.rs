use rusqlite::{params, Connection};
use serde_json::Value;

pub fn upsert_transfer(conn: &Connection, row: &Value) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"INSERT INTO transfer_log(id, direction, file_id, conversation_id, peer_label, filename, size_bytes, status, error, bytes_done, verified, started_at, updated_at, finished_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
           ON CONFLICT(id) DO UPDATE SET
             file_id=excluded.file_id,
             status=excluded.status,
             error=excluded.error,
             bytes_done=excluded.bytes_done,
             verified=excluded.verified,
             updated_at=excluded.updated_at,
             finished_at=excluded.finished_at,
             size_bytes=excluded.size_bytes,
             filename=excluded.filename"#,
        params![
            row["id"].as_str().unwrap_or(""),
            row["direction"].as_str().unwrap_or("send"),
            row.get("file_id").and_then(|v| v.as_str()),
            row.get("conversation_id").and_then(|v| v.as_str()),
            row.get("peer_label").and_then(|v| v.as_str()),
            row["filename"].as_str().unwrap_or("file"),
            row["size_bytes"].as_i64().unwrap_or(0),
            row["status"].as_str().unwrap_or("queued"),
            row.get("error").and_then(|v| v.as_str()),
            row["bytes_done"].as_i64().unwrap_or(0),
            if row["verified"].as_bool().unwrap_or(false) { 1 } else { 0 },
            row["started_at"].as_str().unwrap_or(&now),
            now,
            row.get("finished_at").and_then(|v| v.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_transfers(conn: &Connection, limit: i64) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, direction, file_id, conversation_id, peer_label, filename, size_bytes, status, error, bytes_done, verified, started_at, updated_at, finished_at FROM transfer_log ORDER BY updated_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "direction": r.get::<_, String>(1)?,
                "file_id": r.get::<_, Option<String>>(2)?,
                "conversation_id": r.get::<_, Option<String>>(3)?,
                "peer_label": r.get::<_, Option<String>>(4)?,
                "filename": r.get::<_, String>(5)?,
                "size_bytes": r.get::<_, i64>(6)?,
                "status": r.get::<_, String>(7)?,
                "error": r.get::<_, Option<String>>(8)?,
                "bytes_done": r.get::<_, i64>(9)?,
                "verified": r.get::<_, i64>(10)? == 1,
                "started_at": r.get::<_, String>(11)?,
                "updated_at": r.get::<_, String>(12)?,
                "finished_at": r.get::<_, Option<String>>(13)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn delete_transfer(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM transfer_log WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_transfer_history(conn: &Connection) -> Result<u64, String> {
    let n = conn
        .execute(
            "DELETE FROM transfer_log WHERE status NOT IN ('queued','transferring','verifying')",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u64)
}

