use crate::db;
use crate::runtime::group_events::enqueue_group_event;
use crate::tls_cert::{self, LocalCert};
use crate::util::from_peer_json;
use base64::Engine;
use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension};
use rustls::pki_types::ServerName;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// Suppress duplicate OS toasts for the same logical inbox event (outbox retries).
static RECENT_TOASTS: LazyLock<Mutex<HashMap<String, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const TOAST_DEDUPE_SECS: u64 = 10;

/// Soft-cancel flags for in-flight `/v1/file/stream` downloads (pause/stop).
static STREAM_CANCEL: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Outgoing native staging: stop / pause between chunks.
static STAGE_CANCEL: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static STAGE_PAUSE: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn register_stream_cancel(file_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    STREAM_CANCEL.lock().insert(file_id.to_string(), flag.clone());
    flag
}

pub fn request_stream_cancel(file_id: &str) {
    if let Some(flag) = STREAM_CANCEL.lock().get(file_id) {
        flag.store(true, Ordering::SeqCst);
    }
}

pub fn clear_stream_cancel(file_id: &str) {
    STREAM_CANCEL.lock().remove(file_id);
}

pub fn register_stage_controls(file_id: &str) -> (Arc<AtomicBool>, Arc<AtomicBool>) {
    let cancel = Arc::new(AtomicBool::new(false));
    let pause = Arc::new(AtomicBool::new(false));
    STAGE_CANCEL
        .lock()
        .insert(file_id.to_string(), cancel.clone());
    STAGE_PAUSE.lock().insert(file_id.to_string(), pause.clone());
    (cancel, pause)
}

pub fn request_stage_cancel(file_id: &str) {
    if let Some(flag) = STAGE_CANCEL.lock().get(file_id) {
        flag.store(true, Ordering::SeqCst);
    }
    // Wake a paused stage so it can observe cancel.
    if let Some(flag) = STAGE_PAUSE.lock().get(file_id) {
        flag.store(false, Ordering::SeqCst);
    }
}

pub fn request_stage_pause(file_id: &str) {
    if let Some(flag) = STAGE_PAUSE.lock().get(file_id) {
        flag.store(true, Ordering::SeqCst);
    }
}

pub fn clear_stage_pause(file_id: &str) {
    if let Some(flag) = STAGE_PAUSE.lock().get(file_id) {
        flag.store(false, Ordering::SeqCst);
    }
}

pub fn clear_stage_controls(file_id: &str) {
    STAGE_CANCEL.lock().remove(file_id);
    STAGE_PAUSE.lock().remove(file_id);
}
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_rustls::TlsConnector;

pub type SharedDb = Arc<Mutex<Connection>>;

/// Pick a free TCP listen port: prefer `preferred`, then 9877..9899, then ephemeral.
pub fn allocate_listen_port(preferred: u16) -> Result<u16, String> {
    let start = if preferred == 0 { 9876 } else { preferred };
    for p in start..=9899u16 {
        if std::net::TcpListener::bind(("0.0.0.0", p)).is_ok() {
            return Ok(p);
        }
    }
    for p in 9876..start {
        if std::net::TcpListener::bind(("0.0.0.0", p)).is_ok() {
            return Ok(p);
        }
    }
    let l = std::net::TcpListener::bind(("0.0.0.0", 0)).map_err(|e| e.to_string())?;
    let port = l.local_addr().map_err(|e| e.to_string())?.port();
    drop(l);
    Ok(port)
}

pub fn spawn_listener(
    cert: LocalCert,
    port: u16,
    db: SharedDb,
    my_id: String,
    app: AppHandle,
) -> Result<(), String> {
    // Confirm bind before spawning accept loop so setup can fail loudly.
    {
        let probe = std::net::TcpListener::bind(("0.0.0.0", port))
            .map_err(|e| format!("cannot bind TCP port {port}: {e}"))?;
        drop(probe);
    }
    let cfg = Arc::new(tls_cert::rustls_server_config(&cert)?);
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(l) => l,
            Err(e) => {
                // Log to stderr so it lands in peerchat.log via the OS stream.
                let ts = chrono::Utc::now().to_rfc3339();
                let _ = std::io::Write::write_fmt(
                    &mut std::io::stderr(),
                    format_args!("[{ts}] [ERROR] PeerChat TLS listener bind failed on port {port}: {e}\n"),
                );
                return;
            }
        };
        let acceptor = tokio_rustls::TlsAcceptor::from(cfg);
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                continue;
            };
            let acceptor = acceptor.clone();
            let db = db.clone();
            let my_id = my_id.clone();
            let app = app.clone();
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(tcp).await else {
                    return;
                };
                // Keep-alive: many file-chunk fetches share one TLS session (huge speedup).
                let mut pending = Vec::new();
                // Heap buffer — large stack arrays in async tasks blow the Windows thread stack (0xc00000fd).
                let mut tmp = vec![0u8; 64 * 1024];
                const MAX_REQ: usize = 16 * 1024 * 1024;
                loop {
                    let req_bytes = match read_one_http_request(&mut tls, &mut pending, &mut tmp, MAX_REQ).await
                    {
                        Ok(Some(r)) => r,
                        Ok(None) => break,
                        Err(_) => break,
                    };
                    let req = String::from_utf8_lossy(&req_bytes);
                    match handle_http(&req, &db, &my_id, &app) {
                        HttpAction::Json { response, notify } => {
                            if tls.write_all(response.as_bytes()).await.is_err() {
                                break;
                            }
                            if let Some(info) = notify {
                                desktop_notify_if_needed(&app, &db, &info);
                                let _ = app.emit("inbox-updated", info);
                            }
                        }
                        HttpAction::FileStream {
                            staging,
                            from_index,
                            chunk_count,
                        } => {
                            // One-shot binary stream — closes after (IPMsg-style bulk transfer).
                            if stream_file_chunks(&mut tls, &staging, from_index, chunk_count)
                                .await
                                .is_err()
                            {
                                break;
                            }
                            break;
                        }
                    }
                }
            });
        }
    });
    Ok(())
}

/// OS toast from Rust so notifications still fire when the window is hidden in the tray
/// (WebView2 may suspend JS listeners while not visible).
fn desktop_notify_if_needed(app: &AppHandle, db: &SharedDb, info: &Value) {
    // Skip redelivered / already-known messages (duplicate OS toasts).
    if info.get("fresh").and_then(|v| v.as_bool()) == Some(false) {
        return;
    }
    let kind = info.get("kind").and_then(|v| v.as_str()).unwrap_or("text");
    if matches!(
        kind,
        "reaction" | "pin" | "unpin" | "deleted" | "game_move" | "group_event" | "system"
    ) {
        return;
    }
    let from_id = info.get("from_id").and_then(|v| v.as_str()).unwrap_or("");
    let message_id = info.get("message_id").and_then(|v| v.as_str()).unwrap_or("");
    let cid_early = info
        .get("conversation_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let dedupe_key = if !message_id.is_empty() {
        format!("{cid_early}:{message_id}")
    } else {
        format!("{cid_early}:{from_id}:{kind}")
    };
    {
        let mut recent = RECENT_TOASTS.lock();
        let now = Instant::now();
        recent.retain(|_, at| now.duration_since(*at) < Duration::from_secs(TOAST_DEDUPE_SECS));
        if recent.contains_key(&dedupe_key) {
            return;
        }
        recent.insert(dedupe_key, now);
    }
    let my_id = {
        let conn = db.lock();
        db::get_profile(&conn)
            .ok()
            .flatten()
            .and_then(|p| p.get("id")?.as_str().map(|s| s.to_string()))
            .unwrap_or_default()
    };
    if !from_id.is_empty() && !my_id.is_empty() && from_id == my_id {
        return;
    }
    if !from_id.is_empty() {
        let blocked = {
            let conn = db.lock();
            db::peer_blocked(&conn, from_id).unwrap_or(false)
        };
        if blocked {
            return;
        }
    }
    let enabled = {
        let conn = db.lock();
        db::get_setting(&conn, "notifications_enabled")
            .ok()
            .flatten()
            .map(|v| v != "0")
            .unwrap_or(true)
    };
    if !enabled {
        return;
    }
    let cid = info
        .get("conversation_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !cid.is_empty() {
        let muted = {
            let conn = db.lock();
            db::conversation_muted(&conn, cid).unwrap_or(false)
        };
        if muted {
            return;
        }
    }
    let win = app.get_webview_window("main");
    let visible = win
        .as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    let focused = win
        .as_ref()
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    // App is open and focused — no OS toasts (any conversation).
    if visible && focused {
        return;
    }
    let title = info
        .get("from_name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("PeerChat");
    let body = match kind {
        "file_notice" => "Sent a file",
        "system" | "group_event" => "Group update",
        "calendar_share" => "Shared a calendar item",
        _ => "New message",
    };
    let mut builder = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .auto_cancel();
    if !cid.is_empty() {
        builder = builder.extra("conversation_id", cid);
    }
    let _ = builder.show();
}

enum HttpAction {
    Json {
        response: String,
        notify: Option<Value>,
    },
    FileStream {
        staging: std::path::PathBuf,
        from_index: u32,
        chunk_count: u32,
    },
}

fn http_ok(response: String, notify: Option<Value>) -> HttpAction {
    HttpAction::Json { response, notify }
}

/// Returns JSON response or a binary file-stream handoff.
fn handle_http(req: &str, db: &SharedDb, my_id: &str, app: &AppHandle) -> HttpAction {
    let mut lines = req.split("\r\n");
    let first = lines.next().unwrap_or("");
    let parts: Vec<&str> = first.split_whitespace().collect();
    if parts.len() < 2 {
        return http_ok(http_json(400, json!({"error":"bad request"})), None);
    }
    let method = parts[0];
    let path = parts[1];
    let body = req.split("\r\n\r\n").nth(1).unwrap_or("");

    match (method, path) {
        ("GET", "/v1/hello") => {
            let conn = db.lock();
            let profile = db::get_profile(&conn).ok().flatten();
            http_ok(
                http_json(
                    200,
                    json!({
                        "ok": true,
                        "user_id": my_id,
                        "profile": profile,
                    }),
                ),
                None,
            )
        }
        ("POST", "/v1/deliver") => {
            const MAX_DELIVER_BODY: usize = 2 * 1024 * 1024;
            if body.len() > MAX_DELIVER_BODY {
                return http_ok(http_json(400, json!({"error":"frame too large"})), None);
            }
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_ok(http_json(400, json!({"error":"bad json"})), None);
            };
            if let Some(ct) = payload
                .pointer("/message/ciphertext")
                .and_then(|v| v.as_str())
            {
                if ct.len() > MAX_DELIVER_BODY {
                    return http_ok(http_json(400, json!({"error":"ciphertext too large"})), None);
                }
            }
            let has_inbox = payload.get("message").is_some()
                || payload.get("file").is_some()
                || payload.get("files").is_some()
                || payload.get("group_event").is_some()
                || payload.get("calendar_share").is_some();
            let mut fresh_message = false;
            // Emit after COMMIT so UI/IPC readers see committed wraps/membership.
            let mut pending_group_key_updated: Option<Value> = None;
            let mut pending_group_sync_request: Option<Value> = None;
            let conn = db.lock();
            if conn.execute_batch("BEGIN IMMEDIATE").is_err() {
                return http_ok(http_json(500, json!({"error":"db busy"})), None);
            }
            let deliver_sender_id = payload
                .pointer("/from_peer/user_id")
                .and_then(|v| v.as_str())
                .or_else(|| payload.pointer("/message/sender_id").and_then(|v| v.as_str()))
                .unwrap_or("")
                .trim();
            if let Some(msg) = payload.get("message") {
                let msg_conv = msg
                    .get("conversation_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let sender_id = msg.get("sender_id").and_then(|v| v.as_str()).unwrap_or("");
                let is_group = payload.get("wrapped_group_key").is_some()
                    || payload.get("group_event").is_some()
                    || msg_conv.starts_with("group:")
                    || conn
                        .query_row(
                            "SELECT kind FROM conversations WHERE id=?1",
                            rusqlite::params![msg_conv],
                            |r| r.get::<_, String>(0),
                        )
                        .optional()
                        .ok()
                        .flatten()
                        .as_deref()
                        == Some("group");
                // Local block: drop DM traffic from blocked peers (ack OK so they stop retrying).
                if !is_group
                    && !sender_id.is_empty()
                    && db::peer_blocked(&conn, sender_id).unwrap_or(false)
                {
                    let _ = conn.execute_batch("ROLLBACK");
                    return http_ok(http_json(200, json!({"ok": true, "blocked": true})), None);
                }
                if !is_group && !msg_conv.is_empty() && !sender_id.is_empty() {
                    if let Err(e) =
                        db::reconcile_dm_on_deliver(&conn, &my_id, sender_id, msg_conv)
                    {
                        let _ = conn.execute_batch("ROLLBACK");
                        return http_ok(http_json(500, json!({"error": e})), None);
                    }
                }
                // Local receive time for ordering — ignore sender wall-clock skew.
                let mut inbound = msg.clone();
                inbound["sort_at"] = json!(chrono::Utc::now().to_rfc3339());
                let is_edit = payload.get("edit").and_then(|v| v.as_bool()).unwrap_or(false);
                let insert_result: Result<bool, String> = if payload
                    .get("delete_for_everyone")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    if let Some(mid) = inbound.get("id").and_then(|v| v.as_str()) {
                        let can_delete = if let Ok(Some(orig)) = conn
                            .query_row(
                                "SELECT sender_id, conversation_id FROM messages WHERE id=?1",
                                rusqlite::params![mid],
                                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                            )
                            .optional()
                        {
                            let (orig_sender, cid) = orig;
                            orig_sender == sender_id
                                || (!sender_id.is_empty()
                                    && db::is_group_admin(&conn, &cid, sender_id).unwrap_or(false))
                        } else {
                            true
                        };
                        if can_delete {
                            let _ = db::tombstone_message(&conn, mid);
                            let r = db::insert_message(&conn, &inbound);
                            let _ = db::tombstone_message(&conn, mid);
                            r
                        } else {
                            Ok(false)
                        }
                    } else {
                        Ok(false)
                    }
                } else if inbound.get("kind").and_then(|v| v.as_str()) == Some("deleted") {
                    if let Some(mid) = inbound.get("id").and_then(|v| v.as_str()) {
                        let can_delete = if let Ok(Some(orig)) = conn
                            .query_row(
                                "SELECT sender_id, conversation_id FROM messages WHERE id=?1",
                                rusqlite::params![mid],
                                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                            )
                            .optional()
                        {
                            let (orig_sender, cid) = orig;
                            orig_sender == sender_id
                                || (!sender_id.is_empty()
                                    && db::is_group_admin(&conn, &cid, sender_id).unwrap_or(false))
                        } else {
                            true
                        };
                        if can_delete {
                            let r = db::insert_message(&conn, &inbound);
                            let _ = db::tombstone_message(&conn, mid);
                            r
                        } else {
                            Ok(false)
                        }
                    } else {
                        Ok(false)
                    }
                } else if is_edit {
                    if inbound
                        .get("edited_at")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .is_empty()
                    {
                        inbound["edited_at"] = json!(chrono::Utc::now().to_rfc3339());
                    }
                    db::apply_message_edit(&conn, &inbound).map(|_| false)
                } else {
                    db::insert_message(&conn, &inbound)
                };
                match insert_result {
                    Ok(is_new) => fresh_message = is_new,
                    Err(e) => {
                        let _ = conn.execute_batch("ROLLBACK");
                        return http_ok(http_json(500, json!({"error": e})), None);
                    }
                }
            }
            // Prefer multi-file album payload; fall back to legacy single `file`.
            let inbound_files: Vec<&Value> = payload
                .get("files")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().collect())
                .unwrap_or_else(|| {
                    payload
                        .get("file")
                        .map(|f| vec![f])
                        .unwrap_or_default()
                });
            for file in inbound_files {
                let file_cid = file
                    .get("conversation_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let uploader = file
                    .get("uploader_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let file_is_group = file_cid.starts_with("group:")
                    || conn
                        .query_row(
                            "SELECT kind FROM conversations WHERE id=?1",
                            rusqlite::params![file_cid],
                            |r| r.get::<_, String>(0),
                        )
                        .optional()
                        .ok()
                        .flatten()
                        .as_deref()
                        == Some("group");
                if !file_is_group
                    && !uploader.is_empty()
                    && db::peer_blocked(&conn, uploader).unwrap_or(false)
                {
                    let _ = conn.execute_batch("ROLLBACK");
                    return http_ok(http_json(200, json!({"ok": true, "blocked": true})), None);
                }
                let _ = db::insert_file(&conn, file);
                // Ensure downloader is a member so later chunk auth succeeds on the uploader.
                if let (Some(cid), Some(uid)) = (
                    file.get("conversation_id").and_then(|v| v.as_str()),
                    file.get("uploader_id").and_then(|v| v.as_str()),
                ) {
                    let _ = db::upsert_member(&conn, cid, my_id, None, None);
                    let _ = db::upsert_member(&conn, cid, uid, None, None);
                }
            }
            if let (Some(reader), Some(ids)) = (
                payload.get("reader_id").and_then(|v| v.as_str()),
                payload.get("read_receipts").and_then(|v| v.as_array()),
            ) {
                for id in ids {
                    if let Some(message_id) = id.as_str() {
                        let _ = db::mark_message_read(&conn, message_id, reader);
                    }
                }
            }
            if let Some(peer) = payload.get("from_peer") {
                let uid = peer["user_id"].as_str().unwrap_or("").to_string();
                let dn = peer["display_name"]
                    .as_str()
                    .unwrap_or("peer")
                    .to_string();
                let x = peer["x25519_public"].as_str().unwrap_or("").to_string();
                let e = peer["ed25519_public"].as_str().unwrap_or("").to_string();
                let fp = peer
                    .get("tls_fingerprint")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                // Archive previous keys before overwriting, then refresh reachability.
                if let Ok(Some(existing)) = db::get_peer(&conn, &uid) {
                    let same_fp = existing["tls_fingerprint"].as_str() == fp.as_deref()
                        || fp.as_ref().map(|s| s.is_empty()).unwrap_or(true);
                    let same_x = existing["x25519_public"].as_str() == Some(x.as_str());
                    let same_e = existing["ed25519_public"].as_str() == Some(e.as_str());
                    if !(same_fp && same_x && same_e) {
                        let _ = db::adopt_peer_identity(
                            &conn,
                            &uid,
                            fp.as_deref().unwrap_or(""),
                            &x,
                            &e,
                        );
                    }
                }
                let _ = db::upsert_peer(
                    &conn,
                    &uid,
                    &dn,
                    &x,
                    &e,
                    peer.get("last_ip").and_then(|v| v.as_str()),
                    peer.get("last_port").and_then(|v| v.as_i64()),
                    fp.as_deref(),
                    true,
                );
                let _ = db::clear_peer_outbox_backoff(&conn, &uid);
                if payload
                    .get("profile_update")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                    || !dn.is_empty()
                {
                    let _ = db::update_peer_display_name_everywhere(&conn, &uid, &dn);
                }
            }
            // Group membership and key synchronization:
            // Check if this payload is related to a group (via wrapped_group_key, group_event, conversation_id, or message kind)
            let group_cid = payload
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .or_else(|| payload.pointer("/message/conversation_id").and_then(|v| v.as_str()))
                .or_else(|| payload.pointer("/group_event/conversation_id").and_then(|v| v.as_str()))
                .unwrap_or("");

            let is_group_payload = !group_cid.is_empty() && (
                payload.get("wrapped_group_key").is_some()
                || payload.get("group_event").is_some()
                || group_cid.starts_with("group:")
                || conn
                    .query_row(
                        "SELECT kind FROM conversations WHERE id=?1",
                        rusqlite::params![group_cid],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()
                    .ok()
                    .flatten()
                    .as_deref()
                    == Some("group")
            );

            if is_group_payload && !group_cid.is_empty() {
                let title = payload
                    .get("group_title")
                    .and_then(|v| v.as_str())
                    .or_else(|| payload.pointer("/group_event/title").and_then(|v| v.as_str()))
                    .unwrap_or("Group");

                // Ensure group conversation exists
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO conversations(id, kind, title, created_at) VALUES (?1,'group',?2,?3)",
                    rusqlite::params![group_cid, title, chrono::Utc::now().to_rfc3339()],
                );
                if title != "Group" {
                    let _ = db::set_conversation_title(&conn, group_cid, title);
                }

                // Ingest full members roster if attached to message or event
                let inbound_members = payload
                    .get("members")
                    .or_else(|| payload.pointer("/group_event/members"))
                    .and_then(|v| v.as_array());
                if let Some(arr) = inbound_members {
                    let mut upserted_count = 0;
                    for m in arr {
                        let uid = m.get("user_id").and_then(|v| v.as_str()).unwrap_or("");
                        if uid.is_empty() {
                            continue;
                        }
                        let name = m.get("display_name").and_then(|v| v.as_str());
                        let _ = db::upsert_member(&conn, group_cid, uid, None, name);
                        if let Some(role) = m.get("role").and_then(|v| v.as_str()) {
                            let _ = db::set_member_role(&conn, group_cid, uid, role);
                        }
                        upserted_count += 1;
                    }
                    println!("[GroupSync:deliver:roster] group_id={} ingested {} members from payload", group_cid, upserted_count);
                }

                // Ingest sender identity as a member of this group
                if !deliver_sender_id.is_empty() {
                    let sender_name = payload.pointer("/from_peer/display_name").and_then(|v| v.as_str());
                    let _ = db::upsert_member(&conn, group_cid, deliver_sender_id, None, sender_name);
                }

                // Ingest my_id as a member of this group
                if !my_id.is_empty() {
                    let _ = db::upsert_member(&conn, group_cid, my_id, None, None);
                }

                // Update my wrapped_group_key if provided
                let inbound_wrap = payload
                    .get("wrapped_group_key")
                    .or_else(|| payload.pointer("/group_event/wrapped_group_key"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty());
                if let Some(wrap) = inbound_wrap {
                    let _ = db::upsert_member(&conn, group_cid, my_id, Some(wrap), None);
                    println!(
                        "[GroupSync:deliver:wrap] updated wrapped_group_key for my_id={} in group_id={} wrap_len={}",
                        my_id,
                        group_cid,
                        wrap.len()
                    );
                    pending_group_key_updated = Some(json!({
                        "conversation_id": group_cid,
                        "member_id": my_id,
                        "source": "deliver",
                    }));
                }
            }

            if let Some(ev) = payload.get("group_event") {
                let cid = payload
                    .get("conversation_id")
                    .and_then(|v| v.as_str())
                    .or_else(|| ev.get("conversation_id").and_then(|v| v.as_str()))
                    .unwrap_or(group_cid);
                let op = ev.get("op").and_then(|v| v.as_str()).unwrap_or("");
                let is_admin = !deliver_sender_id.is_empty()
                    && db::is_group_admin(&conn, cid, deliver_sender_id).unwrap_or(false);
                if !cid.is_empty() && (op == "sync" || op == "add") {
                    if let Some(mca) = ev
                        .get("members_can_add")
                        .and_then(|v| v.as_bool())
                        .or_else(|| payload.get("members_can_add").and_then(|v| v.as_bool()))
                    {
                        let _ = db::set_members_can_add(&conn, cid, mca);
                    }
                }
                if op == "request_sync" && !cid.is_empty() && !deliver_sender_id.is_empty() {
                    let title = db::conversation_title(&conn, cid)
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "Group".to_string());
                    let roster = Value::Array(db::list_members(&conn, cid).unwrap_or_default());
                    let wrap = db::get_wrapped_group_key(&conn, cid, deliver_sender_id).ok().flatten();
                    let profile_opt = db::get_profile(&conn).ok().flatten();
                    if let Some(profile) = profile_opt {
                        let state = app.state::<crate::state::AppState>();
                        let fingerprint = state.fingerprint.lock().clone();
                        let from_peer = from_peer_json(&profile, &fingerprint);
                        println!(
                            "[GroupSync:handle_request_sync] received request_sync from sender={} group_id={} has_wrap={}",
                            deliver_sender_id,
                            cid,
                            wrap.is_some()
                        );
                        if wrap.is_some() {
                            let _ = enqueue_group_event(
                                &conn,
                                &from_peer,
                                cid,
                                deliver_sender_id,
                                &title,
                                wrap,
                                &roster,
                                "sync",
                                None,
                            );
                        } else {
                            // No stored wrap for requester — ask local UI to re-wrap from plaintext key.
                            println!(
                                "[GroupSync:handle_request_sync:needs_repair] group_id={} requester={} — emitting group-sync-request",
                                cid, deliver_sender_id
                            );
                            pending_group_sync_request = Some(json!({
                                "conversation_id": cid,
                                "requester_id": deliver_sender_id,
                                "requester_name": payload
                                    .pointer("/from_peer/display_name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(""),
                            }));
                        }
                    }
                }
                if op == "rename" && !cid.is_empty() {
                    let title = payload
                        .get("group_title")
                        .and_then(|v| v.as_str())
                        .or_else(|| ev.get("title").and_then(|v| v.as_str()))
                        .unwrap_or("Group");
                    let _ = db::set_conversation_title(&conn, cid, title);
                }
                if op == "delete" && !cid.is_empty() && is_admin {
                    let _ = db::delete_conversation_local(&conn, cid);
                }
                if op == "remove" && !cid.is_empty() {
                    let uid = ev.get("user_id").and_then(|v| v.as_str()).unwrap_or("");
                    if !uid.is_empty() && (is_admin || uid == deliver_sender_id) {
                        let _ = db::delete_member(&conn, cid, uid);
                    }
                }
                if op == "role" && !cid.is_empty() && is_admin {
                    let uid = ev.get("user_id").and_then(|v| v.as_str()).unwrap_or("");
                    let role = ev.get("role").and_then(|v| v.as_str()).unwrap_or("member");
                    if !uid.is_empty() {
                        let _ = db::set_member_role(&conn, cid, uid, role);
                    }
                }
                if op == "settings" && !cid.is_empty() && is_admin {
                    if let Some(mca) = ev.get("members_can_add").and_then(|v| v.as_bool()) {
                        let _ = db::set_members_can_add(&conn, cid, mca);
                    }
                }
            }
            if let Some(share) = payload.get("calendar_share") {
                let op = share.get("op").and_then(|v| v.as_str()).unwrap_or("upsert");
                if op == "checklist_toggle" {
                    let item_id = share.get("item_id").and_then(|v| v.as_str()).unwrap_or("");
                    let option_id = share.get("option_id").and_then(|v| v.as_str()).unwrap_or("");
                    let user_id = if !deliver_sender_id.is_empty() {
                        deliver_sender_id
                    } else {
                        share.get("user_id").and_then(|v| v.as_str()).unwrap_or("")
                    };
                    let checked = share.get("checked").and_then(|v| v.as_bool()).unwrap_or(false);
                    let updated_at = share
                        .get("updated_at")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if !item_id.is_empty() && !option_id.is_empty() && !user_id.is_empty() {
                        let _ = db::apply_checklist_toggle(
                            &conn, item_id, option_id, user_id, checked, updated_at,
                        );
                    }
                } else if op == "ack" {
                    let item_id = share.get("item_id").and_then(|v| v.as_str()).unwrap_or("");
                    let user_id = if !deliver_sender_id.is_empty() {
                        deliver_sender_id
                    } else {
                        share.get("user_id").and_then(|v| v.as_str()).unwrap_or("")
                    };
                    let at = share.get("at").and_then(|v| v.as_str()).unwrap_or("");
                    if !item_id.is_empty() && !user_id.is_empty() {
                        let _ = db::apply_calendar_ack(&conn, item_id, user_id, at);
                    }
                } else if let Some(item) = share.get("item") {
                    if op == "delete" {
                        if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                            let mut allowed = true;
                            if let Ok(Some(existing)) = db::get_calendar_item(&conn, id) {
                                let owner = existing["created_by"].as_str().unwrap_or("");
                                if !deliver_sender_id.is_empty() && !owner.is_empty() && owner != deliver_sender_id {
                                    allowed = false;
                                }
                            }
                            if allowed {
                                let _ = db::delete_calendar_item(&conn, id);
                            }
                        }
                    } else {
                        let mut row = item.clone();
                        let item_id = row.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let mut allowed = true;
                        if !item_id.is_empty() {
                            if let Ok(Some(existing)) = db::get_calendar_item(&conn, item_id) {
                                let owner = existing["created_by"].as_str().unwrap_or("");
                                if !deliver_sender_id.is_empty() && !owner.is_empty() && owner != deliver_sender_id {
                                    allowed = false;
                                }
                            }
                        }
                        if allowed {
                            let mut parts: Vec<String> = row
                                .get("participant_ids")
                                .and_then(|v| v.as_array())
                                .map(|a| {
                                    a.iter()
                                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                                        .collect()
                                })
                                .unwrap_or_default();
                            if !my_id.is_empty() && !parts.iter().any(|p| p == my_id) {
                                parts.push(my_id.to_string());
                            }
                            row["participant_ids"] = json!(parts);
                            row["shared"] = json!(true);
                            let _ = db::upsert_calendar_item(&conn, &row);
                        }
                    }
                }
            }
            if conn.execute_batch("COMMIT").is_err() {
                let _ = conn.execute_batch("ROLLBACK");
                return http_ok(http_json(500, json!({"error":"commit failed"})), None);
            }
            if let Some(ev) = pending_group_key_updated {
                let _ = app.emit("group-key-updated", ev);
            }
            if let Some(ev) = pending_group_sync_request {
                let _ = app.emit("group-sync-request", ev);
            }
            // Toast only for newly inserted messages (redelivery must not double-notify).
            // Still emit inbox-updated for UI refresh whenever anything arrived.
            let notify = if has_inbox {
                let from = payload.get("from_peer");
                let msg = payload.get("message");
                let kind = msg
                    .and_then(|m| m.get("kind"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(if payload.get("file").is_some() {
                        "file_notice"
                    } else if payload.get("group_event").is_some() {
                        "group_event"
                    } else if payload.get("calendar_share").is_some() {
                        "calendar_share"
                    } else {
                        "text"
                    });
                let cid = msg
                    .and_then(|m| m.get("conversation_id"))
                    .and_then(|v| v.as_str())
                    .or_else(|| payload.get("conversation_id").and_then(|v| v.as_str()))
                    .unwrap_or("");
                let message_id = msg
                    .and_then(|m| m.get("id"))
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        payload
                            .pointer("/calendar_share/item/id")
                            .and_then(|v| v.as_str())
                    })
                    .or_else(|| {
                        payload
                            .pointer("/calendar_share/item_id")
                            .and_then(|v| v.as_str())
                    })
                    .unwrap_or("");
                // Item sync (calendar_share payload, no chat message) stays silent —
                // the DM calendar_share card carries the user-facing toast.
                // Checklist/ack also silent. Chat messages use normal fresh_message.
                let fresh = if payload.get("calendar_share").is_some() && msg.is_none() {
                    false
                } else {
                    fresh_message
                };
                Some(json!({
                    "conversation_id": cid,
                    "from_name": from.and_then(|p| p.get("display_name")).and_then(|v| v.as_str()).unwrap_or("Peer"),
                    "from_id": from.and_then(|p| p.get("user_id")).and_then(|v| v.as_str()).unwrap_or(""),
                    "kind": kind,
                    "message_id": message_id,
                    "fresh": fresh,
                }))
            } else {
                None
            };
            let sender_to_flush = if !deliver_sender_id.is_empty() {
                Some(deliver_sender_id.to_string())
            } else {
                payload.get("from_peer").and_then(|p| p.get("user_id")).and_then(|v| v.as_str()).map(|s| s.to_string())
            };
            if let Some(_uid) = sender_to_flush {
                let db_clone = db.clone();
                tauri::async_runtime::spawn(async move {
                    crate::runtime::outbox::flush_outbox(&db_clone).await;
                });
            }
            http_ok(http_json(200, json!({"ok": true})), notify)
        }
        ("POST", "/v1/typing") => {
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_ok(http_json(400, json!({"error":"bad json"})), None);
            };
            let from = payload
                .get("user_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let cid = payload
                .get("conversation_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let blocked = {
                let conn = db.lock();
                let is_dm = cid.starts_with("dm:")
                    || conn
                        .query_row(
                            "SELECT kind FROM conversations WHERE id=?1",
                            rusqlite::params![cid],
                            |r| r.get::<_, String>(0),
                        )
                        .optional()
                        .ok()
                        .flatten()
                        .as_deref()
                        == Some("dm");
                is_dm
                    && !from.is_empty()
                    && db::peer_blocked(&conn, from).unwrap_or(false)
            };
            if !blocked {
                let _ = app.emit("peer-typing", payload);
            }
            http_ok(http_json(200, json!({"ok": true})), None)
        }
        ("POST", "/v1/file/stream") => {
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_ok(http_json(400, json!({"error":"bad json"})), None);
            };
            let file_id = payload["file_id"].as_str().unwrap_or("");
            let from_index = payload["from_index"].as_u64().unwrap_or(0) as u32;
            let conn = db.lock();
            let Some(meta) = db::get_file(&conn, file_id).ok().flatten() else {
                return http_ok(http_json(404, json!({"error":"missing file"})), None);
            };
            let cid = meta["conversation_id"].as_str().unwrap_or("");
            let uploader = meta["uploader_id"].as_str().unwrap_or("");
            let key_for_me = meta
                .get("wrapped_keys")
                .and_then(|v| v.as_object())
                .map(|o| o.contains_key(my_id))
                .unwrap_or(false);
            let allowed = uploader == my_id
                || key_for_me
                || db::is_conversation_member(&conn, cid, my_id).unwrap_or(false);
            if !allowed {
                return http_ok(http_json(403, json!({"error":"forbidden"})), None);
            }
            let staging = meta["staging_dir"].as_str().unwrap_or("");
            if staging.is_empty() || staging.contains("..") {
                return http_ok(http_json(404, json!({"error":"missing staging"})), None);
            }
            let chunk_count = meta["chunk_count"].as_i64().unwrap_or(0).max(0) as u32;
            HttpAction::FileStream {
                staging: std::path::PathBuf::from(staging),
                from_index,
                chunk_count,
            }
        }
        ("POST", "/v1/file/chunk") => {
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_ok(http_json(400, json!({"error":"bad json"})), None);
            };
            let file_id = payload["file_id"].as_str().unwrap_or("");
            let index = payload["index"].as_u64().unwrap_or(0) as usize;
            let conn = db.lock();
            let Some(meta) = db::get_file(&conn, file_id).ok().flatten() else {
                return http_ok(http_json(404, json!({"error":"missing file"})), None);
            };
            let cid = meta["conversation_id"].as_str().unwrap_or("");
            let uploader = meta["uploader_id"].as_str().unwrap_or("");
            // Members, intended key recipients, or the uploader may fetch chunks.
            let key_for_me = meta
                .get("wrapped_keys")
                .and_then(|v| v.as_object())
                .map(|o| o.contains_key(my_id))
                .unwrap_or(false);
            let allowed = uploader == my_id
                || key_for_me
                || db::is_conversation_member(&conn, cid, my_id).unwrap_or(false);
            if !allowed {
                return http_ok(http_json(403, json!({"error":"forbidden"})), None);
            }
            let staging = meta["staging_dir"].as_str().unwrap_or("");
            if staging.is_empty() || staging.contains("..") {
                return http_ok(http_json(404, json!({"error":"missing staging"})), None);
            }
            let path = std::path::Path::new(staging).join(format!("{index}.chunk"));
            let nonce_path = std::path::Path::new(staging).join(format!("{index}.nonce"));
            let Ok(data) = std::fs::read(&path) else {
                return http_ok(http_json(404, json!({"error":"missing chunk"})), None);
            };
            let nonce = std::fs::read_to_string(&nonce_path).unwrap_or_default();
            http_ok(
                http_json(
                    200,
                    json!({
                        "ok": true,
                        "nonce": nonce,
                        "data_b64": base64::engine::general_purpose::STANDARD.encode(data),
                    }),
                ),
                None,
            )
        }
        ("POST", "/v1/file/ack") => {
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_ok(http_json(400, json!({"error":"bad json"})), None);
            };
            let file_id = payload["file_id"].as_str().unwrap_or("");
            // Ignore spoofed user_id; bind ack to this peer's authenticated profile id.
            let user_id = my_id;
            let conn = db.lock();
            let _ = db::ack_file(&conn, file_id, user_id);
            // If we are uploader, maybe purge staging when all members acked
            if let Ok(Some(meta)) = db::get_file(&conn, file_id) {
                if meta["uploader_id"].as_str() == Some(my_id) {
                    let members = db::member_ids(&conn, meta["conversation_id"].as_str().unwrap_or(""))
                        .unwrap_or_default();
                    let acks = db::file_ack_count(&conn, file_id).unwrap_or(0) as usize;
                    // Keep encrypted sender staging available for in-chat preview.
                    // The original file path is not exposed by every WebView file picker.
                    let _ = (members, acks);
                }
            }
            http_ok(http_json(200, json!({"ok": true})), None)
        }
        _ => http_ok(http_json(404, json!({"error":"not found"})), None),
    }
}

/// Binary framed stream of encrypted staging chunks (E2E preserved).
async fn stream_file_chunks(
    tls: &mut tokio_rustls::server::TlsStream<tokio::net::TcpStream>,
    staging: &std::path::Path,
    from_index: u32,
    chunk_count: u32,
) -> Result<(), ()> {
    // No Content-Length — client reads until EOF / sentinel after headers.
    let headers = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nX-PeerChat-Stream: v1\r\nConnection: close\r\n\r\n";
    tls.write_all(headers.as_bytes()).await.map_err(|_| ())?;
    // Batch a few frames before flush — cuts TLS/syscall overhead on LAN.
    let mut out = Vec::with_capacity(16 * 1024 * 1024);
    for index in from_index..chunk_count {
        let path = staging.join(format!("{index}.chunk"));
        let nonce_path = staging.join(format!("{index}.nonce"));
        let data = tokio::fs::read(&path).await.map_err(|_| ())?;
        let nonce = tokio::fs::read_to_string(&nonce_path)
            .await
            .unwrap_or_default();
        let nonce_b = nonce.as_bytes();
        if nonce_b.len() > u16::MAX as usize {
            return Err(());
        }
        out.extend_from_slice(&index.to_le_bytes());
        out.extend_from_slice(&(nonce_b.len() as u16).to_le_bytes());
        out.extend_from_slice(nonce_b);
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&data);
        // Flush every ~2 frames (≈16 MiB ciphertext) or at end.
        if out.len() >= 14 * 1024 * 1024 || index + 1 == chunk_count {
            tls.write_all(&out).await.map_err(|_| ())?;
            out.clear();
        }
    }
    tls.write_all(&0xFFFFFFFFu32.to_le_bytes())
        .await
        .map_err(|_| ())?;
    let _ = tls.flush().await;
    Ok(())
}

fn http_json(code: u16, body: Value) -> String {
    let raw = body.to_string();
    let status = match code {
        200 => "200 OK",
        400 => "400 Bad Request",
        403 => "403 Forbidden",
        404 => "404 Not Found",
        _ => "500 Error",
    };
    // HTTP/1.1 keep-alive so a single TLS session can pull many file chunks.
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{raw}",
        raw.len()
    )
}

/// Read exactly one HTTP request from a keep-alive TLS stream.
async fn read_one_http_request(
    tls: &mut tokio_rustls::server::TlsStream<tokio::net::TcpStream>,
    pending: &mut Vec<u8>,
    tmp: &mut [u8],
    max_req: usize,
) -> Result<Option<Vec<u8>>, ()> {
    loop {
        if let Some(end) = complete_http_request_len(pending) {
            let req = pending.drain(..end).collect::<Vec<u8>>();
            return Ok(Some(req));
        }
        match tls.read(tmp).await {
            Ok(0) => {
                return if pending.is_empty() {
                    Ok(None)
                } else {
                    Err(())
                };
            }
            Ok(n) => {
                if pending.len() + n > max_req {
                    return Err(());
                }
                pending.extend_from_slice(&tmp[..n]);
            }
            Err(_) => return Err(()),
        }
    }
}

fn complete_http_request_len(buf: &[u8]) -> Option<usize> {
    let head_end = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
    let header_bytes = head_end + 4;
    let head = std::str::from_utf8(&buf[..header_bytes]).ok()?;
    let cl = head
        .lines()
        .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
        .and_then(|l| l.split(':').nth(1))
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let total = header_bytes + cl;
    if buf.len() >= total {
        Some(total)
    } else {
        None
    }
}

#[derive(Debug)]
struct FingerprintVerifier {
    expected: Option<String>,
    observed: Arc<std::sync::Mutex<String>>,
}

impl rustls::client::danger::ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        let sum = hex::encode(Sha256::digest(end_entity.as_ref()));
        if let Ok(mut g) = self.observed.lock() {
            *g = sum.clone();
        }
        if let Some(ref exp) = self.expected {
            if exp != &sum {
                return Err(rustls::Error::General("tls fingerprint mismatch".into()));
            }
        }
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls::pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub async fn peer_request(
    host: &str,
    port: u16,
    path: &str,
    body: Option<Value>,
    expected_fp: Option<String>,
) -> Result<(Value, String), String> {
    let mut session = PeerSession::connect(host, port, expected_fp).await?;
    let json = session.request(path, body).await?;
    let fp = session.fingerprint();
    Ok((json, fp))
}

/// Persistent TLS HTTP/1.1 client — reuse for many file-chunk pulls.
pub struct PeerSession {
    host: String,
    tls: tokio_rustls::client::TlsStream<tokio::net::TcpStream>,
    pending: Vec<u8>,
    observed_fp: Arc<std::sync::Mutex<String>>,
}

impl PeerSession {
    pub async fn connect(
        host: &str,
        port: u16,
        expected_fp: Option<String>,
    ) -> Result<Self, String> {
        let addr = tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| e.to_string())?
            .next()
            .ok_or("resolve failed")?;
        let tcp =
            tokio::time::timeout(Duration::from_secs(8), tokio::net::TcpStream::connect(addr))
                .await
                .map_err(|_| "connect timeout".to_string())?
                .map_err(|e| e.to_string())?;
        let _ = tcp.set_nodelay(true);
        let observed = Arc::new(std::sync::Mutex::new(String::new()));
        let verifier = Arc::new(FingerprintVerifier {
            expected: expected_fp,
            observed: observed.clone(),
        });
        let config = rustls::ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(verifier)
            .with_no_client_auth();
        let connector = TlsConnector::from(Arc::new(config));
        let name = ServerName::try_from(host.to_string()).map_err(|_| "bad host")?;
        let tls = connector
            .connect(name, tcp)
            .await
            .map_err(|e| e.to_string())?;
        Ok(Self {
            host: host.to_string(),
            tls,
            pending: Vec::new(),
            observed_fp: observed,
        })
    }

    pub fn fingerprint(&self) -> String {
        self.observed_fp
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub async fn request(&mut self, path: &str, body: Option<Value>) -> Result<Value, String> {
        let payload = body.map(|b| b.to_string()).unwrap_or_default();
        let method = if payload.is_empty() { "GET" } else { "POST" };
        let req = format!(
            "{method} {path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{payload}",
            self.host,
            payload.len()
        );
        self.tls
            .write_all(req.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        let resp = self.read_one_response().await?;
        let text = String::from_utf8_lossy(&resp);
        let body = text.split("\r\n\r\n").nth(1).unwrap_or("{}");
        Ok(serde_json::from_str(body).unwrap_or(json!({"raw": body})))
    }

    /// Start `/v1/file/stream` — headers parsed, body frames left in `pending`.
    pub async fn begin_file_stream(
        &mut self,
        file_id: &str,
        from_index: u32,
    ) -> Result<(), String> {
        let payload = json!({"file_id": file_id, "from_index": from_index}).to_string();
        let req = format!(
            "POST /v1/file/stream HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
            self.host,
            payload.len()
        );
        self.tls
            .write_all(req.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        let mut tmp = vec![0u8; 64 * 1024];
        loop {
            if let Some(pos) = self
                .pending
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
            {
                let header_end = pos + 4;
                let head = String::from_utf8_lossy(&self.pending[..header_end]);
                if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
                    let body = head.split("\r\n\r\n").nth(1).unwrap_or("");
                    if let Ok(v) = serde_json::from_str::<Value>(body) {
                        if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
                            return Err(err.to_string());
                        }
                    }
                    return Err("stream not supported by peer".into());
                }
                if !head.to_ascii_lowercase().contains("x-peerchat-stream:") {
                    return Err("stream not supported by peer".into());
                }
                let _ = self.pending.drain(..header_end);
                return Ok(());
            }
            match self.tls.read(&mut tmp).await {
                Ok(0) => return Err("peer closed before stream headers".into()),
                Ok(n) => self.pending.extend_from_slice(&tmp[..n]),
                Err(e) => return Err(e.to_string()),
            }
        }
    }

    pub async fn read_exact(&mut self, n: usize) -> Result<Vec<u8>, String> {
        // Heap — large enough for LAN throughput without blowing the Windows task stack.
        let mut tmp = vec![0u8; 256 * 1024];
        while self.pending.len() < n {
            match self.tls.read(&mut tmp).await {
                Ok(0) => return Err("peer closed mid-stream".into()),
                Ok(k) => self.pending.extend_from_slice(&tmp[..k]),
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(self.pending.drain(..n).collect())
    }

    async fn read_one_response(&mut self) -> Result<Vec<u8>, String> {
        let mut tmp = vec![0u8; 256 * 1024];
        const MAX_RESP: usize = 24 * 1024 * 1024;
        loop {
            if let Some(end) = complete_http_response_len(&self.pending) {
                return Ok(self.pending.drain(..end).collect());
            }
            match self.tls.read(&mut tmp).await {
                Ok(0) => return Err("peer closed connection".into()),
                Ok(n) => {
                    if self.pending.len() + n > MAX_RESP {
                        return Err("peer response too large".into());
                    }
                    self.pending.extend_from_slice(&tmp[..n]);
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    }
}

/// Encrypt one file chunk (matches JS `encryptChunk` AES-256-GCM + optional AAD).
/// Returns (nonce_b64, ciphertext).
pub fn encrypt_file_chunk(
    content_key: &[u8],
    plaintext: &[u8],
    chunk_index: Option<u32>,
) -> Result<(String, Vec<u8>), String> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    if content_key.len() != 32 {
        return Err("content key must be 32 bytes".into());
    }
    let mut nonce_raw = [0u8; 12];
    getrandom::getrandom(&mut nonce_raw).map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(content_key));
    let nonce = Nonce::from_slice(&nonce_raw);
    let aad_owned: Option<Vec<u8>> =
        chunk_index.map(|i| format!("chunk:{i}").into_bytes());
    let ciphertext = if let Some(ref aad) = aad_owned {
        cipher
            .encrypt(
                nonce,
                Payload {
                    msg: plaintext,
                    aad: aad.as_slice(),
                },
            )
            .map_err(|_| "encrypt failed".to_string())?
    } else {
        cipher
            .encrypt(nonce, plaintext)
            .map_err(|_| "encrypt failed".to_string())?
    };
    let nonce_b64 = base64::engine::general_purpose::STANDARD.encode(nonce_raw);
    Ok((nonce_b64, ciphertext))
}

/// Decrypt one file chunk (matches JS `@noble/ciphers` AES-256-GCM + optional AAD).
pub fn decrypt_file_chunk(
    content_key: &[u8],
    nonce_b64: &str,
    ciphertext: &[u8],
    chunk_index: Option<u32>,
) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit, Payload};
    use aes_gcm::{Aes256Gcm, Key, Nonce};
    if content_key.len() != 32 {
        return Err("content key must be 32 bytes".into());
    }
    let nonce_raw = base64::engine::general_purpose::STANDARD
        .decode(nonce_b64.trim())
        .map_err(|e| e.to_string())?;
    if nonce_raw.len() != 12 {
        return Err("nonce must be 12 bytes".into());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(content_key));
    let nonce = Nonce::from_slice(&nonce_raw);
    let aad_owned: Option<Vec<u8>> =
        chunk_index.map(|i| format!("chunk:{i}").into_bytes());
    let plain = if let Some(ref aad) = aad_owned {
        cipher
            .decrypt(
                nonce,
                Payload {
                    msg: ciphertext,
                    aad: aad.as_slice(),
                },
            )
            .map_err(|_| "decrypt failed".to_string())?
    } else {
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| "decrypt failed".to_string())?
    };
    Ok(plain)
}

/// Pull encrypted stream, decrypt, append to receive temp; emit progress.
/// `on_chunk` is called after each successful append so the DB can track resume points.
pub async fn stream_download_and_append<F>(
    host: &str,
    port: u16,
    expected_fp: Option<String>,
    file_id: &str,
    from_index: u32,
    content_key: &[u8],
    file_crypto_v: i64,
    temp_path: &std::path::Path,
    total_chunks: u32,
    app: &AppHandle,
    cancel: Arc<AtomicBool>,
    mut on_chunk: F,
) -> Result<u32, String>
where
    F: FnMut(u32) -> Result<(), String>,
{
    use std::io::{BufWriter, Write};
    let mut session = PeerSession::connect(host, port, expected_fp).await?;
    session.begin_file_stream(file_id, from_index).await?;
    let mut next = from_index;
    let raw = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(temp_path)
        .map_err(|e| e.to_string())?;
    // 4 MiB write buffer — fewer syscalls on large LAN transfers.
    let mut file = BufWriter::with_capacity(4 * 1024 * 1024, raw);
    loop {
        if cancel.load(Ordering::Relaxed) {
            file.flush().map_err(|e| e.to_string())?;
            if next > from_index {
                on_chunk(next)?;
            }
            return Err("cancelled".into());
        }
        let idx_bytes = session.read_exact(4).await?;
        let index = u32::from_le_bytes(idx_bytes.as_slice().try_into().unwrap());
        if index == 0xFFFFFFFF {
            break;
        }
        let nlen_bytes = session.read_exact(2).await?;
        let nlen = u16::from_le_bytes(nlen_bytes.as_slice().try_into().unwrap()) as usize;
        let nonce_raw = session.read_exact(nlen).await?;
        let nonce_b64 = String::from_utf8(nonce_raw).map_err(|e| e.to_string())?;
        let clen_bytes = session.read_exact(4).await?;
        let clen = u32::from_le_bytes(clen_bytes.as_slice().try_into().unwrap()) as usize;
        if clen > 16 * 1024 * 1024 {
            return Err("stream chunk too large".into());
        }
        let cipher = session.read_exact(clen).await?;
        if index != next {
            return Err(format!("stream out of order: expected {next}, got {index}"));
        }
        let chunk_idx = if file_crypto_v >= 2 {
            Some(index)
        } else {
            None
        };
        let plain = decrypt_file_chunk(content_key, &nonce_b64, &cipher, chunk_idx)?;
        file.write_all(&plain).map_err(|e| e.to_string())?;
        next = index + 1;
        // Persist resume cursor less often — DB lock every chunk was a LAN bottleneck.
        if next == total_chunks || next == 1 || next % 8 == 0 {
            file.flush().map_err(|e| e.to_string())?;
            on_chunk(next)?;
            let _ = app.emit(
                "file-stream-progress",
                json!({
                    "file_id": file_id,
                    "done": next,
                    "total": total_chunks,
                }),
            );
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    if next > from_index && (next % 8 != 0) {
        on_chunk(next)?;
    }
    Ok(next)
}

fn complete_http_response_len(buf: &[u8]) -> Option<usize> {
    complete_http_request_len(buf) // same Content-Length framing
}

/// Fetch many encrypted chunks over a single TLS session.
pub async fn fetch_chunks_keep_alive(
    host: &str,
    port: u16,
    expected_fp: Option<String>,
    file_id: &str,
    from_index: u32,
    count: u32,
) -> Result<Vec<Value>, String> {
    if count == 0 {
        return Ok(Vec::new());
    }
    let mut session = PeerSession::connect(host, port, expected_fp).await?;
    let mut out = Vec::with_capacity(count as usize);
    for i in 0..count {
        let index = from_index + i;
        let body = json!({"file_id": file_id, "index": index});
        let resp = session.request("/v1/file/chunk", Some(body)).await?;
        if resp.get("error").is_some() {
            return Err(resp
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("missing chunk")
                .to_string());
        }
        out.push(json!({
            "index": index,
            "nonce": resp.get("nonce").and_then(|v| v.as_str()).unwrap_or(""),
            "data_b64": resp.get("data_b64").and_then(|v| v.as_str()).unwrap_or(""),
        }));
    }
    Ok(out)
}

