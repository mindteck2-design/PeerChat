use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
        "#,
    )
    .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    let version: i32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);

    // v0/v1: create base schema (idempotent).
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

        CREATE TABLE IF NOT EXISTS hidden_messages (
            user_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            hidden_at TEXT NOT NULL,
            PRIMARY KEY (user_id, message_id)
        );

        CREATE TABLE IF NOT EXISTS file_receive_progress (
            file_id TEXT PRIMARY KEY,
            next_index INTEGER NOT NULL DEFAULT 0,
            temp_path TEXT,
            updated_at TEXT NOT NULL
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
    let _ = conn.execute("ALTER TABLE files ADD COLUMN content_sha256 TEXT", []);
    let _ = conn.execute("ALTER TABLE files ADD COLUMN file_crypto_v INTEGER DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE outbox ADD COLUMN last_attempt_at TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE peers ADD COLUMN identity_changed INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE peers ADD COLUMN pending_tls_fingerprint TEXT", []);
    let _ = conn.execute("ALTER TABLE peers ADD COLUMN pending_x25519_public TEXT", []);
    let _ = conn.execute("ALTER TABLE peers ADD COLUMN pending_ed25519_public TEXT", []);

    if version < 2 {
        conn.execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_messages_conv_created
              ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_outbox_pending
              ON outbox(delivered_at, created_at);
            CREATE INDEX IF NOT EXISTS idx_message_reads_msg
              ON message_reads(message_id);
            CREATE INDEX IF NOT EXISTS idx_hidden_messages_user
              ON hidden_messages(user_id, message_id);
            CREATE INDEX IF NOT EXISTS idx_files_conv
              ON files(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_peers_online
              ON peers(online, last_seen_at);
            "#,
        )
        .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 2)
            .map_err(|e| e.to_string())?;
    }

    // Always apply additive ALTERs (safe if already present).
    let _ = conn.execute("ALTER TABLE conversations ADD COLUMN pinned_at TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE conversations ADD COLUMN muted INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN reply_to TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE conversation_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'",
        [],
    );
    let _ = conn.execute("ALTER TABLE conversation_members ADD COLUMN joined_at TEXT", []);

    if version < 3 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS message_pins (
                conversation_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                pinned_by TEXT NOT NULL,
                pinned_at TEXT NOT NULL,
                PRIMARY KEY (conversation_id, message_id)
            );
            CREATE TABLE IF NOT EXISTS message_reactions (
                message_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (message_id, user_id, emoji)
            );
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_conversations_pinned
              ON conversations(pinned_at);
            CREATE INDEX IF NOT EXISTS idx_message_pins_conv
              ON message_pins(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_message_reactions_msg
              ON message_reactions(message_id);
            INSERT OR IGNORE INTO app_settings(key, value) VALUES ('notifications_enabled', '1');
            "#,
        )
        .map_err(|e| e.to_string())?;
        // Backfill member roles / joined_at for existing groups.
        let _ = conn.execute_batch(
            r#"
            UPDATE conversation_members
               SET joined_at = COALESCE(joined_at, (
                     SELECT created_at FROM conversations c
                     WHERE c.id = conversation_members.conversation_id
                   ))
             WHERE joined_at IS NULL;
            UPDATE conversation_members
               SET role = 'admin'
             WHERE role = 'member'
               AND user_id = (
                 SELECT m2.user_id FROM conversation_members m2
                 WHERE m2.conversation_id = conversation_members.conversation_id
                 ORDER BY COALESCE(m2.joined_at, '') ASC, m2.user_id ASC
                 LIMIT 1
               )
               AND EXISTS (
                 SELECT 1 FROM conversations c
                 WHERE c.id = conversation_members.conversation_id AND c.kind = 'group'
               );
            "#,
        );
        conn.pragma_update(None, "user_version", 3)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Mark peers not recently seen as offline (PeerTalk contacts stay listable).
pub fn mark_peers_offline_except(conn: &Connection, online_ids: &[String]) -> Result<(), String> {
    if online_ids.is_empty() {
        conn.execute("UPDATE peers SET online=0", [])
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let placeholders: Vec<String> = online_ids.iter().map(|_| "?".into()).collect();
    let sql = format!(
        "UPDATE peers SET online=0 WHERE user_id NOT IN ({})",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> = online_ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();
    stmt.execute(params.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mark peers offline when last_seen is older than `max_age_secs` (stale beacons).
pub fn mark_stale_peers_offline(conn: &Connection, max_age_secs: i64) -> Result<u64, String> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::seconds(max_age_secs)).to_rfc3339();
    let n = conn
        .execute(
            "UPDATE peers SET online=0 WHERE online=1 AND (last_seen_at IS NULL OR last_seen_at < ?1)",
            params![cutoff],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u64)
}

pub fn set_peer_pending_identity(
    conn: &Connection,
    user_id: &str,
    tls_fingerprint: &str,
    x25519_public: &str,
    ed25519_public: &str,
) -> Result<(), String> {
    conn.execute(
        r#"UPDATE peers SET identity_changed=1,
               pending_tls_fingerprint=?2,
               pending_x25519_public=?3,
               pending_ed25519_public=?4
           WHERE user_id=?1"#,
        params![user_id, tls_fingerprint, x25519_public, ed25519_public],
    )
    .map_err(|e| e.to_string())?;
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
    // If a pending identity was flagged, adopt those keys when re-pinning.
    let pending: Option<(Option<String>, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT pending_tls_fingerprint, pending_x25519_public, pending_ed25519_public FROM peers WHERE user_id=?1",
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((Some(p_fp), Some(px), Some(pe))) = pending {
        let use_fp = if fingerprint.is_empty() {
            p_fp
        } else {
            fingerprint.to_string()
        };
        conn.execute(
            r#"UPDATE peers SET pinned=1, tls_fingerprint=?2,
                   x25519_public=?3, ed25519_public=?4,
                   identity_changed=0,
                   pending_tls_fingerprint=NULL,
                   pending_x25519_public=NULL,
                   pending_ed25519_public=NULL
               WHERE user_id=?1"#,
            params![user_id, use_fp, px, pe],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE peers SET pinned=1, tls_fingerprint=?2, identity_changed=0 WHERE user_id=?1",
            params![user_id, fingerprint],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_peers(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, pinned, last_seen_at, online, COALESCE(identity_changed,0), pending_tls_fingerprint FROM peers ORDER BY display_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let identity_changed = r.get::<_, i64>(10)? == 1;
            let pending_fp: Option<String> = r.get(11)?;
            let pinned_fp: Option<String> = r.get(6)?;
            Ok(serde_json::json!({
                "user_id": r.get::<_, String>(0)?,
                "display_name": r.get::<_, String>(1)?,
                "x25519_public": r.get::<_, String>(2)?,
                "ed25519_public": r.get::<_, String>(3)?,
                "last_ip": r.get::<_, Option<String>>(4)?,
                "last_port": r.get::<_, Option<i64>>(5)?,
                "tls_fingerprint": if identity_changed {
                    pending_fp.clone().or(pinned_fp)
                } else {
                    pinned_fp
                },
                "pinned": r.get::<_, i64>(7)? == 1,
                "last_seen_at": r.get::<_, Option<String>>(8)?,
                "online": r.get::<_, i64>(9)? == 1,
                "identity_changed": identity_changed,
                "pending_tls_fingerprint": pending_fp,
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
    let now_m = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?4), (?1,?3,'member',?4)",
        params![id, me, peer, now_m],
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
        let role = if uid == creator { "admin" } else { "member" };
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, wrapped_group_key, display_name, role, joined_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id, uid, wrap, name, role, now],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_conversations(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, title, peer_id, created_at, pinned_at, COALESCE(muted,0) FROM conversations ORDER BY (pinned_at IS NULL), pinned_at DESC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (id, kind, title, peer_id, created_at, pinned_at, muted) =
            row.map_err(|e| e.to_string())?;
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
            "pinned_at": pinned_at,
            "muted": muted == 1,
        }));
    }
    Ok(out)
}

pub fn insert_message(conn: &Connection, msg: &Value) -> Result<(), String> {
    let id = msg["id"].as_str().unwrap_or("");
    let incoming_kind = msg["kind"].as_str().unwrap_or("text");
    let existing: Option<String> = conn
        .query_row(
            "SELECT kind FROM messages WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(ref kind) = existing {
        // Don't revive a tombstone; don't clobber an existing non-delete row.
        if kind == "deleted" || incoming_kind != "deleted" {
            if incoming_kind == "deleted" && kind != "deleted" {
                return tombstone_message(conn, id);
            }
            return Ok(());
        }
    }
    if incoming_kind == "deleted" {
        // Ensure tombstone row exists even if original never arrived.
        conn.execute(
            r#"INSERT OR REPLACE INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, created_at, delivered, reply_to)
               VALUES (?1,?2,?3,'deleted','','','{}','',NULL,?4,0,NULL)"#,
            params![
                id,
                msg["conversation_id"].as_str().unwrap_or(""),
                msg["sender_id"].as_str().unwrap_or(""),
                msg["created_at"].as_str().unwrap_or(""),
            ],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    conn.execute(
        r#"INSERT INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, created_at, delivered, reply_to)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)"#,
        params![
            id,
            msg["conversation_id"].as_str().unwrap_or(""),
            msg["sender_id"].as_str().unwrap_or(""),
            incoming_kind,
            msg["ciphertext"].as_str().unwrap_or(""),
            msg["nonce"].as_str().unwrap_or(""),
            msg.get("wrapped_keys").map(|v| v.to_string()).unwrap_or_else(|| "{}".into()),
            msg["signature"].as_str().unwrap_or(""),
            msg.get("file_id").and_then(|v| v.as_str()),
            msg["created_at"].as_str().unwrap_or(""),
            msg.get("delivered").and_then(|v| v.as_bool()).unwrap_or(false) as i64,
            msg.get("reply_to").and_then(|v| v.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    // Side-effects for reaction / pin sync messages.
    apply_control_message(conn, msg)?;
    Ok(())
}

fn apply_control_message(conn: &Connection, msg: &Value) -> Result<(), String> {
    let kind = msg["kind"].as_str().unwrap_or("");
    let sender = msg["sender_id"].as_str().unwrap_or("");
    let cid = msg["conversation_id"].as_str().unwrap_or("");
    let target = msg
        .get("reply_to")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let created = msg["created_at"].as_str().unwrap_or("");
    match kind {
        "reaction" => {
            let emoji = msg["ciphertext"].as_str().unwrap_or("").trim();
            if target.is_empty() || emoji.is_empty() || sender.is_empty() {
                return Ok(());
            }
            let remove = msg
                .get("remove_reaction")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if remove {
                let _ = conn.execute(
                    "DELETE FROM message_reactions WHERE message_id=?1 AND user_id=?2 AND emoji=?3",
                    params![target, sender, emoji],
                );
            } else {
                // Toggle: if same reaction exists, remove; else add (and clear other emoji from user on that message).
                let exists: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM message_reactions WHERE message_id=?1 AND user_id=?2 AND emoji=?3",
                        params![target, sender, emoji],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if exists > 0 {
                    let _ = conn.execute(
                        "DELETE FROM message_reactions WHERE message_id=?1 AND user_id=?2 AND emoji=?3",
                        params![target, sender, emoji],
                    );
                } else {
                    let _ = conn.execute(
                        "DELETE FROM message_reactions WHERE message_id=?1 AND user_id=?2",
                        params![target, sender],
                    );
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO message_reactions(message_id, user_id, emoji, created_at) VALUES (?1,?2,?3,?4)",
                        params![target, sender, emoji, created],
                    );
                }
            }
        }
        "pin" => {
            if !target.is_empty() {
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO message_pins(conversation_id, message_id, pinned_by, pinned_at) VALUES (?1,?2,?3,?4)",
                    params![cid, target, sender, created],
                );
            }
        }
        "unpin" => {
            if !target.is_empty() {
                let _ = conn.execute(
                    "DELETE FROM message_pins WHERE conversation_id=?1 AND message_id=?2",
                    params![cid, target],
                );
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn list_messages(
    conn: &Connection,
    conversation_id: &str,
    viewer_id: &str,
) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.ciphertext,
                      m.nonce, m.wrapped_keys, m.signature, m.file_id, m.created_at,
                      m.delivered, m.reply_to,
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
               LEFT JOIN hidden_messages h
                 ON h.message_id=m.id AND h.user_id=?2
               WHERE m.conversation_id=?1
                 AND h.message_id IS NULL
                 AND m.kind NOT IN ('reaction','pin','unpin')
               ORDER BY m.created_at ASC"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id, viewer_id], |r| {
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
                "reply_to": r.get::<_, Option<String>>(11)?,
                "read": r.get::<_, i64>(12)? == 1,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let mut msg = row.map_err(|e| e.to_string())?;
        let mid = msg["id"].as_str().unwrap_or("").to_string();
        let (attempts, last_error): (i64, Option<String>) = conn
            .query_row(
                "SELECT COALESCE(MAX(attempts),0), MAX(last_error) FROM outbox WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
                params![mid.as_str(), format!("{mid}:%")],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap_or((0, None));
        let failed = attempts >= 8;
        msg["failed"] = serde_json::json!(failed);
        msg["attempts"] = serde_json::json!(attempts);
        msg["last_error"] = serde_json::json!(last_error);
        msg["reactions"] = serde_json::json!(list_reactions_for(conn, &mid).unwrap_or_default());
        msg["pinned"] =
            serde_json::json!(is_message_pinned(conn, conversation_id, &mid).unwrap_or(false));
        out.push(msg);
    }
    Ok(out)
}

pub fn reset_outbox_attempts(conn: &Connection, message_id: &str) -> Result<u64, String> {
    let n = conn
        .execute(
            "UPDATE outbox SET attempts=0, last_error=NULL, last_attempt_at=NULL WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
            params![message_id, format!("{message_id}:%")],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u64)
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
            "SELECT id, recipient_id, conversation_id, payload, created_at, attempts, last_error, last_attempt_at FROM outbox WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT 200",
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
                "last_error": r.get::<_, Option<String>>(6)?,
                "last_attempt_at": r.get::<_, Option<String>>(7)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let now = chrono::Utc::now().timestamp();
    for row in rows {
        let item = row.map_err(|e| e.to_string())?;
        let attempts = item["attempts"].as_i64().unwrap_or(0);
        if attempts > 0 {
            // Exponential backoff from last attempt: 2^n seconds, max 60s.
            let delay = (1i64 << attempts.min(6)).min(60);
            let last = item["last_attempt_at"]
                .as_str()
                .or_else(|| item["created_at"].as_str());
            if let Some(ts_s) = last {
                if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(ts_s) {
                    if now - ts.timestamp() < delay {
                        continue;
                    }
                }
            }
        }
        out.push(item);
        if out.len() >= 100 {
            break;
        }
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
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE outbox SET attempts=attempts+1, last_error=?2, last_attempt_at=?3 WHERE id=?1",
        params![id, err, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

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

pub fn list_reactions_for(conn: &Connection, message_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT emoji, user_id FROM message_reactions WHERE message_id=?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![message_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut map: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
    for row in rows {
        let (emoji, uid) = row.map_err(|e| e.to_string())?;
        map.entry(emoji).or_default().push(uid);
    }
    Ok(map
        .into_iter()
        .map(|(emoji, users)| {
            serde_json::json!({ "emoji": emoji, "users": users, "count": users.len() })
        })
        .collect())
}

pub fn is_message_pinned(
    conn: &Connection,
    conversation_id: &str,
    message_id: &str,
) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM message_pins WHERE conversation_id=?1 AND message_id=?2",
            params![conversation_id, message_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

pub fn list_pinned_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT message_id, pinned_by, pinned_at FROM message_pins WHERE conversation_id=?1 ORDER BY pinned_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id], |r| {
            Ok(serde_json::json!({
                "message_id": r.get::<_, String>(0)?,
                "pinned_by": r.get::<_, String>(1)?,
                "pinned_at": r.get::<_, String>(2)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn set_conversation_pinned(
    conn: &Connection,
    conversation_id: &str,
    pinned: bool,
) -> Result<(), String> {
    if pinned {
        conn.execute(
            "UPDATE conversations SET pinned_at=?2 WHERE id=?1",
            params![conversation_id, chrono::Utc::now().to_rfc3339()],
        )
    } else {
        conn.execute(
            "UPDATE conversations SET pinned_at=NULL WHERE id=?1",
            params![conversation_id],
        )
    }
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_conversation_muted(
    conn: &Connection,
    conversation_id: &str,
    muted: bool,
) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET muted=?2 WHERE id=?1",
        params![conversation_id, muted as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key=?1",
        params![key],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings(key, value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn conversation_muted(conn: &Connection, conversation_id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COALESCE(muted,0) FROM conversations WHERE id=?1",
            params![conversation_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(n == 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn insert_message_is_idempotent() {
        let conn = mem();
        let msg = serde_json::json!({
            "id": "m1",
            "conversation_id": "c1",
            "sender_id": "u1",
            "kind": "text",
            "ciphertext": "aaa",
            "nonce": "n",
            "wrapped_keys": {},
            "signature": "s",
            "created_at": "2026-01-01T00:00:00Z",
            "delivered": false
        });
        insert_message(&conn, &msg).unwrap();
        let mut msg2 = msg.clone();
        msg2["ciphertext"] = serde_json::json!("bbb");
        insert_message(&conn, &msg2).unwrap();
        let ct: String = conn
            .query_row("SELECT ciphertext FROM messages WHERE id='m1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ct, "aaa");
    }

    #[test]
    fn tombstone_blocks_revive() {
        let conn = mem();
        let msg = serde_json::json!({
            "id": "m2",
            "conversation_id": "c1",
            "sender_id": "u1",
            "kind": "text",
            "ciphertext": "aaa",
            "nonce": "n",
            "wrapped_keys": {},
            "signature": "s",
            "created_at": "2026-01-01T00:00:00Z",
            "delivered": false
        });
        insert_message(&conn, &msg).unwrap();
        tombstone_message(&conn, "m2").unwrap();
        insert_message(&conn, &msg).unwrap();
        let kind: String = conn
            .query_row("SELECT kind FROM messages WHERE id='m2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kind, "deleted");
    }

    #[test]
    fn migrate_sets_user_version() {
        let conn = mem();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert!(v >= 3);
    }

    #[test]
    fn admin_succession_promotes_earliest() {
        let conn = mem();
        create_group(
            &conn,
            "g1",
            "G",
            "u1",
            &[
                ("u1".into(), None),
                ("u2".into(), None),
                ("u3".into(), None),
            ],
        )
        .unwrap();
        assert!(is_group_admin(&conn, "g1", "u1").unwrap());
        delete_member(&conn, "g1", "u1").unwrap();
        let promoted = ensure_group_admin(&conn, "g1").unwrap();
        assert_eq!(promoted.as_deref(), Some("u2"));
        assert!(is_group_admin(&conn, "g1", "u2").unwrap());
    }

    #[test]
    fn outbox_backoff_skips_hot_loop() {
        let conn = mem();
        enqueue_outbox(&conn, "m9:u2", "u2", "c1", "{}").unwrap();
        conn.execute(
            "UPDATE outbox SET attempts=3, last_attempt_at=?1 WHERE id='m9:u2'",
            params![chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();
        let pending = pending_outbox(&conn).unwrap();
        assert!(pending.iter().all(|p| p["id"].as_str() != Some("m9:u2")));
    }

    #[test]
    fn mark_stale_peers_offline_works() {
        let conn = mem();
        upsert_peer(
            &conn,
            "u1",
            "A",
            "x",
            "e",
            Some("10.0.0.1"),
            Some(4000),
            Some("fp"),
            true,
        )
        .unwrap();
        let old = (chrono::Utc::now() - chrono::Duration::seconds(120)).to_rfc3339();
        conn.execute(
            "UPDATE peers SET last_seen_at=?1 WHERE user_id='u1'",
            params![old],
        )
        .unwrap();
        let n = mark_stale_peers_offline(&conn, 45).unwrap();
        assert!(n >= 1);
        let online: i64 = conn
            .query_row("SELECT online FROM peers WHERE user_id='u1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(online, 0);
    }

    #[test]
    fn receive_progress_resume() {
        let conn = mem();
        upsert_receive_progress(&conn, "f1", 3, Some("/tmp/f1.part")).unwrap();
        let (next, path) = get_receive_progress(&conn, "f1").unwrap().unwrap();
        assert_eq!(next, 3);
        assert_eq!(path.as_deref(), Some("/tmp/f1.part"));
        clear_receive_progress(&conn, "f1").unwrap();
        assert!(get_receive_progress(&conn, "f1").unwrap().is_none());
    }
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

pub fn hide_message(conn: &Connection, user_id: &str, message_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO hidden_messages(user_id, message_id, hidden_at) VALUES (?1,?2,?3)",
        params![user_id, message_id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_message(conn: &Connection, message_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, created_at, delivered FROM messages WHERE id=?1",
        params![message_id],
        |r| {
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
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn tombstone_message(conn: &Connection, message_id: &str) -> Result<(), String> {
    conn.execute(
        r#"UPDATE messages
           SET kind='deleted',
               ciphertext='',
               nonce='',
               wrapped_keys='{}',
               signature='',
               file_id=NULL
           WHERE id=?1"#,
        params![message_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn cancel_outbox_for_message(conn: &Connection, message_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM outbox WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
        params![message_id, format!("{message_id}:%")],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

pub fn is_conversation_member(conn: &Connection, conversation_id: &str, user_id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversation_members WHERE conversation_id=?1 AND user_id=?2",
            params![conversation_id, user_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
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
