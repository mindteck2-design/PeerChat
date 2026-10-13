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

#[derive(Clone, Default)]
pub struct DiscoveryHub {
    pub peers: Arc<RwLock<HashMap<String, PeerBeacon>>>,
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

/// Send UDP payload as broadcast out every usable NIC.
/// Binding per-IP forces Windows to egress that interface (0.0.0.0 often picks Hyper-V).
async fn broadcast_datagram(payload: &[u8], discovery_port: u16) {
    let mut ips = lan_ips_from_os(true);
    if ips.is_empty() {
        ips = lan_ips_from_os(false);
    }
    if ips.is_empty() {
        ips.push(lan_ip());
    }
    let dest_global = format!("255.255.255.255:{discovery_port}");
    let dest_loop = format!("127.0.0.1:{discovery_port}");
    for ip in ips {
        if let Ok(sock) = UdpSocket::bind(format!("{ip}:0")).await {
            let _ = sock.set_broadcast(true);
            let _ = sock.send_to(payload, &dest_global).await;
        }
    }
    if let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await {
        let _ = sock.set_broadcast(true);
        let _ = sock.send_to(payload, &dest_global).await;
        let _ = sock.send_to(payload, &dest_loop).await;
    }
}

pub async fn run_beacon(
    hub: DiscoveryHub,
    listen_port: u16,
    discovery_port: u16,
    stop: tokio::sync::watch::Receiver<bool>,
    mut beacon: PeerBeacon,
    live_display_name: Arc<parking_lot::Mutex<String>>,
    live_team: Arc<parking_lot::Mutex<String>>,
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
    loop {
        if *stop.borrow() {
            break;
        }
        tokio::select! {
            _ = ticker.tick() => {
                beacon.ip = lan_ip();
                beacon.port = listen_port;
                beacon.display_name = live_display_name.lock().clone();
                beacon.team = live_team.lock().clone();
                beacon.ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);
                if let Ok(raw) = serde_json::to_vec(&beacon) {
                    broadcast_datagram(&raw, discovery_port).await;
                }
            }
            res = sock.recv_from(&mut buf) => {
                if let Ok((n, addr)) = res {
                    handle_packet(&hub, &sock, &buf[..n], addr, &beacon).await;
                }
            }
        }
    }
}

async fn handle_packet(
    hub: &DiscoveryHub,
    sock: &UdpSocket,
    data: &[u8],
    addr: SocketAddr,
    self_beacon: &PeerBeacon,
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
    if kind == "who" {
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
    let src = addr.ip().to_string();
    if is_usable_lan_ip(&src) {
        peer.ip = src;
    } else if !is_usable_lan_ip(&peer.ip) {
        peer.ip = src;
    }
    hub.peers.write().await.insert(peer.user_id.clone(), peer);
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

/// Best-effort LAN neighbor list from the OS ARP table (no MAC persistence).
pub fn lan_hosts_without_app(exclude_ips: &[String]) -> Vec<LanHost> {
    let me = lan_ip();
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
        if !ipv4_same_slash24(&me, &ip) {
            continue;
        }
        if exclude_ips.iter().any(|e| e == &ip) {
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
    hosts.sort_by(|a, b| a.ip.cmp(&b.ip));
    hosts.truncate(64);
    hosts
}

pub async fn scan(discovery_port: u16, self_id: &str) -> Result<Vec<PeerBeacon>, String> {
    let sock = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| e.to_string())?;
    sock.set_broadcast(true).map_err(|e| e.to_string())?;
    let who = br#"{"magic":"PEERCHAT","type":"who","v":"4"}"#;
    // Ask every NIC to solicit replies — critical on PCs with Hyper-V/WSL switches.
    broadcast_datagram(who, discovery_port).await;
    let _ = sock
        .send_to(who, format!("255.255.255.255:{discovery_port}"))
        .await;
    let _ = sock
        .send_to(who, format!("127.0.0.1:{discovery_port}"))
        .await;
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
            _ => break,
        }
    }
    Ok(found.into_values().collect())
}
