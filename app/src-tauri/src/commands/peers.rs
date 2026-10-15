#![allow(unused_imports)]
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
pub async fn discover_peers(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
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
    // Merge hub (TTL-pruned) so offline PCs drop within ~45s.
    let hub_peers = state.discovery.fresh_peers().await;
    let mut map = std::collections::HashMap::new();
    for p in scanned {
        // Keep scan results warm in the hub too.
        state.discovery.upsert(p.clone()).await;
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

            // Auto-adopt new TLS / crypto keys; archive previous keys for history.
            if let Some(ref ex) = existing {
                let same_fp = ex["tls_fingerprint"].as_str() == Some(p.fingerprint.as_str());
                let same_x = ex["x25519_public"].as_str() == Some(p.x25519_public.as_str());
                let same_e = ex["ed25519_public"].as_str() == Some(p.ed25519_public.as_str());
                if !(same_fp && same_x && same_e) {
                    let _ = db::adopt_peer_identity(
                        &conn,
                        &p.user_id,
                        &p.fingerprint,
                        &p.x25519_public,
                        &p.ed25519_public,
                    );
                }
            }
            db::upsert_peer_with_team(
                &conn,
                &p.user_id,
                &p.display_name,
                &p.x25519_public,
                &p.ed25519_public,
                Some(&p.ip),
                Some(p.port as i64),
                Some(&p.fingerprint),
                true,
                Some(p.team.as_str()),
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
                "team": p.team,
            }));
        }
        let _ = db::auto_accept_all_pending_identities(&conn);
        let _ = db::mark_peers_offline_except(&conn, &online_ids);
        let _ = db::mark_stale_peers_offline(&conn, 45);
        let _ = db::dedupe_peers_by_ip(&conn);
    }
    // Kick delivery for peers that came online or moved to a new address.
    // Done after releasing conn to avoid any potential lock ordering issue.
    for peer_id in peers_to_kick {
        kick_flush_for_peer(&state, peer_id);
    }
    Ok(out)
}

#[tauri::command]
pub async fn list_lan_hosts(state: State<'_, AppState>) -> Result<Vec<Value>, String> {
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
pub fn list_peers(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.db.lock();
    db::list_peers(&conn)
}

#[tauri::command]
pub fn pin_peer(state: State<AppState>, user_id: String, fingerprint: String) -> Result<(), String> {
    let conn = state.db.lock();
    db::pin_peer(&conn, &user_id, &fingerprint)
}

#[tauri::command]
pub fn set_peer_blocked(
    state: State<AppState>,
    user_id: String,
    blocked: bool,
) -> Result<(), String> {
    let conn = state.db.lock();
    db::set_peer_blocked(&conn, &user_id, blocked)
}

#[tauri::command]
pub async fn send_typing(
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
    // Collect targets under the DB lock, then fire-and-forget so typing never
    // stacks large TLS futures on the command path (composer crash / 0xc00000fd).
    let mut targets: Vec<(String, u16, Option<String>)> = Vec::new();
    {
        let conn = state.db.lock();
        for rid in recipient_ids {
            if rid == me {
                continue;
            }
            let Some(peer) = db::get_peer(&conn, &rid).ok().flatten() else {
                continue;
            };
            let Some(ip) = peer["last_ip"]
                .as_str()
                .filter(|s| discovery::is_usable_lan_ip(s))
                .map(|s| s.to_string())
            else {
                continue;
            };
            let Some(port) = peer["last_port"]
                .as_u64()
                .or_else(|| peer["last_port"].as_i64().map(|p| p as u64))
            else {
                continue;
            };
            let fp = peer["tls_fingerprint"].as_str().map(|s| s.to_string());
            targets.push((ip, port as u16, fp));
        }
    }
    for (ip, port, fp) in targets {
        let body = body.clone();
        tauri::async_runtime::spawn(async move {
            let _ = tokio::time::timeout(
                std::time::Duration::from_millis(1500),
                peer_http::peer_request(&ip, port, "/v1/typing", Some(body), fp),
            )
            .await;
        });
    }
    Ok(())
}

#[derive(Serialize)]
pub struct FileCreateResult {
    pub file_id: String,
    pub staging_dir: String,
}

#[tauri::command]
pub fn tls_fingerprint_peer(host: String, port: u16) -> Result<String, String> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    let (_, fp) = rt.block_on(peer_http::peer_request(&host, port, "/v1/hello", None, None))?;
    Ok(fp)
}


#[tauri::command]
pub fn peer_delivery_error(state: State<AppState>, user_id: String) -> Result<Option<Value>, String> {
    let conn = state.db.lock();
    db::latest_outbox_error(&conn, &user_id)
}

