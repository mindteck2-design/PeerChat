use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

fn row_to_item(
    id: String,
    title: String,
    body: Option<String>,
    kind: String,
    day: String,
    time: Option<String>,
    meeting_url: Option<String>,
    created_by: String,
    created_at: String,
    updated_at: String,
    done: i64,
    shared: i64,
    participants: String,
    notified_at: Option<String>,
    checklist_json: String,
    acks_json: String,
) -> Value {
    let participant_ids: Value =
        serde_json::from_str(&participants).unwrap_or_else(|_| json!([]));
    let checklist: Value =
        serde_json::from_str(&checklist_json).unwrap_or_else(|_| json!([]));
    let acks: Value = serde_json::from_str(&acks_json).unwrap_or_else(|_| json!({}));
    json!({
        "id": id,
        "title": title,
        "body": body.unwrap_or_default(),
        "kind": kind,
        "day": day,
        "time": time,
        "meeting_url": meeting_url,
        "created_by": created_by,
        "created_at": created_at,
        "updated_at": updated_at,
        "done": done != 0,
        "shared": shared != 0,
        "participant_ids": participant_ids,
        "notified_at": notified_at,
        "checklist": checklist,
        "acks": acks,
    })
}

const SELECT_COLS: &str = r#"id, title, body, kind, day, time, meeting_url, created_by, created_at, updated_at,
                  done, shared, participant_ids, notified_at,
                  COALESCE(checklist_json, '[]'), COALESCE(acks_json, '{}')"#;

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
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
        r.get(13)?,
        r.get(14)?,
        r.get(15)?,
    ))
}

fn normalize_checklist(v: &Value) -> Value {
    let Some(arr) = v.as_array() else {
        return json!([]);
    };
    let mut out = Vec::new();
    for item in arr {
        let id = item.get("id").and_then(|x| x.as_str()).unwrap_or("").trim();
        if id.is_empty() {
            continue;
        }
        let label = item
            .get("label")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let checked_by = item
            .get("checked_by")
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|u| u.as_str().map(|s| s.to_string()))
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let check_at = item.get("check_at").cloned().unwrap_or_else(|| json!({}));
        out.push(json!({
            "id": id,
            "label": label,
            "checked_by": checked_by,
            "check_at": check_at,
        }));
    }
    Value::Array(out)
}

fn normalize_acks(v: &Value) -> Value {
    let Some(obj) = v.as_object() else {
        return json!({});
    };
    let mut out = serde_json::Map::new();
    for (k, val) in obj {
        if let Some(s) = val.as_str() {
            if !k.is_empty() && !s.is_empty() {
                out.insert(k.clone(), json!(s));
            }
        }
    }
    Value::Object(out)
}

/// Local calendar day YYYY-MM-DD.
pub fn local_today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
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
    let shared = row["shared"].as_bool().unwrap_or(
        !participants
            .as_array()
            .map(|a| a.is_empty())
            .unwrap_or(true),
    );
    let done = row["done"].as_bool().unwrap_or(false);
    let created_at = row
        .get("created_at")
        .and_then(|v| v.as_str())
        .unwrap_or(&now);
    let updated_at = row
        .get("updated_at")
        .and_then(|v| v.as_str())
        .unwrap_or(&now);
    let meeting_url = row.get("meeting_url").and_then(|v| v.as_str());
    let notified_at = row.get("notified_at").and_then(|v| v.as_str());
    let checklist = normalize_checklist(row.get("checklist").unwrap_or(&json!([])));
    let acks = normalize_acks(row.get("acks").unwrap_or(&json!({})));

    conn.execute(
        r#"INSERT INTO calendar_items(
             id, title, body, kind, day, time, meeting_url, created_by, created_at, updated_at,
             done, shared, participant_ids, notified_at, checklist_json, acks_json
           ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
           ON CONFLICT(id) DO UPDATE SET
             title=excluded.title,
             body=excluded.body,
             kind=excluded.kind,
             day=excluded.day,
             time=excluded.time,
             meeting_url=excluded.meeting_url,
             updated_at=excluded.updated_at,
             done=excluded.done,
             shared=excluded.shared,
             participant_ids=excluded.participant_ids,
             notified_at=COALESCE(excluded.notified_at, calendar_items.notified_at),
             checklist_json=excluded.checklist_json,
             acks_json=excluded.acks_json"#,
        params![
            id,
            title,
            body,
            kind,
            day,
            time,
            meeting_url,
            created_by,
            created_at,
            updated_at,
            if done { 1 } else { 0 },
            if shared { 1 } else { 0 },
            participants_s,
            notified_at,
            checklist.to_string(),
            acks.to_string(),
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
        &format!("SELECT {SELECT_COLS} FROM calendar_items WHERE id=?1"),
        params![id],
        map_row,
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

/// Apply a one-way checklist check (no uncheck / recheck once anyone has checked).
pub fn apply_checklist_toggle(
    conn: &Connection,
    item_id: &str,
    option_id: &str,
    user_id: &str,
    checked: bool,
    updated_at: &str,
) -> Result<Value, String> {
    if !checked {
        return Err("checklist items cannot be unchecked".into());
    }
    let mut item = get_calendar_item(conn, item_id)?.ok_or("calendar item not found")?;
    let day = item["day"].as_str().unwrap_or("");
    let today = local_today();
    if day < today.as_str() {
        return Err("past calendar items are frozen".into());
    }
    let mut checklist = normalize_checklist(item.get("checklist").unwrap_or(&json!([])));
    let arr = checklist
        .as_array_mut()
        .ok_or_else(|| "invalid checklist".to_string())?;
    let mut found = false;
    for opt in arr.iter_mut() {
        if opt.get("id").and_then(|v| v.as_str()) != Some(option_id) {
            continue;
        }
        found = true;
        let mut checked_by: Vec<String> = opt
            .get("checked_by")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|u| u.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        // Once anyone has checked this option, it is locked.
        if !checked_by.is_empty() {
            return Ok(item);
        }
        let prev_at = opt
            .pointer(&format!("/check_at/{user_id}"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !prev_at.is_empty() && updated_at <= prev_at {
            return Ok(item);
        }
        let mut check_at = opt
            .get("check_at")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        check_at.insert(user_id.to_string(), json!(updated_at));
        opt["check_at"] = Value::Object(check_at);
        checked_by.push(user_id.to_string());
        opt["checked_by"] = json!(checked_by);
        break;
    }
    if !found {
        return Err("checklist option not found".into());
    }

    // Derive done: all options have at least one check.
    let all_done = checklist
        .as_array()
        .map(|a| {
            !a.is_empty()
                && a.iter().all(|o| {
                    o.get("checked_by")
                        .and_then(|v| v.as_array())
                        .map(|c| !c.is_empty())
                        .unwrap_or(false)
                })
        })
        .unwrap_or(false);

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE calendar_items SET checklist_json=?2, done=?3, updated_at=?4 WHERE id=?1",
        params![
            item_id,
            checklist.to_string(),
            if all_done { 1 } else { 0 },
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    item["checklist"] = checklist;
    item["done"] = json!(all_done);
    item["updated_at"] = json!(now);
    Ok(item)
}

fn ack_stamp(raw: &str) -> &str {
    raw.strip_prefix("rejected|").unwrap_or(raw)
}

/// Record accept (`at` ISO) or reject (`rejected|{at}`) with per-user last-write-wins on stamp.
pub fn apply_calendar_ack(
    conn: &Connection,
    item_id: &str,
    user_id: &str,
    at: &str,
) -> Result<Value, String> {
    apply_calendar_response(conn, item_id, user_id, "accepted", at)
}

pub fn apply_calendar_response(
    conn: &Connection,
    item_id: &str,
    user_id: &str,
    response: &str,
    at: &str,
) -> Result<Value, String> {
    let mut item = get_calendar_item(conn, item_id)?.ok_or("calendar item not found")?;
    let day = item["day"].as_str().unwrap_or("");
    let today = local_today();
    if day < today.as_str() {
        return Err("past calendar items are frozen".into());
    }
    let stored = if response == "rejected" {
        format!("rejected|{at}")
    } else {
        at.to_string()
    };
    let mut acks = normalize_acks(item.get("acks").unwrap_or(&json!({})));
    let prev = acks.get(user_id).and_then(|v| v.as_str()).unwrap_or("");
    if !prev.is_empty() && at <= ack_stamp(prev) {
        return Ok(item);
    }
    if let Some(obj) = acks.as_object_mut() {
        obj.insert(user_id.to_string(), json!(stored));
    }
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE calendar_items SET acks_json=?2, updated_at=?3 WHERE id=?1",
        params![item_id, acks.to_string(), now],
    )
    .map_err(|e| e.to_string())?;
    item["acks"] = acks;
    item["updated_at"] = json!(now);
    Ok(item)
}

pub fn list_calendar_items(
    conn: &Connection,
    from_day: &str,
    to_day: &str,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(&format!(
            r#"SELECT {SELECT_COLS}
                 FROM calendar_items
                WHERE day >= ?1 AND day <= ?2
                ORDER BY day ASC, COALESCE(time, '99:99') ASC, created_at ASC"#
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from_day, to_day], map_row)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Items due soon for desktop notification (reminder/meeting with a time).
pub fn due_calendar_items(conn: &Connection, now_local: &str) -> Result<Vec<Value>, String> {
    let day = now_local.get(..10).unwrap_or("");
    let hm = now_local.get(11..16).unwrap_or("");
    if day.len() != 10 || hm.len() != 5 {
        return Ok(vec![]);
    }
    let mut stmt = conn
        .prepare(&format!(
            r#"SELECT {SELECT_COLS}
                 FROM calendar_items
                WHERE kind IN ('reminder','meeting')
                  AND time IS NOT NULL AND time != ''
                  AND day = ?1
                  AND time <= ?2
                  AND (notified_at IS NULL OR notified_at = '')
                  AND done = 0
                ORDER BY time ASC
                LIMIT 20"#
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![day, hm], map_row)
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


#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn test_calendar_crud() {
        let conn = mem();
        let item = json!({
            "id": "cal-1",
            "title": "Design Review",
            "body": "Discuss architecture",
            "kind": "meeting",
            "day": "2026-11-01",
            "time": "14:00",
            "meeting_url": "https://meet.google.com/abc-xyz",
            "created_by": "alice",
            "participant_ids": ["bob"],
            "shared": true,
        });

        upsert_calendar_item(&conn, &item).unwrap();

        let fetched = get_calendar_item(&conn, "cal-1").unwrap().expect("item should exist");
        assert_eq!(fetched["title"], "Design Review");
        assert_eq!(fetched["body"], "Discuss architecture");
        assert_eq!(fetched["kind"], "meeting");
        assert_eq!(fetched["day"], "2026-11-01");
        assert_eq!(fetched["time"], "14:00");
        assert_eq!(fetched["meeting_url"], "https://meet.google.com/abc-xyz");
        assert_eq!(fetched["created_by"], "alice");
        assert_eq!(fetched["shared"], true);
        assert_eq!(fetched["done"], false);

        // Query by date range
        let list = list_calendar_items(&conn, "2026-11-01", "2026-11-30").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["id"], "cal-1");

        // Update title
        let mut updated = item.clone();
        updated["title"] = json!("Updated Design Review");
        upsert_calendar_item(&conn, &updated).unwrap();
        let fetched_updated = get_calendar_item(&conn, "cal-1").unwrap().unwrap();
        assert_eq!(fetched_updated["title"], "Updated Design Review");

        // Delete
        delete_calendar_item(&conn, "cal-1").unwrap();
        assert!(get_calendar_item(&conn, "cal-1").unwrap().is_none());
    }

    #[test]
    fn test_calendar_todo_done() {
        let conn = mem();
        let item = json!({
            "id": "todo-1",
            "title": "Ship v1.0.1",
            "kind": "todo",
            "day": "2026-12-01",
            "created_by": "alice",
        });
        upsert_calendar_item(&conn, &item).unwrap();

        set_calendar_todo_done(&conn, "todo-1", true).unwrap();
        let fetched = get_calendar_item(&conn, "todo-1").unwrap().unwrap();
        assert_eq!(fetched["done"], true);

        set_calendar_todo_done(&conn, "todo-1", false).unwrap();
        let fetched2 = get_calendar_item(&conn, "todo-1").unwrap().unwrap();
        assert_eq!(fetched2["done"], false);
    }

    #[test]
    fn test_checklist_one_way_toggle() {
        let conn = mem();
        let today = local_today();
        let item = json!({
            "id": "todo-check-1",
            "title": "Launch Checklist",
            "kind": "todo",
            "day": today,
            "created_by": "alice",
            "checklist": [
                {
                    "id": "opt-1",
                    "label": "Run tests",
                    "checked_by": [],
                    "check_at": {}
                }
            ]
        });
        upsert_calendar_item(&conn, &item).unwrap();

        // Unchecking is strictly rejected
        let err = apply_checklist_toggle(&conn, "todo-check-1", "opt-1", "alice", false, "2026-10-24T12:00:00Z");
        assert!(err.is_err());
        assert!(err.unwrap_err().contains("cannot be unchecked"));

        // Checking succeeds
        let res = apply_checklist_toggle(&conn, "todo-check-1", "opt-1", "alice", true, "2026-10-24T12:00:00Z").unwrap();
        let opts = res["checklist"].as_array().unwrap();
        let checked_by = opts[0]["checked_by"].as_array().unwrap();
        assert_eq!(checked_by.len(), 1);
        assert_eq!(checked_by[0], "alice");

        // Second user trying to check locked option returns without modification
        let res2 = apply_checklist_toggle(&conn, "todo-check-1", "opt-1", "bob", true, "2026-10-24T12:05:00Z").unwrap();
        let opts2 = res2["checklist"].as_array().unwrap();
        let checked_by2 = opts2[0]["checked_by"].as_array().unwrap();
        assert_eq!(checked_by2.len(), 1);
        assert_eq!(checked_by2[0], "alice");
    }

    #[test]
    fn test_checklist_all_done_derivation() {
        let conn = mem();
        let today = local_today();
        let item = json!({
            "id": "todo-all-done",
            "title": "Two tasks",
            "kind": "todo",
            "day": today,
            "created_by": "alice",
            "checklist": [
                { "id": "o1", "label": "Task 1", "checked_by": [], "check_at": {} },
                { "id": "o2", "label": "Task 2", "checked_by": [], "check_at": {} }
            ]
        });
        upsert_calendar_item(&conn, &item).unwrap();

        // Check first task: done remains false
        let s1 = apply_checklist_toggle(&conn, "todo-all-done", "o1", "alice", true, "2026-10-24T12:00:00Z").unwrap();
        assert_eq!(s1["done"], false);

        // Check second task: done automatically becomes true
        let s2 = apply_checklist_toggle(&conn, "todo-all-done", "o2", "bob", true, "2026-10-24T12:01:00Z").unwrap();
        assert_eq!(s2["done"], true);
    }

    #[test]
    fn test_calendar_ack_lww() {
        let conn = mem();
        let today = local_today();
        let item = json!({
            "id": "meet-ack",
            "title": "Sprint Planning",
            "kind": "meeting",
            "day": today,
            "created_by": "alice",
            "participant_ids": ["bob"],
            "shared": true,
        });
        upsert_calendar_item(&conn, &item).unwrap();

        // Initial ack
        let a1 = apply_calendar_ack(&conn, "meet-ack", "bob", "2026-10-24T10:00:00Z").unwrap();
        assert_eq!(a1["acks"]["bob"], "2026-10-24T10:00:00Z");

        // Older timestamp ignored (LWW)
        let a2 = apply_calendar_ack(&conn, "meet-ack", "bob", "2026-10-24T09:00:00Z").unwrap();
        assert_eq!(a2["acks"]["bob"], "2026-10-24T10:00:00Z");

        // Newer timestamp updates
        let a3 = apply_calendar_ack(&conn, "meet-ack", "bob", "2026-10-24T11:00:00Z").unwrap();
        assert_eq!(a3["acks"]["bob"], "2026-10-24T11:00:00Z");
    }

    #[test]
    fn test_due_calendar_items() {
        let conn = mem();
        let today = "2026-11-15";
        let m1 = json!({
            "id": "due-1",
            "title": "Morning Standup",
            "kind": "meeting",
            "day": today,
            "time": "09:30",
            "created_by": "alice",
        });
        let m2 = json!({
            "id": "due-2",
            "title": "Afternoon Review",
            "kind": "meeting",
            "day": today,
            "time": "15:00",
            "created_by": "alice",
        });
        upsert_calendar_item(&conn, &m1).unwrap();
        upsert_calendar_item(&conn, &m2).unwrap();

        // At 10:00, only the 09:30 meeting is due
        let due = due_calendar_items(&conn, "2026-11-15T10:00").unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0]["id"], "due-1");

        // Mark notified
        mark_calendar_notified(&conn, "due-1").unwrap();

        // Query again: due-1 is filtered out
        let due_after = due_calendar_items(&conn, "2026-11-15T10:00").unwrap();
        assert_eq!(due_after.len(), 0);

        // At 16:00, due-2 is returned
        let due_afternoon = due_calendar_items(&conn, "2026-11-15T16:00").unwrap();
        assert_eq!(due_afternoon.len(), 1);
        assert_eq!(due_afternoon[0]["id"], "due-2");
    }
}
