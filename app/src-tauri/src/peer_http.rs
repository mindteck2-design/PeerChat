use crate::db;
use crate::tls_cert::{self, LocalCert};
use base64::Engine;
use parking_lot::Mutex;
use rusqlite::Connection;
use rustls::pki_types::ServerName;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;
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
                eprintln!("PeerTalk listener bind failed on {port}: {e}");
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
            tokio::spawn(async move {
                let Ok(mut tls) = acceptor.accept(tcp).await else {
                    return;
                };
                let mut buf = Vec::new();
                let mut tmp = [0u8; 64 * 1024];
                const MAX_REQ: usize = 16 * 1024 * 1024;
                loop {
                    match tls.read(&mut tmp).await {
                        Ok(0) => break,
                        Ok(n) => {
                            if buf.len() + n > MAX_REQ {
                                buf.clear();
                                break;
                            }
                            buf.extend_from_slice(&tmp[..n]);
                            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                                // If Content-Length is present, keep reading until full body.
                                let head = String::from_utf8_lossy(&buf);
                                if let Some(cl) = head
                                    .lines()
                                    .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
                                    .and_then(|l| l.split(':').nth(1))
                                    .and_then(|v| v.trim().parse::<usize>().ok())
                                {
                                    if let Some(pos) = head.find("\r\n\r\n") {
                                        let body_len = buf.len().saturating_sub(pos + 4);
                                        if body_len >= cl {
                                            break;
                                        }
                                        continue;
                                    }
                                } else {
                                    break;
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                if buf.is_empty() {
                    return;
                }
                let req = String::from_utf8_lossy(&buf);
                let resp = handle_http(&req, &db, &my_id);
                let _ = tls.write_all(resp.as_bytes()).await;
                let _ = tls.shutdown().await;
            });
        }
    });
    Ok(())
}

fn handle_http(req: &str, db: &SharedDb, my_id: &str) -> String {
    let mut lines = req.split("\r\n");
    let first = lines.next().unwrap_or("");
    let parts: Vec<&str> = first.split_whitespace().collect();
    if parts.len() < 2 {
        return http_json(400, json!({"error":"bad request"}));
    }
    let method = parts[0];
    let path = parts[1];
    let body = req.split("\r\n\r\n").nth(1).unwrap_or("");

    match (method, path) {
        ("GET", "/v1/hello") => {
            let conn = db.lock();
            let profile = db::get_profile(&conn).ok().flatten();
            http_json(
                200,
                json!({
                    "ok": true,
                    "user_id": my_id,
                    "profile": profile,
                }),
            )
        }
        ("POST", "/v1/deliver") => {
            const MAX_DELIVER_BODY: usize = 2 * 1024 * 1024;
            if body.len() > MAX_DELIVER_BODY {
                return http_json(400, json!({"error":"frame too large"}));
            }
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_json(400, json!({"error":"bad json"}));
            };
            if let Some(ct) = payload
                .pointer("/message/ciphertext")
                .and_then(|v| v.as_str())
            {
                if ct.len() > MAX_DELIVER_BODY {
                    return http_json(400, json!({"error":"ciphertext too large"}));
                }
            }
            let conn = db.lock();
            if conn.execute_batch("BEGIN IMMEDIATE").is_err() {
                return http_json(500, json!({"error":"db busy"}));
            }
            if let Some(msg) = payload.get("message") {
                if payload
                    .get("delete_for_everyone")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
                {
                    if let Some(mid) = msg.get("id").and_then(|v| v.as_str()) {
                        let _ = db::tombstone_message(&conn, mid);
                        // Ensure the tombstone row exists even if the original never arrived.
                        let _ = db::insert_message(&conn, msg);
                        let _ = db::tombstone_message(&conn, mid);
                    }
                } else if msg.get("kind").and_then(|v| v.as_str()) == Some("deleted") {
                    if let Some(mid) = msg.get("id").and_then(|v| v.as_str()) {
                        let _ = db::insert_message(&conn, msg);
                        let _ = db::tombstone_message(&conn, mid);
                    }
                } else {
                    let _ = db::insert_message(&conn, msg);
                }
            }
            if let Some(file) = payload.get("file") {
                let _ = db::insert_file(&conn, file);
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
                let mut dn = peer["display_name"]
                    .as_str()
                    .unwrap_or("peer")
                    .to_string();
                let mut x = peer["x25519_public"].as_str().unwrap_or("").to_string();
                let mut e = peer["ed25519_public"].as_str().unwrap_or("").to_string();
                let mut fp = peer
                    .get("tls_fingerprint")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if let Ok(Some(existing)) = db::get_peer(&conn, &uid) {
                    if existing["pinned"].as_bool().unwrap_or(false) {
                        let same_fp = existing["tls_fingerprint"].as_str() == fp.as_deref()
                            || fp.as_ref().map(|s| s.is_empty()).unwrap_or(true);
                        let same_x = existing["x25519_public"].as_str() == Some(x.as_str());
                        let same_e = existing["ed25519_public"].as_str() == Some(e.as_str());
                        if !(same_fp && same_x && same_e) {
                            let _ = db::set_peer_pending_identity(
                                &conn,
                                &uid,
                                peer.get("tls_fingerprint").and_then(|v| v.as_str()).unwrap_or(""),
                                peer["x25519_public"].as_str().unwrap_or(""),
                                peer["ed25519_public"].as_str().unwrap_or(""),
                            );
                            if let Some(s) = existing["display_name"].as_str() {
                                dn = s.to_string();
                            }
                            if let Some(s) = existing["x25519_public"].as_str() {
                                x = s.to_string();
                            }
                            if let Some(s) = existing["ed25519_public"].as_str() {
                                e = s.to_string();
                            }
                            fp = existing["tls_fingerprint"]
                                .as_str()
                                .map(|s| s.to_string());
                        }
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
            }
            // group wrap optional
            if let (Some(cid), Some(wrap)) = (
                payload.get("conversation_id").and_then(|v| v.as_str()),
                payload.get("wrapped_group_key").and_then(|v| v.as_str()),
            ) {
                let _ = conn.execute(
                    "UPDATE conversation_members SET wrapped_group_key=?3 WHERE conversation_id=?1 AND user_id=?2",
                    rusqlite::params![cid, my_id, wrap],
                );
                // ensure conversation exists
                if db::list_conversations(&conn)
                    .unwrap_or_default()
                    .iter()
                    .all(|c| c["id"].as_str() != Some(cid))
                {
                    let title = payload
                        .get("group_title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Group");
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO conversations(id, kind, title, created_at) VALUES (?1,'group',?2,?3)",
                        rusqlite::params![cid, title, chrono::Utc::now().to_rfc3339()],
                    );
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO conversation_members(conversation_id, user_id, wrapped_group_key) VALUES (?1,?2,?3)",
                        rusqlite::params![cid, my_id, wrap],
                    );
                }
            }
            if let Some(ev) = payload.get("group_event") {
                let cid = payload
                    .get("conversation_id")
                    .and_then(|v| v.as_str())
                    .or_else(|| ev.get("conversation_id").and_then(|v| v.as_str()))
                    .unwrap_or("");
                let op = ev.get("op").and_then(|v| v.as_str()).unwrap_or("");
                if !cid.is_empty() && (op == "sync" || op == "add") {
                    let title = payload
                        .get("group_title")
                        .and_then(|v| v.as_str())
                        .or_else(|| ev.get("title").and_then(|v| v.as_str()))
                        .unwrap_or("Group");
                    let _ = conn.execute(
                        "INSERT OR IGNORE INTO conversations(id, kind, title, created_at) VALUES (?1,'group',?2,?3)",
                        rusqlite::params![cid, title, chrono::Utc::now().to_rfc3339()],
                    );
                    if let Some(arr) = payload.get("members").and_then(|v| v.as_array()) {
                        for m in arr {
                            let uid = m.get("user_id").and_then(|v| v.as_str()).unwrap_or("");
                            if uid.is_empty() {
                                continue;
                            }
                            let name = m.get("display_name").and_then(|v| v.as_str());
                            let _ = db::upsert_member(&conn, cid, uid, None, name);
                        }
                    }
                    if let Some(wrap) = payload.get("wrapped_group_key").and_then(|v| v.as_str()) {
                        let _ = db::upsert_member(&conn, cid, my_id, Some(wrap), None);
                    }
                }
                if op == "remove" && !cid.is_empty() {
                    let uid = ev.get("user_id").and_then(|v| v.as_str()).unwrap_or("");
                    if !uid.is_empty() {
                        let _ = db::delete_member(&conn, cid, uid);
                    }
                }
            }
            if conn.execute_batch("COMMIT").is_err() {
                let _ = conn.execute_batch("ROLLBACK");
                return http_json(500, json!({"error":"commit failed"}));
            }
            http_json(200, json!({"ok": true}))
        }
        ("POST", "/v1/file/chunk") => {
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_json(400, json!({"error":"bad json"}));
            };
            let file_id = payload["file_id"].as_str().unwrap_or("");
            let index = payload["index"].as_u64().unwrap_or(0) as usize;
            let conn = db.lock();
            let Some(meta) = db::get_file(&conn, file_id).ok().flatten() else {
                return http_json(404, json!({"error":"missing file"}));
            };
            let cid = meta["conversation_id"].as_str().unwrap_or("");
            let uploader = meta["uploader_id"].as_str().unwrap_or("");
            // Only conversation members (or the uploader) may fetch chunks.
            let allowed = uploader == my_id
                || db::is_conversation_member(&conn, cid, my_id).unwrap_or(false);
            if !allowed {
                return http_json(403, json!({"error":"forbidden"}));
            }
            let staging = meta["staging_dir"].as_str().unwrap_or("");
            if staging.is_empty() || staging.contains("..") {
                return http_json(404, json!({"error":"missing staging"}));
            }
            let path = std::path::Path::new(staging).join(format!("{index}.chunk"));
            let nonce_path = std::path::Path::new(staging).join(format!("{index}.nonce"));
            let Ok(data) = std::fs::read(&path) else {
                return http_json(404, json!({"error":"missing chunk"}));
            };
            let nonce = std::fs::read_to_string(&nonce_path).unwrap_or_default();
            http_json(
                200,
                json!({
                    "ok": true,
                    "nonce": nonce,
                    "data_b64": base64::engine::general_purpose::STANDARD.encode(data),
                }),
            )
        }
        ("POST", "/v1/file/ack") => {
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_json(400, json!({"error":"bad json"}));
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
            http_json(200, json!({"ok": true}))
        }
        _ => http_json(404, json!({"error":"not found"})),
    }
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
    format!(
        "HTTP/1.0 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{raw}",
        raw.len()
    )
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
    let addr = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("resolve failed")?;
    let tcp = tokio::time::timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(addr))
        .await
        .map_err(|_| "connect timeout".to_string())?
        .map_err(|e| e.to_string())?;
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
    let mut tls = connector
        .connect(name, tcp)
        .await
        .map_err(|e| e.to_string())?;
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let method = if payload.is_empty() { "GET" } else { "POST" };
    let req = format!(
        "{method} {path} HTTP/1.0\r\nHost: {host}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",
        payload.len()
    );
    tls.write_all(req.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    let mut resp = Vec::new();
    let mut tmp = [0u8; 64 * 1024];
    const MAX_RESP: usize = 16 * 1024 * 1024;
    loop {
        match tls.read(&mut tmp).await {
            Ok(0) => break,
            Ok(n) => {
                if resp.len() + n > MAX_RESP {
                    return Err("peer response too large".into());
                }
                resp.extend_from_slice(&tmp[..n]);
            }
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&resp);
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("{}");
    let json: Value = serde_json::from_str(body).unwrap_or(json!({"raw": body}));
    let fp = observed.lock().map(|g| g.clone()).unwrap_or_default();
    Ok((json, fp))
}

