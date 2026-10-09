# LanMsg

Equal desktop clients (login, DM/group chat, settings) against an isolated **Go + PostgreSQL 18** server per environment. Messages and files are **end-to-end encrypted**; the server relays ciphertext only.

```
D:\LanMsg\
  server\     # Go HTTPS/WSS API + UDP discovery
  app\        # Tauri 2 + React + MUI client
  DEPLOY.md   # Mindteck dual-environment deploy (IPs, Postgres, clients)
  SECURITY.md
```

**Remote:** https://github.com/mindteck2-design/LanMsg.git

## Environments (Mindteck)

| Environment | Example server | Signup | Client URL |
|-------------|----------------|--------|------------|
| Intranet | `172.195.120.180` (`172.195.*` LAN; last octets may vary) | Open | `https://172.195.x.x:8765` |
| Internet | `172.16.69.164` | Invite required | `https://172.16.69.164:8765` |

Same client binary; **no federation** between the two Postgres databases. Full steps: [DEPLOY.md](DEPLOY.md).

## File transfer model

1. Sender encrypts the file and uploads **ciphertext chunks** to the server (staging).
2. Recipients download, decrypt, and save under local `Downloads/LanMsg` (or app data).
3. Server **deletes staging blobs** after every conversation member has downloaded, or when `file_retention_hours` elapses (default 168h). Metadata remains; plaintext never lives on the server.

## Server setup

Requirements: Go 1.22+, PostgreSQL 18, create a database and role:

```sql
CREATE USER lanmsg WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE lanmsg OWNER lanmsg;
```

```bash
cd server
cp config.example.json config.json
# edit database_url, profile (intranet|internet), invite_code for internet
go mod tidy
go run ./cmd/lanmsg-server -config config.json
```

Listen: `https://0.0.0.0:8765`. UDP discovery: `41234`. TLS cert auto-generated under `data/certs/` (fingerprint logged at start).

### Windows service / Linux systemd

See `packaging/server/`.

```bash
# Windows (build + optional NSSM service)
packaging/server/build_windows.bat

# Linux
packaging/server/build_linux.sh
sudo packaging/server/install_systemd.sh
```

## Client setup

Requirements: Node 20+, Rust (for Tauri), platform WebView2 (Windows) / WebKit (Linux).

```bash
cd app
npm install
npm run tauri:dev          # development
npm run tauri:build        # NSIS/MSI + deb installers
```

On first launch: discover server (UDP) or enter URL; **accept TLS fingerprint** (TOFU). Sign up / log in. Private keys stay in Tauri store (not uploaded).

## Security

See [SECURITY.md](SECURITY.md) for the checklist, threat model, and limits.

## Config profiles

- `intranet`: open signup, standard rate limits  
- `internet`: `invite_required` defaults true; stricter login failure threshold  

Set `"profile": "internet"` and `"invite_code": "..."` in `config.json`.
