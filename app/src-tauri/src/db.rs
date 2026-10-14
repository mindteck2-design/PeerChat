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
    let _ = conn.execute("ALTER TABLE profile ADD COLUMN team TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE files ADD COLUMN local_path TEXT", []);
    let _ = conn.execute("ALTER TABLE files ADD COLUMN content_sha256 TEXT", []);
    let _ = conn.execute("ALTER TABLE files ADD COLUMN file_crypto_v INTEGER DEFAULT 1", []);
    let _ = conn.execute("ALTER TABLE outbox ADD COLUMN last_attempt_at TEXT", []);
    let _ = conn.execute("ALTER TABLE outbox ADD COLUMN next_retry_at TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE peers ADD COLUMN identity_changed INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE peers ADD COLUMN pending_tls_fingerprint TEXT", []);
    let _ = conn.execute("ALTER TABLE peers ADD COLUMN pending_x25519_public TEXT", []);
    let _ = conn.execute("ALTER TABLE peers ADD COLUMN pending_ed25519_public TEXT", []);
    let _ = conn.execute("ALTER TABLE peers ADD COLUMN team TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute(
        "ALTER TABLE peers ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS peer_identity_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            tls_fingerprint TEXT,
            x25519_public TEXT NOT NULL,
            ed25519_public TEXT NOT NULL,
            retired_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_peer_identity_history_user
          ON peer_identity_history(user_id, retired_at);
        "#,
    );

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

    if version < 4 {
        // One DM thread per peer; deterministic ids (see dm_conversation_id).
        let _ = conn.execute_batch(
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_dm_peer
              ON conversations(peer_id) WHERE kind='dm' AND peer_id IS NOT NULL;
            "#,
        );
        conn.pragma_update(None, "user_version", 4)
            .map_err(|e| e.to_string())?;
    }

    if version < 5 {
        // Clear poisoned loopback IPs from older lan_ip() fallback (broke reverse delivery).
        let _ = conn.execute_batch(
            r#"
            UPDATE peers SET last_ip=NULL
             WHERE last_ip IN ('127.0.0.1','::1','0.0.0.0','localhost');
            "#,
        );
        conn.pragma_update(None, "user_version", 5)
            .map_err(|e| e.to_string())?;
    }

    if version < 6 {
        // Stop defaulting to on — requestPermission in a poll loop was flashing WebView2 prompts.
        let _ = conn.execute(
            "INSERT OR IGNORE INTO app_settings(key, value) VALUES ('notifications_enabled', '1')",
            [],
        );
        conn.pragma_update(None, "user_version", 6)
            .map_err(|e| e.to_string())?;
    }

    let _ = conn.execute("ALTER TABLE messages ADD COLUMN sort_at TEXT", []);
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN edited_at TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE conversations ADD COLUMN members_can_add INTEGER NOT NULL DEFAULT 1",
        [],
    );

    if version < 7 {
        // Backfill: use created_at so existing rows keep relative order.
        let _ = conn.execute(
            "UPDATE messages SET sort_at = created_at WHERE sort_at IS NULL OR sort_at = ''",
            [],
        );
        conn.pragma_update(None, "user_version", 7)
            .map_err(|e| e.to_string())?;
    }

    if version < 8 {
        conn.pragma_update(None, "user_version", 8)
            .map_err(|e| e.to_string())?;
    }

    if version < 9 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS saved_items (
                id TEXT PRIMARY KEY,
                message_id TEXT,
                conversation_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                preview TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_saved_items_created ON saved_items(created_at);
            CREATE TABLE IF NOT EXISTS transfer_log (
                id TEXT PRIMARY KEY,
                direction TEXT NOT NULL,
                file_id TEXT,
                conversation_id TEXT,
                peer_label TEXT,
                filename TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                error TEXT,
                bytes_done INTEGER NOT NULL DEFAULT 0,
                verified INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                finished_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_transfer_log_updated ON transfer_log(updated_at);
            "#,
        )
        .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 9)
            .map_err(|e| e.to_string())?;
    }

    if version < 10 {
        conn.execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_outbox_next_retry
              ON outbox(next_retry_at) WHERE delivered_at IS NULL;
            "#,
        )
        .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 10)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Stable DM conversation id shared by both peers (must match encryption AD).
pub fn dm_conversation_id(user_a: &str, user_b: &str) -> String {
    let (a, b) = if user_a <= user_b {
        (user_a, user_b)
    } else {
        (user_b, user_a)
    };
    format!("dm:{a}:{b}")
}

fn dm_id_for_peer(conn: &Connection, peer: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT id FROM conversations WHERE kind='dm' AND peer_id=?1 LIMIT 1",
        params![peer],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn conversation_message_count(conn: &Connection, conversation_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM messages WHERE conversation_id=?1",
        params![conversation_id],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

fn rekey_conversation_id(conn: &Connection, old: &str, new: &str) -> Result<(), String> {
    if old == new {
        return Ok(());
    }
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM conversations WHERE id=?1",
            params![new],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    if exists {
        return Ok(());
    }
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| e.to_string())?;
    let tables = [
        "conversation_members",
        "messages",
        "outbox",
        "files",
        "message_pins",
    ];
    for table in tables {
        conn.execute(
            &format!("UPDATE {table} SET conversation_id=?1 WHERE conversation_id=?2"),
            params![new, old],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        "UPDATE conversations SET id=?1 WHERE id=?2",
        params![new, old],
    )
    .map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn ensure_dm_row(conn: &Connection, id: &str, peer: &str, me: &str) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    // Insert without peer_id first so a unique peer index on another row cannot block us.
    conn.execute(
        "INSERT OR IGNORE INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm',NULL,?2)",
        params![id, now],
    )
    .map_err(|e| e.to_string())?;
    detach_dm_peer_links(conn, peer, Some(id))?;
    conn.execute(
        "UPDATE conversations SET peer_id=?1 WHERE id=?2 AND kind='dm'",
        params![peer, id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?3)",
        params![id, me, now],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?3)",
        params![id, peer, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn detach_dm_peer_links(conn: &Connection, peer: &str, keep_id: Option<&str>) -> Result<(), String> {
    if let Some(keep) = keep_id {
        conn.execute(
            "UPDATE conversations SET peer_id=NULL WHERE kind='dm' AND peer_id=?1 AND id!=?2",
            params![peer, keep],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE conversations SET peer_id=NULL WHERE kind='dm' AND peer_id=?1",
            params![peer],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Conversation ids that belong to the same 1:1 thread (legacy random UUIDs + canonical).
fn dm_related_conversation_ids(
    conn: &Connection,
    conversation_id: &str,
    me: &str,
) -> Result<Vec<String>, String> {
    let mut ids = vec![conversation_id.to_string()];
    let row: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT kind, peer_id FROM conversations WHERE id=?1",
            params![conversation_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((kind, peer_id)) = row else {
        return Ok(ids);
    };
    if kind != "dm" {
        return Ok(ids);
    }
    let peer = peer_id.or_else(|| {
        // Canonical form dm:{a}:{b}
        let rest = conversation_id.strip_prefix("dm:")?;
        let (a, b) = rest.split_once(':')?;
        if a == me {
            Some(b.to_string())
        } else if b == me {
            Some(a.to_string())
        } else {
            None
        }
    });
    let Some(peer) = peer else {
        return Ok(ids);
    };

    let mut stmt = conn
        .prepare(
            r#"SELECT DISTINCT cm.conversation_id
               FROM conversation_members cm
               JOIN conversations c ON c.id = cm.conversation_id
               WHERE c.kind = 'dm'
                 AND cm.user_id = ?1
                 AND cm.conversation_id IN (
                   SELECT conversation_id FROM conversation_members WHERE user_id = ?2
                 )"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![peer.as_str(), me], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for r in rows {
        let id = r.map_err(|e| e.to_string())?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    // Detached legacy rows may still hold messages under old ids.
    let mut stmt2 = conn
        .prepare(
            "SELECT id FROM conversations WHERE kind='dm' AND (peer_id=?1 OR id=?2)",
        )
        .map_err(|e| e.to_string())?;
    let rows2 = stmt2
        .query_map(params![peer.as_str(), conversation_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for r in rows2 {
        let id = r.map_err(|e| e.to_string())?;
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// Align local DM metadata with an inbound message's conversation_id (crypto AD must match row).
pub fn reconcile_dm_on_deliver(
    conn: &Connection,
    me: &str,
    sender_id: &str,
    incoming_conv_id: &str,
) -> Result<(), String> {
    if sender_id.is_empty() || incoming_conv_id.is_empty() || sender_id == me {
        return Ok(());
    }
    if let Ok(kind) = conn.query_row(
        "SELECT kind FROM conversations WHERE id=?1",
        params![incoming_conv_id],
        |r| r.get::<_, String>(0),
    ) {
        if kind == "group" {
            return Ok(());
        }
    }

    // Keep inbound conversation_id for crypto AD; prefer canonical as the People/open link.
    let canonical = dm_conversation_id(me, sender_id);
    ensure_dm_row(conn, incoming_conv_id, sender_id, me)?;
    if canonical != incoming_conv_id {
        // Members on inbound id (already), plus a canonical row linked for UI/send.
        let now = chrono::Utc::now().to_rfc3339();
        let _ = conn.execute(
            "INSERT OR IGNORE INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm',NULL,?2)",
            params![canonical.as_str(), now],
        );
        let _ = conn.execute(
            "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?3)",
            params![canonical.as_str(), me, now],
        );
        let _ = conn.execute(
            "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,?2,'member',?3)",
            params![canonical.as_str(), sender_id, now],
        );
        detach_dm_peer_links(conn, sender_id, Some(&canonical))?;
        let _ = conn.execute(
            "UPDATE conversations SET peer_id=?1 WHERE id=?2",
            params![sender_id, canonical.as_str()],
        );
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

fn archive_peer_identity(
    conn: &Connection,
    user_id: &str,
    tls_fingerprint: Option<&str>,
    x25519_public: &str,
    ed25519_public: &str,
) -> Result<(), String> {
    if x25519_public.is_empty() && ed25519_public.is_empty() {
        return Ok(());
    }
    let exists: i64 = conn
        .query_row(
            r#"SELECT COUNT(*) FROM peer_identity_history
               WHERE user_id=?1 AND x25519_public=?2 AND ed25519_public=?3
                 AND IFNULL(tls_fingerprint,'')=IFNULL(?4,'')"#,
            params![user_id, x25519_public, ed25519_public, tls_fingerprint],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if exists > 0 {
        return Ok(());
    }
    conn.execute(
        r#"INSERT INTO peer_identity_history(user_id, tls_fingerprint, x25519_public, ed25519_public, retired_at)
           VALUES (?1,?2,?3,?4,?5)"#,
        params![
            user_id,
            tls_fingerprint,
            x25519_public,
            ed25519_public,
            chrono::Utc::now().to_rfc3339()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Adopt a peer's new TLS / crypto keys immediately. Old keys are retained in
/// peer_identity_history so previously encrypted material can still be verified.
pub fn adopt_peer_identity(
    conn: &Connection,
    user_id: &str,
    tls_fingerprint: &str,
    x25519_public: &str,
    ed25519_public: &str,
) -> Result<(), String> {
    if user_id.is_empty() {
        return Ok(());
    }
    let existing = get_peer(conn, user_id)?;
    if let Some(ref ex) = existing {
        let old_x = ex["x25519_public"].as_str().unwrap_or("");
        let old_e = ex["ed25519_public"].as_str().unwrap_or("");
        let old_fp = ex["tls_fingerprint"].as_str();
        let same = old_x == x25519_public
            && old_e == ed25519_public
            && (tls_fingerprint.is_empty() || old_fp == Some(tls_fingerprint));
        if same {
            let _ = conn.execute(
                r#"UPDATE peers SET identity_changed=0,
                       pending_tls_fingerprint=NULL,
                       pending_x25519_public=NULL,
                       pending_ed25519_public=NULL
                   WHERE user_id=?1"#,
                params![user_id],
            );
            return Ok(());
        }
        archive_peer_identity(conn, user_id, old_fp, old_x, old_e)?;
    }
    let fp = if tls_fingerprint.is_empty() {
        existing
            .as_ref()
            .and_then(|e| e["tls_fingerprint"].as_str())
            .unwrap_or("")
    } else {
        tls_fingerprint
    };
    let x = if x25519_public.is_empty() {
        existing
            .as_ref()
            .and_then(|e| e["x25519_public"].as_str())
            .unwrap_or("")
    } else {
        x25519_public
    };
    let e = if ed25519_public.is_empty() {
        existing
            .as_ref()
            .and_then(|e| e["ed25519_public"].as_str())
            .unwrap_or("")
    } else {
        ed25519_public
    };
    conn.execute(
        r#"UPDATE peers SET
               tls_fingerprint=?2,
               x25519_public=?3,
               ed25519_public=?4,
               identity_changed=0,
               pending_tls_fingerprint=NULL,
               pending_x25519_public=NULL,
               pending_ed25519_public=NULL
           WHERE user_id=?1"#,
        params![user_id, fp, x, e],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Apply any leftover pending identity rows (from older builds that required Review).
pub fn auto_accept_all_pending_identities(conn: &Connection) -> Result<u64, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT user_id,
                      COALESCE(pending_tls_fingerprint,''),
                      COALESCE(pending_x25519_public,''),
                      COALESCE(pending_ed25519_public,'')
               FROM peers
               WHERE identity_changed=1 AND pending_tls_fingerprint IS NOT NULL"#,
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let mut n = 0u64;
    for (uid, fp, x, e) in rows {
        adopt_peer_identity(conn, &uid, &fp, &x, &e)?;
        n += 1;
    }
    Ok(n)
}

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
    upsert_peer_with_team(
        conn,
        user_id,
        display_name,
        x25519_public,
        ed25519_public,
        ip,
        port,
        tls_fingerprint,
        online,
        None,
    )
}

pub fn upsert_peer_with_team(
    conn: &Connection,
    user_id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    ip: Option<&str>,
    port: Option<i64>,
    tls_fingerprint: Option<&str>,
    online: bool,
    team: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    // Never persist loopback / garbage — that poisons reverse delivery.
    let ip = ip.filter(|s| crate::discovery::is_usable_lan_ip(s));
    let team = team.unwrap_or("").trim();
    conn.execute(
        r#"INSERT INTO peers(user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, last_seen_at, online, team)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
           ON CONFLICT(user_id) DO UPDATE SET
             display_name=excluded.display_name,
             x25519_public=excluded.x25519_public,
             ed25519_public=excluded.ed25519_public,
             last_ip=COALESCE(excluded.last_ip, peers.last_ip),
             last_port=COALESCE(excluded.last_port, peers.last_port),
             tls_fingerprint=COALESCE(excluded.tls_fingerprint, peers.tls_fingerprint),
             last_seen_at=excluded.last_seen_at,
             online=excluded.online,
             team=CASE WHEN excluded.team != '' THEN excluded.team ELSE peers.team END"#,
        params![
            user_id,
            display_name,
            x25519_public,
            ed25519_public,
            ip,
            port,
            tls_fingerprint,
            now,
            online as i64,
            team
        ],
    )
    .map_err(|e| e.to_string())?;
    // One peer per LAN IP: when this identity is live at `ip`, fold any other row
    // still holding that address (typical after a PeerChat reinstall / new user_id).
    if online {
        if let Some(ip) = ip {
            let _ = claim_unique_peer_ip(conn, user_id, ip);
        }
    }
    Ok(())
}

/// Ensure `keep_user_id` is the only peer with `last_ip = ip`. Transfers pin/block
/// from displaced rows, then deletes them.
pub fn claim_unique_peer_ip(
    conn: &Connection,
    keep_user_id: &str,
    ip: &str,
) -> Result<(), String> {
    if keep_user_id.is_empty() || !crate::discovery::is_usable_lan_ip(ip) {
        return Ok(());
    }
    let mut stmt = conn
        .prepare(
            r#"SELECT user_id, COALESCE(pinned,0), tls_fingerprint, COALESCE(blocked,0)
               FROM peers
               WHERE user_id != ?1 AND last_ip = ?2"#,
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, i64, Option<String>, i64)> = stmt
        .query_map(params![keep_user_id, ip], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    if rows.is_empty() {
        return Ok(());
    }

    let keep = get_peer(conn, keep_user_id)?;
    let mut keep_pinned = keep
        .as_ref()
        .and_then(|p| p.get("pinned").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    let mut keep_blocked = keep
        .as_ref()
        .and_then(|p| p.get("blocked").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    for (dup_id, pinned, fp, blocked) in rows {
        if pinned == 1 && !keep_pinned {
            let use_fp = fp.unwrap_or_default();
            if !use_fp.is_empty() {
                let _ = pin_peer(conn, keep_user_id, &use_fp);
            } else {
                let _ = conn.execute(
                    "UPDATE peers SET pinned=1 WHERE user_id=?1",
                    params![keep_user_id],
                );
            }
            keep_pinned = true;
        }
        if blocked == 1 && !keep_blocked {
            let _ = set_peer_blocked(conn, keep_user_id, true);
            keep_blocked = true;
        }
        let _ = conn.execute("DELETE FROM peers WHERE user_id=?1", params![dup_id]);
    }
    Ok(())
}

/// Collapse any existing IP collisions (online / most-recently-seen wins).
pub fn dedupe_peers_by_ip(conn: &Connection) -> Result<(), String> {
    let peers = list_peers_raw(conn)?;
    use std::collections::HashMap;
    let mut best: HashMap<String, (String, bool, String)> = HashMap::new();
    for p in &peers {
        let id = p["user_id"].as_str().unwrap_or("").to_string();
        let ip = p["last_ip"].as_str().unwrap_or("").to_string();
        if id.is_empty() || !crate::discovery::is_usable_lan_ip(&ip) {
            continue;
        }
        let online = p["online"].as_bool().unwrap_or(false);
        let seen = p["last_seen_at"].as_str().unwrap_or("").to_string();
        match best.get(&ip) {
            None => {
                best.insert(ip, (id, online, seen));
            }
            Some((_, was_online, was_seen)) => {
                let better = (online && !*was_online)
                    || (online == *was_online && seen.as_str() > was_seen.as_str());
                if better {
                    best.insert(ip, (id, online, seen));
                }
            }
        }
    }
    for (ip, (keep_id, _, _)) in best {
        let _ = claim_unique_peer_ip(conn, &keep_id, &ip);
    }
    Ok(())
}

fn list_peers_raw(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, pinned, last_seen_at, online, COALESCE(identity_changed,0), pending_tls_fingerprint, COALESCE(team,''), COALESCE(blocked,0) FROM peers ORDER BY display_name",
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
                "team": r.get::<_, String>(12)?,
                "blocked": r.get::<_, i64>(13)? == 1,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn peer_blocked(conn: &Connection, user_id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COALESCE(blocked,0) FROM peers WHERE user_id=?1",
        params![user_id],
        |r| Ok(r.get::<_, i64>(0)? == 1),
    )
    .optional()
    .map_err(|e| e.to_string())
    .map(|o| o.unwrap_or(false))
}

/// Block or unblock a peer for DMs. Trust (pinned) is preserved so unblock does not
/// re-trigger first-contact. Blocking mutes the DM; unblock unmutes it.
pub fn set_peer_blocked(conn: &Connection, user_id: &str, blocked: bool) -> Result<(), String> {
    let n = conn
        .execute(
            "UPDATE peers SET blocked=?2 WHERE user_id=?1",
            params![user_id, blocked as i64],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("unknown peer".into());
    }
    if let Some(profile) = get_profile(conn)? {
        let me = profile.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if !me.is_empty() {
            let cid = dm_conversation_id(me, user_id);
            let _ = set_conversation_muted(conn, &cid, blocked);
            if let Ok(Some(legacy)) = dm_id_for_peer(conn, user_id) {
                if legacy != cid {
                    let _ = set_conversation_muted(conn, &legacy, blocked);
                }
            }
        }
    }
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
            r#"UPDATE peers SET pinned=1, blocked=0, tls_fingerprint=?2,
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
            "UPDATE peers SET pinned=1, blocked=0, tls_fingerprint=?2, identity_changed=0 WHERE user_id=?1",
            params![user_id, fingerprint],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_peers(conn: &Connection) -> Result<Vec<Value>, String> {
    // Enforce unique last_ip before returning (clears reinstall ghosts).
    let _ = dedupe_peers_by_ip(conn);
    list_peers_raw(conn)
}

pub fn get_peer(conn: &Connection, user_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, pinned, online, COALESCE(blocked,0) FROM peers WHERE user_id=?1",
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
                "blocked": r.get::<_, i64>(9)? == 1,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn ensure_dm(conn: &Connection, me: &str, peer: &str) -> Result<String, String> {
    let canonical = dm_conversation_id(me, peer);
    // Always send/open on the shared canonical id. Legacy random UUID threads stay readable
    // via dm_related_conversation_ids in list_messages (crypto AD must keep old ids on rows).
    detach_dm_peer_links(conn, peer, Some(&canonical))?;
    if let Some(existing) = dm_id_for_peer(conn, peer)? {
        if existing != canonical {
            detach_dm_peer_links(conn, peer, None)?;
        }
    }
    // Re-link any empty legacy row by rekey when safe (no messages / no id clash).
    let legacy: Vec<String> = {
        let mut stmt = conn
            .prepare(
                r#"SELECT c.id FROM conversations c
                   JOIN conversation_members m1 ON m1.conversation_id=c.id AND m1.user_id=?1
                   JOIN conversation_members m2 ON m2.conversation_id=c.id AND m2.user_id=?2
                   WHERE c.kind='dm' AND c.id!=?3"#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![me, peer, canonical.as_str()], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let mut v = Vec::new();
        for r in rows {
            v.push(r.map_err(|e| e.to_string())?);
        }
        v
    };
    for old in legacy {
        if conversation_message_count(conn, &old)? == 0 {
            let _ = rekey_conversation_id(conn, &old, &canonical);
        }
    }
    ensure_dm_row(conn, &canonical, peer, me)?;
    Ok(canonical)
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

pub fn is_announcement_board_id(id: &str) -> bool {
    id == "board:org" || id.starts_with("board:team:")
}

/// Create or reopen a local announcement board conversation for this user.
pub fn ensure_announcement_board(
    conn: &Connection,
    id: &str,
    title: &str,
    me: &str,
) -> Result<Value, String> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversations WHERE id=?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        create_group(conn, id, title, me, &[(me.to_string(), None)])?;
    } else {
        conn.execute(
            "UPDATE conversations SET title=?2 WHERE id=?1",
            params![id, title],
        )
        .map_err(|e| e.to_string())?;
        upsert_member(conn, id, me, None, None)?;
        // First member who created the board stays admin; ensure at least one admin.
        let _ = ensure_group_admin(conn, id);
    }
    Ok(serde_json::json!({
        "id": id,
        "kind": "group",
        "title": title,
        "peer_id": Value::Null,
        "peer_name": Value::Null,
        "created_at": chrono::Utc::now().to_rfc3339(),
        "is_announcement_board": true,
    }))
}

pub fn list_conversations(conn: &Connection) -> Result<Vec<Value>, String> {
    let me = get_profile(conn)?
        .and_then(|p| p["id"].as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    // Subquery: pick the single most-recent visible message per conversation using
    // a window function so we get kind + sender alongside the timestamp.
    let mut stmt = conn
        .prepare(
            r#"SELECT c.id, c.kind, c.title, c.peer_id, c.created_at, c.pinned_at,
                      COALESCE(c.muted,0), COALESCE(c.members_can_add,1),
                      lm.kind, lm.created_at, lm.sender_id,
                      lm.ciphertext, lm.nonce, lm.wrapped_keys
               FROM conversations c
               LEFT JOIN (
                 SELECT conversation_id, kind, created_at, sender_id, ciphertext, nonce, wrapped_keys
                 FROM (
                   SELECT conversation_id, kind, created_at, sender_id, ciphertext, nonce, wrapped_keys,
                          ROW_NUMBER() OVER (
                            PARTITION BY conversation_id
                            ORDER BY COALESCE(NULLIF(sort_at,''), created_at) DESC, id DESC
                          ) AS rn
                   FROM messages
                   WHERE kind NOT IN ('reaction','pin','unpin','deleted','game_move','poll_vote')
                 ) ranked
                 WHERE rn = 1
               ) lm ON lm.conversation_id = c.id
               ORDER BY (c.pinned_at IS NULL),
                        c.pinned_at DESC,
                        COALESCE(lm.created_at, c.created_at) DESC"#,
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
                r.get::<_, i64>(7)?,
                r.get::<_, Option<String>>(8)?,
                r.get::<_, Option<String>>(9)?,
                r.get::<_, Option<String>>(10)?,
                r.get::<_, Option<String>>(11)?,
                r.get::<_, Option<String>>(12)?,
                r.get::<_, Option<String>>(13)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (id, kind, title, peer_id, created_at, pinned_at, muted, members_can_add,
             last_kind, last_at, last_sender, last_ct, last_nonce, last_wraps) =
            row.map_err(|e| e.to_string())?;
        let last_wrapped_keys: Value = last_wraps
            .as_deref()
            .filter(|s| !s.is_empty())
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::json!({}));
        // Hide detached legacy DM shells (peer_id cleared after canonical migration).
        if kind == "dm" && peer_id.is_none() {
            continue;
        }
        // Announcement boards have their own nav page.
        if is_announcement_board_id(&id) {
            continue;
        }
        let peer_name = peer_id.as_ref().and_then(|pid| {
            conn.query_row(
                "SELECT display_name FROM peers WHERE user_id=?1",
                params![pid],
                |x| x.get::<_, String>(0),
            )
            .ok()
        });
        let unread = if me.is_empty() {
            0
        } else {
            unread_count(conn, &id, &me).unwrap_or(0)
        };
        out.push(serde_json::json!({
            "id": id,
            "kind": kind,
            "title": title,
            "peer_id": peer_id,
            "peer_name": peer_name,
            "created_at": created_at,
            "pinned_at": pinned_at,
            "muted": muted == 1,
            "members_can_add": members_can_add == 1,
            "unread_count": unread,
            "last_message_kind": last_kind,
            "last_message_at": last_at,
            "last_message_sender": last_sender,
            "last_message_ciphertext": last_ct,
            "last_message_nonce": last_nonce,
            "last_message_wrapped_keys": last_wrapped_keys,
        }));
    }
    Ok(out)
}

/// Returns `true` when a new row was written (used to avoid duplicate OS toasts).
pub fn insert_message(conn: &Connection, msg: &Value) -> Result<bool, String> {
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
                tombstone_message(conn, id)?;
                return Ok(true);
            }
            return Ok(false);
        }
    }
    let created = msg["created_at"].as_str().unwrap_or("");
    // sort_at: local timeline so skewed peer clocks cannot reorder the chat.
    // Incoming delivers should pass local "now"; outbound uses created_at.
    let sort_at = msg
        .get("sort_at")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(created);
    if incoming_kind == "deleted" {
        // Ensure tombstone row exists even if original never arrived.
        conn.execute(
            r#"INSERT OR REPLACE INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, created_at, delivered, reply_to, sort_at)
               VALUES (?1,?2,?3,'deleted','','','{}','',NULL,?4,0,NULL,?5)"#,
            params![
                id,
                msg["conversation_id"].as_str().unwrap_or(""),
                msg["sender_id"].as_str().unwrap_or(""),
                created,
                sort_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        return Ok(true);
    }
    conn.execute(
        r#"INSERT INTO messages(id, conversation_id, sender_id, kind, ciphertext, nonce, wrapped_keys, signature, file_id, created_at, delivered, reply_to, sort_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)"#,
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
            created,
            msg.get("delivered").and_then(|v| v.as_bool()).unwrap_or(false) as i64,
            msg.get("reply_to").and_then(|v| v.as_str()),
            sort_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    // Side-effects for reaction / pin sync messages.
    apply_control_message(conn, msg)?;
    Ok(true)
}

/// Replace ciphertext for an existing text message (edit sync).
pub fn apply_message_edit(conn: &Connection, msg: &Value) -> Result<(), String> {
    let id = msg["id"].as_str().unwrap_or("");
    if id.is_empty() {
        return Err("missing message id".into());
    }
    let kind: Option<String> = conn
        .query_row("SELECT kind FROM messages WHERE id=?1", params![id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(kind) = kind else {
        // Original never arrived — insert as normal.
        insert_message(conn, msg)?;
        return Ok(());
    };
    if kind == "deleted" || kind != "text" {
        return Ok(());
    }
    let edited_at = msg
        .get("edited_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            msg.get("created_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    conn.execute(
        r#"UPDATE messages SET ciphertext=?2, nonce=?3, wrapped_keys=?4, signature=?5, edited_at=?6
           WHERE id=?1"#,
        params![
            id,
            msg["ciphertext"].as_str().unwrap_or(""),
            msg["nonce"].as_str().unwrap_or(""),
            msg.get("wrapped_keys")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "{}".into()),
            msg["signature"].as_str().unwrap_or(""),
            edited_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_peer_display_name_everywhere(
    conn: &Connection,
    user_id: &str,
    display_name: &str,
) -> Result<(), String> {
    let _ = conn.execute(
        "UPDATE conversation_members SET display_name=?2 WHERE user_id=?1",
        params![user_id, display_name],
    );
    Ok(())
}

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

pub fn set_conversation_title(
    conn: &Connection,
    conversation_id: &str,
    title: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET title=?2 WHERE id=?1 AND kind='group'",
        params![conversation_id, title],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_members_can_add(
    conn: &Connection,
    conversation_id: &str,
    allowed: bool,
) -> Result<(), String> {
    conn.execute(
        "UPDATE conversations SET members_can_add=?2 WHERE id=?1 AND kind='group'",
        params![conversation_id, allowed as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn members_can_add(conn: &Connection, conversation_id: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COALESCE(members_can_add,1) FROM conversations WHERE id=?1",
            params![conversation_id],
            |r| r.get(0),
        )
        .unwrap_or(1);
    Ok(n == 1)
}

/// Delete all messages in a chat on this device. Keeps the conversation row.
/// When `include_files` is true, also removes file records and staging folders.
pub fn clear_conversation_messages(
    conn: &Connection,
    conversation_id: &str,
    include_files: bool,
) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "DELETE FROM message_pins WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM hidden_messages WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM messages WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM outbox WHERE conversation_id=?1",
        params![conversation_id],
    );
    if include_files {
        let mut stmt = conn
            .prepare("SELECT id FROM files WHERE conversation_id=?1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(params![conversation_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for id in ids {
            let _ = delete_file_record(conn, &id);
        }
    }
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Wipe a group conversation and related rows for this device.
pub fn delete_conversation_local(conn: &Connection, conversation_id: &str) -> Result<(), String> {
    conn.execute_batch("PRAGMA foreign_keys=OFF;")
        .map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "DELETE FROM message_pins WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM hidden_messages WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE conversation_id=?1)",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM messages WHERE conversation_id=?1",
        params![conversation_id],
    );
    // Always purge files when removing the whole conversation.
    {
        let mut stmt = conn
            .prepare("SELECT id FROM files WHERE conversation_id=?1")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(params![conversation_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for id in ids {
            let _ = delete_file_record(conn, &id);
        }
    }
    let _ = conn.execute(
        "DELETE FROM outbox WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM conversation_members WHERE conversation_id=?1",
        params![conversation_id],
    );
    let _ = conn.execute(
        "DELETE FROM conversations WHERE id=?1",
        params![conversation_id],
    );
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
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
    let related = dm_related_conversation_ids(conn, conversation_id, viewer_id)?;
    let placeholders = related
        .iter()
        .map(|_| "?".to_string())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        r#"SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.ciphertext,
                  m.nonce, m.wrapped_keys, m.signature, m.file_id, m.created_at,
                  m.delivered, m.reply_to, m.edited_at,
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
             ON h.message_id=m.id AND h.user_id=?1
           WHERE m.conversation_id IN ({placeholders})
             AND h.message_id IS NULL
             AND m.kind NOT IN ('reaction','pin','unpin')
           ORDER BY COALESCE(NULLIF(m.sort_at,''), m.created_at) ASC, m.created_at ASC, m.id ASC"#
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(1 + related.len());
    params_vec.push(&viewer_id);
    for id in &related {
        params_vec.push(id);
    }
    let rows = stmt
        .query_map(params_vec.as_slice(), |r| {
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
                "edited_at": r.get::<_, Option<String>>(12)?,
                "read": r.get::<_, i64>(13)? == 1,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let mut msg = row.map_err(|e| e.to_string())?;
        let mid = msg["id"].as_str().unwrap_or("").to_string();
        let msg_cid = msg["conversation_id"]
            .as_str()
            .unwrap_or(conversation_id)
            .to_string();
        let (pending_count, attempts, last_error, outbox_created): (
            i64,
            i64,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(MAX(attempts),0), MAX(last_error), MIN(created_at) FROM outbox WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
                params![mid.as_str(), format!("{mid}:%")],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap_or((0, 0, None, None));
        let queued =
            pending_count > 0 && !msg["delivered"].as_bool().unwrap_or(false);
        // Soft network failures stay Queued. Only age out after 2 days, or fail
        // immediately on security/identity errors.
        let security = last_error
            .as_deref()
            .map(|e| e.contains("[SECURITY]"))
            .unwrap_or(false);
        let stale = outbox_created
            .as_deref()
            .or(msg["created_at"].as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|ts| {
                chrono::Utc::now()
                    .signed_duration_since(ts.with_timezone(&chrono::Utc))
                    .num_hours()
                    >= 48
            })
            .unwrap_or(false);
        let failed = security || (queued && stale);
        msg["failed"] = serde_json::json!(failed);
        msg["queued"] = serde_json::json!(queued && !failed);
        msg["attempts"] = serde_json::json!(attempts);
        msg["last_error"] = serde_json::json!(last_error);
        msg["reactions"] = serde_json::json!(list_reactions_for(conn, &mid).unwrap_or_default());
        msg["pinned"] =
            serde_json::json!(is_message_pinned(conn, &msg_cid, &mid).unwrap_or(false));
        out.push(msg);
    }
    Ok(out)
}

pub fn reset_outbox_attempts(conn: &Connection, message_id: &str) -> Result<u64, String> {
    let n = conn
        .execute(
            "UPDATE outbox SET attempts=0, last_error=NULL, last_attempt_at=NULL, next_retry_at=NULL WHERE delivered_at IS NULL AND (id=?1 OR id LIKE ?2)",
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
    // Filter by next_retry_at in SQL so the index can skip non-due rows.
    // Rows that have never failed (next_retry_at IS NULL) are always included.
    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn
        .prepare(
            r#"SELECT id, recipient_id, conversation_id, payload, created_at, attempts, last_error, last_attempt_at
               FROM outbox
               WHERE delivered_at IS NULL
                 AND (next_retry_at IS NULL OR next_retry_at <= ?1)
               ORDER BY created_at ASC
               LIMIT 100"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![now], |r| {
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
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Items due for delivery to a specific peer (respects next_retry_at backoff).
pub fn pending_outbox_for_peer(conn: &Connection, recipient_id: &str) -> Result<Vec<Value>, String> {
    let now = chrono::Utc::now().to_rfc3339();
    let mut stmt = conn
        .prepare(
            r#"SELECT id, recipient_id, conversation_id, payload, created_at, attempts, last_error, last_attempt_at
               FROM outbox
               WHERE delivered_at IS NULL
                 AND recipient_id=?1
                 AND (next_retry_at IS NULL OR next_retry_at <= ?2)
               ORDER BY created_at ASC
               LIMIT 50"#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![recipient_id, now], |r| {
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
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// Immediately re-enable delivery attempts for all pending items to a given peer.
/// Called when a peer is rediscovered at a new address so the backoff window is bypassed.
pub fn clear_peer_outbox_backoff(conn: &Connection, recipient_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE outbox SET next_retry_at=NULL WHERE delivered_at IS NULL AND recipient_id=?1",
        params![recipient_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();
    // Read current attempts so we can compute the correct next delay.
    let attempts: i64 = conn
        .query_row("SELECT attempts FROM outbox WHERE id=?1", params![id], |r| r.get(0))
        .unwrap_or(0);
    let new_attempts = attempts + 1;
    // Exponential backoff with ±25 % jitter, then settle at 5 minutes so offline
    // peers (app closed on LAN) stay queued without a hot retry loop.
    // Jitter uses FNV-1a hash of the id so different items for the same peer
    // don't all retry at exactly the same moment (thundering-herd avoidance).
    let base_delay = if new_attempts <= 6 {
        (1i64 << new_attempts).min(60)
    } else {
        300
    };
    let jitter_range = (base_delay / 4).max(1);
    let hash: u64 = id.bytes().fold(14_695_981_039_346_656_037_u64, |acc, b| {
        acc.wrapping_mul(1_099_511_628_211).wrapping_add(b as u64)
    });
    let jitter = (hash % (jitter_range as u64 * 2)) as i64 - jitter_range;
    let delay = (base_delay + jitter).max(1);
    let next_retry_at = (now + chrono::Duration::seconds(delay)).to_rfc3339();
    conn.execute(
        "UPDATE outbox SET attempts=attempts+1, last_error=?2, last_attempt_at=?3, next_retry_at=?4 WHERE id=?1",
        params![id, err, now_str, next_retry_at],
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

fn unread_message_filter_sql() -> &'static str {
    // User-visible chat items only (skip reactions / pin control / deletes).
    "m.kind IN ('text','forwarded','file_notice','system')"
}

pub fn unread_count(
    conn: &Connection,
    conversation_id: &str,
    my_user_id: &str,
) -> Result<i64, String> {
    Ok(unread_incoming(conn, conversation_id, my_user_id)?.len() as i64)
}

pub fn unread_incoming(
    conn: &Connection,
    conversation_id: &str,
    my_user_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let related = dm_related_conversation_ids(conn, conversation_id, my_user_id)?;
    let mut out = Vec::new();
    for cid in related {
        let mut stmt = conn
            .prepare(&format!(
                r#"SELECT m.id, m.sender_id
                   FROM messages m
                   LEFT JOIN message_reads r
                     ON r.message_id=m.id AND r.user_id=?2
                   WHERE m.conversation_id=?1
                     AND m.sender_id<>?2
                     AND r.message_id IS NULL
                     AND {}"#,
                unread_message_filter_sql()
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cid.as_str(), my_user_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
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
        assert!(v >= 10);
    }

    #[test]
    fn dm_conversation_id_is_symmetric_and_stable() {
        let a = "user-aaa";
        let b = "user-bbb";
        assert_eq!(dm_conversation_id(a, b), dm_conversation_id(b, a));
        assert_eq!(dm_conversation_id(a, b), "dm:user-aaa:user-bbb");
    }

    #[test]
    fn ensure_dm_uses_shared_id() {
        let conn = mem();
        let id_a = ensure_dm(&conn, "alice", "bob").unwrap();
        let id_b = ensure_dm(&conn, "bob", "alice").unwrap();
        assert_eq!(id_a, id_b);
        assert_eq!(id_a, dm_conversation_id("alice", "bob"));
    }

    #[test]
    fn reconcile_dm_on_deliver_creates_thread_for_inbound() {
        let conn = mem();
        let cid = "dm:alice:bob";
        reconcile_dm_on_deliver(&conn, "bob", "alice", cid).unwrap();
        let peer_row: String = conn
            .query_row(
                "SELECT id FROM conversations WHERE kind='dm' AND peer_id='alice'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(peer_row, cid);
    }

    #[test]
    fn legacy_dm_uuid_still_lists_under_canonical() {
        let conn = mem();
        let legacy = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm','bob',?2)",
            params![legacy, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, role, joined_at) VALUES (?1,'alice','member',?2), (?1,'bob','member',?2)",
            params![legacy, now],
        )
        .unwrap();
        insert_message(
            &conn,
            &serde_json::json!({
                "id": "m-legacy",
                "conversation_id": legacy,
                "sender_id": "bob",
                "kind": "text",
                "ciphertext": "x",
                "nonce": "n",
                "wrapped_keys": {},
                "signature": "s",
                "created_at": now,
                "delivered": true
            }),
        )
        .unwrap();

        let canonical = ensure_dm(&conn, "alice", "bob").unwrap();
        assert_eq!(canonical, dm_conversation_id("alice", "bob"));
        assert_ne!(canonical, legacy);

        let msgs = list_messages(&conn, &canonical, "alice").unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["id"], "m-legacy");
        assert_eq!(msgs[0]["conversation_id"], legacy);
    }

    #[test]
    fn ensure_dm_prefers_canonical_even_if_legacy_has_messages() {
        let conn = mem();
        let legacy = "11111111-2222-3333-4444-555555555555";
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO conversations(id, kind, peer_id, created_at) VALUES (?1,'dm','bob',?2)",
            params![legacy, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversation_members(conversation_id, user_id, joined_at) VALUES (?1,'alice',?2), (?1,'bob',?2)",
            params![legacy, now],
        )
        .unwrap();
        insert_message(
            &conn,
            &serde_json::json!({
                "id": "m1",
                "conversation_id": legacy,
                "sender_id": "alice",
                "kind": "text",
                "ciphertext": "x",
                "nonce": "n",
                "wrapped_keys": {},
                "signature": "s",
                "created_at": now,
                "delivered": false
            }),
        )
        .unwrap();
        let id = ensure_dm(&conn, "alice", "bob").unwrap();
        assert_eq!(id, dm_conversation_id("alice", "bob"));
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
        // Simulate failed attempts via bump_outbox_error so next_retry_at is set.
        for _ in 0..3 {
            bump_outbox_error(&conn, "m9:u2", "test error").unwrap();
        }
        let pending = pending_outbox(&conn).unwrap();
        assert!(pending.iter().all(|p| p["id"].as_str() != Some("m9:u2")));
    }

    #[test]
    fn outbox_fresh_item_is_immediately_due() {
        let conn = mem();
        enqueue_outbox(&conn, "m-fresh:u3", "u3", "c1", "{}").unwrap();
        let pending = pending_outbox(&conn).unwrap();
        assert!(pending.iter().any(|p| p["id"].as_str() == Some("m-fresh:u3")));
    }

    #[test]
    fn bump_outbox_error_stores_next_retry_at() {
        let conn = mem();
        enqueue_outbox(&conn, "m-err:u4", "u4", "c1", "{}").unwrap();
        bump_outbox_error(&conn, "m-err:u4", "network error").unwrap();
        // next_retry_at should be in the future
        let next: Option<String> = conn
            .query_row("SELECT next_retry_at FROM outbox WHERE id='m-err:u4'", [], |r| r.get(0))
            .unwrap();
        assert!(next.is_some(), "next_retry_at should be set after bump");
        let ts = chrono::DateTime::parse_from_rfc3339(next.as_deref().unwrap()).unwrap();
        assert!(ts > chrono::Utc::now(), "next_retry_at should be in the future");
    }

    #[test]
    fn reset_outbox_attempts_clears_next_retry_at() {
        let conn = mem();
        enqueue_outbox(&conn, "m-reset:u5", "u5", "c1", "{}").unwrap();
        bump_outbox_error(&conn, "m-reset:u5", "err").unwrap();
        // Item should be in backoff
        let pending_before = pending_outbox(&conn).unwrap();
        assert!(!pending_before.iter().any(|p| p["id"].as_str() == Some("m-reset:u5")));
        // Reset should clear backoff
        reset_outbox_attempts(&conn, "m-reset").unwrap();
        let pending_after = pending_outbox(&conn).unwrap();
        assert!(pending_after.iter().any(|p| p["id"].as_str() == Some("m-reset:u5")));
    }

    #[test]
    fn clear_peer_outbox_backoff_unblocks_items() {
        let conn = mem();
        enqueue_outbox(&conn, "m-kick:u6", "u6", "c1", "{}").unwrap();
        bump_outbox_error(&conn, "m-kick:u6", "err").unwrap();
        // Peer comes back online — clear backoff
        clear_peer_outbox_backoff(&conn, "u6").unwrap();
        let pending = pending_outbox(&conn).unwrap();
        assert!(pending.iter().any(|p| p["id"].as_str() == Some("m-kick:u6")));
    }

    #[test]
    fn group_delivery_requires_all_recipients() {
        let conn = mem();
        // Two per-recipient outbox rows for the same message
        enqueue_outbox(&conn, "mg1:u1", "u1", "g1", "{}").unwrap();
        enqueue_outbox(&conn, "mg1:u2", "u2", "g1", "{}").unwrap();
        // Insert the message row (delivered=0)
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO messages(id,conversation_id,sender_id,kind,ciphertext,nonce,wrapped_keys,signature,created_at,delivered) VALUES ('mg1','g1','me','text','','','{}','',?1,0)",
            params![now],
        ).unwrap();
        // Deliver to u1 only — message should still be undelivered
        mark_outbox_delivered(&conn, "mg1:u1").unwrap();
        let delivered: i64 = conn
            .query_row("SELECT delivered FROM messages WHERE id='mg1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(delivered, 0, "delivered must stay 0 until all recipients acked");
        // Deliver to u2 — now message should be marked delivered
        mark_outbox_delivered(&conn, "mg1:u2").unwrap();
        let delivered: i64 = conn
            .query_row("SELECT delivered FROM messages WHERE id='mg1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(delivered, 1, "delivered must be 1 after all recipients acked");
    }

    #[test]
    fn duplicate_deliver_is_idempotent() {
        let conn = mem();
        enqueue_outbox(&conn, "dup1:u1", "u1", "c1", "{}").unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO messages(id,conversation_id,sender_id,kind,ciphertext,nonce,wrapped_keys,signature,created_at,delivered) VALUES ('dup1','c1','me','text','','','{}','',?1,0)",
            params![now],
        ).unwrap();
        mark_outbox_delivered(&conn, "dup1:u1").unwrap();
        // Second call must not error or corrupt state
        mark_outbox_delivered(&conn, "dup1:u1").unwrap();
        let delivered: i64 = conn
            .query_row("SELECT delivered FROM messages WHERE id='dup1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(delivered, 1);
    }

    #[test]
    fn pending_outbox_for_peer_returns_correct_subset() {
        let conn = mem();
        enqueue_outbox(&conn, "mp1:ua", "ua", "c1", "{}").unwrap();
        enqueue_outbox(&conn, "mp2:ub", "ub", "c1", "{}").unwrap();
        let for_ua = pending_outbox_for_peer(&conn, "ua").unwrap();
        assert_eq!(for_ua.len(), 1);
        assert_eq!(for_ua[0]["id"].as_str(), Some("mp1:ua"));
        let for_ub = pending_outbox_for_peer(&conn, "ub").unwrap();
        assert_eq!(for_ub.len(), 1);
        assert_eq!(for_ub[0]["id"].as_str(), Some("mp2:ub"));
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

pub fn delete_saved_by_message_id(conn: &Connection, message_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM saved_items WHERE message_id=?1",
        params![message_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn hide_message(conn: &Connection, user_id: &str, message_id: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO hidden_messages(user_id, message_id, hidden_at) VALUES (?1,?2,?3)",
        params![user_id, message_id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|e| e.to_string())?;
    // Saved is a shortcut into chat — drop it when the message is gone for me.
    let _ = delete_saved_by_message_id(conn, message_id);
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
    let _ = delete_saved_by_message_id(conn, message_id);
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

pub fn accept_pending_identity(conn: &Connection, user_id: &str) -> Result<(), String> {
    let pending: Option<(String, String, String)> = conn
        .query_row(
            r#"SELECT COALESCE(pending_tls_fingerprint,''),
                      COALESCE(pending_x25519_public,''),
                      COALESCE(pending_ed25519_public,'')
               FROM peers WHERE user_id=?1 AND identity_changed=1"#,
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((fp, x, e)) = pending else {
        return Err("No pending identity change for this peer".into());
    };
    adopt_peer_identity(conn, user_id, &fp, &x, &e)
}

pub fn upsert_transfer(conn: &Connection, row: &Value) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        r#"INSERT INTO transfer_log(id, direction, file_id, conversation_id, peer_label, filename, size_bytes, status, error, bytes_done, verified, started_at, updated_at, finished_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
           ON CONFLICT(id) DO UPDATE SET
             file_id=excluded.file_id,
             status=excluded.status,
             error=excluded.error,
             bytes_done=excluded.bytes_done,
             verified=excluded.verified,
             updated_at=excluded.updated_at,
             finished_at=excluded.finished_at,
             size_bytes=excluded.size_bytes,
             filename=excluded.filename"#,
        params![
            row["id"].as_str().unwrap_or(""),
            row["direction"].as_str().unwrap_or("send"),
            row.get("file_id").and_then(|v| v.as_str()),
            row.get("conversation_id").and_then(|v| v.as_str()),
            row.get("peer_label").and_then(|v| v.as_str()),
            row["filename"].as_str().unwrap_or("file"),
            row["size_bytes"].as_i64().unwrap_or(0),
            row["status"].as_str().unwrap_or("queued"),
            row.get("error").and_then(|v| v.as_str()),
            row["bytes_done"].as_i64().unwrap_or(0),
            if row["verified"].as_bool().unwrap_or(false) { 1 } else { 0 },
            row["started_at"].as_str().unwrap_or(&now),
            now,
            row.get("finished_at").and_then(|v| v.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_transfers(conn: &Connection, limit: i64) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, direction, file_id, conversation_id, peer_label, filename, size_bytes, status, error, bytes_done, verified, started_at, updated_at, finished_at FROM transfer_log ORDER BY updated_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "direction": r.get::<_, String>(1)?,
                "file_id": r.get::<_, Option<String>>(2)?,
                "conversation_id": r.get::<_, Option<String>>(3)?,
                "peer_label": r.get::<_, Option<String>>(4)?,
                "filename": r.get::<_, String>(5)?,
                "size_bytes": r.get::<_, i64>(6)?,
                "status": r.get::<_, String>(7)?,
                "error": r.get::<_, Option<String>>(8)?,
                "bytes_done": r.get::<_, i64>(9)?,
                "verified": r.get::<_, i64>(10)? == 1,
                "started_at": r.get::<_, String>(11)?,
                "updated_at": r.get::<_, String>(12)?,
                "finished_at": r.get::<_, Option<String>>(13)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn delete_transfer(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM transfer_log WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_transfer_history(conn: &Connection) -> Result<u64, String> {
    let n = conn
        .execute(
            "DELETE FROM transfer_log WHERE status NOT IN ('queued','transferring','verifying')",
            [],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u64)
}

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

pub fn latest_outbox_error(conn: &Connection, recipient_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT last_error, attempts, created_at FROM outbox WHERE recipient_id=?1 AND delivered_at IS NULL AND last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1",
        params![recipient_id],
        |r| {
            Ok(serde_json::json!({
                "last_error": r.get::<_, Option<String>>(0)?,
                "attempts": r.get::<_, i64>(1)?,
                "created_at": r.get::<_, String>(2)?,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
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
