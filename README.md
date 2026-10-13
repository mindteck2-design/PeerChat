# PeerChat

LAN peer-to-peer messenger. No central server — each PC runs the app, discovers peers on the network, and sends end-to-end encrypted chats and files directly.

## Requirements

- **Windows 10/11** with [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (usually already installed)
- Same LAN (or VPN) as the people you chat with
- Firewall: allow **UDP 41234** (discovery) and **TCP 9876** (or the listen port you choose)

## Install (end users)

1. Get a `PeerChat-Setup-<version>` folder (or zip) from your team.
2. Run `Install-PeerChat.bat` (no admin needed).
3. Open PeerChat from the Start Menu or Desktop shortcut.
4. Enter a display name and start.
5. On **People**, refresh, then **Accept** each peer’s fingerprint the first time you talk.

Updates: run `Install-PeerChat.bat` again from a newer setup folder. Chat history is kept.

Uninstall: Start Menu → PeerChat → Uninstall PeerChat  
(or `Force-Uninstall-PeerChat.ps1` if uninstall is stuck)

Data lives in `%APPDATA%\com.peerchat.app` and is not removed by uninstall.

## Develop / build

Needs **Node 20+**, **Rust stable** (MSVC toolchain on Windows), and WebView2.

```bash
cd app
npm install
npm run tauri:dev      # hot reload
npm run tauri:build    # release binary + optional NSIS under src-tauri/target/release/
```

### Windows install pack

```bash
cd packaging/client
cmd //c build_windows.bat
```

Output:

- `dist/windows/PeerChat.exe` — portable
- `dist/windows/PeerChat-Setup-<version>/` — share this folder; recipients run `Install-PeerChat.bat`

### Linux `.deb`

Build on Linux or WSL (not from Windows MSVC):

```bash
packaging/client/build_linux.sh
sudo apt install ./dist/linux/peerchat_*.deb
```

## Layout

```
app/                 Tauri + React client
packaging/client/    Windows/Linux install scripts
dist/                Build output (generated)
```
