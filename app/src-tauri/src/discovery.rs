use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::sync::RwLock;
use tokio::time::timeout;

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
    pub ts: f64,
}

#[derive(Clone, Default)]
pub struct DiscoveryHub {
    pub peers: Arc<RwLock<HashMap<String, PeerBeacon>>>,
}

pub fn lan_ip() -> String {
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = sock.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".into()
}

pub async fn run_beacon(
    hub: DiscoveryHub,
    listen_port: u16,
    discovery_port: u16,
    stop: tokio::sync::watch::Receiver<bool>,
    mut beacon: PeerBeacon,
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
                beacon.ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);
                if let Ok(raw) = serde_json::to_vec(&beacon) {
                    let _ = sock.send_to(&raw, format!("255.255.255.255:{discovery_port}")).await;
                    let _ = sock.send_to(&raw, format!("127.0.0.1:{discovery_port}")).await;
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
    if v.get("magic").and_then(|x| x.as_str()) != Some("LANMSG") {
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
    if peer.ip.is_empty() || peer.ip == "0.0.0.0" {
        peer.ip = addr.ip().to_string();
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
            std::process::Command::new("arp")
                .arg("-a")
                .output()
                .ok()
        }
        #[cfg(not(windows))]
        {
            std::process::Command::new("ip")
                .args(["neigh"])
                .output()
                .or_else(|_| std::process::Command::new("arp").arg("-an").output())
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
    let who = br#"{"magic":"LANMSG","type":"who","v":"4"}"#;
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
                if v.get("magic").and_then(|x| x.as_str()) != Some("LANMSG") {
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
                if peer.ip.is_empty() {
                    peer.ip = addr.ip().to_string();
                }
                found.insert(peer.user_id.clone(), peer);
            }
            _ => break,
        }
    }
    Ok(found.into_values().collect())
}
