#![allow(dead_code)]
use crate::db;
use crate::discovery;
use crate::state::AppState;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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

pub(crate) const MAX_FILE_BYTES: i64 = 5 * 1024 * 1024 * 1024; // 5 GiB
/// Plaintext chunk size — must match JS `CHUNK_SIZE` in crypto.ts.
pub(crate) const PLAIN_CHUNK_BYTES: usize = 8 * 1024 * 1024;
/// Plaintext chunks are 8 MiB; AES-GCM ciphertext is +16 bytes (auth tag).
/// Allow a small margin so encrypted staging writes don't fail at exactly 8 MiB.
pub(crate) const MAX_CHUNK_BYTES: usize = PLAIN_CHUNK_BYTES + 64;
pub(crate) const MAX_CHUNKS: i64 = 65_536;

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
        assert_eq!(safe_download_name("..\\windows\\system32\\cmd.exe"), "download.bin");
        assert_eq!(safe_download_name(".hidden"), "hidden");
    }
}
