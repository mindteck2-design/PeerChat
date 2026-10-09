use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS profile (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            x25519_public TEXT NOT NULL,
            ed25519_public TEXT NOT NULL,
            listen_port INTEGER NOT NULL DEFAULT 9876,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS peers (
            user_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            x25519_public TEXT NOT NULL,
            ed25519_public TEXT NOT NULL,
            last_ip TEXT,
            last_port INTEGER,
            tls_fingerprint TEXT,
            pinned INTEGER NOT NULL DEFAULT 0,
            last_seen_at TEXT,
            online INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL CHECK (kind IN ('dm','group')),
            title TEXT,
            peer_id TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversation_members (
            conversation_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            wrapped_group_key TEXT,
            display_name TEXT,
            PRIMARY KEY (conversation_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            sender_id TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'text',
            ciphertext TEXT NOT NULL DEFAULT '',
            nonce TEXT NOT NULL DEFAULT '',
            wrapped_keys TEXT NOT NULL DEFAULT '{}',
            signature TEXT NOT NULL DEFAULT '',
            file_id TEXT,
            created_at TEXT NOT NULL,
            delivered INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS message_reads (
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            read_at TEXT NOT NULL,
            PRIMARY KEY (message_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS outbox (
            id TEXT PRIMARY KEY,
            recipient_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            delivered_at TEXT
        );

        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            uploader_id TEXT NOT NULL,
            enc_filename TEXT NOT NULL,
            filename_nonce TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL,
            wrapped_keys TEXT NOT NULL DEFAULT '{}',
            staging_dir TEXT,
            local_path TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS file_acks (
            file_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            acked_at TEXT NOT NULL,
            PRIMARY KEY (file_id, user_id)
        );
        "#,
    )
    .map_err(|e| e.to_string())?;
    // Existing databases created before display_name was added.
    let _ = conn.execute(
        "ALTER TABLE conversation_members ADD COLUMN display_name TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE files ADD COLUMN local_path TEXT", []);
    Ok(())
}

pub fn upsert_profile(
    conn: &Connection,
    id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    listen_port: i64,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"INSERT INTO profile(id, display_name, x25519_public, ed25519_public, listen_port, created_at)
           VALUES (?1,?2,?3,?4,?5,?6)
           ON CONFLICT(id) DO UPDATE SET
             display_name=excluded.display_name,
             x25519_public=excluded.x25519_public,
             ed25519_public=excluded.ed25519_public,
             listen_port=excluded.listen_port"#,
        params![id, display_name, x25519_public, ed25519_public, listen_port, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_profile(conn: &Connection) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT id, display_name, x25519_public, ed25519_public, listen_port, created_at FROM profile LIMIT 1",
        [],
        |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "display_name": r.get::<_, String>(1)?,
                "x25519_public": r.get::<_, String>(2)?,
                "ed25519_public": r.get::<_, String>(3)?,
                "listen_port": r.get::<_, i64>(4)?,
                "created_at": r.get::<_, String>(5)?,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn upsert_peer(
    conn: &Connection,
    user_id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    ip: Option<&str>,
    port: Option<i64>,
    tls_fingerprint: Option<&str>,
    online: bool,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"INSERT INTO peers(user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, last_seen_at, online)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
           ON CONFLICT(user_id) DO UPDATE SET
             display_name=excluded.display_name,
             x25519_public=excluded.x25519_public,
             ed25519_public=excluded.ed25519_public,
             last_ip=COALESCE(excluded.last_ip, peers.last_ip),
             last_port=COALESCE(excluded.last_port, peers.last_port),
             tls_fingerprint=COALESCE(excluded.tls_fingerprint, peers.tls_fingerprint),
             last_seen_at=excluded.last_seen_at,
             online=excluded.online"#,
        params![
            user_id,
            display_name,
            x25519_public,
            ed25519_public,
            ip,
            port,
            tls_fingerprint,
            now,
            online as i64
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn pin_peer(conn: &Connection, user_id: &str, fingerprint: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE peers SET pinned=1, tls_fingerprint=?2 WHERE user_id=?1",
        params![user_id, fingerprint],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_peers(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, pinned, last_seen_at, online FROM peers ORDER BY display_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "user_id": r.get::<_, String>(0)?,
                "display_name": r.get::<_, String>(1)?,
                "x25519_public": r.get::<_, String>(2)?,
                "ed25519_public": r.get::<_, String>(3)?,
                "last_ip": r.get::<_, Option<String>>(4)?,
                "last_port": r.get::<_, Option<i64>>(5)?,
                "tls_fingerprint": r.get::<_, Option<String>>(6)?,
                "pinned": r.get::<_, i64>(7)? == 1,
                "last_seen_at": r.get::<_, Option<String>>(8)?,
                "online": r.get::<_, i64>(9)? == 1,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn get_peer(conn: &Connection, user_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, pinned, online FROM peers WHERE user_id=?1",
        params![user_id],
        |r| {
            Ok(serde_json::json!({
                "user_id": r.get::<_, String>(0)?,
                "display_name": r.get::<_, String>(1)?,
                "x25519_public": r.get::<_, String>(2)?,
                "ed25519_public": r.get::<_, String>(3)?,
                "last_ip": r.get::<_, Option<String>>(4)?,
                "last_port": r.get::<_, Option<i64>>(5)?,
                "tls_fingerprint": r.get::<_, Option<String>>(6)?,
                "pinned": r.get::<_, i64>(7)? == 1,
                "online": r.get::<_, i64>(8)? == 1,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn ensure_dm(conn: &Connection, me: &str, peer: &str) -> Result<String, String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM conversations WHERE kind='dm' AND peer_id=?1",
            params![peer],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm',?2,?3)",
        params![id, peer, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO conversation_members(conversation_id, user_id) VALUES (?1,?2), (?1,?3)",
        params![id, me, peer],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn create_group(
    conn: &Connection,
    id: &str,
    title: &str,
    creator: &str,
    members: &[(String, Option<String>)],
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO conversations(id, kind, title, created_at) VALUES (?1,'group',?2,?3)",
        params![id, title, now],
    )
    .map_err(|e| e.to_string())?;
    for (uid, wrap) in members {
        let name = display_name_for(conn, uid);
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, wrapped_group_key, display_name) VALUES (?1,?2,?3,?4)",
            params![id, uid, wrap, name],
        )
        .map_err(|e| e.to_string())?;
    }
    let _ = creator;
    Ok(())
}

pub fn list_conversations(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare("SELECT id, kind, title, peer_id, created_at FROM conversations ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (id, kind, title, peer_id, created_at) = row.map_err(|e| e.to_string())?;
        let peer_name = peer_id.as_ref().and_then(|pid| {
            conn.query_row(
                "SELECT display_name FROM peers WHERE user_id=?1",
                params![pid],
                |x| x.get::<_, String>(0),
            )
            .ok()
        });
        out.push(serde_json::json!({
            "id": id,
            "kind": kind,
            "title": title,
            "peer_id": peer_id,
            "peer_name": peer_name,
            "created_at": created_at,
        }));
    }
    Ok(out)
}

pub fn insert_message(conn: &Connection, msg: &Value) -> Result<(), String> {
    conn.execute(
        r#"INSERT OR REPLACE INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, created_at, delivered)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"#,
        params![
            msg["id"].as_str().unwrap_or(""),
            msg["conversation_id"].as_str().unwrap_or(""),
            msg["sender_id"].as_str().unwrap_or(""),
            msg["kind"].as_str().unwrap_or("text"),
            msg["ciphertext"].as_str().unwrap_or(""),
            msg["nonce"].as_str().unwrap_or(""),
            msg.get("wrapped_keys").map(|v| v.to_string()).unwrap_or_else(|| "{}".into()),
            msg["signature"].as_str().unwrap_or(""),
            msg.get("file_id").and_then(|v| v.as_str()),
            msg["created_at"].as_str().unwrap_or(""),
            msg.get("delivered").and_then(|v| v.as_bool()).unwrap_or(false) as i64,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.ciphertext,
                      m.nonce, m.wrapped_keys, m.signature, m.file_id, m.created_at,
                      m.delivered,
                      CASE
                        WHEN (SELECT COUNT(*) FROM outbox o
                              WHERE o.id LIKE m.id || ':%') > 0
                         AND (SELECT COUNT(*) FROM message_reads mr
                              WHERE mr.message_id=m.id) >=
                             (SELECT COUNT(*) FROM outbox o
                              WHERE o.id LIKE m.id || ':%')
                        THEN 1 ELSE 0
                      END AS is_read
               FROM messages m
               WHERE m.conversation_id=?1
               ORDER BY m.created_at ASC"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |r| {
            let wraps: String = r.get(6)?;
            let wrapped_keys: Value = serde_json::from_str(&wraps).unwrap_or(serde_json::json!({}));
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "conversation_id": r.get::<_, String>(1)?,
                "sender_id": r.get::<_, String>(2)?,
                "kind": r.get::<_, String>(3)?,
                "ciphertext": r.get::<_, String>(4)?,
                "nonce": r.get::<_, String>(5)?,
                "wrapped_keys": wrapped_keys,
                "signature": r.get::<_, String>(7)?,
                "file_id": r.get::<_, Option<String>>(8)?,
                "created_at": r.get::<_, String>(9)?,
                "delivered": r.get::<_, i64>(10)? == 1,
                "read": r.get::<_, i64>(11)? == 1,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
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
    let mut stmt = conn
        .prepare(
            "SELECT id, recipient_id, conversation_id, payload, created_at, attempts FROM outbox WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "recipient_id": r.get::<_, String>(1)?,
                "conversation_id": r.get::<_, String>(2)?,
                "payload": r.get::<_, String>(3)?,
                "created_at": r.get::<_, String>(4)?,
                "attempts": r.get::<_, i64>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
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
    conn.execute(
        "UPDATE outbox SET attempts=attempts+1, last_error=?2 WHERE id=?1",
        params![id, err],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn insert_file(conn: &Connection, file: &Value) -> Result<(), String> {
    conn.execute(
        r#"INSERT INTO files(id, conversation_id, uploader_id, enc_filename, filename_nonce, size_bytes, chunk_count, wrapped_keys, staging_dir, local_path, created_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"#,
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
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_file(conn: &Connection, file_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT id, conversation_id, uploader_id, enc_filename, filename_nonce, size_bytes, chunk_count, wrapped_keys, staging_dir, local_path, created_at FROM files WHERE id=?1",
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
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn set_file_local_path(conn: &Connection, file_id: &str, path: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE files SET local_path=?2 WHERE id=?1",
        params![file_id, path],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn mark_message_read(conn: &Connection, message_id: &str, user_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO message_reads(message_id, user_id, read_at) VALUES (?1,?2,?3)",
        params![message_id, user_id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn unread_incoming(
    conn: &Connection,
    conversation_id: &str,
    my_user_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT m.id, m.sender_id
               FROM messages m
               LEFT JOIN message_reads r
                 ON r.message_id=m.id AND r.user_id=?2
               WHERE m.conversation_id=?1
                 AND m.sender_id<>?2
                 AND r.message_id IS NULL"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id, my_user_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
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

pub fn upsert_member(
    conn: &Connection,
    conversation_id: &str,
    user_id: &str,
    wrapped_group_key: Option<&str>,
    display_name: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        r#"INSERT INTO conversation_members(conversation_id, user_id, wrapped_group_key, display_name)
           VALUES (?1,?2,?3,?4)
           ON CONFLICT(conversation_id, user_id) DO UPDATE SET
             wrapped_group_key=COALESCE(excluded.wrapped_group_key, conversation_members.wrapped_group_key),
             display_name=COALESCE(excluded.display_name, conversation_members.display_name)"#,
        params![conversation_id, user_id, wrapped_group_key, display_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
                      COALESCE(NULLIF(m.display_name, ''), p.display_name, '')
               FROM conversation_members m
               LEFT JOIN peers p ON p.user_id = m.user_id
               WHERE m.conversation_id=?1
               ORDER BY 2"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (uid, mut name) = row.map_err(|e| e.to_string())?;
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
        }));
    }
    Ok(out)
}

pub fn conversation_title(conn: &Connection, conversation_id: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT title FROM conversations WHERE id=?1",
        params![conversation_id],
        |r| r.get::<_, Option<String>>(0),
    )
    .optional()
    .map(|o| o.flatten())
    .map_err(|e| e.to_string())
}
