# LanMsg security checklist

## Threat model (v1)

- Server admin / Postgres dump / stolen staging blobs must not yield message or file **plaintext**.
- Network attackers need TLS pin break + E2E keys to read or forge content.
- Compromised client device is limited by OS keychain / Tauri store protections; logout clears session tokens.
- Metadata (who talked to whom, timestamps, membership) is visible to the server.

## Authentication

- [x] Passwords hashed with **Argon2id** (m=65536, t=3, p=4)
- [x] Login rate limits per IP + username (tighter on `internet` profile)
- [x] Opaque session tokens (≥256-bit), stored **hashed** (SHA-256)
- [x] Idle + absolute session lifetime; logout deletes session
- [x] Password change revokes all sessions
- [x] `intranet` open signup; `internet` invite-required by default

## Transport

- [x] HTTPS + WSS only
- [x] Self-signed or operator cert; client **TOFU** pin (SHA-256 fingerprint)
- [x] No default “ignore all certificate errors”
- [x] UDP discovery announces fingerprint; discovery alone is not trust

## End-to-end crypto

- [x] X25519 key wrap + Ed25519 signatures + AES-256-GCM
- [x] AD binds conversation id + sender id on messages
- [x] DM per-message content keys wrapped to recipients (+ self)
- [x] Group symmetric key, individually wrapped per member
- [x] Files: 512 KiB chunked AES-GCM; filename encrypted with content key
- [x] Private keys never uploaded

## File staging

- Encrypted chunks held on the server until members download **or** retention TTL elapses
- Clients save plaintext to local `Downloads/LanMsg` (or app data)
- Server deletes staging blobs after all members mark downloaded, or on TTL; DB keeps ciphertext metadata only

## Server hardening

- [x] Parameterized SQL (`pgx`)
- [x] Auth on mutating API + WS; membership ACL for conversations/files
- [x] Path-safe file ids; per-chunk size limit; max upload config
- [x] Security headers on HTTP responses
- [x] Separate `intranet` / `internet` profiles

## Honest limits

- A compromised server can still push malicious **client updates** if you host installers there — distribute signed installers from a trusted channel.
- E2E does not hide metadata.
- New device = new identity keys; old history cannot be decrypted without a future backup feature.
