# LanMsg security (P2P)

## Threat model

- Compromised peer / stolen SQLite must not reveal **other users’** plaintext without keys.
- LAN attacker must not read/forge chats without breaking TLS pin + E2E.
- No central admin dump of all messages (there is no central DB).

## Controls

- [x] X25519 wraps + Ed25519 signatures + AES-256-GCM (client crypto)
- [x] Per-peer TLS TOFU (SHA-256 fingerprint pin)
- [x] Identity private keys in Tauri store (not uploaded)
- [x] File chunks staged only as ciphertext on sender until ACK
- [x] Outbox holds ciphertext only

## Limits

- Metadata visible to peers you chat with (who, when).
- Malicious peers can refuse delivery or serve bad chunks — verify fingerprints out-of-band.
- Distribute installers from a trusted channel.
