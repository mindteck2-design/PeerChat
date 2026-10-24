use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

fn row_to_item(
    id: String,
    title: String,
    body: Option<String>,
    kind: String,
    day: String,
    time: Option<String>,
    created_by: String,
    created_at: String,
    updated_at: String,
    done: i64,
    shared: i64,
    participants: String,
    notified_at: Option<String>,
) -> Value {
    let participant_ids: Value =
        serde_json::from_str(&participants).unwrap_or_else(|_| json!([]));
    json!({
        "id": id,
        "title": title,
        "body": body.unwrap_or_default(),
        "kind": kind,
        "day": day,
        "time": time,
        "created_by": created_by,
        "created_at": created_at,
        "updated_at": updated_at,
        "done": done != 0,
        "shared": shared != 0,
        "participant_ids": participant_ids,
        "notified_at": notified_at,
    })
}

pub fn upsert_calendar_item(conn: &Connection, row: &Value) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let id = row["id"].as_str().unwrap_or("").trim();
    if id.is_empty() {
        return Err("calendar item id required".into());
    }
    let title = row["title"].as_str().unwrap_or("").trim();
    if title.is_empty() {
        return Err("title required".into());
    }
    let kind = row["kind"].as_str().unwrap_or("note");
    if !matches!(kind, "note" | "reminder" | "meeting" | "todo") {
        return Err("invalid kind".into());
    }
    let day = row["day"].as_str().unwrap_or("").trim();
    if day.len() != 10 {
        return Err("day must be YYYY-MM-DD".into());
    }
    let time = row
        .get("time")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let body = row
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let created_by = row["created_by"].as_str().unwrap_or("").trim();
    if created_by.is_empty() {
        return Err("created_by required".into());
    }
    let participants = row
        .get("participant_ids")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let participants_s = participants.to_string();
    let shared = row["shared"].as_bool().unwrap_or(!participants.as_array().map(|a| a.is_empty()).unwrap_or(true));
    let done = row["done"].as_bool().unwrap_or(false);
    let created_at = row
        .get("created_at")
        .and_then(|v| v.as_str())
        .unwrap_or(&now);
    let updated_at = row
        .get("updated_at")
        .and_then(|v| v.as_str())
        .unwrap_or(&now);
    let notified_at = row.get("notified_at").and_then(|v| v.as_str());

    conn.execute(
        r#"INSERT INTO calendar_items(
             id, title, body, kind, day, time, created_by, created_at, updated_at,
             done, shared, participant_ids, notified_at
           ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
           ON CONFLICT(id) DO UPDATE SET
             title=excluded.title,
             body=excluded.body,
             kind=excluded.kind,
             day=excluded.day,
             time=excluded.time,
             updated_at=excluded.updated_at,
             done=excluded.done,
             shared=excluded.shared,
             participant_ids=excluded.participant_ids,
             notified_at=COALESCE(excluded.notified_at, calendar_items.notified_at)"#,
        params![
            id,
            title,
            body,
            kind,
            day,
            time,
            created_by,
            created_at,
            updated_at,
            if done { 1 } else { 0 },
            if shared { 1 } else { 0 },
            participants_s,
            notified_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_calendar_item(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM calendar_items WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_calendar_item(conn: &Connection, id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        r#"SELECT id, title, body, kind, day, time, created_by, created_at, updated_at,
                  done, shared, participant_ids, notified_at
             FROM calendar_items WHERE id=?1"#,
        params![id],
        |r| {
            Ok(row_to_item(
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
                r.get(11)?,
                r.get(12)?,
            ))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn set_calendar_todo_done(conn: &Connection, id: &str, done: bool) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let n = conn
        .execute(
            "UPDATE calendar_items SET done=?2, updated_at=?3 WHERE id=?1",
            params![id, if done { 1 } else { 0 }, now],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("calendar item not found".into());
    }
    Ok(())
}

pub fn list_calendar_items(
    conn: &Connection,
    from_day: &str,
    to_day: &str,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT id, title, body, kind, day, time, created_by, created_at, updated_at,
                      done, shared, participant_ids, notified_at
                 FROM calendar_items
                WHERE day >= ?1 AND day <= ?2
                ORDER BY day ASC, COALESCE(time, '99:99') ASC, created_at ASC"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from_day, to_day], |r| {
            Ok(row_to_item(
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
                r.get(11)?,
                r.get(12)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Items due soon for desktop notification (reminder/meeting with a time).
pub fn due_calendar_items(conn: &Connection, now_local: &str) -> Result<Vec<Value>, String> {
    // now_local: "YYYY-MM-DDTHH:MM" in local wall clock (no tz).
    let day = now_local.get(..10).unwrap_or("");
    let hm = now_local.get(11..16).unwrap_or("");
    if day.len() != 10 || hm.len() != 5 {
        return Ok(vec![]);
    }
    let mut stmt = conn
        .prepare(
            r#"SELECT id, title, body, kind, day, time, created_by, created_at, updated_at,
                      done, shared, participant_ids, notified_at
                 FROM calendar_items
                WHERE kind IN ('reminder','meeting')
                  AND time IS NOT NULL AND time != ''
                  AND day = ?1
                  AND time <= ?2
                  AND (notified_at IS NULL OR notified_at = '')
                  AND done = 0
                ORDER BY time ASC
                LIMIT 20"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![day, hm], |r| {
            Ok(row_to_item(
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
                r.get(10)?,
                r.get(11)?,
                r.get(12)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn mark_calendar_notified(conn: &Connection, id: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE calendar_items SET notified_at=?2 WHERE id=?1",
        params![id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
