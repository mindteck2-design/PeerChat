use rusqlite::Connection;
use std::path::Path;

mod profile;
mod peers;
mod conversations;
mod messages;
mod files;
mod outbox;
mod members;
mod transfers;
mod settings;
mod saved;
mod calendar;

pub use profile::*;
pub use peers::*;
pub use conversations::*;
pub use messages::*;
pub use files::*;
pub use outbox::*;
pub use members::*;
pub use transfers::*;
pub use settings::*;
pub use saved::*;
pub use calendar::*;

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

    // Multi-attachment album messages (text + images/files in one bubble).
    let _ = conn.execute("ALTER TABLE messages ADD COLUMN attachments TEXT", []);

    if version < 11 {
        // Backfill single-file rows so clients always see an attachments array when file_id is set.
        let _ = conn.execute_batch(
            r#"
            UPDATE messages
               SET attachments = json_array(file_id)
             WHERE file_id IS NOT NULL
               AND file_id != ''
               AND (attachments IS NULL OR attachments = '' OR attachments = '[]');
            "#,
        );
        conn.pragma_update(None, "user_version", 11)
            .map_err(|e| e.to_string())?;
    }

    if version < 12 {
        conn.execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_messages_conv_sort
              ON messages(conversation_id, sort_at, created_at, id);
            CREATE INDEX IF NOT EXISTS idx_outbox_recipient_pending
              ON outbox(recipient_id, next_retry_at, created_at) WHERE delivered_at IS NULL;
            CREATE INDEX IF NOT EXISTS idx_messages_conv_sender_kind
              ON messages(conversation_id, sender_id, kind);
            "#,
        )
        .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 12)
            .map_err(|e| e.to_string())?;
    }

    if version < 13 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS calendar_items (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL CHECK (kind IN ('note','reminder','meeting','todo')),
                day TEXT NOT NULL,
                time TEXT,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                shared INTEGER NOT NULL DEFAULT 0,
                participant_ids TEXT NOT NULL DEFAULT '[]',
                notified_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_calendar_items_day
              ON calendar_items(day, time);
            "#,
        )
        .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 13)
            .map_err(|e| e.to_string())?;
    }

    if version < 14 {
        conn.execute_batch(
            r#"
            ALTER TABLE calendar_items ADD COLUMN checklist_json TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE calendar_items ADD COLUMN acks_json TEXT NOT NULL DEFAULT '{}';
            "#,
        )
        .map_err(|e| e.to_string())?;
        conn.pragma_update(None, "user_version", 14)
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}


