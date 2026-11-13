# PeerChat security (P2P)

## Threat model

- Compromised peer / stolen SQLite must not reveal **other users’** plaintext without keys.
- LAN attacker must not read/forge chats without breaking TLS pin + E2E.
- No central admin dump of all messages (there is no central DB).

Corporate LAN / firewall deployments treat the main risks as: bad installers, rubber-stamped Trust, and machines off the internal network (guest Wi‑Fi). Internet-facing exposure is out of scope when the app stays on corp VLAN/VPN.

## Controls

- [x] X25519 wraps + Ed25519 signatures + AES-256-GCM (client crypto)
- [x] Per-peer TLS TOFU (SHA-256 fingerprint pin)
- [x] Inbound `/v1/deliver` rejects signed messages that fail Ed25519 against known peer keys (active or pending)
- [x] Identity private keys in Tauri store (not uploaded)
- [x] File chunks staged only as ciphertext on sender until ACK
- [x] Outbox holds ciphertext only

## Corporate deployment (necessary)

1. **Trusted installer channel** — distribute `PeerChat-Setup-*` / `.deb` only from an internal share or approved IT package. Do not pull installers from random links (Windows builds may be unsigned → SmartScreen warnings are expected).
2. **Fingerprint Trust** — on first contact (and on “New keys”), users should compare TLS (and identity) fingerprints out of band (desk / phone) before Accept. Settings → Cryptographic Fingerprints shows your values.
3. **Stay on corp LAN/VPN** — keep UDP 41234 and TCP 9876+ on the internal network; avoid guest/public Wi‑Fi. Settings warns if the detected address does not look private.

## Limits

- Metadata visible to peers you chat with (who, when).
- Malicious peers can refuse delivery or serve bad chunks — verify fingerprints out-of-band.
- Distribute installers from a trusted channel.
- Optional hardenings (mTLS on file pulls, encrypted AppData, server-enforced announcement roles) are deferred for typical firewalled intranet use.
