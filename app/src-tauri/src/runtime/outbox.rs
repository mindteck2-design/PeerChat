#![allow(unused_imports)]
use crate::db;
use crate::discovery;
use crate::peer_http::{self, SharedDb};
use crate::state::AppState;
use crate::util::*;
use serde_json::{json, Value};
use tauri::Manager;

pub(crate) fn kick_flush(state: &AppState) {
    let db = state.db.clone();
    tauri::async_runtime::spawn(async move {
        flush_outbox(&db).await;
    });
}

pub(crate) async fn deliver_peer_items(db: &SharedDb, items: Vec<Value>) {
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
                "peer IP is loopback/invalid — ask them to update PeerChat and Refresh People",
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
            peer_http::peer_request(&ip, port as u16, "/v1/deliver", Some(payload.clone()), fp),
        )
        .await;

        match result {
            Err(_elapsed) => {
                let conn = db.lock();
                let _ = db::bump_outbox_error(&conn, &id, "request timed out after 10 s");
            }
            Ok(Ok((resp, observed_fp))) if resp.get("ok").and_then(|v| v.as_bool()) == Some(true) => {
                let conn = db.lock();
                if pinned && !observed_fp.is_empty() {
                    let cur = peer["tls_fingerprint"].as_str().unwrap_or("");
                    if cur != observed_fp {
                        let _ = db::adopt_peer_identity(
                            &conn,
                            &recipient,
                            &observed_fp,
                            peer["x25519_public"].as_str().unwrap_or(""),
                            peer["ed25519_public"].as_str().unwrap_or(""),
                        );
                    }
                }
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
            Ok(Err(e)) if e.contains("tls fingerprint mismatch") => {
                let conn = db.lock();
                let _ = db::bump_outbox_error(
                    &conn,
                    &id,
                    "TLS security fingerprint mismatch — peer identity requires verification",
                );
            }
            Ok(Err(e)) => {
                let conn = db.lock();
                let _ = db::bump_outbox_error(&conn, &id, &e);
            }
        }
    }
}

/// Drain all due outbox items, delivering to each peer concurrently (up to 8 peers at once).
/// Items for the same peer are delivered sequentially to preserve ordering.
pub(crate) async fn flush_outbox(db: &SharedDb) {
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
pub(crate) fn kick_flush_for_peer(state: &AppState, recipient_id: String) {
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

