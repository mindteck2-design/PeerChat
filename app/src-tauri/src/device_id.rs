//! Stable per-machine identity for new PeerChat profiles.
//! Existing profiles keep their stored `profile.id` forever; this is only used at setup.

use sha2::{Digest, Sha256};
use std::path::PathBuf;

const APP_SALT: &[u8] = b"peerchat-device-id-v1";

/// Opaque UUID-shaped id derived from the OS machine identity (survives app reinstall).
pub fn stable_device_id() -> String {
    if let Some(raw) = read_os_machine_id() {
        return uuid_shaped_hash(&raw);
    }
    // Fallback: persist a random id outside the wipeable Tauri app data dir.
    match load_or_create_fallback_id() {
        Ok(id) => id,
        Err(_) => {
            // Last resort — still better than panicking; may change on wipe.
            uuid_shaped_hash(&format!("fallback-{}", uuid::Uuid::new_v4()))
        }
    }
}

fn uuid_shaped_hash(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(APP_SALT);
    hasher.update(raw.trim().as_bytes());
    let dig = hasher.finalize();
    // Format first 16 bytes as UUID (version/variant bits set for RFC-ish shape).
    let mut b = [0u8; 16];
    b.copy_from_slice(&dig[..16]);
    b[6] = (b[6] & 0x0f) | 0x50; // version 5-ish
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    uuid::Uuid::from_bytes(b).to_string()
}

fn read_os_machine_id() -> Option<String> {
    #[cfg(windows)]
    {
        return read_windows_machine_guid();
    }
    #[cfg(not(windows))]
    {
        for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
            if let Ok(s) = std::fs::read_to_string(path) {
                let t = s.trim();
                if !t.is_empty() {
                    return Some(t.to_string());
                }
            }
        }
        None
    }
}

#[cfg(windows)]
fn read_windows_machine_guid() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        // REG_SZ    MachineGuid    <guid>
        let lower = line.to_ascii_lowercase();
        if !lower.contains("machineguid") {
            continue;
        }
        if let Some(pos) = line.rfind(' ') {
            let guid = line[pos + 1..].trim();
            if !guid.is_empty() {
                return Some(guid.to_string());
            }
        }
    }
    None
}

fn fallback_path() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let program_data = std::env::var_os("PROGRAMDATA")?;
        Some(PathBuf::from(program_data).join("PeerChat").join("device_id"))
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME")?;
        Some(
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("peerchat")
                .join("device_id"),
        )
    }
}

fn load_or_create_fallback_id() -> Result<String, String> {
    let path = fallback_path().ok_or("no fallback path")?;
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let t = existing.trim();
        if !t.is_empty() {
            return Ok(t.to_string());
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    std::fs::write(&path, &id).map_err(|e| e.to_string())?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_raw_machine_id_hashes_stably() {
        let a = uuid_shaped_hash("abc-machine-id");
        let b = uuid_shaped_hash("abc-machine-id");
        assert_eq!(a, b);
        assert_ne!(a, uuid_shaped_hash("other-machine"));
        assert_eq!(a.len(), 36);
        assert_eq!(a.chars().filter(|c| *c == '-').count(), 4);
    }
}
