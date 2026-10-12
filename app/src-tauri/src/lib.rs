mod bundle;
mod db;
mod discovery;
mod peer_http;
mod tls_cert;

use base64::Engine;
use discovery::{DiscoveryHub, PeerBeacon};
use parking_lot::Mutex;
use peer_http::SharedDb;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    db: SharedDb,
    data_dir: PathBuf,
    discovery: DiscoveryHub,
    stop_tx: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    fingerprint: Mutex<String>,
    started: Mutex<bool>,
    /// Live discovery beacon display name (updated on rename).
    live_display_name: Arc<Mutex<String>>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

const MAX_FILE_BYTES: i64 = 2 * 1024 * 1024 * 1024; // 2 GiB
const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const MAX_CHUNKS: i64 = 65_536;

fn safe_download_name(filename: &str) -> String {
    let safe: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = safe.trim().trim_start_matches('.').to_string();
    if trimmed.is_empty() || trimmed.contains("..") {
        "download.bin".into()
    } else {
        trimmed
    }
}

fn explain_io(err: std::io::Error) -> String {
    let raw = err.raw_os_error();
    let text = err.to_string();
    if raw == Some(28) || text.to_lowercase().contains("space") {
        format!("insufficient disk space: {text}")
    } else if raw == Some(13) || text.to_lowercase().contains("permission") {
        format!("permission denied: {text}")
    } else {
        text
    }
}

fn resolve_download_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    let custom = {
        let conn = state.db.lock();
        db::get_setting(&conn, "download_dir")?
    };
    if let Some(custom) = custom {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            let path = PathBuf::from(trimmed);
            if !path.is_absolute() {
                return Err("invalid destination: download directory must be an absolute path".into());
            }
            std::fs::create_dir_all(&path).map_err(explain_io)?;
            return Ok(path);
        }
    }
    app.path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())
}

fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(explain_io)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(explain_io)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn resolve_staging_dir(app: &AppHandle, file_id: &str) -> Result<PathBuf, String> {
    if file_id.is_empty()
        || file_id.contains("..")
        || file_id.contains('/')
        || file_id.contains('\\')
    {
        return Err("invalid file id".into());
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("staging")
        .join(file_id);
    Ok(base)
}

fn from_peer_json(profile: &Value, fingerprint: &str) -> Value {
    json!({
        "user_id": profile["id"],
        "display_name": profile["display_name"],
        "x25519_public": profile["x25519_public"],
        "ed25519_public": profile["ed25519_public"],
        "last_port": profile["listen_port"],
        "tls_fingerprint": fingerprint,
        "last_ip": discovery::lan_ip(),
    })
}

fn kick_flush(state: &AppState) {
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        flush_outbox(&db).await;
    });
}

fn enqueue_group_event(
    conn: &Connection,
    from_peer: &Value,
    conversation_id: &str,
    recipient_id: &str,
    title: &str,
    wrapped_for_recipient: Option<String>,
    members: &Value,
    op: &str,
    subject_user_id: Option<&str>,
) -> Result<(), String> {
    enqueue_group_event_extra(
        conn,
        from_peer,
        conversation_id,
        recipient_id,
        title,
        wrapped_for_recipient,
        members,
        op,
        subject_user_id,
        None,
    )
}

fn enqueue_group_event_extra(
    conn: &Connection,
    from_peer: &Value,
    conversation_id: &str,
    recipient_id: &str,
    title: &str,
    wrapped_for_recipient: Option<String>,
    members: &Value,
    op: &str,
    subject_user_id: Option<&str>,
    extra: Option<Value>,
) -> Result<(), String> {
    let oid = format!("gev-{}:{}", uuid::Uuid::new_v4(), recipient_id);
    let mut event = json!({
        "op": op,
        "conversation_id": conversation_id,
        "title": title,
        "members": members,
    });
    if let Some(uid) = subject_user_id {
        event["user_id"] = json!(uid);
    }
    if let Some(ex) = extra {
        if let Some(obj) = ex.as_object() {
            for (k, v) in obj {
                event[k] = v.clone();
            }
        }
    }
    let payload = json!({
        "from_peer": from_peer,
        "conversation_id": conversation_id,
        "group_title": title,
        "wrapped_group_key": wrapped_for_recipient,
        "members": members,
        "group_event": event,
    });
    db::enqueue_outbox(
        conn,
        &oid,
        recipient_id,
        conversation_id,
        &payload.to_string(),
    )
}

#[tauri::command]
fn get_profile(state: State<AppState>) -> Result<Option<Value>, String> {
    let conn = state.db.lock();
    db::get_profile(&conn)
}

#[tauri::command]
fn setup_profile(
    app: AppHandle,
    state: State<AppState>,
    display_name: String,
    user_id: String,
    x25519_public: String,
    ed25519_public: String,
    listen_port: Option<i64>,
) -> Result<Value, String> {
    let preferred = listen_port.unwrap_or(9876) as u16;
    let port = peer_http::allocate_listen_port(preferred)?;
    {
        let conn = state.db.lock();
        db::upsert_profile(
            &conn,
            &user_id,
            &display_name,
            &x25519_public,
            &ed25519_public,
            port as i64,
        )?;
    }
    start_runtime_inner(
        &app,
        &state,
        &user_id,
        &display_name,
        &x25519_public,
        &ed25519_public,
        port,
    )?;
    let conn = state.db.lock();
    db::get_profile(&conn)?.ok_or_else(|| "profile missing".into())
}

#[tauri::command]
fn update_display_name(state: State<AppState>, display_name: String) -> Result<Value, String> {
    let name = display_name.trim();
    if name.is_empty() {
        return Err("display name required".into());
    }
    let (profile, fingerprint) = {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let id = profile["id"].as_str().unwrap_or("");
        db::upsert_profile(
            &conn,
            id,
            name,
            profile["x25519_public"].as_str().unwrap_or(""),
            profile["ed25519_public"].as_str().unwrap_or(""),
            profile["listen_port"].as_i64().unwrap_or(9876),
        )?;
        let updated = db::get_profile(&conn)?.ok_or_else(|| "profile missing".to_string())?;
        let fp = state.fingerprint.lock().clone();
        // Fan-out name to known peers so lists update without waiting for chat traffic.
        let me = updated["id"].as_str().unwrap_or("").to_string();
        let from_peer = from_peer_json(&updated, &fp);
        let peers = db::list_peers(&conn).unwrap_or_default();
        for p in peers {
            let rid = p["user_id"].as_str().unwrap_or("");
            if rid.is_empty() || rid == me {
                continue;
            }
            let oid = format!("profile-{}:{}", uuid::Uuid::new_v4(), rid);
            let payload = json!({
                "from_peer": from_peer,
                "profile_update": true,
            });
            let _ = db::enqueue_outbox(&conn, &oid, rid, "", &payload.to_string());
        }
        (updated, fp)
    };
    let _ = fingerprint;
    *state.live_display_name.lock() = name.to_string();
    kick_flush(&state);
    Ok(profile)
}

#[tauri::command]
fn set_conversation_pinned(
    state: State<AppState>,
    conversation_id: String,
    pinned: bool,
) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_conversation_pinned(&conn, &conversation_id, pinned)
}

#[tauri::command]
fn set_conversation_muted(
    state: State<AppState>,
    conversation_id: String,
    muted: bool,
) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_conversation_muted(&conn, &conversation_id, muted)
}

#[tauri::command]
fn list_pinned_messages(
    state: State<AppState>,
    conversation_id: String,
) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_pinned_messages(&conn, &conversation_id)
}

#[tauri::command]
fn get_notifications_enabled(state: State<AppState>) -> Result<bool, String> {
    let conn = state.db.lock();
    Ok(db::get_setting(&conn, "notifications_enabled")?
        .map(|v| v != "0")
        .unwrap_or(true))
}

#[tauri::command]
fn set_notifications_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_setting(&conn, "notifications_enabled", if enabled { "1" } else { "0" })
}

#[tauri::command]
fn conversation_is_muted(state: State<AppState>, conversation_id: String) -> Result<bool, String> {
    let conn = state.db.lock();
    db::conversation_muted(&conn, &conversation_id)
}

fn start_runtime_inner(
    app: &AppHandle,
    state: &AppState,
    user_id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    preferred_port: u16,
) -> Result<(), String> {
    {
        let started = state.started.lock();
        if *started {
            return Ok(());
        }
    }
    let port = peer_http::allocate_listen_port(preferred_port)?;
    {
        let conn = state.db.lock();
        let _ = conn.execute(
            "UPDATE profile SET listen_port=?1",
            rusqlite::params![port as i64],
        );
    }
    let cert = tls_cert::ensure(&state.data_dir)?;
    *state.fingerprint.lock() = cert.fingerprint.clone();
    *state.live_display_name.lock() = display_name.to_string();
    peer_http::spawn_listener(
        cert.clone(),
        port,
        state.db.clone(),
        user_id.to_string(),
        app.clone(),
    )?;

    let (tx, rx) = tokio::sync::watch::channel(false);
    *state.stop_tx.lock() = Some(tx);
    let hub = state.discovery.clone();
    let live_name = state.live_display_name.clone();
    let beacon = PeerBeacon {
        magic: "LANMSG".into(),
        v: "4".into(),
        kind: "peer".into(),
        ip: discovery::lan_ip(),
        port,
        user_id: user_id.into(),
        display_name: display_name.into(),
        fingerprint: cert.fingerprint.clone(),
        x25519_public: x25519_public.into(),
        ed25519_public: ed25519_public.into(),
        ts: 0.0,
    };
    tauri::async_runtime::spawn(async move {
        discovery::run_beacon(hub, port, 41234, rx, beacon, live_name).await;
    });

    // outbox flusher
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            flush_outbox(&db).await;
        }
    });

    *state.started.lock() = true;
    Ok(())
}

/// Deliver a slice of outbox items that all belong to the same recipient peer.
/// Items are delivered sequentially to preserve per-peer ordering.
/// A 10-second total timeout wraps each request (covers TLS handshake + body read).
async fn deliver_peer_items(db: &SharedDb, items: Vec<Value>) {
    for item in items {
        let id = item["id"].as_str().unwrap_or("").to_string();
        let recipient = item["recipient_id"].as_str().unwrap_or("").to_string();
        let payload_str = item["payload"].as_str().unwrap_or("{}").to_string();

        let peer = {
            let conn = db.lock();
            db::get_peer(&conn, &recipient).ok().flatten()
        };
        let Some(peer) = peer else {
            continue;
        };

        let ip = match peer["last_ip"].as_str() {
            Some(ip) => ip.to_string(),
            None => {
                let conn = db.lock();
                let _ = db::bump_outbox_error(&conn, &id, "peer has no LAN IP yet — refresh People");
                continue;
            }
        };
        if !discovery::is_usable_lan_ip(&ip) {
            let conn = db.lock();
            let _ = db::bump_outbox_error(
                &conn,
                &id,
                "peer IP is loopback/invalid — ask them to update PeerTalk and Refresh People",
            );
            continue;
        }
        let port = peer["last_port"]
            .as_u64()
            .or_else(|| peer["last_port"].as_i64().map(|p| p as u64));
        let Some(port) = port else {
            let conn = db.lock();
            let _ = db::bump_outbox_error(&conn, &id, "peer has no listen port");
            continue;
        };
        let pinned = peer["pinned"].as_bool().unwrap_or(false);
        let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
        if pinned && fp.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
            let conn = db.lock();
            let _ = db::bump_outbox_error(&conn, &id, "pinned peer missing fingerprint");
            continue;
        }
        let Ok(payload) = serde_json::from_str::<Value>(&payload_str) else {
            continue;
        };

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            peer_http::peer_request(&ip, port as u16, "/v1/deliver", Some(payload), fp),
        )
        .await;

        match result {
            Err(_elapsed) => {
                let conn = db.lock();
                let _ = db::bump_outbox_error(&conn, &id, "request timed out after 10 s");
            }
            Ok(Ok((resp, _))) if resp.get("ok").and_then(|v| v.as_bool()) == Some(true) => {
                let conn = db.lock();
                let _ = db::mark_outbox_delivered(&conn, &id);
            }
            Ok(Ok((resp, _))) => {
                let err = resp
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("deliver rejected")
                    .to_string();
                let conn = db.lock();
                let _ = db::bump_outbox_error(&conn, &id, &err);
            }
            Ok(Err(e)) => {
                // Classify TLS fingerprint mismatch as a security failure so the UI can
                // surface it distinctly from ordinary network errors.
                let msg = if e.contains("tls fingerprint mismatch") {
                    "[SECURITY] TLS fingerprint mismatch — peer identity may have changed. \
                     Go to People and accept or reject the new identity.".to_string()
                } else {
                    e
                };
                let conn = db.lock();
                let _ = db::bump_outbox_error(&conn, &id, &msg);
            }
        }
    }
}

/// Drain all due outbox items, delivering to each peer concurrently (up to 8 peers at once).
/// Items for the same peer are delivered sequentially to preserve ordering.
async fn flush_outbox(db: &SharedDb) {
    let pending = {
        let conn = db.lock();
        db::pending_outbox(&conn).unwrap_or_default()
    };

    // Group by recipient so we can deliver to multiple peers in parallel while
    // keeping per-peer message ordering intact.
    let mut by_peer: std::collections::HashMap<String, Vec<Value>> = Default::default();
    for item in pending {
        let recipient = item["recipient_id"].as_str().unwrap_or("").to_string();
        by_peer.entry(recipient).or_default().push(item);
    }

    const MAX_CONCURRENT_PEERS: usize = 8;
    let mut set = tokio::task::JoinSet::new();

    for (_peer_id, items) in by_peer {
        // Bound concurrency: wait for a slot before spawning a new peer task.
        if set.len() >= MAX_CONCURRENT_PEERS {
            let _ = set.join_next().await;
        }
        let db2 = db.clone();
        set.spawn(async move {
            deliver_peer_items(&db2, items).await;
        });
    }
    // Drain remaining tasks.
    while set.join_next().await.is_some() {}
}

/// Immediately attempt delivery of all pending items for a single peer.
/// Clears the backoff window first so newly reachable peers are not held back.
fn kick_flush_for_peer(state: &AppState, recipient_id: String) {
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        {
            let conn = db.lock();
            let _ = db::clear_peer_outbox_backoff(&conn, &recipient_id);
        }
        let items = {
            let conn = db.lock();
            db::pending_outbox_for_peer(&conn, &recipient_id).unwrap_or_default()
        };
        if !items.is_empty() {
            deliver_peer_items(&db, items).await;
        }
    });
}

#[tauri::command]
fn my_fingerprint(state: State<AppState>) -> String {
    state.fingerprint.lock().clone()
}

#[tauri::command]
async fn discover_peers(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let profile = {
        let conn = state.db.lock();
        db::get_profile(&conn)?
    };
    let self_id = profile
        .as_ref()
        .and_then(|p| p["id"].as_str())
        .unwrap_or("")
        .to_string();
    let scanned = discovery::scan(41234, &self_id).await?;
    // merge hub
    let hub_peers = state.discovery.peers.read().await.clone();
    let mut map = std::collections::HashMap::new();
    for p in scanned {
        map.insert(p.user_id.clone(), p);
    }
    for (k, v) in hub_peers {
        map.insert(k, v);
    }
    let mut out = Vec::new();
    let online_ids: Vec<String> = map.keys().cloned().collect();
    // Collect peers whose reachable address changed so we can kick delivery after releasing
    // the DB lock (avoid deadlock: kick_flush_for_peer spawns tasks that also lock the DB).
    let mut peers_to_kick: Vec<String> = Vec::new();
    {
        let conn = state.db.lock();
        for p in map.values() {
            // Read existing row once — used for pinned-key preservation and IP-change detection.
            let existing = db::get_peer(&conn, &p.user_id).ok().flatten();
            let old_ip = existing.as_ref().and_then(|e| e["last_ip"].as_str().map(|s| s.to_string()));
            let ip_changed = old_ip.as_deref() != Some(p.ip.as_str())
                && discovery::is_usable_lan_ip(&p.ip);

            // Pinned peers: freeze identity keys / TLS fingerprint on change.
            if let Some(ref ex) = existing {
                let pinned = ex["pinned"].as_bool().unwrap_or(false);
                if pinned {
                    let same_fp = ex["tls_fingerprint"].as_str() == Some(p.fingerprint.as_str());
                    let same_x = ex["x25519_public"].as_str() == Some(p.x25519_public.as_str());
                    let same_e = ex["ed25519_public"].as_str() == Some(p.ed25519_public.as_str());
                    if !(same_fp && same_x && same_e) {
                        // Keep old keys; still refresh IP/online for delivery.
                        db::upsert_peer(
                            &conn,
                            &p.user_id,
                            ex["display_name"].as_str().unwrap_or(&p.display_name),
                            ex["x25519_public"].as_str().unwrap_or(&p.x25519_public),
                            ex["ed25519_public"].as_str().unwrap_or(&p.ed25519_public),
                            Some(&p.ip),
                            Some(p.port as i64),
                            ex["tls_fingerprint"].as_str(),
                            true,
                        )?;
                        let _ = db::set_peer_pending_identity(
                            &conn,
                            &p.user_id,
                            &p.fingerprint,
                            &p.x25519_public,
                            &p.ed25519_public,
                        );
                        if ip_changed {
                            peers_to_kick.push(p.user_id.clone());
                        }
                        out.push(json!({
                            "user_id": p.user_id,
                            "display_name": ex["display_name"],
                            "x25519_public": ex["x25519_public"],
                            "ed25519_public": ex["ed25519_public"],
                            "last_ip": p.ip,
                            "last_port": p.port,
                            "tls_fingerprint": p.fingerprint,
                            "online": true,
                            "identity_changed": true,
                        }));
                        continue;
                    }
                }
            }
            db::upsert_peer(
                &conn,
                &p.user_id,
                &p.display_name,
                &p.x25519_public,
                &p.ed25519_public,
                Some(&p.ip),
                Some(p.port as i64),
                Some(&p.fingerprint),
                true,
            )?;
            if ip_changed {
                peers_to_kick.push(p.user_id.clone());
            }
            out.push(json!({
                "user_id": p.user_id,
                "display_name": p.display_name,
                "x25519_public": p.x25519_public,
                "ed25519_public": p.ed25519_public,
                "last_ip": p.ip,
                "last_port": p.port,
                "tls_fingerprint": p.fingerprint,
                "online": true,
                "identity_changed": false,
            }));
        }
        let _ = db::mark_peers_offline_except(&conn, &online_ids);
        let _ = db::mark_stale_peers_offline(&conn, 45);
    }
    // Kick delivery for peers that came online or moved to a new address.
    // Done after releasing conn to avoid any potential lock ordering issue.
    for peer_id in peers_to_kick {
        kick_flush_for_peer(&state, peer_id);
    }
    Ok(out)
}

#[tauri::command]
async fn list_lan_hosts(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
    let peer_ips: Vec<String> = {
        let conn = state.db.lock();
        db::list_peers(&conn)?
            .into_iter()
            .filter_map(|p| p["last_ip"].as_str().map(|s| s.to_string()))
            .collect()
    };
    let me = discovery::lan_ip();
    let mut exclude = peer_ips;
    exclude.push(me);
    let hosts = discovery::lan_hosts_without_app(&exclude);
    Ok(hosts
        .into_iter()
        .map(|h| {
            json!({
                "ip": h.ip,
                "label": h.label,
                "has_app": false,
            })
        })
        .collect())
}

#[tauri::command]
fn list_peers(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_peers(&conn)
}

#[tauri::command]
fn pin_peer(state: State<AppState>, user_id: String, fingerprint: String) -> Result<(), String> {
    let conn = state.db.lock();
    db::pin_peer(&conn, &user_id, &fingerprint)
}

#[tauri::command]
fn list_conversations(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_conversations(&conn)
}

#[tauri::command]
fn open_dm(state: State<AppState>, peer_id: String) -> Result<Value, String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let id = db::ensure_dm(&conn, &me, &peer_id)?;
    let peer_name = db::get_peer(&conn, &peer_id)?
        .and_then(|p| p["display_name"].as_str().map(|s| s.to_string()));
    Ok(json!({
        "id": id,
        "kind": "dm",
        "peer_id": peer_id,
        "peer_name": peer_name,
        "created_at": now(),
    }))
}

#[tauri::command]
fn create_group(
    state: State<AppState>,
    title: String,
    member_ids: Vec<String>,
    wrapped_group_keys: Value,
) -> Result<Value, String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let mut members = vec![(
        me.clone(),
        wrapped_group_keys
            .get(me.as_str())
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    )];
    for mid in &member_ids {
        members.push((
            mid.clone(),
            wrapped_group_keys
                .get(mid.as_str())
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
        ));
    }
    db::create_group(&conn, &id, &title, &me, &members)?;
    Ok(json!({
        "id": id,
        "kind": "group",
        "title": title,
        "created_at": now(),
    }))
}

#[tauri::command]
fn list_messages(state: State<AppState>, conversation_id: String) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    db::list_messages(&conn, &conversation_id, &me)
}

#[tauri::command]
fn retry_message(state: State<AppState>, message_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let n = db::reset_outbox_attempts(&conn, &message_id)?;
    if n == 0 {
        return Err("No pending delivery to retry".into());
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn delete_message_for_me(state: State<AppState>, message_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    db::hide_message(&conn, &me, &message_id)
}

#[tauri::command]
fn delete_message_for_everyone(
    state: State<AppState>,
    message_id: String,
) -> Result<Value, String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let msg = db::get_message(&conn, &message_id)?.ok_or("message missing")?;
    if msg["sender_id"].as_str() != Some(me.as_str()) {
        return Err("Only the sender can delete for everyone".into());
    }
    if msg["kind"].as_str() == Some("deleted") {
        return Ok(msg);
    }
    let conversation_id = msg["conversation_id"].as_str().unwrap_or("").to_string();
    let created_at = msg["created_at"]
        .as_str()
        .unwrap_or("")
        .to_string();
    db::cancel_outbox_for_message(&conn, &message_id)?;
    db::tombstone_message(&conn, &message_id)?;
    let tombstone = json!({
        "id": message_id,
        "conversation_id": conversation_id,
        "sender_id": me,
        "kind": "deleted",
        "ciphertext": "",
        "nonce": "",
        "wrapped_keys": {},
        "signature": "",
        "file_id": Value::Null,
        "created_at": created_at,
        "delivered": false,
    });
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    let members = db::member_ids(&conn, &conversation_id)?;
    for rid in members {
        if rid == me {
            continue;
        }
        let oid = format!("del-{}:{}", uuid::Uuid::new_v4(), rid);
        let payload = json!({
            "message": tombstone,
            "from_peer": from_peer,
            "conversation_id": conversation_id,
            "delete_for_everyone": true,
        });
        db::enqueue_outbox(
            &conn,
            &oid,
            &rid,
            &conversation_id,
            &payload.to_string(),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(tombstone)
}

#[tauri::command]
fn abort_outgoing_file(state: State<AppState>, file_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("");
    let file = db::get_file(&conn, &file_id)?.ok_or("file missing")?;
    if file["uploader_id"].as_str() != Some(me) {
        return Err("Only the uploader can abort this file".into());
    }
    db::delete_file_record(&conn, &file_id)
}

#[tauri::command]
fn mark_conversation_read(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let unread = db::unread_incoming(&conn, &conversation_id, &me)?;
    let mut by_sender: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (message_id, sender_id) in unread {
        db::mark_message_read(&conn, &message_id, &me)?;
        by_sender.entry(sender_id).or_default().push(message_id);
    }
    for (sender_id, ids) in by_sender {
        let oid = format!("read-{}:{sender_id}", uuid::Uuid::new_v4());
        let payload = json!({
            "reader_id": me,
            "read_receipts": ids,
        });
        db::enqueue_outbox(
            &conn,
            &oid,
            &sender_id,
            &conversation_id,
            &payload.to_string(),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn send_message(
    state: State<AppState>,
    conversation_id: String,
    message: Value,
    recipient_ids: Vec<String>,
    edit: Option<bool>,
) -> Result<Value, String> {
    let is_edit = edit.unwrap_or(false);
    let mut msg = message;
    if msg.get("id").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        if is_edit {
            return Err("edit requires message id".into());
        }
        msg["id"] = json!(uuid::Uuid::new_v4().to_string());
    }
    if msg.get("created_at").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        msg["created_at"] = json!(now());
    }
    if is_edit {
        msg["edited_at"] = json!(now());
    }
    msg["conversation_id"] = json!(conversation_id);
    msg["delivered"] = json!(false);
    if msg.get("sort_at").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        msg["sort_at"] = msg["created_at"].clone();
    }

    let fingerprint = state.fingerprint.lock().clone();
    let profile = {
        let conn = state.db.lock();
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        let result = (|| -> Result<Value, String> {
            if is_edit {
                db::apply_message_edit(&conn, &msg)?;
            } else {
                db::insert_message(&conn, &msg)?;
            }
            let profile = db::get_profile(&conn)?.ok_or("no profile")?;
            let from_peer = json!({
                "user_id": profile["id"],
                "display_name": profile["display_name"],
                "x25519_public": profile["x25519_public"],
                "ed25519_public": profile["ed25519_public"],
                "last_port": profile["listen_port"],
                "tls_fingerprint": fingerprint,
                "last_ip": discovery::lan_ip(),
            });
            let me = profile["id"].as_str().unwrap_or("");
            let title = conn
                .query_row(
                    "SELECT title FROM conversations WHERE id=?1",
                    rusqlite::params![conversation_id.as_str()],
                    |r| r.get::<_, Option<String>>(0),
                )
                .ok()
                .flatten();
            for rid in &recipient_ids {
                if rid == me {
                    continue;
                }
                let out_id = msg["id"].as_str().unwrap_or("").to_string();
                let oid = if is_edit {
                    format!("edit-{}:{}:{}", out_id, uuid::Uuid::new_v4(), rid)
                } else {
                    format!("{out_id}:{rid}")
                };
                let mut payload = json!({
                    "message": msg,
                    "from_peer": from_peer,
                    "conversation_id": conversation_id,
                });
                if is_edit {
                    payload["edit"] = json!(true);
                }
                if let Ok(Some(w)) = db::get_wrapped_group_key(&conn, conversation_id.as_str(), rid) {
                    payload["wrapped_group_key"] = json!(w);
                }
                if let Some(ref t) = title {
                    payload["group_title"] = json!(t);
                }
                db::enqueue_outbox(
                    &conn,
                    &oid,
                    rid,
                    conversation_id.as_str(),
                    &payload.to_string(),
                )?;
            }
            Ok(profile)
        })();
        match result {
            Ok(p) => {
                conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
                p
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(e);
            }
        }
    };

    let _ = profile;
    kick_flush(&state);
    Ok(msg)
}

#[tauri::command]
fn get_group_key(state: State<AppState>, conversation_id: String) -> Result<Option<String>, String> {
    let conn = state.db.lock();
    let me = db::get_profile(&conn)?
        .ok_or("no profile")?
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    db::get_wrapped_group_key(&conn, &conversation_id, &me)
}

#[tauri::command]
fn member_ids(state: State<AppState>, conversation_id: String) -> Result<Vec<String>, String> {
    let conn = state.db.lock();
    db::member_ids(&conn, &conversation_id)
}

#[tauri::command]
fn list_group_members(state: State<AppState>, conversation_id: String) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_members(&conn, &conversation_id)
}

#[tauri::command]
fn add_group_members(
    state: State<AppState>,
    conversation_id: String,
    wrapped_group_keys: Value,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let is_admin = db::is_group_admin(&conn, &conversation_id, &me)?;
    let can_add = is_admin
        || (db::is_conversation_member(&conn, &conversation_id, &me).unwrap_or(false)
            && db::members_can_add(&conn, &conversation_id)?);
    if !can_add {
        return Err("Only admins can add members in this group".into());
    }
    let title = db::conversation_title(&conn, &conversation_id)?
        .unwrap_or_else(|| "Group".into());
    if let Some(map) = wrapped_group_keys.as_object() {
        for (uid, wrapv) in map {
            if uid == &me {
                continue;
            }
            let wrap = wrapv.as_str();
            let name = db::display_name_for(&conn, uid);
            db::upsert_member(&conn, &conversation_id, uid, wrap, Some(name.as_str()))?;
        }
    }
    let roster = Value::Array(
        db::list_members(&conn, &conversation_id)?
            .into_iter()
            .collect(),
    );
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    let members = db::member_ids(&conn, &conversation_id)?;
    for rid in members {
        if rid == me {
            continue;
        }
        let wrap = db::get_wrapped_group_key(&conn, &conversation_id, &rid)?;
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            wrap,
            &roster,
            "sync",
            None,
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn remove_group_member(
    state: State<AppState>,
    conversation_id: String,
    user_id: String,
    wrapped_group_keys: Option<Value>,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if user_id == me {
        return Err("use leave to exit the group".into());
    }
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can remove members".into());
    }
    let title = db::conversation_title(&conn, &conversation_id)?
        .unwrap_or_else(|| "Group".into());
    let notify = db::member_ids(&conn, &conversation_id)?;
    db::delete_member(&conn, &conversation_id, &user_id)?;
    let _ = db::ensure_group_admin(&conn, &conversation_id)?;
    // Rotate group key for remaining members when wraps are provided.
    if let Some(wraps) = wrapped_group_keys.as_ref().and_then(|v| v.as_object()) {
        let pairs: Vec<(String, String)> = wraps
            .iter()
            .filter_map(|(uid, w)| w.as_str().map(|s| (uid.clone(), s.to_string())))
            .filter(|(uid, _)| uid != &user_id)
            .collect();
        db::update_member_wraps(&conn, &conversation_id, &pairs)?;
    }
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in notify {
        if rid == me || rid == user_id {
            // Still notify removed user of removal; remaining get new wraps.
        }
        if rid == me {
            continue;
        }
        let wrap = db::get_wrapped_group_key(&conn, &conversation_id, &rid)?;
        let op = if rid == user_id { "remove" } else { "sync" };
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            wrap,
            &roster,
            op,
            Some(user_id.as_str()),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn leave_group(
    state: State<AppState>,
    conversation_id: String,
    wrapped_group_keys: Option<Value>,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let title = db::conversation_title(&conn, &conversation_id)?
        .unwrap_or_else(|| "Group".into());
    let notify = db::member_ids(&conn, &conversation_id)?;
    db::delete_member(&conn, &conversation_id, &me)?;
    let _ = db::ensure_group_admin(&conn, &conversation_id)?;
    if let Some(wraps) = wrapped_group_keys.as_ref().and_then(|v| v.as_object()) {
        let pairs: Vec<(String, String)> = wraps
            .iter()
            .filter_map(|(uid, w)| w.as_str().map(|s| (uid.clone(), s.to_string())))
            .filter(|(uid, _)| uid != &me)
            .collect();
        db::update_member_wraps(&conn, &conversation_id, &pairs)?;
    }
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in notify {
        if rid == me {
            continue;
        }
        let wrap = db::get_wrapped_group_key(&conn, &conversation_id, &rid)?;
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            wrap,
            &roster,
            "sync",
            Some(me.as_str()),
        )?;
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            None,
            &roster,
            "remove",
            Some(me.as_str()),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn rename_group(
    state: State<AppState>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("title required".into());
    }
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can rename".into());
    }
    db::set_conversation_title(&conn, &conversation_id, &title)?;
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in db::member_ids(&conn, &conversation_id)? {
        if rid == me {
            continue;
        }
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            None,
            &roster,
            "rename",
            None,
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn delete_group(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can delete the group".into());
    }
    let title = db::conversation_title(&conn, &conversation_id)?.unwrap_or_else(|| "Group".into());
    let notify = db::member_ids(&conn, &conversation_id)?;
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in &notify {
        if rid == &me {
            continue;
        }
        enqueue_group_event(
            &conn,
            &from_peer,
            &conversation_id,
            rid,
            &title,
            None,
            &roster,
            "delete",
            None,
        )?;
    }
    db::delete_conversation_local(&conn, &conversation_id)?;
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn set_group_members_can_add(
    state: State<AppState>,
    conversation_id: String,
    allowed: bool,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can change this setting".into());
    }
    db::set_members_can_add(&conn, &conversation_id, allowed)?;
    let title = db::conversation_title(&conn, &conversation_id)?.unwrap_or_else(|| "Group".into());
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in db::member_ids(&conn, &conversation_id)? {
        if rid == me {
            continue;
        }
        enqueue_group_event_extra(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            None,
            &roster,
            "settings",
            None,
            Some(json!({ "members_can_add": allowed })),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn set_group_member_role(
    state: State<AppState>,
    conversation_id: String,
    user_id: String,
    role: String,
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if !db::is_group_admin(&conn, &conversation_id, &me)? {
        return Err("Only group admins can change roles".into());
    }
    db::set_member_role(&conn, &conversation_id, &user_id, &role)?;
    let title = db::conversation_title(&conn, &conversation_id)?.unwrap_or_else(|| "Group".into());
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in db::member_ids(&conn, &conversation_id)? {
        if rid == me {
            continue;
        }
        enqueue_group_event_extra(
            &conn,
            &from_peer,
            &conversation_id,
            &rid,
            &title,
            None,
            &roster,
            "role",
            Some(user_id.as_str()),
            Some(json!({ "role": role })),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
async fn send_typing(
    state: State<'_, AppState>,
    conversation_id: String,
    recipient_ids: Vec<String>,
) -> Result<(), String> {
    let (from_peer, me) = {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("").to_string();
        let fp = state.fingerprint.lock().clone();
        (from_peer_json(&profile, &fp), me)
    };
    let body = json!({
        "conversation_id": conversation_id,
        "user_id": me,
        "display_name": from_peer["display_name"],
    });
    for rid in recipient_ids {
        if rid == me {
            continue;
        }
        let peer = {
            let conn = state.db.lock();
            db::get_peer(&conn, &rid).ok().flatten()
        };
        let Some(peer) = peer else { continue };
        let Some(ip) = peer["last_ip"].as_str().filter(|s| discovery::is_usable_lan_ip(s)) else {
            continue;
        };
        let Some(port) = peer["last_port"]
            .as_u64()
            .or_else(|| peer["last_port"].as_i64().map(|p| p as u64))
        else {
            continue;
        };
        let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
        let _ = peer_http::peer_request(ip, port as u16, "/v1/typing", Some(body.clone()), fp).await;
    }
    Ok(())
}

#[derive(Serialize)]
struct FileCreateResult {
    file_id: String,
    staging_dir: String,
}

#[tauri::command]
fn create_outgoing_file(
    app: AppHandle,
    state: State<AppState>,
    conversation_id: String,
    enc_filename: String,
    filename_nonce: String,
    size_bytes: i64,
    chunk_count: i64,
    wrapped_keys: Value,
    original_path: Option<String>,
    content_sha256: Option<String>,
    file_crypto_v: Option<i64>,
) -> Result<FileCreateResult, String> {
    let profile = {
        let conn = state.db.lock();
        db::get_profile(&conn)?.ok_or("no profile")?
    };
    if size_bytes <= 0 || size_bytes > MAX_FILE_BYTES {
        return Err(format!("file size must be 1..{MAX_FILE_BYTES} bytes"));
    }
    if chunk_count <= 0 || chunk_count > MAX_CHUNKS {
        return Err(format!("chunk_count must be 1..{MAX_CHUNKS}"));
    }
    let crypto_v = file_crypto_v.unwrap_or(2).clamp(1, 2);
    let file_id = uuid::Uuid::new_v4().to_string();
    let staging = resolve_staging_dir(&app, &file_id)?;
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let meta = json!({
        "id": file_id,
        "conversation_id": conversation_id,
        "uploader_id": profile["id"],
        "enc_filename": enc_filename,
        "filename_nonce": filename_nonce,
        "size_bytes": size_bytes,
        "chunk_count": chunk_count,
        "wrapped_keys": wrapped_keys,
        "staging_dir": staging.display().to_string(),
        "local_path": original_path,
        "created_at": now(),
        "content_sha256": content_sha256,
        "file_crypto_v": crypto_v,
    });
    {
        let conn = state.db.lock();
        db::insert_file(&conn, &meta)?;
    }
    Ok(FileCreateResult {
        file_id,
        staging_dir: staging.display().to_string(),
    })
}

#[tauri::command]
fn set_file_content_hash(
    state: State<AppState>,
    file_id: String,
    content_sha256: String,
) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_file_content_hash(&conn, &file_id, &content_sha256)
}

#[tauri::command]
fn write_file_chunk(
    app: AppHandle,
    state: State<AppState>,
    file_id: String,
    index: u32,
    data_b64: String,
    nonce: String,
) -> Result<(), String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(&data_b64)
        .map_err(|e| e.to_string())?;
    if data.len() > MAX_CHUNK_BYTES {
        return Err(format!("chunk exceeds {MAX_CHUNK_BYTES} bytes"));
    }
    {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("");
        let file = db::get_file(&conn, &file_id)?.ok_or("file missing")?;
        if file["uploader_id"].as_str() != Some(me) {
            return Err("only uploader may write staging chunks".into());
        }
    }
    let dir = resolve_staging_dir(&app, &file_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{index}.chunk")), data).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{index}.nonce")), nonce).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn send_file_notice(
    state: State<AppState>,
    conversation_id: String,
    file_id: String,
    recipient_ids: Vec<String>,
) -> Result<Value, String> {
    let profile = {
        let conn = state.db.lock();
        db::get_profile(&conn)?.ok_or("no profile")?
    };
    let file = {
        let conn = state.db.lock();
        db::get_file(&conn, &file_id)?.ok_or("file missing")?
    };
    let mut outbound_file = file.clone();
    outbound_file["staging_dir"] = Value::Null;
    outbound_file["local_path"] = Value::Null;
    let created = now();
    let msg = json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "conversation_id": conversation_id,
        "sender_id": profile["id"],
        "kind": "file_notice",
        "ciphertext": "",
        "nonce": "",
        "wrapped_keys": {},
        "signature": "",
        "file_id": file_id,
        "created_at": created,
        "sort_at": created,
        "delivered": false,
    });
    {
        let conn = state.db.lock();
        db::insert_message(&conn, &msg)?;
        let from_peer = json!({
            "user_id": profile["id"],
            "display_name": profile["display_name"],
            "x25519_public": profile["x25519_public"],
            "ed25519_public": profile["ed25519_public"],
            "last_port": profile["listen_port"],
            "tls_fingerprint": state.fingerprint.lock().clone(),
            "last_ip": discovery::lan_ip(),
        });
        for rid in recipient_ids {
            if rid == profile["id"].as_str().unwrap_or("") {
                continue;
            }
            let oid = format!("{}:{}", msg["id"].as_str().unwrap_or(""), rid);
            let payload = json!({
                "message": msg,
                "file": outbound_file,
                "from_peer": from_peer,
            });
            db::enqueue_outbox(&conn, &oid, &rid, &conversation_id, &payload.to_string())?;
        }
        // sender has local copy — ack self
        let _ = db::ack_file(&conn, &file_id, profile["id"].as_str().unwrap_or(""));
    }
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        flush_outbox(&db).await;
    });
    Ok(msg)
}

#[tauri::command]
async fn fetch_file_chunk(
    state: State<'_, AppState>,
    file_id: String,
    index: u32,
    uploader_id: String,
) -> Result<Value, String> {
    let local = {
        let conn = state.db.lock();
        db::get_file(&conn, &file_id).ok().flatten()
    };
    if let Some(meta) = local {
        if let Some(dir) = meta["staging_dir"].as_str() {
            let path = PathBuf::from(dir).join(format!("{index}.chunk"));
            let nonce_path = PathBuf::from(dir).join(format!("{index}.nonce"));
            if path.is_file() {
                let data = std::fs::read(&path).map_err(|e| e.to_string())?;
                let nonce = std::fs::read_to_string(&nonce_path).unwrap_or_default();
                return Ok(json!({
                    "nonce": nonce,
                    "data_b64": base64::engine::general_purpose::STANDARD.encode(data),
                }));
            }
        }
    }
    let peer = {
        let conn = state.db.lock();
        db::get_peer(&conn, &uploader_id)?.ok_or("uploader offline/unknown")?
    };
    let ip = peer["last_ip"]
        .as_str()
        .filter(|s| discovery::is_usable_lan_ip(s))
        .ok_or("no ip")?;
    let port = peer["last_port"]
        .as_u64()
        .or_else(|| peer["last_port"].as_i64().map(|p| p as u64))
        .ok_or("no port")? as u16;
    let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
    let body = json!({"file_id": file_id, "index": index});
    let (resp, _) = peer_http::peer_request(ip, port, "/v1/file/chunk", Some(body), fp)
        .await
        .map_err(|e| format!("connect to sender failed: {e}"))?;
    if resp.get("error").is_some() {
        return Err(resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("missing chunk")
            .to_string());
    }
    Ok(resp)
}

#[tauri::command]
async fn ack_file_download(
    state: State<'_, AppState>,
    file_id: String,
    uploader_id: String,
) -> Result<(), String> {
    let me = {
        let conn = state.db.lock();
        let id = db::get_profile(&conn)?
            .ok_or("no profile")?
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        db::ack_file(&conn, &file_id, &id)?;
        id
    };
    let peer = {
        let conn = state.db.lock();
        db::get_peer(&conn, &uploader_id)?
    };
    if let Some(peer) = peer {
        if let (Some(ip), Some(port)) = (peer["last_ip"].as_str(), peer["last_port"].as_u64()) {
            let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
            let body = json!({"file_id": file_id, "user_id": me});
            let _ = peer_http::peer_request(ip, port as u16, "/v1/file/ack", Some(body), fp).await;
        }
    }
    Ok(())
}

#[tauri::command]
fn get_file(state: State<AppState>, file_id: String) -> Result<Option<Value>, String> {
    let conn = state.db.lock();
    db::get_file(&conn, &file_id)
}

#[tauri::command]
async fn save_downloaded_file(
    app: AppHandle,
    state: State<'_, AppState>,
    file_id: Option<String>,
    filename: String,
    data_b64: String,
) -> Result<String, String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;
    if data.len() > MAX_FILE_BYTES as usize {
        return Err("decoded file exceeds size limit".into());
    }
    let name = safe_download_name(&filename);
    let dir = resolve_download_dir(&app, &state)?;
    std::fs::create_dir_all(&dir).map_err(explain_io)?;
    let mut path = dir.join(&name);
    if path.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        path = dir.join(format!("{stem}-{stamp}{ext}"));
    }
    // Reject path escape even after join.
    if !path.starts_with(&dir) {
        return Err("invalid destination".into());
    }
    std::fs::write(&path, &data).map_err(explain_io)?;
    if let Some(file_id) = file_id {
        let conn = state.db.lock();
        db::set_file_local_path(&conn, &file_id, &path.display().to_string())?;
        let _ = db::clear_receive_progress(&conn, &file_id);
    }
    Ok(path.display().to_string())
}

#[tauri::command]
fn begin_file_receive(app: AppHandle, state: State<AppState>, file_id: String) -> Result<Value, String> {
    let conn = state.db.lock();
    if let Ok(Some((next, temp))) = db::get_receive_progress(&conn, &file_id) {
        return Ok(json!({ "next_index": next, "temp_path": temp }));
    }
    let tmp_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("incoming");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let temp = tmp_dir.join(format!("{file_id}.part"));
    if temp.exists() {
        let _ = std::fs::remove_file(&temp);
    }
    std::fs::File::create(&temp).map_err(|e| e.to_string())?;
    db::upsert_receive_progress(&conn, &file_id, 0, Some(&temp.display().to_string()))?;
    Ok(json!({ "next_index": 0, "temp_path": temp.display().to_string() }))
}

#[tauri::command]
fn append_file_receive(
    state: State<AppState>,
    file_id: String,
    index: u32,
    data_b64: String,
) -> Result<(), String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;
    if data.len() > MAX_CHUNK_BYTES {
        return Err("chunk too large".into());
    }
    let (expected, temp) = {
        let conn = state.db.lock();
        let prog = db::get_receive_progress(&conn, &file_id)?.ok_or("receive not started")?;
        prog
    };
    if index as i64 != expected {
        return Err(format!("expected chunk {expected}, got {index}"));
    }
    let path = PathBuf::from(temp.ok_or("missing temp path")?);
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(&data).map_err(|e| e.to_string())?;
    let conn = state.db.lock();
    db::upsert_receive_progress(
        &conn,
        &file_id,
        expected + 1,
        Some(&path.display().to_string()),
    )?;
    Ok(())
}

#[tauri::command]
fn finalize_file_receive(
    app: AppHandle,
    state: State<AppState>,
    file_id: String,
    filename: String,
) -> Result<String, String> {
    let temp = {
        let conn = state.db.lock();
        let prog = db::get_receive_progress(&conn, &file_id)?.ok_or("receive not started")?;
        PathBuf::from(prog.1.ok_or("missing temp path")?)
    };
    if !temp.is_file() {
        return Err("temp file missing".into());
    }
    let name = safe_download_name(&filename);
    let dir = resolve_download_dir(&app, &state)?;
    std::fs::create_dir_all(&dir).map_err(explain_io)?;
    let mut path = dir.join(&name);
    if path.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        path = dir.join(format!("{stem}-{stamp}{ext}"));
    }
    if !path.starts_with(&dir) {
        return Err("invalid download path".into());
    }
    std::fs::rename(&temp, &path)
        .or_else(|_| {
            std::fs::copy(&temp, &path)
                .map(|_| ())
                .and_then(|_| std::fs::remove_file(&temp))
        })
        .map_err(explain_io)?;
    let conn = state.db.lock();
    db::set_file_local_path(&conn, &file_id, &path.display().to_string())?;
    let _ = db::clear_receive_progress(&conn, &file_id);
    Ok(path.display().to_string())
}

#[tauri::command]
fn get_receive_progress(state: State<AppState>, file_id: String) -> Result<Value, String> {
    let conn = state.db.lock();
    match db::get_receive_progress(&conn, &file_id)? {
        Some((next, temp)) => Ok(json!({ "next_index": next, "temp_path": temp })),
        None => Ok(json!({ "next_index": 0, "temp_path": Value::Null })),
    }
}

#[tauri::command]
fn open_local_file(state: State<AppState>, file_id: String) -> Result<(), String> {
    let path = {
        let conn = state.db.lock();
        let file = db::get_file(&conn, &file_id)?.ok_or("file metadata missing")?;
        file["local_path"]
            .as_str()
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .ok_or("No local copy is available yet")?
    };
    if !path.is_file() {
        return Err("The local file has been moved or deleted".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        // `start` opens the file with the default app (explorer alone often fails on files).
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path.display().to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn read_local_file(state: State<AppState>, file_id: String) -> Result<String, String> {
    let path = {
        let conn = state.db.lock();
        let file = db::get_file(&conn, &file_id)?.ok_or("file metadata missing")?;
        file["local_path"]
            .as_str()
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .ok_or("No local copy is available")?
    };
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(data))
}

#[tauri::command]
fn tls_fingerprint_peer(host: String, port: u16) -> Result<String, String> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let (_, fp) = rt.block_on(peer_http::peer_request(&host, port, "/v1/hello", None, None))?;
    Ok(fp)
}

const SETTING_KEYS: &[&str] = &["theme", "games_enabled", "download_dir"];

#[tauri::command]
fn get_app_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    if !SETTING_KEYS.contains(&key.as_str()) {
        return Err("unknown setting".into());
    }
    let conn = state.db.lock();
    db::get_setting(&conn, &key)
}

#[tauri::command]
fn set_app_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    if !SETTING_KEYS.contains(&key.as_str()) {
        return Err("unknown setting".into());
    }
    if key == "theme" && value != "dark" && value != "light" {
        return Err("theme must be dark or light".into());
    }
    if key == "games_enabled" && value != "0" && value != "1" {
        return Err("games_enabled must be 0 or 1".into());
    }
    if key == "download_dir" && !value.trim().is_empty() {
        let path = PathBuf::from(value.trim());
        if !path.is_absolute() {
            return Err("invalid destination: download directory must be an absolute path".into());
        }
        std::fs::create_dir_all(&path).map_err(explain_io)?;
    }
    let conn = state.db.lock();
    db::set_setting(&conn, &key, value.trim())
}

#[tauri::command]
fn accept_pending_identity(state: State<AppState>, user_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    db::accept_pending_identity(&conn, &user_id)
}

#[tauri::command]
fn upsert_transfer(state: State<AppState>, row: Value) -> Result<(), String> {
    let conn = state.db.lock();
    db::upsert_transfer(&conn, &row)
}

#[tauri::command]
fn list_transfers(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_transfers(&conn, 200)
}

#[tauri::command]
fn save_item(state: State<AppState>, row: Value) -> Result<(), String> {
    let preview = row["preview"].as_str().unwrap_or("");
    if preview.chars().count() > 4000 {
        return Err("saved preview is too long".into());
    }
    let conn = state.db.lock();
    db::save_item(&conn, &row)
}

#[tauri::command]
fn delete_saved_item(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock();
    db::delete_saved_item(&conn, &id)
}

#[tauri::command]
fn list_saved_items(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_saved_items(&conn)
}

#[tauri::command]
fn peer_delivery_error(state: State<AppState>, user_id: String) -> Result<Option<Value>, String> {
    let conn = state.db.lock();
    db::latest_outbox_error(&conn, &user_id)
}

#[tauri::command]
fn verify_downloaded_file(state: State<AppState>, file_id: String) -> Result<Value, String> {
    let conn = state.db.lock();
    let file = db::get_file(&conn, &file_id)?.ok_or("file metadata missing")?;
    let path = file["local_path"]
        .as_str()
        .filter(|p| !p.is_empty())
        .map(std::path::PathBuf::from)
        .ok_or("no local file to verify")?;
    drop(conn);
    if !path.is_file() {
        return Err("local file missing before integrity check".into());
    }
    let actual = sha256_file(&path)?;
    let expected = file["content_sha256"].as_str().unwrap_or("").trim().to_string();
    if expected.is_empty() {
        return Ok(json!({
            "verified": false,
            "sha256": actual,
            "reason": "sender did not attach an integrity hash (older peer)"
        }));
    }
    if !expected.eq_ignore_ascii_case(&actual) {
        let _ = std::fs::remove_file(&path);
        let conn = state.db.lock();
        let _ = db::set_file_local_path(&conn, &file_id, "");
        return Err(format!(
            "integrity check failed for this file (expected {expected}, got {actual})"
        ));
    }
    Ok(json!({ "verified": true, "sha256": actual }))
}

#[tauri::command]
fn discard_file_receive(state: State<AppState>, file_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    if let Ok(Some((_, temp))) = db::get_receive_progress(&conn, &file_id) {
        if let Some(temp) = temp {
            let path = PathBuf::from(temp);
            if path.file_name().and_then(|s| s.to_str()) == Some(&format!("{file_id}.part")) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    db::clear_receive_progress(&conn, &file_id)
}

#[tauri::command]
fn list_directory_files(root: String) -> Result<Vec<Value>, String> {
    bundle::list_tree(std::path::Path::new(&root))
}

#[tauri::command]
fn pack_bundle(app: AppHandle, entries: Vec<bundle::BundleEntry>) -> Result<Value, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bundles");
    std::fs::create_dir_all(&dir).map_err(explain_io)?;
    let id = uuid::Uuid::new_v4().to_string();
    let path = dir.join(format!("{id}.zip"));
    let (size, count) = bundle::pack(&path, &entries)?;
    Ok(json!({
        "path": path.display().to_string(),
        "size": size,
        "count": count,
        "name": format!("bundle-{}.zip", &id[..8]),
    }))
}

#[tauri::command]
fn read_bundle_chunk(app: AppHandle, path: String, offset: u64, len: u32) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bundles");
    let bytes = bundle::read_under(base.as_path(), std::path::Path::new(&path), offset, len as usize)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn delete_bundle_file(app: AppHandle, path: String) -> Result<(), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bundles");
    let base = base.canonicalize().map_err(|e| e.to_string())?;
    let path = std::path::PathBuf::from(path);
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&base) {
        return Err("refusing to delete a file outside the bundle directory".into());
    }
    std::fs::remove_file(path).map_err(explain_io)
}

// ─── Virus scanning ──────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
struct ScanResult {
    clean: bool,
    engine: String,
    detail: String,
    skipped: bool,
}

/// Scan a file path with the system AV (Windows Defender on Windows).
/// Returns {clean, engine, detail, skipped}. Never returns Err — on failure
/// the result is skipped=true so the caller can decide how to proceed.
#[tauri::command]
fn scan_file(path: String) -> ScanResult {
    scan_file_inner(&path)
}

fn scan_file_inner(path: &str) -> ScanResult {
    #[cfg(target_os = "windows")]
    {
        windows_defender_scan(path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        ScanResult {
            clean: true,
            engine: "none".to_string(),
            detail: "Virus scanning requires Windows (Windows Defender). Not available on this platform.".to_string(),
            skipped: true,
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_defender_scan(path: &str) -> ScanResult {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
    let candidates = [
        format!(r"{pf}\Windows Defender\MpCmdRun.exe"),
        format!(r"{pf86}\Windows Defender\MpCmdRun.exe"),
    ];
    let exe = match candidates.iter().find(|p| std::path::Path::new(p.as_str()).exists()) {
        Some(e) => e,
        None => {
            return ScanResult {
                clean: true,
                engine: "none".to_string(),
                detail: "Windows Defender (MpCmdRun.exe) not found — scan skipped".to_string(),
                skipped: true,
            };
        }
    };

    match std::process::Command::new(exe)
        .args(["-Scan", "-ScanType", "3", "-File", path])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(out) => match out.status.code().unwrap_or(-1) {
            0 => ScanResult {
                clean: true,
                engine: "Windows Defender".to_string(),
                detail: "No threats detected".to_string(),
                skipped: false,
            },
            2 => ScanResult {
                clean: false,
                engine: "Windows Defender".to_string(),
                detail: "Threat detected — Windows Defender flagged this file as malicious".to_string(),
                skipped: false,
            },
            c => ScanResult {
                clean: true,
                engine: "Windows Defender".to_string(),
                detail: format!("Scan inconclusive (exit {c}) — treating file as safe"),
                skipped: true,
            },
        },
        Err(e) => ScanResult {
            clean: true,
            engine: "Windows Defender".to_string(),
            detail: format!("Scan error: {e} — treating file as safe"),
            skipped: true,
        },
    }
}

// ─── Windows shell integration ("Share in PeerChat" right-click) ──────────────

/// Write HKCU shell verb so "Share in PeerChat" appears on right-click for all files.
/// exe_path should be the full path to PeerChat.exe.
#[tauri::command]
fn install_shell_extension(exe_path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        shell_verb_write(&exe_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Shell integration is only available on Windows".into())
    }
}

/// Remove the HKCU shell verb.
#[tauri::command]
fn uninstall_shell_extension() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        shell_verb_remove()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Shell integration is only available on Windows".into())
    }
}

#[cfg(target_os = "windows")]
fn shell_verb_write(exe_path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let verb_key = r"HKCU\Software\Classes\*\shell\ShareInPeerChat";
    let cmd_key = format!(r"{verb_key}\command");

    let run = |args: &[&str]| -> bool {
        std::process::Command::new("reg")
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };

    run(&["add", verb_key, "/ve", "/d", "Share in PeerChat", "/f"]);
    run(&["add", verb_key, "/v", "Icon", "/d", &format!("{exe_path},0"), "/f"]);
    let cmd_val = format!("\"{exe_path}\" --share \"%1\"");
    run(&["add", &cmd_key, "/ve", "/d", &cmd_val, "/f"]);

    Ok(())
}

#[cfg(target_os = "windows")]
fn shell_verb_remove() -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let _ = std::process::Command::new("reg")
        .args(["delete", r"HKCU\Software\Classes\*\shell\ShareInPeerChat", "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    Ok(())
}

/// Check whether the shell verb is currently registered.
#[tauri::command]
fn shell_extension_installed() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Classes\*\shell\ShareInPeerChat"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app
                .path()
                .app_data_dir()
                .map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&data).ok();
            let db_path = data.join("lanmsg.sqlite");
            let conn = db::open(&db_path)?;
            let shared: SharedDb = Arc::new(Mutex::new(conn));
            app.manage(AppState {
                db: shared.clone(),
                data_dir: data.clone(),
                discovery: DiscoveryHub::default(),
                stop_tx: Mutex::new(None),
                fingerprint: Mutex::new(String::new()),
                started: Mutex::new(false),
                live_display_name: Arc::new(Mutex::new(String::new())),
            });
            // auto-start if profile exists (drop DB lock before starting runtime —
            // holding it across start_runtime_inner deadlocks on the same Mutex).
            let existing = {
                let conn = shared.lock();
                db::get_profile(&conn).ok().flatten()
            };
            if let Some(p) = existing {
                let state = app.state::<AppState>();
                let _ = start_runtime_inner(
                    &app.handle().clone(),
                    &state,
                    p["id"].as_str().unwrap_or(""),
                    p["display_name"].as_str().unwrap_or(""),
                    p["x25519_public"].as_str().unwrap_or(""),
                    p["ed25519_public"].as_str().unwrap_or(""),
                    p["listen_port"].as_u64().unwrap_or(9876) as u16,
                );
            }

            // Handle --share <file> [<file>...] launched from the right-click context menu.
            // We delay the emit slightly so the React app has time to mount its listener.
            let raw_args: Vec<String> = std::env::args().collect();
            if let Some(pos) = raw_args.iter().position(|a| a == "--share") {
                let files: Vec<String> = raw_args[pos + 1..]
                    .iter()
                    .take_while(|a| !a.starts_with("--"))
                    .cloned()
                    .collect();
                if !files.is_empty() {
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_millis(900)).await;
                        let _ = handle.emit("share-files", files);
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_profile,
            setup_profile,
            update_display_name,
            set_conversation_pinned,
            set_conversation_muted,
            list_pinned_messages,
            get_notifications_enabled,
            set_notifications_enabled,
            conversation_is_muted,
            my_fingerprint,
            discover_peers,
            list_lan_hosts,
            list_peers,
            pin_peer,
            list_conversations,
            open_dm,
            create_group,
            list_messages,
            retry_message,
            delete_message_for_me,
            delete_message_for_everyone,
            abort_outgoing_file,
            mark_conversation_read,
            send_message,
            get_group_key,
            member_ids,
            list_group_members,
            add_group_members,
            remove_group_member,
            leave_group,
            rename_group,
            delete_group,
            set_group_members_can_add,
            set_group_member_role,
            send_typing,
            create_outgoing_file,
            write_file_chunk,
            set_file_content_hash,
            send_file_notice,
            fetch_file_chunk,
            ack_file_download,
            get_file,
            save_downloaded_file,
            begin_file_receive,
            append_file_receive,
            finalize_file_receive,
            get_receive_progress,
            open_local_file,
            read_local_file,
            tls_fingerprint_peer,
            get_app_setting,
            set_app_setting,
            accept_pending_identity,
            upsert_transfer,
            list_transfers,
            save_item,
            delete_saved_item,
            list_saved_items,
            peer_delivery_error,
            verify_downloaded_file,
            discard_file_receive,
            list_directory_files,
            pack_bundle,
            read_bundle_chunk,
            delete_bundle_file,
            scan_file,
            install_shell_extension,
            uninstall_shell_extension,
            shell_extension_installed,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PeerChat");
}

#[cfg(test)]
mod path_tests {
    use super::safe_download_name;

    #[test]
    fn rejects_path_traversal_names() {
        let n = safe_download_name("../etc/passwd");
        assert!(!n.contains(".."));
        assert_ne!(n, "download.bin");
        let n2 = safe_download_name("..\\secret.txt");
        assert!(!n2.contains(".."));
        assert_eq!(safe_download_name(""), "download.bin");
        assert_eq!(safe_download_name("notes.pdf"), "notes.pdf");
    }
}
