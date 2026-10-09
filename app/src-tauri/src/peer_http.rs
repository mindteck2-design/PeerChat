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

pub fn spawn_listener(
    cert: LocalCert,
    port: u16,
    db: SharedDb,
    my_id: String,
) -> Result<(), String> {
    let cfg = Arc::new(tls_cert::rustls_server_config(&cert)?);
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(l) => l,
            Err(_) => return,
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
                let mut buf = vec![0u8; 256 * 1024];
                let Ok(n) = tls.read(&mut buf).await else {
                    return;
                };
                if n == 0 {
                    return;
                }
                let req = String::from_utf8_lossy(&buf[..n]);
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
            let Ok(payload) = serde_json::from_str::<Value>(body) else {
                return http_json(400, json!({"error":"bad json"}));
            };
            let conn = db.lock();
            if let Some(msg) = payload.get("message") {
                let _ = db::insert_message(&conn, msg);
            }
            if let Some(file) = payload.get("file") {
                let _ = db::insert_file(&conn, file);
            }
            if let Some(peer) = payload.get("from_peer") {
                let _ = db::upsert_peer(
                    &conn,
                    peer["user_id"].as_str().unwrap_or(""),
                    peer["display_name"].as_str().unwrap_or("peer"),
                    peer["x25519_public"].as_str().unwrap_or(""),
                    peer["ed25519_public"].as_str().unwrap_or(""),
                    peer.get("last_ip").and_then(|v| v.as_str()),
                    peer.get("last_port").and_then(|v| v.as_i64()),
                    peer.get("tls_fingerprint").and_then(|v| v.as_str()),
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
            let staging = meta["staging_dir"].as_str().unwrap_or("");
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
            let user_id = payload["user_id"].as_str().unwrap_or(my_id);
            let conn = db.lock();
            let _ = db::ack_file(&conn, file_id, user_id);
            // If we are uploader, maybe purge staging when all members acked
            if let Ok(Some(meta)) = db::get_file(&conn, file_id) {
                if meta["uploader_id"].as_str() == Some(my_id) {
                    let members = db::member_ids(&conn, meta["conversation_id"].as_str().unwrap_or(""))
                        .unwrap_or_default();
                    let acks = db::file_ack_count(&conn, file_id).unwrap_or(0) as usize;
                    if !members.is_empty() && acks >= members.len() {
                        if let Some(dir) = meta["staging_dir"].as_str() {
                            let _ = std::fs::remove_dir_all(dir);
                        }
                    }
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
    let mut tmp = [0u8; 8192];
    loop {
        match tls.read(&mut tmp).await {
            Ok(0) => break,
            Ok(n) => resp.extend_from_slice(&tmp[..n]),
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&resp);
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("{}");
    let json: Value = serde_json::from_str(body).unwrap_or(json!({"raw": body}));
    let fp = observed.lock().map(|g| g.clone()).unwrap_or_default();
    Ok((json, fp))
}

