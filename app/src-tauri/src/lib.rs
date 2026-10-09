use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UdpSocket;
use tokio::time::timeout;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredServer {
    pub ip: String,
    pub port: u16,
    pub fingerprint: String,
    pub profile: String,
}

#[tauri::command]
async fn discover_servers() -> Result<Vec<DiscoveredServer>, String> {
    let sock = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    sock.set_broadcast(true).map_err(|e| e.to_string())?;
    let who = br#"{"magic":"LANMSG","type":"who","v":"3"}"#;
    for target in ["255.255.255.255:41234", "127.0.0.1:41234"] {
        let _ = sock.send_to(who, target).await;
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    let mut found: HashMap<String, DiscoveredServer> = HashMap::new();
    let mut buf = [0u8; 4096];
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        match timeout(remaining.min(Duration::from_millis(400)), sock.recv_from(&mut buf)).await {
            Ok(Ok((n, _))) => {
                let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) else {
                    continue;
                };
                if v.get("magic").and_then(|x| x.as_str()) != Some("LANMSG") {
                    continue;
                }
                if v.get("type").and_then(|x| x.as_str()) != Some("server") {
                    continue;
                }
                let ip = v
                    .get("ip")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let port = v.get("port").and_then(|x| x.as_u64()).unwrap_or(8765) as u16;
                let fingerprint = v
                    .get("fingerprint")
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let profile = v
                    .get("profile")
                    .and_then(|x| x.as_str())
                    .unwrap_or("intranet")
                    .to_string();
                if !ip.is_empty() {
                    found.insert(
                        format!("{ip}:{port}"),
                        DiscoveredServer {
                            ip,
                            port,
                            fingerprint,
                            profile,
                        },
                    );
                }
            }
            _ => break,
        }
    }
    Ok(found.into_values().collect())
}

/// Probe TLS and return SHA-256 of the leaf certificate DER (TOFU; no system trust).
#[tauri::command]
async fn tls_fingerprint(url: String) -> Result<String, String> {
    let url = url.trim_end_matches('/').to_string();
    let without = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(&url);
    let hostport = without.split('/').next().unwrap_or(without);
    let (host, port) = if let Some((h, p)) = hostport.rsplit_once(':') {
        (h.to_string(), p.parse::<u16>().unwrap_or(8765))
    } else {
        (hostport.to_string(), 8765u16)
    };

    let mut addrs = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| e.to_string())?;
    let addr = addrs
        .next()
        .ok_or_else(|| "could not resolve server host".to_string())?;

    let tcp = timeout(Duration::from_secs(5), tokio::net::TcpStream::connect(addr))
        .await
        .map_err(|_| "tls connect timeout".to_string())?
        .map_err(|e| e.to_string())?;

    let recorder = Arc::new(std::sync::Mutex::new(String::new()));
    let verifier = Arc::new(FingerprintVerifier {
        fingerprint: recorder.clone(),
    });
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();

    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let server_name = rustls::pki_types::ServerName::try_from(host)
        .map_err(|_| "invalid server name".to_string())?;
    let mut tls = connector
        .connect(server_name, tcp)
        .await
        .map_err(|e| e.to_string())?;
    let _ = tls.write_all(b"GET /api/health HTTP/1.0\r\n\r\n").await;
    let mut scratch = [0u8; 64];
    let _ = tls.read(&mut scratch).await;
    let fp = recorder.lock().map_err(|e| e.to_string())?.clone();
    if fp.is_empty() {
        return Err("no certificate presented".into());
    }
    Ok(fp)
}

#[derive(Debug)]
struct FingerprintVerifier {
    fingerprint: Arc<std::sync::Mutex<String>>,
}

impl rustls::client::danger::ServerCertVerifier for FingerprintVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        let sum = Sha256::digest(end_entity.as_ref());
        if let Ok(mut g) = self.fingerprint.lock() {
            *g = hex::encode(sum);
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

#[tauri::command]
async fn save_downloaded_file(
    app: tauri::AppHandle,
    filename: String,
    data: Vec<u8>,
) -> Result<String, String> {
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
        "download.bin".to_string()
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
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file")
            .to_string();
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        path = dir.join(format!("{stem}-{stamp}{ext}"));
    }
    std::fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            discover_servers,
            tls_fingerprint,
            save_downloaded_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running LanMsg");
}
