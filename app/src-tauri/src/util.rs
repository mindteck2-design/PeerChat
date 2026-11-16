#![allow(dead_code)]
use crate::db;
use crate::discovery;
use crate::state::AppState;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

/// App data dir for backend error-log writes (set once at startup).
static ERROR_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn set_error_log_dir(dir: PathBuf) {
    let _ = ERROR_LOG_DIR.set(dir);
}

/// Append a backend error/warn line to `peerchat-error.log` (and stderr).
pub(crate) fn log_error(message: impl AsRef<str>) {
    let msg = message.as_ref();
    eprintln!("{msg}");
    let Some(dir) = ERROR_LOG_DIR.get() else {
        return;
    };
    let path = dir.join("peerchat-error.log");
    write_error_log_line(&path, "ERROR", msg);
}

pub(crate) fn log_warn(message: impl AsRef<str>) {
    let msg = message.as_ref();
    eprintln!("{msg}");
    let Some(dir) = ERROR_LOG_DIR.get() else {
        return;
    };
    let path = dir.join("peerchat-error.log");
    write_error_log_line(&path, "WARN", msg);
}

fn write_error_log_line(path: &Path, level: &str, message: &str) {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    // Light rotate (same 2 MiB cap as settings append).
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() >= 2 * 1024 * 1024 {
            let backup = path.with_file_name(format!(
                "{}.1",
                path.file_name().and_then(|s| s.to_str()).unwrap_or("peerchat-error.log")
            ));
            let _ = std::fs::remove_file(&backup);
            let _ = std::fs::rename(path, &backup);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let cleaned = message.replace('\r', " ").replace('\n', " ");
        let _ = writeln!(
            f,
            "[{}] [{level}] {cleaned}",
            chrono::Utc::now().to_rfc3339()
        );
    }
}

/// Match JS `verifyMessageSignature` in crypto.ts — sign(sha256(`${cid}|${sid}|${nonce}|${ct}`)).
pub(crate) fn verify_message_ed25519(msg: &Value, ed25519_public_b64: &str) -> Result<(), String> {
    let ciphertext = msg
        .get("ciphertext")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing ciphertext".to_string())?;
    let nonce = msg
        .get("nonce")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing nonce".to_string())?;
    let signature_b64 = msg
        .get("signature")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing signature".to_string())?;
    let conversation_id = msg
        .get("conversation_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let sender_id = msg.get("sender_id").and_then(|v| v.as_str()).unwrap_or("");
    let to_sign = format!("{conversation_id}|{sender_id}|{nonce}|{ciphertext}");
    let digest = Sha256::digest(to_sign.as_bytes());
    let pub_bytes = base64::engine::general_purpose::STANDARD
        .decode(ed25519_public_b64.trim())
        .map_err(|_| "bad ed25519 public key".to_string())?;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(signature_b64.trim())
        .map_err(|_| "bad signature encoding".to_string())?;
    let pub_arr: [u8; 32] = pub_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "ed25519 public key must be 32 bytes".to_string())?;
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "ed25519 signature must be 64 bytes".to_string())?;
    let vk = VerifyingKey::from_bytes(&pub_arr).map_err(|e| e.to_string())?;
    let sig = Signature::from_bytes(&sig_arr);
    vk.verify(digest.as_slice(), &sig)
        .map_err(|_| "invalid message signature".to_string())
}

/// Verify against any known key for the sender (active or pending). Skip if unknown / unsigned.
pub(crate) fn enforce_inbound_message_signature(
    conn: &rusqlite::Connection,
    msg: &Value,
) -> Result<(), String> {
    let sender_id = msg
        .get("sender_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if sender_id.is_empty() {
        return Ok(());
    }
    let has_sig = msg
        .get("signature")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if !has_sig {
        // Older / control payloads without signatures stay accepted.
        return Ok(());
    }
    let keys = db::peer_ed25519_verify_keys(conn, sender_id)?;
    if keys.is_empty() {
        // First contact — no stored key yet; TOFU via from_peer upsert later.
        return Ok(());
    }
    let mut last_err = "invalid message signature".to_string();
    for pk in &keys {
        match verify_message_ed25519(msg, pk) {
            Ok(()) => return Ok(()),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// True for typical corp LAN / VPN private ranges (not a hard block — UI hint only).
pub(crate) fn is_corp_friendly_lan_ip(ip: &str) -> bool {
    let Ok(addr) = ip.parse::<std::net::IpAddr>() else {
        return false;
    };
    match addr {
        std::net::IpAddr::V4(v4) => {
            v4.is_private() || v4.is_loopback() || matches!(v4.octets(), [100, 64..=127, _, _])
        }
        std::net::IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00,
    }
}

pub(crate) fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub(crate) fn same_local_calendar_day(created_at: &str) -> bool {
    use chrono::{Datelike, Local};
    let Ok(dt) = chrono::DateTime::parse_from_rfc3339(created_at) else {
        return false;
    };
    let local = dt.with_timezone(&Local);
    let today = Local::now();
    local.year() == today.year() && local.month() == today.month() && local.day() == today.day()
}

pub(crate) const MAX_FILE_BYTES: i64 = 10 * 1024 * 1024 * 1024; // 10 GiB
/// Plaintext chunk size — must match JS `CHUNK_SIZE` in crypto.ts.
pub(crate) const PLAIN_CHUNK_BYTES: usize = 8 * 1024 * 1024;
/// Plaintext chunks are 8 MiB; AES-GCM ciphertext is +16 bytes (auth tag).
/// Allow a small margin so encrypted staging writes don't fail at exactly 8 MiB.
pub(crate) const MAX_CHUNK_BYTES: usize = PLAIN_CHUNK_BYTES + 64;
pub(crate) const MAX_CHUNKS: i64 = 65_536;
/// Headroom so a download doesn't fill the volume to zero.
pub(crate) const DISK_SPACE_MARGIN_BYTES: u64 = 64 * 1024 * 1024;

/// Human-readable size for errors / status (binary units).
pub(crate) fn format_bytes(n: u64) -> String {
    const KIB: u64 = 1024;
    const MIB: u64 = 1024 * 1024;
    const GIB: u64 = 1024 * 1024 * 1024;
    const TIB: u64 = 1024u64 * 1024 * 1024 * 1024;
    if n < KIB {
        format!("{n} B")
    } else if n < MIB {
        format!("{:.1} KB", n as f64 / KIB as f64)
    } else if n < GIB {
        format!("{:.1} MB", n as f64 / MIB as f64)
    } else if n < TIB {
        format!("{:.1} GB", n as f64 / GIB as f64)
    } else {
        format!("{:.2} TB", n as f64 / TIB as f64)
    }
}

/// Free bytes on the volume that contains `path` (or its nearest existing ancestor).
pub(crate) fn available_disk_bytes(path: &std::path::Path) -> Result<u64, String> {
    let probe = existing_ancestor(path);
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let wide: Vec<u16> = probe
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free_for_caller: u64 = 0;
        let mut total: u64 = 0;
        let mut free_total: u64 = 0;
        // SAFETY: path is NUL-terminated; outs are valid stack locals.
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_for_caller,
                &mut total,
                &mut free_total,
            )
        };
        if ok == 0 {
            return Err(format!(
                "could not query free disk space for {}",
                probe.display()
            ));
        }
        Ok(free_for_caller)
    }
    #[cfg(unix)]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let c = CString::new(probe.as_os_str().as_bytes())
            .map_err(|_| "invalid path for disk space check".to_string())?;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        let rc = unsafe { libc::statvfs(c.as_ptr(), &mut stat) };
        if rc != 0 {
            return Err(format!(
                "could not query free disk space for {}",
                probe.display()
            ));
        }
        Ok((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = probe;
        Err("disk space check not supported on this platform".into())
    }
}

fn existing_ancestor(path: &std::path::Path) -> PathBuf {
    let mut cur = path.to_path_buf();
    loop {
        if cur.exists() {
            return cur;
        }
        if !cur.pop() {
            return path.to_path_buf();
        }
    }
}

/// Ensure `needed` bytes (+ margin) fit on the volume for `path`.
pub(crate) fn ensure_disk_space(path: &std::path::Path, needed: u64) -> Result<(), String> {
    if needed == 0 {
        return Ok(());
    }
    let require = needed.saturating_add(DISK_SPACE_MARGIN_BYTES);
    let free = match available_disk_bytes(path) {
        Ok(v) => v,
        Err(_) => return Ok(()), // don't block download if the OS query fails
    };
    if free < require {
        return Err(format!(
            "Not enough disk space: need about {} free (file ~{}), but only {} available",
            format_bytes(require),
            format_bytes(needed),
            format_bytes(free)
        ));
    }
    Ok(())
}

pub(crate) fn safe_download_name(filename: &str) -> String {
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

pub(crate) fn explain_io(err: std::io::Error) -> String {
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

pub(crate) fn resolve_download_dir(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
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

pub(crate) fn sha256_file(path: &std::path::Path) -> Result<String, String> {
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

pub(crate) fn resolve_staging_dir(app: &AppHandle, file_id: &str) -> Result<PathBuf, String> {
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

pub(crate) fn from_peer_json(profile: &Value, fingerprint: &str) -> Value {
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



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_download_name_basic() {
        assert_eq!(safe_download_name("report.pdf"), "report.pdf");
        assert_eq!(safe_download_name("My File (2026).txt"), "My File _2026_.txt");
    }

    #[test]
    fn test_safe_download_name_prevents_traversal() {
        // Double dots or empty resolves to fallback
        assert_eq!(safe_download_name(""), "download.bin");
        assert_eq!(safe_download_name(".."), "download.bin");
        assert_eq!(safe_download_name("../../../etc/passwd"), "download.bin");
        assert_eq!(safe_download_name("..\\windows\\system32\\cmd.exe"), "_windows_system32_cmd.exe");
        assert_eq!(safe_download_name(".hidden"), "hidden");
    }

    #[test]
    fn test_format_bytes_gib() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1023), "1023 B");
        assert!(format_bytes(MAX_FILE_BYTES as u64).contains("GB"));
        assert_eq!(format_bytes(10 * 1024 * 1024 * 1024), "10.0 GB");
    }

    #[test]
    fn test_corp_friendly_lan_ip() {
        assert!(is_corp_friendly_lan_ip("10.1.2.3"));
        assert!(is_corp_friendly_lan_ip("192.168.0.10"));
        assert!(is_corp_friendly_lan_ip("172.16.5.5"));
        assert!(is_corp_friendly_lan_ip("100.64.1.2"));
        assert!(!is_corp_friendly_lan_ip("8.8.8.8"));
    }

    #[test]
    fn test_verify_message_ed25519_roundtrip() {
        use ed25519_dalek::Signer;
        use ed25519_dalek::SigningKey;

        let mut rng_bytes = [0u8; 32];
        getrandom::getrandom(&mut rng_bytes).unwrap();
        let sk = SigningKey::from_bytes(&rng_bytes);
        let pk = sk.verifying_key();
        let cid = "dm:a:b";
        let sid = "user-a";
        let nonce = "bm9uY2U=";
        let ct = "Y3Q=";
        let to_sign = format!("{cid}|{sid}|{nonce}|{ct}");
        let digest = Sha256::digest(to_sign.as_bytes());
        let sig = sk.sign(digest.as_slice());
        let msg = json!({
            "conversation_id": cid,
            "sender_id": sid,
            "nonce": nonce,
            "ciphertext": ct,
            "signature": base64::engine::general_purpose::STANDARD.encode(sig.to_bytes()),
        });
        let pk_b64 = base64::engine::general_purpose::STANDARD.encode(pk.as_bytes());
        verify_message_ed25519(&msg, &pk_b64).unwrap();
        let bad = json!({
            "conversation_id": cid,
            "sender_id": sid,
            "nonce": nonce,
            "ciphertext": "YmFk",
            "signature": msg["signature"],
        });
        assert!(verify_message_ed25519(&bad, &pk_b64).is_err());
    }
}
