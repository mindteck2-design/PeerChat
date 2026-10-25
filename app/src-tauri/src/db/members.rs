use super::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub fn set_member_role(
    conn: &Connection,
    conversation_id: &str,
    user_id: &str,
    role: &str,
) -> Result<(), String> {
    if role != "admin" && role != "member" {
        return Err("role must be admin or member".into());
    }
    if role == "member" {
        let admins: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM conversation_members WHERE conversation_id=?1 AND role='admin'",
                params![conversation_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let is_admin: bool = is_group_admin(conn, conversation_id, user_id)?;
        if is_admin && admins <= 1 {
            return Err("cannot demote the last admin".into());
        }
    }
    let n = conn
        .execute(
            "UPDATE conversation_members SET role=?3 WHERE conversation_id=?1 AND user_id=?2",
            params![conversation_id, user_id, role],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("not a member".into());
    }
    Ok(())
}

pub fn member_ids(conn: &Connection, conversation_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn get_wrapped_group_key(conn: &Connection, conversation_id: &str, user_id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT wrapped_group_key FROM conversation_members WHERE conversation_id=?1 AND user_id=?2",
        params![conversation_id, user_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|o| o.flatten())
    .map_err(|e| e.to_string())
}

pub fn upsert_member(
    conn: &Connection,
    conversation_id: &str,
    user_id: &str,
    wrapped_group_key: Option<&str>,
    display_name: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"INSERT INTO conversation_members(conversation_id, user_id, wrapped_group_key, display_name, role, joined_at)
           VALUES (?1,?2,?3,?4,'member',?5)
           ON CONFLICT(conversation_id, user_id) DO UPDATE SET
             wrapped_group_key=COALESCE(excluded.wrapped_group_key, conversation_members.wrapped_group_key),
             display_name=COALESCE(excluded.display_name, conversation_members.display_name),
             joined_at=COALESCE(conversation_members.joined_at, excluded.joined_at)"#,
        params![conversation_id, user_id, wrapped_group_key, display_name, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn member_role(conn: &Connection, conversation_id: &str, user_id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT COALESCE(role,'member') FROM conversation_members WHERE conversation_id=?1 AND user_id=?2",
        params![conversation_id, user_id],
        |r| r.get(0),
    )
    .map_err(|_| "not a member".into())
}

pub fn is_group_admin(conn: &Connection, conversation_id: &str, user_id: &str) -> Result<bool, String> {
    Ok(member_role(conn, conversation_id, user_id)? == "admin")
}

/// If no admin remains, promote the earliest joined remaining member.
pub fn ensure_group_admin(conn: &Connection, conversation_id: &str) -> Result<Option<String>, String> {
    let admins: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversation_members WHERE conversation_id=?1 AND role='admin'",
            params![conversation_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if admins > 0 {
        return Ok(None);
    }
    let next: Option<String> = conn
        .query_row(
            "SELECT user_id FROM conversation_members WHERE conversation_id=?1 ORDER BY COALESCE(joined_at,'') ASC, user_id ASC LIMIT 1",
            params![conversation_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(ref uid) = next {
        conn.execute(
            "UPDATE conversation_members SET role='admin' WHERE conversation_id=?1 AND user_id=?2",
            params![conversation_id, uid],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(next)
}

pub fn delete_member(conn: &Connection, conversation_id: &str, user_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM conversation_members WHERE conversation_id=?1 AND user_id=?2",
        params![conversation_id, user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_members(conn: &Connection, conversation_id: &str) -> Result<Vec<Value>, String> {
    let me = get_profile(conn)?
        .and_then(|p| p.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()));
    let my_name = get_profile(conn)?
        .and_then(|p| p.get("display_name").and_then(|v| v.as_str()).map(|s| s.to_string()));
    let mut stmt = conn
        .prepare(
            r#"SELECT m.user_id,
                      COALESCE(NULLIF(m.display_name, ''), p.display_name, ''),
                      COALESCE(m.role, 'member'),
                      m.joined_at
               FROM conversation_members m
               LEFT JOIN peers p ON p.user_id = m.user_id
               WHERE m.conversation_id=?1
               ORDER BY CASE WHEN m.role='admin' THEN 0 ELSE 1 END, COALESCE(m.joined_at,''), 2"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (uid, mut name, role, joined_at) = row.map_err(|e| e.to_string())?;
        if me.as_deref() == Some(uid.as_str()) {
            if let Some(ref n) = my_name {
                name = n.clone();
            }
        }
        if name.trim().is_empty() {
            name = "Member".into();
        }
        out.push(serde_json::json!({
            "user_id": uid,
            "display_name": name,
            "role": role,
            "joined_at": joined_at,
        }));
    }
    Ok(out)
}

pub fn update_member_wraps(
    conn: &Connection,
    conversation_id: &str,
    wraps: &[(String, String)],
) -> Result<(), String> {
    for (uid, wrap) in wraps {
        conn.execute(
            "UPDATE conversation_members SET wrapped_group_key=?3 WHERE conversation_id=?1 AND user_id=?2",
            params![conversation_id, uid, wrap],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// After ingesting an authoritative roster, drop local members that are no longer listed.
pub fn reconcile_members(
    conn: &Connection,
    conversation_id: &str,
    keep_user_ids: &[String],
) -> Result<usize, String> {
    if keep_user_ids.is_empty() {
        return Ok(0);
    }
    let keep: std::collections::HashSet<&str> =
        keep_user_ids.iter().map(|s| s.as_str()).collect();
    let existing = member_ids(conn, conversation_id)?;
    let mut removed = 0usize;
    for uid in existing {
        if !keep.contains(uid.as_str()) {
            delete_member(conn, conversation_id, &uid)?;
            removed += 1;
        }
    }
    Ok(removed)
}

