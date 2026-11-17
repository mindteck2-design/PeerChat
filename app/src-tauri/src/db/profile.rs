use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub fn upsert_profile(
    conn: &Connection,
    id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    listen_port: i64,
    team: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"INSERT INTO profile(id, display_name, x25519_public, ed25519_public, listen_port, created_at, team)
           VALUES (?1,?2,?3,?4,?5,?6,?7)
           ON CONFLICT(id) DO UPDATE SET
             display_name=excluded.display_name,
             x25519_public=excluded.x25519_public,
             ed25519_public=excluded.ed25519_public,
             listen_port=excluded.listen_port,
             team=excluded.team"#,
        params![id, display_name, x25519_public, ed25519_public, listen_port, now, team],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_profile(conn: &Connection) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT id, display_name, x25519_public, ed25519_public, listen_port, created_at, COALESCE(team,'') FROM profile LIMIT 1",
        [],
        |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "display_name": r.get::<_, String>(1)?,
                "x25519_public": r.get::<_, String>(2)?,
                "ed25519_public": r.get::<_, String>(3)?,
                "listen_port": r.get::<_, i64>(4)?,
                "created_at": r.get::<_, String>(5)?,
                "team": r.get::<_, String>(6)?,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn display_name_for(conn: &Connection, user_id: &str) -> String {
    if let Ok(Some(profile)) = get_profile(conn) {
        if profile["id"].as_str() == Some(user_id) {
            return profile["display_name"]
                .as_str()
                .unwrap_or("Me")
                .to_string();
        }
    }
    conn.query_row(
        "SELECT display_name FROM peers WHERE user_id=?1",
        params![user_id],
        |r| r.get::<_, String>(0),
    )
    .unwrap_or_else(|_| "Member".into())
}

/// Setup must never mint a second profile or rewrite `id` when one already exists.
/// Returns the existing row when present; callers skip insert/runtime restart.
pub fn keep_existing_profile(conn: &Connection) -> Result<Option<Value>, String> {
    get_profile(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn existing_profile_id_is_never_rewritten() {
        let conn = mem();
        upsert_profile(&conn, "legacy-uuid", "Ada", "x", "e", 9876, "eng").unwrap();
        // Mirror setup_profile: if a profile exists, keep it (stable_device_id unused).
        let kept = keep_existing_profile(&conn).unwrap().unwrap();
        assert_eq!(kept["id"], "legacy-uuid");
        upsert_profile(&conn, "legacy-uuid", "Ada Renamed", "x2", "e2", 9877, "eng").unwrap();
        let after = get_profile(&conn).unwrap().unwrap();
        assert_eq!(after["id"], "legacy-uuid");
        assert_eq!(after["display_name"], "Ada Renamed");
    }
}

