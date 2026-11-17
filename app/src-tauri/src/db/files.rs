use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

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

fn file_row_from_query(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let wraps: String = r.get(7)?;
    let wrapped_keys: Value = serde_json::from_str(&wraps).unwrap_or(json!({}));
    Ok(json!({
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
        "local_cleared": r.get::<_, i64>(13).unwrap_or(0) != 0,
    }))
}

const FILE_SELECT: &str = "SELECT id, conversation_id, uploader_id, enc_filename, filename_nonce, size_bytes, chunk_count, wrapped_keys, staging_dir, local_path, created_at, content_sha256, COALESCE(file_crypto_v,1), COALESCE(local_cleared,0) FROM files";

pub fn get_file(conn: &Connection, file_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        &format!("{FILE_SELECT} WHERE id=?1"),
        params![file_id],
        file_row_from_query,
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn list_files(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(&format!("{FILE_SELECT} ORDER BY created_at DESC, id DESC"))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], file_row_from_query)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn set_file_content_hash(conn: &Connection, file_id: &str, content_sha256: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET content_sha256=?2 WHERE id=?1",
        params![file_id, content_sha256],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_file_size_and_chunks(
    conn: &Connection,
    file_id: &str,
    size_bytes: i64,
    chunk_count: i64,
    content_sha256: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET size_bytes=?2, chunk_count=?3, content_sha256=?4 WHERE id=?1",
        params![file_id, size_bytes, chunk_count, content_sha256],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_file_local_path(conn: &Connection, file_id: &str, path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        conn.execute(
            "UPDATE files SET local_path='', local_cleared=1 WHERE id=?1",
            params![file_id],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE files SET local_path=?2, local_cleared=0 WHERE id=?1",
            params![file_id, trimmed],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn path_is_under(path: &Path, root: &Path) -> bool {
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    path.starts_with(&root)
}

fn dir_disk_bytes(path: &Path) -> u64 {
    fn walk(p: &Path, acc: &mut u64) {
        let Ok(entries) = std::fs::read_dir(p) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, acc);
            } else if let Ok(meta) = entry.metadata() {
                *acc = acc.saturating_add(meta.len());
            }
        }
    }
    let mut total = 0u64;
    walk(path, &mut total);
    total
}

/// On-disk size for storage summary; falls back to `size_bytes` if stat fails.
pub fn local_disk_bytes(path: &Path, size_bytes: i64) -> u64 {
    if path.is_dir() {
        let n = dir_disk_bytes(path);
        if n > 0 {
            return n;
        }
    } else if let Ok(meta) = std::fs::metadata(path) {
        return meta.len();
    }
    size_bytes.max(0) as u64
}

/// Delete local download when it lives under allowed roots; always clear DB path.
/// Returns: deleted_disk | cleared_only | missing
pub fn delete_local_file_copy(
    conn: &Connection,
    file_id: &str,
    allowed_roots: &[PathBuf],
) -> Result<&'static str, String> {
    let file = get_file(conn, file_id)?.ok_or_else(|| "file missing".to_string())?;
    let path_str = file
        .get("local_path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if path_str.is_empty() {
        set_file_local_path(conn, file_id, "")?;
        return Ok("missing");
    }
    let path = PathBuf::from(path_str);
    let present = path.is_file() || path.is_dir();
    if !present {
        set_file_local_path(conn, file_id, "")?;
        return Ok("missing");
    }
    let under_allowed = allowed_roots.iter().any(|root| path_is_under(&path, root));
    if under_allowed {
        if path.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        set_file_local_path(conn, file_id, "")?;
        Ok("deleted")
    } else {
        // Sender source / outside download root — clear DB pointer only.
        set_file_local_path(conn, file_id, "")?;
        Ok("cleared_only")
    }
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
