#![allow(unused_imports)]
use crate::commands::peers::FileCreateResult;
use base64::Engine;
use rusqlite::OptionalExtension;
use crate::tls_cert;
use crate::discovery::{self, DiscoveryHub, PeerBeacon};
use crate::db;
use crate::runtime;
use crate::state::AppState;
use crate::util;
use crate::peer_http::{self, SharedDb};
use crate::bundle;
use parking_lot::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::util::*;
use crate::runtime::outbox::{kick_flush, kick_flush_for_peer, flush_outbox};
use crate::runtime::group_events::{enqueue_group_event, enqueue_group_event_extra};
use crate::runtime::bootstrap::{start_runtime_inner, show_main_window};

#[tauri::command]
pub fn abort_outgoing_file(state: State<AppState>, file_id: String) -> Result<(), String> {
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
pub fn create_outgoing_file(
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
pub fn set_file_content_hash(
    state: State<AppState>,
    file_id: String,
    content_sha256: String,
) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_file_content_hash(&conn, &file_id, &content_sha256)
}

#[tauri::command]
pub fn write_file_chunk(
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

#[derive(Serialize)]
pub struct StageOutgoingResult {
    pub content_sha256: String,
    pub bytes_written: u64,
    pub chunk_count: u32,
}

/// Native path staging: read → AES-GCM (v2 AAD) → staging dir. Avoids JS Base64 IPC.
#[tauri::command]
pub fn stage_outgoing_from_path(
    app: AppHandle,
    state: State<AppState>,
    file_id: String,
    path: String,
    content_key_b64: String,
) -> Result<StageOutgoingResult, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let content_key = base64::engine::general_purpose::STANDARD
        .decode(content_key_b64.trim())
        .map_err(|e| e.to_string())?;
    if content_key.len() != 32 {
        return Err("content key must be 32 bytes".into());
    }

    let src = PathBuf::from(&path);
    if !src.is_file() {
        return Err("source file missing or not a regular file".into());
    }
    let meta = std::fs::metadata(&src).map_err(explain_io)?;
    let size = meta.len();
    if size == 0 || size > MAX_FILE_BYTES as u64 {
        return Err(format!("file size must be 1..{MAX_FILE_BYTES} bytes"));
    }
    let expected_chunks = ((size + PLAIN_CHUNK_BYTES as u64 - 1) / PLAIN_CHUNK_BYTES as u64) as u32;
    if expected_chunks == 0 || expected_chunks as i64 > MAX_CHUNKS {
        return Err(format!("chunk_count must be 1..{MAX_CHUNKS}"));
    }

    {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("");
        let file = db::get_file(&conn, &file_id)?.ok_or("file missing")?;
        if file["uploader_id"].as_str() != Some(me) {
            return Err("only uploader may stage outgoing file".into());
        }
        let declared = file["chunk_count"].as_i64().unwrap_or(0) as u32;
        if declared != expected_chunks {
            return Err(format!(
                "chunk_count mismatch (meta {declared}, path implies {expected_chunks})"
            ));
        }
    }

    let dir = resolve_staging_dir(&app, &file_id)?;
    std::fs::create_dir_all(&dir).map_err(explain_io)?;

    let (cancel_flag, pause_flag) = peer_http::register_stage_controls(&file_id);
    let stage_result = (|| {
        let mut file = std::fs::File::open(&src).map_err(explain_io)?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; PLAIN_CHUNK_BYTES];
        let mut index: u32 = 0;
        let mut bytes_written: u64 = 0;

        loop {
            // Cooperative pause — UI freezes; resume clears the flag.
            while pause_flag.load(std::sync::atomic::Ordering::SeqCst) {
                if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                    return Err("aborted".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if cancel_flag.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("aborted".into());
            }

            let mut filled = 0usize;
            while filled < PLAIN_CHUNK_BYTES {
                let n = file.read(&mut buf[filled..]).map_err(explain_io)?;
                if n == 0 {
                    break;
                }
                filled += n;
            }
            if filled == 0 {
                break;
            }
            let plain = &buf[..filled];
            hasher.update(plain);
            let (nonce_b64, ciphertext) =
                peer_http::encrypt_file_chunk(&content_key, plain, Some(index))?;
            if ciphertext.len() > MAX_CHUNK_BYTES {
                return Err(format!("encrypted chunk exceeds {MAX_CHUNK_BYTES} bytes"));
            }
            std::fs::write(dir.join(format!("{index}.chunk")), &ciphertext).map_err(explain_io)?;
            std::fs::write(dir.join(format!("{index}.nonce")), nonce_b64.as_bytes())
                .map_err(explain_io)?;
            bytes_written += filled as u64;
            index += 1;
            let _ = app.emit(
                "file-stage-progress",
                json!({
                    "file_id": file_id,
                    "done": index,
                    "total": expected_chunks,
                    "bytes_done": bytes_written,
                }),
            );
            if filled < PLAIN_CHUNK_BYTES {
                break;
            }
        }

        if index == 0 {
            return Err("empty file after read".into());
        }
        if index != expected_chunks {
            return Err(format!(
                "staged {index} chunks but expected {expected_chunks}"
            ));
        }

        let digest = hex::encode(hasher.finalize());
        {
            let conn = state.db.lock();
            db::set_file_content_hash(&conn, &file_id, &digest)?;
            db::set_file_local_path(&conn, &file_id, &path)?;
        }

        Ok(StageOutgoingResult {
            content_sha256: digest,
            bytes_written,
            chunk_count: index,
        })
    })();
    peer_http::clear_stage_controls(&file_id);
    stage_result
}

#[tauri::command]
pub fn request_stage_cancel(file_id: String) -> Result<(), String> {
    peer_http::request_stage_cancel(&file_id);
    Ok(())
}

#[tauri::command]
pub fn request_stage_pause(file_id: String) -> Result<(), String> {
    peer_http::request_stage_pause(&file_id);
    Ok(())
}

#[tauri::command]
pub fn clear_stage_pause(file_id: String) -> Result<(), String> {
    peer_http::clear_stage_pause(&file_id);
    Ok(())
}

#[tauri::command]
pub fn send_file_notice(
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
pub async fn fetch_file_chunk(
    state: State<'_, AppState>,
    file_id: String,
    index: u32,
    uploader_id: String,
) -> Result<Value, String> {
    let batch = fetch_file_chunks(state, file_id, index, 1, uploader_id).await?;
    batch
        .into_iter()
        .next()
        .ok_or_else(|| "missing chunk".to_string())
}

/// IPMsg-style binary stream download: decrypt on the wire path, append to receive temp.
/// Falls back is handled by the frontend when this errors (old peers).
#[tauri::command]
pub async fn download_file_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    file_id: String,
    uploader_id: String,
    content_key_b64: String,
    from_index: u32,
) -> Result<Value, String> {
    let content_key = base64::engine::general_purpose::STANDARD
        .decode(content_key_b64.trim())
        .map_err(|e| e.to_string())?;
    if content_key.len() != 32 {
        return Err("invalid content key".into());
    }
    let (temp_path, total_chunks, crypto_v, expected) = {
        let conn = state.db.lock();
        let prog = db::get_receive_progress(&conn, &file_id)?.ok_or("receive not started")?;
        let expected = prog.0;
        let temp = prog.1.ok_or("missing temp path")?;
        let meta = db::get_file(&conn, &file_id)?.ok_or("file missing")?;
        let total = meta["chunk_count"].as_i64().unwrap_or(0).max(0) as u32;
        let crypto_v = meta["file_crypto_v"].as_i64().unwrap_or(1);
        (PathBuf::from(temp), total, crypto_v, expected)
    };
    if from_index as i64 != expected {
        return Err(format!("expected chunk {expected}, got {from_index}"));
    }
    let peer = {
        let conn = state.db.lock();
        db::get_peer(&conn, &uploader_id)?.ok_or("uploader offline/unknown")?
    };
    let ip = peer["last_ip"]
        .as_str()
        .filter(|s| discovery::is_usable_lan_ip(s))
        .ok_or("no ip")?
        .to_string();
    let port = peer["last_port"]
        .as_u64()
        .or_else(|| peer["last_port"].as_i64().map(|p| p as u64))
        .ok_or("no port")? as u16;
    let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
    let db = state.db.clone();
    let fid = file_id.clone();
    let temp_s = temp_path.display().to_string();
    let cancel = peer_http::register_stream_cancel(&file_id);
    let next = peer_http::stream_download_and_append(
        &ip,
        port,
        fp,
        &file_id,
        from_index,
        &content_key,
        crypto_v,
        &temp_path,
        total_chunks,
        &app,
        cancel,
        |done| {
            let conn = db.lock();
            db::upsert_receive_progress(&conn, &fid, done as i64, Some(&temp_s))
        },
    )
    .await;
    peer_http::clear_stream_cancel(&file_id);
    let next = next.map_err(|e| format!("stream download failed: {e}"))?;
    Ok(json!({ "next_index": next, "total": total_chunks }))
}

#[tauri::command]
pub fn cancel_file_stream(file_id: String) -> Result<(), String> {
    peer_http::request_stream_cancel(&file_id);
    Ok(())
}

/// Pull `count` encrypted chunks (from `from_index`) over one TLS keep-alive session.
#[tauri::command]
pub async fn fetch_file_chunks(
    state: State<'_, AppState>,
    file_id: String,
    from_index: u32,
    count: u32,
    uploader_id: String,
) -> Result<Vec<Value>, String> {
    let count = count.min(64).max(1);
    // Prefer local staging when we are the uploader / already have chunks on disk.
    let local = {
        let conn = state.db.lock();
        db::get_file(&conn, &file_id).ok().flatten()
    };
    if let Some(meta) = local {
        if let Some(dir) = meta["staging_dir"].as_str() {
            let dir = PathBuf::from(dir);
            let mut out = Vec::new();
            let mut all_local = true;
            for i in 0..count {
                let index = from_index + i;
                let path = dir.join(format!("{index}.chunk"));
                let nonce_path = dir.join(format!("{index}.nonce"));
                if !path.is_file() {
                    all_local = false;
                    break;
                }
                let data = std::fs::read(&path).map_err(|e| e.to_string())?;
                let nonce = std::fs::read_to_string(&nonce_path).unwrap_or_default();
                out.push(json!({
                    "index": index,
                    "nonce": nonce,
                    "data_b64": base64::engine::general_purpose::STANDARD.encode(data),
                }));
            }
            if all_local && out.len() == count as usize {
                return Ok(out);
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
        .ok_or("no ip")?
        .to_string();
    let port = peer["last_port"]
        .as_u64()
        .or_else(|| peer["last_port"].as_i64().map(|p| p as u64))
        .ok_or("no port")? as u16;
    let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
    peer_http::fetch_chunks_keep_alive(&ip, port, fp, &file_id, from_index, count)
        .await
        .map_err(|e| format!("connect to sender failed: {e}"))
}

#[tauri::command]
pub async fn ack_file_download(
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
pub fn get_file(state: State<AppState>, file_id: String) -> Result<Option<Value>, String> {
    let conn = state.db.lock();
    db::get_file(&conn, &file_id)
}

#[tauri::command]
pub fn get_files(state: State<AppState>, file_ids: Vec<String>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    let mut out = Vec::with_capacity(file_ids.len());
    for fid in file_ids {
        if let Some(mut f) = db::get_file(&conn, &fid)? {
            let path = f["local_path"].as_str().unwrap_or("").trim();
            let present = !path.is_empty() && std::path::Path::new(path).is_file();
            if !path.is_empty() && !present {
                let _ = db::set_file_local_path(&conn, &fid, "");
                f["local_path"] = Value::Null;
            }
            f["local_path_present"] = json!(present);
            out.push(f);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn save_downloaded_file(
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
pub fn begin_file_receive(app: AppHandle, state: State<AppState>, file_id: String) -> Result<Value, String> {
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
pub fn append_file_receive(
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
pub fn finalize_file_receive(
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
pub fn get_receive_progress(state: State<AppState>, file_id: String) -> Result<Value, String> {
    let conn = state.db.lock();
    match db::get_receive_progress(&conn, &file_id)? {
        Some((next, temp)) => Ok(json!({ "next_index": next, "temp_path": temp })),
        None => Ok(json!({ "next_index": 0, "temp_path": Value::Null })),
    }
}

/// Copy an existing plaintext file into the durable outgoing cache and pin
/// `local_path` there. Used for annotated screenshots (temp `captures/`) so
/// thumbs survive chat switches after the staging capture is discarded.
#[tauri::command]
pub fn persist_outgoing_from_path(
    app: AppHandle,
    state: State<AppState>,
    file_id: String,
    source_path: String,
    filename: Option<String>,
) -> Result<String, String> {
    if file_id.is_empty()
        || file_id.contains("..")
        || file_id.contains('/')
        || file_id.contains('\\')
    {
        return Err("invalid file id".into());
    }
    let src = PathBuf::from(source_path.trim());
    if !src.is_file() {
        return Err("source file missing".into());
    }
    let filename = {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("");
        let file = db::get_file(&conn, &file_id)?.ok_or("file missing")?;
        if file["uploader_id"].as_str() != Some(me) {
            return Err("only uploader may persist outgoing plaintext".into());
        }
        // Already durable and present — keep it (do not re-copy from a temp path).
        if let Some(p) = file["local_path"].as_str().filter(|p| !p.is_empty()) {
            let existing = PathBuf::from(p);
            if existing.is_file() {
                let under_outgoing = existing
                    .components()
                    .any(|c| c.as_os_str() == std::ffi::OsStr::new("outgoing"));
                if under_outgoing && existing != src {
                    return Ok(p.to_string());
                }
            }
        }
        filename
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                src.file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| "file.bin".into())
    };
    let name = safe_download_name(&filename);
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("outgoing")
        .join(&file_id);
    std::fs::create_dir_all(&dir).map_err(explain_io)?;
    let dest = dir.join(&name);
    if !dest.starts_with(&dir) {
        return Err("invalid destination".into());
    }
    if src != dest {
        std::fs::copy(&src, &dest).map_err(explain_io)?;
    }
    let path_str = dest.display().to_string();
    {
        let conn = state.db.lock();
        db::set_file_local_path(&conn, &file_id, &path_str)?;
    }
    Ok(path_str)
}

/// Persist a plaintext copy of an outgoing file when the WebView picker did not
/// expose a real disk path (common on Windows). Enables reopen + thumbs later.
#[tauri::command]
pub fn cache_outgoing_plain(
    app: AppHandle,
    state: State<AppState>,
    file_id: String,
    filename: String,
    data_b64: String,
) -> Result<String, String> {
    if file_id.is_empty()
        || file_id.contains("..")
        || file_id.contains('/')
        || file_id.contains('\\')
    {
        return Err("invalid file id".into());
    }
    {
        let conn = state.db.lock();
        let profile = db::get_profile(&conn)?.ok_or("no profile")?;
        let me = profile["id"].as_str().unwrap_or("");
        let file = db::get_file(&conn, &file_id)?.ok_or("file missing")?;
        if file["uploader_id"].as_str() != Some(me) {
            return Err("only uploader may cache outgoing plaintext".into());
        }
        // Already have a usable path — keep it.
        if let Some(p) = file["local_path"].as_str().filter(|p| !p.is_empty()) {
            if PathBuf::from(p).is_file() {
                return Ok(p.to_string());
            }
        }
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| e.to_string())?;
    if data.len() > MAX_FILE_BYTES as usize {
        return Err("decoded file exceeds size limit".into());
    }
    let name = safe_download_name(&filename);
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("outgoing")
        .join(&file_id);
    std::fs::create_dir_all(&dir).map_err(explain_io)?;
    let path = dir.join(&name);
    if !path.starts_with(&dir) {
        return Err("invalid destination".into());
    }
    std::fs::write(&path, &data).map_err(explain_io)?;
    let path_str = path.display().to_string();
    {
        let conn = state.db.lock();
        db::set_file_local_path(&conn, &file_id, &path_str)?;
    }
    Ok(path_str)
}

#[tauri::command]
pub fn open_local_file(state: State<AppState>, file_id: String) -> Result<(), String> {
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
        let conn = state.db.lock();
        let _ = db::set_file_local_path(&conn, &file_id, "");
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
pub fn read_local_file(state: State<AppState>, file_id: String) -> Result<String, String> {
    let path = {
        let conn = state.db.lock();
        let file = db::get_file(&conn, &file_id)?.ok_or("file metadata missing")?;
        file["local_path"]
            .as_str()
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .ok_or("No local copy is available")?
    };
    let data = match std::fs::read(&path) {
        Ok(d) => d,
        Err(e) => {
            let conn = state.db.lock();
            let _ = db::set_file_local_path(&conn, &file_id, "");
            return Err(e.to_string());
        }
    };
    Ok(base64::engine::general_purpose::STANDARD.encode(data))
}

/// Generate or reuse a ~256px JPEG thumb under app_data/thumbs/{file_id}.jpg.
#[tauri::command]
pub fn ensure_file_thumbnail(
    app: AppHandle,
    state: State<AppState>,
    file_id: String,
) -> Result<Value, String> {
    let path = {
        let conn = state.db.lock();
        let file = db::get_file(&conn, &file_id)?.ok_or("file metadata missing")?;
        let p = file["local_path"]
            .as_str()
            .filter(|p| !p.is_empty())
            .map(PathBuf::from)
            .ok_or("No local copy is available")?;
        if !p.is_file() {
            let _ = db::set_file_local_path(&conn, &file_id, "");
            return Err("The local file has been moved or deleted".into());
        }
        p
    };
    let thumbs = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    std::fs::create_dir_all(&thumbs).map_err(|e| e.to_string())?;
    let thumb_path = thumbs.join(format!("{file_id}.jpg"));

    let src_meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let src_len = src_meta.len();
    // Skip absurd sources for chat thumbs.
    if src_len > 40 * 1024 * 1024 {
        return Err("source too large for thumbnail".into());
    }
    let need_regen = match std::fs::metadata(&thumb_path) {
        Ok(tm) => {
            let src_mtime = src_meta.modified().ok();
            let tm_mtime = tm.modified().ok();
            match (src_mtime, tm_mtime) {
                (Some(s), Some(t)) => s > t || tm.len() < 32,
                _ => tm.len() < 32,
            }
        }
        Err(_) => true,
    };
    if need_regen {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(ext.as_str(), "mp4" | "webm" | "mov" | "mkv" | "avi") {
            return Err("video thumbnail not available".into());
        }
        let img = image::open(&path).map_err(|e| format!("thumb decode: {e}"))?;
        let thumb = img.thumbnail(256, 256);
        let rgb = thumb.to_rgb8();
        let mut out = std::fs::File::create(&thumb_path).map_err(|e| e.to_string())?;
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 72);
        enc.encode(
            rgb.as_raw(),
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("thumb encode: {e}"))?;
    }
    let bytes = std::fs::read(&thumb_path).map_err(|e| e.to_string())?;
    Ok(json!({
        "file_id": file_id,
        "mime": "image/jpeg",
        "data_b64": base64::engine::general_purpose::STANDARD.encode(bytes),
    }))
}

#[tauri::command]
pub fn verify_downloaded_file(state: State<AppState>, file_id: String) -> Result<Value, String> {
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
pub fn discard_file_receive(state: State<AppState>, file_id: String) -> Result<(), String> {
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
pub fn list_directory_files(root: String) -> Result<Vec<Value>, String> {
    bundle::list_tree(std::path::Path::new(&root))
}

#[tauri::command]
pub async fn pack_bundle(app: AppHandle, entries: Vec<bundle::BundleEntry>) -> Result<Value, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bundles");
    std::fs::create_dir_all(&dir).map_err(explain_io)?;
    let id = uuid::Uuid::new_v4().to_string();
    let path = dir.join(format!("{id}.zip"));
    let path_str = path.display().to_string();
    let name = format!("bundle-{}.zip", &id[..8]);
    let app_progress = app.clone();
    // Off the async runtime so Deflate/disk work cannot freeze the WebView.
    let result = tokio::task::spawn_blocking(move || {
        bundle::pack_with_progress(&path, &entries, |done, total, bytes| {
            // Throttle UI events a bit for huge trees.
            if done == total || done == 1 || done % 5 == 0 {
                let _ = app_progress.emit(
                    "bundle-pack-progress",
                    json!({
                        "done_files": done,
                        "total_files": total,
                        "bytes": bytes,
                    }),
                );
            }
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    let (size, count) = result;
    Ok(json!({
        "path": path_str,
        "size": size,
        "count": count,
        "name": name,
    }))
}

#[tauri::command]
pub fn read_bundle_chunk(app: AppHandle, path: String, offset: u64, len: u32) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bundles");
    let bytes = bundle::read_under(base.as_path(), std::path::Path::new(&path), offset, len as usize)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Read a chunk from any regular local file (drag-drop / share paths outside bundles/).
#[tauri::command]
pub fn read_file_chunk(path: String, offset: u64, len: u32) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    if len == 0 || (len as usize) > MAX_CHUNK_BYTES {
        return Err(format!("invalid read length (max {MAX_CHUNK_BYTES} bytes)"));
    }
    let p = std::path::PathBuf::from(&path);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("refusing symbolic link".into());
    }
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let mut file = std::fs::File::open(&p).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; len as usize];
    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);
    Ok(base64::engine::general_purpose::STANDARD.encode(buf))
}

#[tauri::command]
pub fn delete_bundle_file(app: AppHandle, path: String) -> Result<(), String> {
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
pub struct ScanResult {
    pub clean: bool,
    pub engine: String,
    pub detail: String,
    pub skipped: bool,
}

#[derive(Serialize)]
pub struct LocalPathMeta {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

/// Stat a local path for drag-drop / share staging (size + basename).
#[tauri::command]
pub fn local_path_meta(path: String) -> Result<LocalPathMeta, String> {
    let p = std::path::Path::new(&path);
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    Ok(LocalPathMeta {
        path,
        name,
        size: meta.len(),
        is_dir: meta.is_dir(),
    })
}

/// Common media / document types that rarely carry executable payloads.
/// Skipping Defender preflight avoids false alarms on screenshots & photos.
fn is_low_risk_attachment(path: &str) -> bool {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "bmp"
            | "ico"
            | "svg"
            | "heic"
            | "heif"
            | "mp4"
            | "webm"
            | "mov"
            | "mkv"
            | "avi"
            | "mp3"
            | "wav"
            | "ogg"
            | "flac"
            | "m4a"
            | "txt"
            | "md"
            | "csv"
            | "json"
    )
}

fn defender_output_looks_like_threat(stdout: &str, stderr: &str) -> bool {
    let blob = format!("{stdout}\n{stderr}").to_ascii_lowercase();
    if blob.trim().is_empty() {
        return false;
    }
    // Require concrete threat language — MpCmdRun exit 2 is also used for generic failures.
    let has_threat_word = [
        "threat detected",
        "threat found",
        "malware",
        "trojan",
        "virus",
        "worm",
        "spyware",
        "ransomware",
        "found a threat",
        "detection name",
    ]
    .iter()
    .any(|k| blob.contains(k));
    has_threat_word
}

/// Scan a file path with the system AV (Windows Defender on Windows).
/// Returns {clean, engine, detail, skipped}. Never returns Err — on failure
/// the result is skipped=true so the caller can decide how to proceed.
#[tauri::command]
pub fn scan_file(path: String) -> ScanResult {
    scan_file_inner(&path)
}

pub fn scan_file_inner(path: &str) -> ScanResult {
    if is_low_risk_attachment(path) {
        return ScanResult {
            clean: true,
            engine: "none".to_string(),
            detail: "Skipped — common media/document type".to_string(),
            skipped: true,
        };
    }
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
pub fn windows_defender_scan(path: &str) -> ScanResult {
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
        Ok(out) => {
            let code = out.status.code().unwrap_or(-1);
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);
            let snippet = {
                let s = format!("{stdout}{stderr}").trim().to_string();
                if s.is_empty() {
                    String::new()
                } else {
                    s.chars().take(280).collect()
                }
            };
            match code {
                0 => ScanResult {
                    clean: true,
                    engine: "Windows Defender".to_string(),
                    detail: "No threats detected".to_string(),
                    skipped: false,
                },
                2 if defender_output_looks_like_threat(&stdout, &stderr) => ScanResult {
                    clean: false,
                    engine: "Windows Defender".to_string(),
                    detail: if snippet.is_empty() {
                        "Windows Defender reported a threat in this file".to_string()
                    } else {
                        format!("Windows Defender: {snippet}")
                    },
                    skipped: false,
                },
                2 => ScanResult {
                    // Exit 2 without threat text is usually a scan/tool failure, not malware.
                    clean: true,
                    engine: "Windows Defender".to_string(),
                    detail: if snippet.is_empty() {
                        "Scan inconclusive (exit 2, no threat details) — treating file as safe"
                            .to_string()
                    } else {
                        format!("Scan inconclusive (exit 2): {snippet} — treating file as safe")
                    },
                    skipped: true,
                },
                c => ScanResult {
                    clean: true,
                    engine: "Windows Defender".to_string(),
                    detail: format!("Scan inconclusive (exit {c}) — treating file as safe"),
                    skipped: true,
                },
            }
        }
        Err(e) => ScanResult {
            clean: true,
            engine: "Windows Defender".to_string(),
            detail: format!("Scan error: {e} — treating file as safe"),
            skipped: true,
        },
    }
}

// ─── Windows autostart (HKCU Run → tray) ───────────────────────────────────────

#[cfg(windows)]
const AUTOSTART_VALUE: &str = "PeerChat";

#[cfg(windows)]
pub fn windows_autostart_command_line() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy();
    Ok(format!("\"{exe}\" --tray"))
}

#[cfg(windows)]
pub fn set_windows_autostart(enabled: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    if enabled {
        let cmd = windows_autostart_command_line()?;
        let out = std::process::Command::new("reg")
            .args(["add", key, "/v", AUTOSTART_VALUE, "/t", "REG_SZ", "/d", &cmd, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
    } else {
        let _ = std::process::Command::new("reg")
            .args(["delete", key, "/v", AUTOSTART_VALUE, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    Ok(())
}

#[cfg(windows)]
pub fn windows_autostart_enabled() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let out = std::process::Command::new("reg")
        .args(["query", key, "/v", AUTOSTART_VALUE])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    matches!(out, Ok(o) if o.status.success())
}

