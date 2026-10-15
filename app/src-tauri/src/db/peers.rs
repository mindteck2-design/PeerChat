use super::*;
use super::conversations::dm_id_for_peer;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

pub fn mark_peers_offline_except(conn: &Connection, online_ids: &[String]) -> Result<(), String> {
    if online_ids.is_empty() {
        conn.execute("UPDATE peers SET online=0", [])
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let placeholders: Vec<String> = online_ids.iter().map(|_| "?".into()).collect();
    let sql = format!(
        "UPDATE peers SET online=0 WHERE user_id NOT IN ({})",
        placeholders.join(",")
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let params: Vec<&dyn rusqlite::ToSql> = online_ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();
    stmt.execute(params.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mark peers offline when last_seen is older than `max_age_secs` (stale beacons).
pub fn mark_stale_peers_offline(conn: &Connection, max_age_secs: i64) -> Result<u64, String> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::seconds(max_age_secs)).to_rfc3339();
    let n = conn
        .execute(
            "UPDATE peers SET online=0 WHERE online=1 AND (last_seen_at IS NULL OR last_seen_at < ?1)",
            params![cutoff],
        )
        .map_err(|e| e.to_string())?;
    Ok(n as u64)
}

pub(crate) fn archive_peer_identity(
    conn: &Connection,
    user_id: &str,
    tls_fingerprint: Option<&str>,
    x25519_public: &str,
    ed25519_public: &str,
) -> Result<(), String> {
    if x25519_public.is_empty() && ed25519_public.is_empty() {
        return Ok(());
    }
    let exists: i64 = conn
        .query_row(
            r#"SELECT COUNT(*) FROM peer_identity_history
               WHERE user_id=?1 AND x25519_public=?2 AND ed25519_public=?3
                 AND IFNULL(tls_fingerprint,'')=IFNULL(?4,'')"#,
            params![user_id, x25519_public, ed25519_public, tls_fingerprint],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if exists > 0 {
        return Ok(());
    }
    conn.execute(
        r#"INSERT INTO peer_identity_history(user_id, tls_fingerprint, x25519_public, ed25519_public, retired_at)
           VALUES (?1,?2,?3,?4,?5)"#,
        params![
            user_id,
            tls_fingerprint,
            x25519_public,
            ed25519_public,
            chrono::Utc::now().to_rfc3339()
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Adopt a peer's new TLS / crypto keys immediately. Old keys are retained in
/// peer_identity_history so previously encrypted material can still be verified.
pub fn adopt_peer_identity(
    conn: &Connection,
    user_id: &str,
    tls_fingerprint: &str,
    x25519_public: &str,
    ed25519_public: &str,
) -> Result<(), String> {
    if user_id.is_empty() {
        return Ok(());
    }
    let existing = get_peer(conn, user_id)?;
    if let Some(ref ex) = existing {
        let old_x = ex["x25519_public"].as_str().unwrap_or("");
        let old_e = ex["ed25519_public"].as_str().unwrap_or("");
        let old_fp = ex["tls_fingerprint"].as_str();
        let same = old_x == x25519_public
            && old_e == ed25519_public
            && (tls_fingerprint.is_empty() || old_fp == Some(tls_fingerprint));
        if same {
            let _ = conn.execute(
                r#"UPDATE peers SET identity_changed=0,
                       pending_tls_fingerprint=NULL,
                       pending_x25519_public=NULL,
                       pending_ed25519_public=NULL
                   WHERE user_id=?1"#,
                params![user_id],
            );
            return Ok(());
        }
        archive_peer_identity(conn, user_id, old_fp, old_x, old_e)?;
    }
    let fp = if tls_fingerprint.is_empty() {
        existing
            .as_ref()
            .and_then(|e| e["tls_fingerprint"].as_str())
            .unwrap_or("")
    } else {
        tls_fingerprint
    };
    let x = if x25519_public.is_empty() {
        existing
            .as_ref()
            .and_then(|e| e["x25519_public"].as_str())
            .unwrap_or("")
    } else {
        x25519_public
    };
    let e = if ed25519_public.is_empty() {
        existing
            .as_ref()
            .and_then(|e| e["ed25519_public"].as_str())
            .unwrap_or("")
    } else {
        ed25519_public
    };
    conn.execute(
        r#"UPDATE peers SET
               tls_fingerprint=?2,
               x25519_public=?3,
               ed25519_public=?4,
               identity_changed=0,
               pending_tls_fingerprint=NULL,
               pending_x25519_public=NULL,
               pending_ed25519_public=NULL
           WHERE user_id=?1"#,
        params![user_id, fp, x, e],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Apply any leftover pending identity rows (from older builds that required Review).
pub fn auto_accept_all_pending_identities(conn: &Connection) -> Result<u64, String> {
    let mut stmt = conn
        .prepare(
            r#"SELECT user_id,
                      COALESCE(pending_tls_fingerprint,''),
                      COALESCE(pending_x25519_public,''),
                      COALESCE(pending_ed25519_public,'')
               FROM peers
               WHERE identity_changed=1 AND pending_tls_fingerprint IS NOT NULL"#,
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let mut n = 0u64;
    for (uid, fp, x, e) in rows {
        adopt_peer_identity(conn, &uid, &fp, &x, &e)?;
        n += 1;
    }
    Ok(n)
}

pub fn upsert_peer(
    conn: &Connection,
    user_id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    ip: Option<&str>,
    port: Option<i64>,
    tls_fingerprint: Option<&str>,
    online: bool,
) -> Result<(), String> {
    upsert_peer_with_team(
        conn,
        user_id,
        display_name,
        x25519_public,
        ed25519_public,
        ip,
        port,
        tls_fingerprint,
        online,
        None,
    )
}

pub fn upsert_peer_with_team(
    conn: &Connection,
    user_id: &str,
    display_name: &str,
    x25519_public: &str,
    ed25519_public: &str,
    ip: Option<&str>,
    port: Option<i64>,
    tls_fingerprint: Option<&str>,
    online: bool,
    team: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    // Never persist loopback / garbage — that poisons reverse delivery.
    let ip = ip.filter(|s| crate::discovery::is_usable_lan_ip(s));
    let team = team.unwrap_or("").trim();
    conn.execute(
        r#"INSERT INTO peers(user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, last_seen_at, online, team)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
           ON CONFLICT(user_id) DO UPDATE SET
             display_name=excluded.display_name,
             x25519_public=excluded.x25519_public,
             ed25519_public=excluded.ed25519_public,
             last_ip=COALESCE(excluded.last_ip, peers.last_ip),
             last_port=COALESCE(excluded.last_port, peers.last_port),
             tls_fingerprint=COALESCE(excluded.tls_fingerprint, peers.tls_fingerprint),
             last_seen_at=excluded.last_seen_at,
             online=excluded.online,
             team=CASE WHEN excluded.team != '' THEN excluded.team ELSE peers.team END"#,
        params![
            user_id,
            display_name,
            x25519_public,
            ed25519_public,
            ip,
            port,
            tls_fingerprint,
            now,
            online as i64,
            team
        ],
    )
    .map_err(|e| e.to_string())?;
    // One peer per LAN IP: when this identity is live at `ip`, fold any other row
    // still holding that address (typical after a PeerChat reinstall / new user_id).
    if online {
        if let Some(ip) = ip {
            let _ = claim_unique_peer_ip(conn, user_id, ip);
        }
    }
    Ok(())
}

/// Ensure `keep_user_id` is the only peer with `last_ip = ip`. Transfers pin/block
/// from displaced rows, then deletes them.
pub fn claim_unique_peer_ip(
    conn: &Connection,
    keep_user_id: &str,
    ip: &str,
) -> Result<(), String> {
    if keep_user_id.is_empty() || !crate::discovery::is_usable_lan_ip(ip) {
        return Ok(());
    }
    let mut stmt = conn
        .prepare(
            r#"SELECT user_id, COALESCE(pinned,0), tls_fingerprint, COALESCE(blocked,0)
               FROM peers
               WHERE user_id != ?1 AND last_ip = ?2"#,
        )
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, i64, Option<String>, i64)> = stmt
        .query_map(params![keep_user_id, ip], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    if rows.is_empty() {
        return Ok(());
    }

    let keep = get_peer(conn, keep_user_id)?;
    let mut keep_pinned = keep
        .as_ref()
        .and_then(|p| p.get("pinned").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    let mut keep_blocked = keep
        .as_ref()
        .and_then(|p| p.get("blocked").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    for (dup_id, pinned, fp, blocked) in rows {
        if pinned == 1 && !keep_pinned {
            let use_fp = fp.unwrap_or_default();
            if !use_fp.is_empty() {
                let _ = pin_peer(conn, keep_user_id, &use_fp);
            } else {
                let _ = conn.execute(
                    "UPDATE peers SET pinned=1 WHERE user_id=?1",
                    params![keep_user_id],
                );
            }
            keep_pinned = true;
        }
        if blocked == 1 && !keep_blocked {
            let _ = set_peer_blocked(conn, keep_user_id, true);
            keep_blocked = true;
        }
        let _ = conn.execute("DELETE FROM peers WHERE user_id=?1", params![dup_id]);
    }
    Ok(())
}

/// Collapse any existing IP collisions (online / most-recently-seen wins).
pub fn dedupe_peers_by_ip(conn: &Connection) -> Result<(), String> {
    let peers = list_peers_raw(conn)?;
    use std::collections::HashMap;
    let mut best: HashMap<String, (String, bool, String)> = HashMap::new();
    for p in &peers {
        let id = p["user_id"].as_str().unwrap_or("").to_string();
        let ip = p["last_ip"].as_str().unwrap_or("").to_string();
        if id.is_empty() || !crate::discovery::is_usable_lan_ip(&ip) {
            continue;
        }
        let online = p["online"].as_bool().unwrap_or(false);
        let seen = p["last_seen_at"].as_str().unwrap_or("").to_string();
        match best.get(&ip) {
            None => {
                best.insert(ip, (id, online, seen));
            }
            Some((_, was_online, was_seen)) => {
                let better = (online && !*was_online)
                    || (online == *was_online && seen.as_str() > was_seen.as_str());
                if better {
                    best.insert(ip, (id, online, seen));
                }
            }
        }
    }
    for (ip, (keep_id, _, _)) in best {
        let _ = claim_unique_peer_ip(conn, &keep_id, &ip);
    }
    Ok(())
}

pub(crate) fn list_peers_raw(conn: &Connection) -> Result<Vec<Value>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, pinned, last_seen_at, online, COALESCE(identity_changed,0), pending_tls_fingerprint, COALESCE(team,''), COALESCE(blocked,0) FROM peers ORDER BY display_name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let identity_changed = r.get::<_, i64>(10)? == 1;
            let pending_fp: Option<String> = r.get(11)?;
            let pinned_fp: Option<String> = r.get(6)?;
            Ok(serde_json::json!({
                "user_id": r.get::<_, String>(0)?,
                "display_name": r.get::<_, String>(1)?,
                "x25519_public": r.get::<_, String>(2)?,
                "ed25519_public": r.get::<_, String>(3)?,
                "last_ip": r.get::<_, Option<String>>(4)?,
                "last_port": r.get::<_, Option<i64>>(5)?,
                "tls_fingerprint": if identity_changed {
                    pending_fp.clone().or(pinned_fp)
                } else {
                    pinned_fp
                },
                "pinned": r.get::<_, i64>(7)? == 1,
                "last_seen_at": r.get::<_, Option<String>>(8)?,
                "online": r.get::<_, i64>(9)? == 1,
                "identity_changed": identity_changed,
                "pending_tls_fingerprint": pending_fp,
                "team": r.get::<_, String>(12)?,
                "blocked": r.get::<_, i64>(13)? == 1,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn peer_blocked(conn: &Connection, user_id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COALESCE(blocked,0) FROM peers WHERE user_id=?1",
        params![user_id],
        |r| Ok(r.get::<_, i64>(0)? == 1),
    )
    .optional()
    .map_err(|e| e.to_string())
    .map(|o| o.unwrap_or(false))
}

/// Block or unblock a peer for DMs. Trust (pinned) is preserved so unblock does not
/// re-trigger first-contact. Blocking mutes the DM; unblock unmutes it.
pub fn set_peer_blocked(conn: &Connection, user_id: &str, blocked: bool) -> Result<(), String> {
    let n = conn
        .execute(
            "UPDATE peers SET blocked=?2 WHERE user_id=?1",
            params![user_id, blocked as i64],
        )
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("unknown peer".into());
    }
    if let Some(profile) = get_profile(conn)? {
        let me = profile.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if !me.is_empty() {
            let cid = dm_conversation_id(me, user_id);
            let _ = set_conversation_muted(conn, &cid, blocked);
            if let Ok(Some(legacy)) = dm_id_for_peer(conn, user_id) {
                if legacy != cid {
                    let _ = set_conversation_muted(conn, &legacy, blocked);
                }
            }
        }
    }
    Ok(())
}

pub fn pin_peer(conn: &Connection, user_id: &str, fingerprint: &str) -> Result<(), String> {
    // If a pending identity was flagged, adopt those keys when re-pinning.
    let pending: Option<(Option<String>, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT pending_tls_fingerprint, pending_x25519_public, pending_ed25519_public FROM peers WHERE user_id=?1",
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((Some(p_fp), Some(px), Some(pe))) = pending {
        let use_fp = if fingerprint.is_empty() {
            p_fp
        } else {
            fingerprint.to_string()
        };
        conn.execute(
            r#"UPDATE peers SET pinned=1, blocked=0, tls_fingerprint=?2,
                   x25519_public=?3, ed25519_public=?4,
                   identity_changed=0,
                   pending_tls_fingerprint=NULL,
                   pending_x25519_public=NULL,
                   pending_ed25519_public=NULL
               WHERE user_id=?1"#,
            params![user_id, use_fp, px, pe],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE peers SET pinned=1, blocked=0, tls_fingerprint=?2, identity_changed=0 WHERE user_id=?1",
            params![user_id, fingerprint],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn list_peers(conn: &Connection) -> Result<Vec<Value>, String> {
    // Hot path (discovery ticker, who, UI). Dedupe only at startup / discover — not every call.
    list_peers_raw(conn)
}

pub fn get_peer(conn: &Connection, user_id: &str) -> Result<Option<Value>, String> {
    conn.query_row(
        "SELECT user_id, display_name, x25519_public, ed25519_public, last_ip, last_port, tls_fingerprint, pinned, online, COALESCE(blocked,0) FROM peers WHERE user_id=?1",
        params![user_id],
        |r| {
            Ok(serde_json::json!({
                "user_id": r.get::<_, String>(0)?,
                "display_name": r.get::<_, String>(1)?,
                "x25519_public": r.get::<_, String>(2)?,
                "ed25519_public": r.get::<_, String>(3)?,
                "last_ip": r.get::<_, Option<String>>(4)?,
                "last_port": r.get::<_, Option<i64>>(5)?,
                "tls_fingerprint": r.get::<_, Option<String>>(6)?,
                "pinned": r.get::<_, i64>(7)? == 1,
                "online": r.get::<_, i64>(8)? == 1,
                "blocked": r.get::<_, i64>(9)? == 1,
            }))
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn update_peer_display_name_everywhere(
    conn: &Connection,
    user_id: &str,
    display_name: &str,
) -> Result<(), String> {
    let _ = conn.execute(
        "UPDATE conversation_members SET display_name=?2 WHERE user_id=?1",
        params![user_id, display_name],
    );
    Ok(())
}

pub fn accept_pending_identity(conn: &Connection, user_id: &str) -> Result<(), String> {
    let pending: Option<(String, String, String)> = conn
        .query_row(
            r#"SELECT COALESCE(pending_tls_fingerprint,''),
                      COALESCE(pending_x25519_public,''),
                      COALESCE(pending_ed25519_public,'')
               FROM peers WHERE user_id=?1 AND identity_changed=1"#,
            params![user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((fp, x, e)) = pending else {
        return Err("No pending identity change for this peer".into());
    };
    adopt_peer_identity(conn, user_id, &fp, &x, &e)
}

