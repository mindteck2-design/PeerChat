# PeerTalk (P2P)

Desktop messenger for the LAN — **no central server**. Each PC runs the Tauri app (**PeerTalk**), stores data in **local SQLite**, discovers peers over **UDP**, and delivers **E2E-encrypted** messages/files directly. If a peer is offline, ciphertext stays in the **sender outbox** until they return.

Stable V1 identifiers remain `com.lanmsg.app` / `lanmsg.sqlite` so existing installs keep working.

```
D:\LanMsg\
  app\                 # Tauri 2 + React + MUI client (the product)
  archive\server\      # Old Go+Postgres design (not required)
  packaging\client\    # Win/Linux client installers
  DEPLOY.md
  SECURITY.md
```

**Remote:** https://github.com/mindteck2-design/LanMsg.git

## How it works

1. Install/run LanMsg on each PC; create a **local profile** (display name + listen port).
2. Peers announce on UDP **41234**; HTTPS peer API on TCP **9876** (configurable).
3. First chat with a peer: **TOFU** — accept their TLS fingerprint.
4. DMs/groups/files use the same E2E crypto as before; staging files live on the **sender** until ACKs.

## Limits

- No delivery if the **sender** PC is offline (outbox is local).
- No global directory — only peers discovered on the current network.
- New device = new keys unless you add a backup feature later.
- Firewall must allow UDP 41234 and each peer’s TCP listen port.

## Build (laptop / open network)

```bash
cd app
npm install
npm run tauri:dev      # development
npm run tauri:build    # NSIS/MSI/deb under src-tauri/target/release/bundle/
```

Requires Node 20+, Rust stable (MSVC on Windows), WebView2.

## Deploy notes

See [DEPLOY.md](DEPLOY.md). Postgres is **not** used.
