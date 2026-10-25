use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;
use tokio::sync::RwLock;
use tokio::time::timeout;

/// Avoid flashing a console window when spawning `ipconfig` / `arp` on Windows.
fn silent_command(program: &str) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

static LAN_IP_CACHE: Mutex<Option<(String, Instant)>> = Mutex::new(None);
const LAN_IP_TTL: Duration = Duration::from_secs(30);

static ARP_CACHE: Mutex<Option<(Instant, Vec<LanHost>)>> = Mutex::new(None);
const ARP_CACHE_TTL: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerBeacon {
    pub magic: String,
    pub v: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub ip: String,
    pub port: u16,
    pub user_id: String,
    pub display_name: String,
    pub fingerprint: String,
    pub x25519_public: String,
    pub ed25519_public: String,
    #[serde(default)]
    pub team: String,
    pub ts: f64,
}

const PEER_HUB_TTL: Duration = Duration::from_secs(45);

#[derive(Clone, Default)]
pub struct DiscoveryHub {
    /// peer_id → (beacon, last_heard)
    peers: Arc<RwLock<HashMap<String, (PeerBeacon, Instant)>>>,
}

impl DiscoveryHub {
    pub async fn upsert(&self, peer: PeerBeacon) {
        let id = peer.user_id.clone();
        self.peers
            .write()
            .await
            .insert(id, (peer, Instant::now()));
    }

    /// Drop stale hub entries and return currently fresh peers.
    pub async fn fresh_peers(&self) -> HashMap<String, PeerBeacon> {
        let now = Instant::now();
        let mut guard = self.peers.write().await;
        guard.retain(|_, (_, at)| now.duration_since(*at) <= PEER_HUB_TTL);
        guard
            .iter()
            .map(|(k, (b, _))| (k.clone(), b.clone()))
            .collect()
    }
}

/// True if this IP is usable for peer delivery on a LAN (not loopback / unspecified).
pub fn is_usable_lan_ip(ip: &str) -> bool {
    let Ok(addr) = ip.parse::<std::net::IpAddr>() else {
        return false;
    };
    match addr {
        std::net::IpAddr::V4(v4) => {
            !v4.is_loopback()
                && !v4.is_unspecified()
                && !v4.is_broadcast()
                && !v4.is_multicast()
                && !v4.is_link_local()
        }
        std::net::IpAddr::V6(v6) => !v6.is_loopback() && !v6.is_unspecified() && !v6.is_multicast(),
    }
}

/// Local IPv4 used in beacons / from_peer. Must work offline (no dependency on 8.8.8.8).
pub fn lan_ip() -> String {
    if let Ok(guard) = LAN_IP_CACHE.lock() {
        if let Some((ip, at)) = guard.as_ref() {
            if at.elapsed() < LAN_IP_TTL {
                return ip.clone();
            }
        }
    }
    let ip = resolve_lan_ip();
    if let Ok(mut guard) = LAN_IP_CACHE.lock() {
        *guard = Some((ip.clone(), Instant::now()));
    }
    ip
}

#[cfg(windows)]
fn is_virtual_adapter_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.contains("vethernet")
        || n.contains("hyper-v")
        || n.contains("wsl")
        || n.contains("virtualbox")
        || n.contains("vmware")
        || n.contains("loopback")
        || n.contains("bluetooth")
        || n.contains("docker")
}

fn resolve_lan_ip() -> String {
    // Prefer a real NIC from the OS list (skip Hyper-V / WSL switches).
    if let Some(ip) = lan_ips_from_os(true).into_iter().next() {
        return ip;
    }
    // UDP "connect" only selects a route; destinations need not be reachable.
    const PROBES: &[&str] = &[
        "172.195.0.1:1",
        "172.16.0.1:1",
        "10.0.0.1:1",
        "192.168.0.1:1",
        "8.8.8.8:80",
    ];
    for dest in PROBES {
        if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(dest).is_ok() {
                if let Ok(addr) = sock.local_addr() {
                    let ip = addr.ip().to_string();
                    if is_usable_lan_ip(&ip) {
                        return ip;
                    }
                }
            }
        }
    }
    if let Some(ip) = lan_ips_from_os(false).into_iter().next() {
        return ip;
    }
    "127.0.0.1".into()
}

/// Local IPv4 addresses. When `physical_only`, skip Hyper-V / WSL / VM adapters.
fn lan_ips_from_os(physical_only: bool) -> Vec<String> {
    #[cfg(windows)]
    {
        let Some(out) = silent_command("ipconfig").output().ok() else {
            return Vec::new();
        };
        let text = String::from_utf8_lossy(&out.stdout);
        let mut cur_adapter = String::new();
        let mut preferred = Vec::new();
        let mut other = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for line in text.lines() {
            let trimmed = line.trim();
            let lower = trimmed.to_ascii_lowercase();
            if lower.contains("adapter") && trimmed.ends_with(':') {
                cur_adapter = trimmed.trim_end_matches(':').to_string();
                continue;
            }
            if !lower.contains("ipv4") {
                continue;
            }
            if physical_only && is_virtual_adapter_name(&cur_adapter) {
                continue;
            }
            if let Some(pos) = line.rfind(':') {
                let candidate = line[pos + 1..].trim().to_string();
                if is_usable_lan_ip(&candidate) && seen.insert(candidate.clone()) {
                    if candidate.starts_with("172.")
                        || candidate.starts_with("10.")
                        || candidate.starts_with("192.168.")
                    {
                        preferred.push(candidate);
                    } else {
                        other.push(candidate);
                    }
                }
            }
        }
        preferred.extend(other);
        return preferred;
    }
    #[cfg(not(windows))]
    {
        let _ = physical_only;
        Vec::new()
    }
}

/// Derive /24 directed subnet broadcast address for an IPv4 string.
pub(crate) fn subnet_broadcast_for(ip: &str) -> Option<String> {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok()) {
        Some(format!("{}.{}.{}.255", parts[0], parts[1], parts[2]))
    } else {
        None
    }
}

/// Send UDP payload as broadcast from a specific active socket to global broadcast,
/// loopback, and all detected LAN subnet broadcasts (e.g. 192.168.1.255).
async fn broadcast_datagram_from(sock: &UdpSocket, payload: &[u8], discovery_port: u16) {
    let _ = sock.set_broadcast(true);
    let dest_global = format!("255.255.255.255:{discovery_port}");
    let dest_loop = format!("127.0.0.1:{discovery_port}");
    let _ = sock.send_to(payload, &dest_global).await;
    let _ = sock.send_to(payload, &dest_loop).await;

    let mut ips = lan_ips_from_os(true);
    if ips.is_empty() {
        ips = lan_ips_from_os(false);
    }
    for ip in ips {
        if let Some(sb) = subnet_broadcast_for(&ip) {
            let dest_subnet = format!("{sb}:{discovery_port}");
            let _ = sock.send_to(payload, &dest_subnet).await;
        }
    }
}

/// Send UDP payload as broadcast out every usable NIC.
async fn broadcast_datagram(payload: &[u8], discovery_port: u16) {
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await {
        broadcast_datagram_from(&sock, payload, discovery_port).await;
    }
}

/// Unicast a datagram to one host's discovery port.
async fn unicast_datagram(payload: &[u8], ip: &str, discovery_port: u16) {
    if !is_usable_lan_ip(ip) {
        return;
    }
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await {
        let _ = sock
            .send_to(payload, format!("{ip}:{discovery_port}"))
            .await;
    }
}

/// Presence beacons: listen for who/peer, unicast peer status to known non-blocked
/// peers (so blocked users stop seeing us online). New contacts still use who-scan.
pub async fn run_beacon(
    hub: DiscoveryHub,
    listen_port: u16,
    discovery_port: u16,
    stop: tokio::sync::watch::Receiver<bool>,
    mut beacon: PeerBeacon,
    live_display_name: Arc<parking_lot::Mutex<String>>,
    live_team: Arc<parking_lot::Mutex<String>>,
    db: Arc<parking_lot::Mutex<rusqlite::Connection>>,
) {
    let sock = match UdpSocket::bind(format!("0.0.0.0:{discovery_port}")).await {
        Ok(s) => s,
        Err(_) => match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => s,
            Err(_) => return,
        },
    };
    let _ = sock.set_broadcast(true);
    let mut buf = [0u8; 4096];
    let mut ticker = tokio::time::interval(Duration::from_secs(2));
    let mut tick_count: u64 = 0;
    loop {
        if *stop.borrow() {
            break;
        }
        tokio::select! {
            _ = ticker.tick() => {
                tick_count = tick_count.wrapping_add(1);
                beacon.ip = lan_ip();
                beacon.port = listen_port;
                beacon.display_name = live_display_name.lock().clone();
                beacon.team = live_team.lock().clone();
                beacon.ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);
                if let Ok(raw) = serde_json::to_vec(&beacon) {
                    // Unicast to known non-blocked peers
                    let targets: Vec<String> = {
                        let conn = db.lock();
                        crate::db::list_peers(&conn)
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|p| p.get("blocked").and_then(|v| v.as_bool()) != Some(true))
                            .filter_map(|p| {
                                p.get("last_ip")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                            })
                            .filter(|ip| is_usable_lan_ip(ip))
                            .collect()
                    };
                    for ip in targets {
                        unicast_datagram(&raw, &ip, discovery_port).await;
                    }
                }
                // Every 6 ticks (12s), or on initial tick, broadcast a who probe so other
                // peers on the LAN reply with their beacons (recovers from sleep, Wi-Fi reconnect, or IP change).
                if tick_count == 1 || tick_count % 6 == 0 {
                    let who = br#"{"magic":"PEERCHAT","type":"who","v":"4"}"#;
                    broadcast_datagram_from(&sock, who, discovery_port).await;
                }
            }
            res = sock.recv_from(&mut buf) => {
                match res {
                    Ok((n, addr)) => {
                        handle_packet(&hub, &sock, &buf[..n], addr, &beacon, &db).await;
                    }
                    Err(_e) => {
                        #[cfg(windows)]
                        if _e.raw_os_error() == Some(10054) {
                            continue;
                        }
                    }
                }
            }
        }
    }
}

fn ip_is_blocked_peer(db: &parking_lot::Mutex<rusqlite::Connection>, ip: &str) -> bool {
    let conn = db.lock();
    crate::db::list_peers(&conn)
        .unwrap_or_default()
        .into_iter()
        .any(|p| {
            p.get("blocked").and_then(|v| v.as_bool()) == Some(true)
                && p.get("last_ip").and_then(|v| v.as_str()) == Some(ip)
        })
}

async fn handle_packet(
    hub: &DiscoveryHub,
    sock: &UdpSocket,
    data: &[u8],
    addr: SocketAddr,
    self_beacon: &PeerBeacon,
    db: &Arc<parking_lot::Mutex<rusqlite::Connection>>,
) {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(data) else {
        return;
    };
    let magic = v.get("magic").and_then(|x| x.as_str()).unwrap_or("");
    // Accept legacy LanMsg beacons so mixed fleets still discover each other.
    if magic != "PEERCHAT" && magic != "LANMSG" {
        return;
    }
    let kind = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let src = addr.ip().to_string();
    if kind == "who" {
        // Hide from blocked peers: do not answer their discovery probes.
        if ip_is_blocked_peer(db, &src) {
            return;
        }
        if let Ok(raw) = serde_json::to_vec(self_beacon) {
            let _ = sock.send_to(&raw, addr).await;
        }
        return;
    }
    if kind != "peer" {
        return;
    }
    let Ok(mut peer) = serde_json::from_value::<PeerBeacon>(v) else {
        return;
    };
    if peer.user_id == self_beacon.user_id {
        return;
    }
    // Always prefer the UDP source address — self-reported IP is often 127.0.0.1
    // on offline intranet PCs (old lan_ip fallback) and breaks reverse delivery.
    if is_usable_lan_ip(&src) {
        peer.ip = src;
    } else if !is_usable_lan_ip(&peer.ip) {
        peer.ip = src;
    }
    hub.upsert(peer.clone()).await;

    // Immediately persist peer status in SQLite so UI and outbox see the peer online right away.
    let mut kick_flush = false;
    {
        let conn = db.lock();
        if let Ok(Some(existing)) = crate::db::get_peer(&conn, &peer.user_id) {
            let was_offline = existing.get("online").and_then(|v| v.as_bool()) == Some(false);
            let old_ip = existing.get("last_ip").and_then(|v| v.as_str());
            let ip_changed = old_ip != Some(peer.ip.as_str());
            let same_fp = existing.get("tls_fingerprint").and_then(|v| v.as_str()) == Some(peer.fingerprint.as_str());
            let same_x = existing.get("x25519_public").and_then(|v| v.as_str()) == Some(peer.x25519_public.as_str());
            let same_e = existing.get("ed25519_public").and_then(|v| v.as_str()) == Some(peer.ed25519_public.as_str());
            if !(same_fp && same_x && same_e) {
                let _ = crate::db::adopt_peer_identity(
                    &conn,
                    &peer.user_id,
                    &peer.fingerprint,
                    &peer.x25519_public,
                    &peer.ed25519_public,
                );
            }
            let _ = crate::db::upsert_peer_with_team(
                &conn,
                &peer.user_id,
                &peer.display_name,
                &peer.x25519_public,
                &peer.ed25519_public,
                Some(&peer.ip),
                Some(peer.port as i64),
                Some(&peer.fingerprint),
                true,
                Some(peer.team.as_str()),
            );
            if was_offline || ip_changed {
                let _ = crate::db::clear_peer_outbox_backoff(&conn, &peer.user_id);
                kick_flush = true;
            }
        } else {
            let _ = crate::db::upsert_peer_with_team(
                &conn,
                &peer.user_id,
                &peer.display_name,
                &peer.x25519_public,
                &peer.ed25519_public,
                Some(&peer.ip),
                Some(peer.port as i64),
                Some(&peer.fingerprint),
                true,
                Some(peer.team.as_str()),
            );
        }
    }
    if kick_flush {
        let db_clone = db.clone();
        tauri::async_runtime::spawn(async move {
            crate::runtime::outbox::flush_outbox(&db_clone).await;
        });
    }
}

/// A LAN device observed via ARP (no PeerTalk). MAC is never returned or stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LanHost {
    pub ip: String,
    pub label: String,
}

fn ipv4_same_slash24(a: &str, b: &str) -> bool {
    let pa: Vec<_> = a.split('.').collect();
    let pb: Vec<_> = b.split('.').collect();
    pa.len() == 4
        && pb.len() == 4
        && pa[0] == pb[0]
        && pa[1] == pb[1]
        && pa[2] == pb[2]
}

fn looks_like_ipv4(s: &str) -> bool {
    let parts: Vec<_> = s.split('.').collect();
    parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok())
}

/// Best-effort LAN neighbor list from the OS ARP table (cached for 45s to avoid process spawn storms).
pub fn lan_hosts_without_app(exclude_ips: &[String]) -> Vec<LanHost> {
    let me = lan_ip();
    let raw_hosts = {
        let mut cache = ARP_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((ts, ref hosts)) = *cache {
            if ts.elapsed() < ARP_CACHE_TTL {
                hosts.clone()
            } else {
                let fresh = parse_raw_arp(&me);
                *cache = Some((Instant::now(), fresh.clone()));
                fresh
            }
        } else {
            let fresh = parse_raw_arp(&me);
            *cache = Some((Instant::now(), fresh.clone()));
            fresh
        }
    };

    let mut hosts: Vec<LanHost> = raw_hosts
        .into_iter()
        .filter(|h| !exclude_ips.iter().any(|e| e == &h.ip))
        .collect();
    hosts.sort_by(|a, b| a.ip.cmp(&b.ip));
    hosts.truncate(64);
    hosts
}

fn parse_raw_arp(me: &str) -> Vec<LanHost> {
    let output = {
        #[cfg(windows)]
        {
            silent_command("arp").arg("-a").output().ok()
        }
        #[cfg(not(windows))]
        {
            silent_command("ip")
                .args(["neigh"])
                .output()
                .or_else(|_| silent_command("arp").arg("-an").output())
                .ok()
        }
    };
    let Some(out) = output else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut hosts: Vec<LanHost> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for line in text.lines() {
        let mut ip: Option<String> = None;
        for tok in line.split_whitespace() {
            let t = tok.trim_matches(|c| c == '(' || c == ')');
            if looks_like_ipv4(t) {
                ip = Some(t.to_string());
                break;
            }
        }
        let Some(ip) = ip else { continue };
        if ip == me || ip.ends_with(".255") || ip.ends_with(".0") {
            continue;
        }
        if !ipv4_same_slash24(me, &ip) {
            continue;
        }
        if !seen.insert(ip.clone()) {
            continue;
        }
        hosts.push(LanHost {
            ip: ip.clone(),
            label: format!("Device on LAN ({ip})"),
        });
    }
    hosts
}

pub async fn scan(discovery_port: u16, self_id: &str) -> Result<Vec<PeerBeacon>, String> {
    let sock = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    sock.set_broadcast(true).map_err(|e| e.to_string())?;
    let who = br#"{"magic":"PEERCHAT","type":"who","v":"4"}"#;
    // Broadcast from THIS socket to global broadcast, loopback, and all subnet broadcasts
    broadcast_datagram_from(&sock, who, discovery_port).await;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
    let mut found: HashMap<String, PeerBeacon> = HashMap::new();
    let mut buf = [0u8; 4096];
    while tokio::time::Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        match timeout(remaining.min(Duration::from_millis(400)), sock.recv_from(&mut buf)).await {
            Ok(Ok((n, addr))) => {
                let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) else {
                    continue;
                };
                let magic = v.get("magic").and_then(|x| x.as_str()).unwrap_or("");
                if magic != "PEERCHAT" && magic != "LANMSG" {
                    continue;
                }
                if v.get("type").and_then(|x| x.as_str()) != Some("peer") {
                    continue;
                }
                let Ok(mut peer) = serde_json::from_value::<PeerBeacon>(v) else {
                    continue;
                };
                if peer.user_id == self_id {
                    continue;
                }
                let src = addr.ip().to_string();
                if is_usable_lan_ip(&src) {
                    peer.ip = src;
                } else if !is_usable_lan_ip(&peer.ip) {
                    peer.ip = src;
                }
                found.insert(peer.user_id.clone(), peer);
            }
            Ok(Err(e)) => {
                #[cfg(windows)]
                if e.raw_os_error() == Some(10054) {
                    continue;
                }
                break;
            }
            _ => break,
        }
    }
    Ok(found.into_values().collect())
}
