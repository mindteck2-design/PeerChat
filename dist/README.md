# PeerTalk installers / binaries

## Windows (available now)

Portable app (no installer wrapper — NSIS download was blocked on the corporate network):

| File | Path |
|------|------|
| **PeerTalk.exe** | `dist/windows/PeerTalk.exe` |

### Use on two PCs

1. Copy `PeerTalk.exe` to the other PC (USB / share).
2. On each PC: run `PeerTalk.exe` (WebView2 required — already on most Windows 10/11).
3. Enter a **display name** → Start.
4. Allow firewall prompts for **UDP 41234** and **TCP 9876** (or the port you chose).
5. Open **People** → Refresh → accept TLS fingerprint → chat.

Same exe on both machines. No Postgres / no server install.

### Full NSIS installer (`.exe` setup wizard)

Build on a PC with internet (laptop):

```bat
cd app
npm install
npm run tauri:build
```

Installer appears under:

`app\src-tauri\target\release\bundle\nsis\`

## Linux `.deb`

Must be built **on Linux** (or WSL with Rust + `libwebkit2gtk` deps) with network access:

```bash
cd app
npm install
npm run tauri:build
# output: app/src-tauri/target/release/bundle/deb/*.deb
```

Then: `sudo apt install ./lanmsg_*.deb`

Copy the `.deb` to other Linux machines and install the same way.
