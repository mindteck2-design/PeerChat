# LanMsg P2P deploy (Mindteck)

No Postgres / no LanMsg Server. Install the **same client** on every PC.

## Network

| Traffic | Port | Notes |
|---------|------|--------|
| Peer API (HTTPS) | TCP **9876** (default, per user) | Change in setup if needed |
| Discovery | UDP **41234** | Broadcast on LAN |

### Example environments

Peers only see each other on the same L3 network:

- **Intranet** `172.195.x.x` (e.g. host was `172.195.120.180`) — run clients on those PCs.
- **Internet segment** `172.16.69.164` area — separate LAN; no automatic bridge to intranet.

## Client install

### Windows (quick)

Portable binary (already produced on build): `dist/windows/LanMsg.exe`

1. Copy `LanMsg.exe` to each Windows PC
2. Run it → enter **display name** → Start
3. Allow firewall for UDP **41234** and TCP **9876** (or your listen port)
4. Refresh People → **Accept** peer TLS fingerprint → chat

Full NSIS setup wizard: build with network (`npm run tauri:build`) → `app/src-tauri/target/release/bundle/nsis/`

### Linux

Build `.deb` **on Linux/WSL** (not on Windows):

```bash
packaging/client/build_linux.sh
# or: cd app && npm run tauri:build
sudo apt install ./dist/linux/lanmsg_*.deb
```

Same firewall ports as Windows.

## Data location

- SQLite + TLS certs + file staging: Tauri **app data** directory
- Decrypted downloads: `Downloads/LanMsg`

## Offline delivery

Messages/files to an offline peer stay in the **sender outbox** until that peer is discovered again and accepts delivery. If the sender is offline, nothing is delivered.

## Legacy

The old Go+Postgres stack is under `archive/server/` for reference only.
