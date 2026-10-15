use rusqlite::{params, Connection};
use serde_json::Value;

pub fn save_item(conn: &Connection, row: &Value) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"INSERT INTO saved_items(id, message_id, conversation_id, kind, preview, created_at)
           VALUES (?1,?2,?3,?4,?5,?6)
           ON CONFLICT(id) DO UPDATE SET preview=excluded.preview, kind=excluded.kind"#,
        params![
            row["id"].as_str().unwrap_or(""),
            row.get("message_id").and_then(|v| v.as_str()),
            row["conversation_id"].as_str().unwrap_or(""),
            row["kind"].as_str().unwrap_or("text"),
            row["preview"].as_str().unwrap_or(""),
            row["created_at"].as_str().unwrap_or(&now),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_saved_item(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM saved_items WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_saved_items(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, message_id, conversation_id, kind, preview, created_at FROM saved_items ORDER BY created_at DESC LIMIT 500",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "message_id": r.get::<_, Option<String>>(1)?,
                "conversation_id": r.get::<_, String>(2)?,
                "kind": r.get::<_, String>(3)?,
                "preview": r.get::<_, String>(4)?,
                "created_at": r.get::<_, String>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

