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
use tauri::{AppHandle, Manager, State};

struct AppState {
    db: SharedDb,
    data_dir: PathBuf,
    discovery: DiscoveryHub,
    stop_tx: Mutex<Option<tokio::sync::watch::Sender<bool>>>,
    fingerprint: Mutex<String>,
    started: Mutex<bool>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
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
    state: State<AppState>,
    display_name: String,
    user_id: String,
    x25519_public: String,
    ed25519_public: String,
    listen_port: Option<i64>,
) -> Result<Value, String> {
    let port = listen_port.unwrap_or(9876);
    {
        let conn = state.db.lock();
        db::upsert_profile(
            &conn,
            &user_id,
            &display_name,
            &x25519_public,
            &ed25519_public,
            port,
        )?;
    }
    start_runtime_inner(&state, &user_id, &display_name, &x25519_public, &ed25519_public, port as u16)?;
    let conn = state.db.lock();
    db::get_profile(&conn)?.ok_or_else(|| "profile missing".into())
}

fn start_runtime_inner(
    state: &AppState,
    user_id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    port: u16,
) -> Result<(), String> {
    let mut started = state.started.lock();
    if *started {
        return Ok(());
    }
    let cert = tls_cert::ensure(&state.data_dir)?;
    *state.fingerprint.lock() = cert.fingerprint.clone();
    peer_http::spawn_listener(cert.clone(), port, state.db.clone(), user_id.to_string())?;

    let (tx, rx) = tokio::sync::watch::channel(false);
    *state.stop_tx.lock() = Some(tx);
    let hub = state.discovery.clone();
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
        discovery::run_beacon(hub, port, 41234, rx, beacon).await;
    });

    // outbox flusher
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            flush_outbox(&db).await;
        }
    });

    *started = true;
    Ok(())
}

async fn flush_outbox(db: &SharedDb) {
    let pending = {
        let conn = db.lock();
        db::pending_outbox(&conn).unwrap_or_default()
    };
    for item in pending {
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
        let Some(ip) = peer["last_ip"].as_str() else {
            continue;
        };
        let Some(port) = peer["last_port"].as_u64() else {
            continue;
        };
        if !peer["online"].as_bool().unwrap_or(false) && peer["last_ip"].is_null() {
            continue;
        }
        let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
        let Ok(payload) = serde_json::from_str::<Value>(&payload_str) else {
            continue;
        };
        match peer_http::peer_request(ip, port as u16, "/v1/deliver", Some(payload), fp).await {
            Ok((resp, _)) if resp.get("ok").and_then(|v| v.as_bool()) == Some(true) => {
                let conn = db.lock();
                let _ = db::mark_outbox_delivered(&conn, &id);
            }
            Ok(_) | Err(_) => {
                let err = "deliver failed".to_string();
                let conn = db.lock();
                let _ = db::bump_outbox_error(&conn, &id, &err);
            }
        }
    }
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
    {
        let conn = state.db.lock();
        for p in map.values() {
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
            out.push(json!({
                "user_id": p.user_id,
                "display_name": p.display_name,
                "x25519_public": p.x25519_public,
                "ed25519_public": p.ed25519_public,
                "last_ip": p.ip,
                "last_port": p.port,
                "tls_fingerprint": p.fingerprint,
                "online": true,
            }));
        }
    }
    Ok(out)
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
fn send_message(state: State<AppState>, conversation_id: String, message: Value, recipient_ids: Vec<String>) -> Result<Value, String> {
    let mut msg = message;
    if msg.get("id").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        msg["id"] = json!(uuid::Uuid::new_v4().to_string());
    }
    if msg.get("created_at").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        msg["created_at"] = json!(now());
    }
    msg["conversation_id"] = json!(conversation_id);
    msg["delivered"] = json!(false);

    let profile = {
        let conn = state.db.lock();
        db::insert_message(&conn, &msg)?;
        db::get_profile(&conn)?.ok_or("no profile")?
    };

    let from_peer = json!({
        "user_id": profile["id"],
        "display_name": profile["display_name"],
        "x25519_public": profile["x25519_public"],
        "ed25519_public": profile["ed25519_public"],
        "last_port": profile["listen_port"],
        "tls_fingerprint": state.fingerprint.lock().clone(),
        "last_ip": discovery::lan_ip(),
    });

    {
        let conn = state.db.lock();
        let me = profile["id"].as_str().unwrap_or("");
        let title = conn
            .query_row(
                "SELECT title FROM conversations WHERE id=?1",
                rusqlite::params![conversation_id.as_str()],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten();
        for rid in recipient_ids {
            if rid == me {
                continue;
            }
            let out_id = msg["id"].as_str().unwrap_or("").to_string();
            let oid = format!("{out_id}:{rid}");
            let mut payload = json!({
                "message": msg,
                "from_peer": from_peer,
                "conversation_id": conversation_id,
            });
            // Each recipient needs their own wrapped group key copy
            if let Ok(Some(w)) = db::get_wrapped_group_key(&conn, conversation_id.as_str(), &rid) {
                payload["wrapped_group_key"] = json!(w);
            }
            if let Some(ref t) = title {
                payload["group_title"] = json!(t);
            }
            db::enqueue_outbox(
                &conn,
                &oid,
                &rid,
                conversation_id.as_str(),
                &payload.to_string(),
            )?;
        }
    }
    // kick flush
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        flush_outbox(&db).await;
    });
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
) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    if user_id == me {
        return Err("use leave to exit the group".into());
    }
    let title = db::conversation_title(&conn, &conversation_id)?
        .unwrap_or_else(|| "Group".into());
    let notify = db::member_ids(&conn, &conversation_id)?;
    db::delete_member(&conn, &conversation_id, &user_id)?;
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in notify {
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
            "remove",
            Some(user_id.as_str()),
        )?;
    }
    drop(conn);
    kick_flush(&state);
    Ok(())
}

#[tauri::command]
fn leave_group(state: State<AppState>, conversation_id: String) -> Result<(), String> {
    let conn = state.db.lock();
    let profile = db::get_profile(&conn)?.ok_or("no profile")?;
    let me = profile["id"].as_str().unwrap_or("").to_string();
    let title = db::conversation_title(&conn, &conversation_id)?
        .unwrap_or_else(|| "Group".into());
    let notify = db::member_ids(&conn, &conversation_id)?;
    db::delete_member(&conn, &conversation_id, &me)?;
    let roster = Value::Array(db::list_members(&conn, &conversation_id)?);
    let from_peer = from_peer_json(&profile, &state.fingerprint.lock());
    for rid in notify {
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
            "remove",
            Some(me.as_str()),
        )?;
    }
    drop(conn);
    kick_flush(&state);
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
) -> Result<FileCreateResult, String> {
    let profile = {
        let conn = state.db.lock();
        db::get_profile(&conn)?.ok_or("no profile")?
    };
    let file_id = uuid::Uuid::new_v4().to_string();
    let staging = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("staging")
        .join(&file_id);
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
fn write_file_chunk(
    staging_dir: String,
    index: u32,
    data_b64: String,
    nonce: String,
) -> Result<(), String> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;
    let dir = PathBuf::from(staging_dir);
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
        "created_at": now(),
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
    let ip = peer["last_ip"].as_str().ok_or("no ip")?;
    let port = peer["last_port"].as_u64().ok_or("no port")? as u16;
    let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
    let body = json!({"file_id": file_id, "index": index});
    let (resp, _) = peer_http::peer_request(ip, port, "/v1/file/chunk", Some(body), fp).await?;
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
    let name = if safe.trim().is_empty() {
        "download.bin".into()
    } else {
        safe
    };
    let base = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("LanMsg");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut path = dir.join(&name);
    if path.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        path = dir.join(format!("{name}-{stamp}"));
    }
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    if let Some(file_id) = file_id {
        let conn = state.db.lock();
        db::set_file_local_path(&conn, &file_id, &path.display().to_string())?;
    }
    Ok(path.display().to_string())
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
    std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
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
            });
            // auto-start if profile exists
            if let Ok(Some(p)) = db::get_profile(&shared.lock()) {
                let state = app.state::<AppState>();
                let _ = start_runtime_inner(
                    &state,
                    p["id"].as_str().unwrap_or(""),
                    p["display_name"].as_str().unwrap_or(""),
                    p["x25519_public"].as_str().unwrap_or(""),
                    p["ed25519_public"].as_str().unwrap_or(""),
                    p["listen_port"].as_u64().unwrap_or(9876) as u16,
                );
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_profile,
            setup_profile,
            my_fingerprint,
            discover_peers,
            list_peers,
            pin_peer,
            list_conversations,
            open_dm,
            create_group,
            list_messages,
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
            create_outgoing_file,
            write_file_chunk,
            send_file_notice,
            fetch_file_chunk,
            ack_file_download,
            get_file,
            save_downloaded_file,
            open_local_file,
            read_local_file,
            tls_fingerprint_peer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LanMsg");
}
