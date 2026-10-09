use rcgen::{CertificateParams, KeyPair, SanType};
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Clone)]
pub struct LocalCert {
    pub cert_pem: String,
    pub key_pem: String,
    pub fingerprint: String,
}

pub fn ensure(data_dir: &Path) -> Result<LocalCert, String> {
    let cert_dir = data_dir.join("certs");
    std::fs::create_dir_all(&cert_dir).map_err(|e| e.to_string())?;
    let cert_path = cert_dir.join("peer.crt");
    let key_path = cert_dir.join("peer.key");
    if cert_path.exists() && key_path.exists() {
        let cert_pem = std::fs::read_to_string(&cert_path).map_err(|e| e.to_string())?;
        let key_pem = std::fs::read_to_string(&key_path).map_err(|e| e.to_string())?;
        let fp = fingerprint_pem(&cert_pem)?;
        return Ok(LocalCert {
            cert_pem,
            key_pem,
            fingerprint: fp,
        });
    }

    let key_pair = KeyPair::generate().map_err(|e| e.to_string())?;
    let mut params = CertificateParams::new(vec!["localhost".into()]).map_err(|e| e.to_string())?;
    params.subject_alt_names = vec![
        SanType::DnsName("localhost".try_into().map_err(|e: rcgen::Error| e.to_string())?),
        SanType::IpAddress(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))),
    ];
    // Add LAN IPs if available
    if let Ok(ifaces) = local_ips() {
        for ip in ifaces {
            params
                .subject_alt_names
                .push(SanType::IpAddress(std::net::IpAddr::V4(ip)));
        }
    }
    let cert = params
        .self_signed(&key_pair)
        .map_err(|e| e.to_string())?;
    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();
    std::fs::write(&cert_path, &cert_pem).map_err(|e| e.to_string())?;
    std::fs::write(&key_path, &key_pem).map_err(|e| e.to_string())?;
    let fp = fingerprint_pem(&cert_pem)?;
    Ok(LocalCert {
        cert_pem,
        key_pem,
        fingerprint: fp,
    })
}

fn fingerprint_pem(pem: &str) -> Result<String, String> {
    let mut reader = std::io::Cursor::new(pem.as_bytes());
    let certs: Vec<_> = rustls_pemfile::certs(&mut reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let der = certs.first().ok_or("no cert")?;
    Ok(hex::encode(Sha256::digest(der.as_ref())))
}

fn local_ips() -> Result<Vec<std::net::Ipv4Addr>, String> {
    // Best-effort: parse from OS is hard without extra crates; leave empty SANs beyond localhost.
    Ok(vec![])
}

pub fn rustls_server_config(cert: &LocalCert) -> Result<rustls::ServerConfig, String> {
    let mut cert_reader = std::io::Cursor::new(cert.cert_pem.as_bytes());
    let certs: Vec<_> = rustls_pemfile::certs(&mut cert_reader)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut key_reader = std::io::Cursor::new(cert.key_pem.as_bytes());
    let key = rustls_pemfile::private_key(&mut key_reader)
        .map_err(|e| e.to_string())?
        .ok_or("no private key")?;
    rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| e.to_string())
}
