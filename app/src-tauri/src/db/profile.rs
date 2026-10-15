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

