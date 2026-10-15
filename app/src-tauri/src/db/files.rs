use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub fn insert_file(conn: &Connection, file: &Value) -> Result<(), String> {
    conn.execute(
        r#"INSERT OR IGNORE INTO files(id, conversation_id, uploader_id, enc_filename, filename_nonce, size_bytes, chunk_count, wrapped_keys, staging_dir, local_path, created_at, content_sha256, file_crypto_v)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)"#,
        params![
            file["id"].as_str().unwrap_or(""),
            file["conversation_id"].as_str().unwrap_or(""),
            file["uploader_id"].as_str().unwrap_or(""),
            file["enc_filename"].as_str().unwrap_or(""),
            file["filename_nonce"].as_str().unwrap_or(""),
            file["size_bytes"].as_i64().unwrap_or(0),
            file["chunk_count"].as_i64().unwrap_or(0),
            file.get("wrapped_keys").map(|v| v.to_string()).unwrap_or_else(|| "{}".into()),
            file.get("staging_dir").and_then(|v| v.as_str()),
            file.get("local_path").and_then(|v| v.as_str()),
            file["created_at"].as_str().unwrap_or(""),
            file.get("content_sha256").and_then(|v| v.as_str()),
            file.get("file_crypto_v").and_then(|v| v.as_i64()).unwrap_or(1),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_file(conn: &Connection, file_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT id, conversation_id, uploader_id, enc_filename, filename_nonce, size_bytes, chunk_count, wrapped_keys, staging_dir, local_path, created_at, content_sha256, COALESCE(file_crypto_v,1) FROM files WHERE id=?1",
        params![file_id],
        |r| {
            let wraps: String = r.get(7)?;
            let wrapped_keys: Value = serde_json::from_str(&wraps).unwrap_or(serde_json::json!({}));
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "conversation_id": r.get::<_, String>(1)?,
                "uploader_id": r.get::<_, String>(2)?,
                "enc_filename": r.get::<_, String>(3)?,
                "filename_nonce": r.get::<_, String>(4)?,
                "size_bytes": r.get::<_, i64>(5)?,
                "chunk_count": r.get::<_, i64>(6)?,
                "wrapped_keys": wrapped_keys,
                "staging_dir": r.get::<_, Option<String>>(8)?,
                "local_path": r.get::<_, Option<String>>(9)?,
                "created_at": r.get::<_, String>(10)?,
                "content_sha256": r.get::<_, Option<String>>(11)?,
                "file_crypto_v": r.get::<_, i64>(12)?,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn set_file_content_hash(conn: &Connection, file_id: &str, content_sha256: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET content_sha256=?2 WHERE id=?1",
        params![file_id, content_sha256],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_file_local_path(conn: &Connection, file_id: &str, path: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET local_path=?2 WHERE id=?1",
        params![file_id, path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn ack_file(conn: &Connection, file_id: &str, user_id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO file_acks(file_id, user_id, acked_at) VALUES (?1,?2,?3)",
        params![file_id, user_id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn file_ack_count(conn: &Connection, file_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM file_acks WHERE file_id=?1",
        params![file_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

pub fn get_receive_progress(conn: &Connection, file_id: &str) -> Result<Option<(i64, Option<String>)>, String> {
    conn.query_row(
        "SELECT next_index, temp_path FROM file_receive_progress WHERE file_id=?1",
        params![file_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn upsert_receive_progress(
    conn: &Connection,
    file_id: &str,
    next_index: i64,
    temp_path: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        r#"INSERT INTO file_receive_progress(file_id, next_index, temp_path, updated_at)
           VALUES (?1,?2,?3,?4)
           ON CONFLICT(file_id) DO UPDATE SET
             next_index=excluded.next_index,
             temp_path=COALESCE(excluded.temp_path, file_receive_progress.temp_path),
             updated_at=excluded.updated_at"#,
        params![file_id, next_index, temp_path, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_receive_progress(conn: &Connection, file_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM file_receive_progress WHERE file_id=?1",
        params![file_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_file_record(conn: &Connection, file_id: &str) -> Result<(), String> {
    let staging: Option<String> = conn
        .query_row(
            "SELECT staging_dir FROM files WHERE id=?1",
            params![file_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    conn.execute("DELETE FROM file_acks WHERE file_id=?1", params![file_id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM files WHERE id=?1", params![file_id])
        .map_err(|e| e.to_string())?;
    if let Some(dir) = staging {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(())
}
