# PeerTalk installers / binaries

Current app version: **0.3.0** (shown in the window title, sidebar, and Settings).

## What to share with users

Prefer the **install pack** (permanent Start Menu app + easy updates):

| Item | Path |
|------|------|
| **Install pack (zip)** | `dist/windows/PeerTalk-Setup-0.3.0.zip` |
| **Install pack (folder)** | `dist/windows/PeerTalk-Setup-0.3.0/` |
| Portable exe only | `dist/windows/PeerTalk.exe` |

### “Unknown publisher”

Expected for unsigned internal builds. Users: **More info → Run anyway**. Install once via `Install-PeerTalk.bat` so they don’t keep seeing it from Downloads copies. **NSIS does not remove this** — only a code-signing certificate would.

### First install (each PC)

1. Unzip the pack.
2. Double-click **`Install-PeerTalk.bat`**.
3. Start PeerTalk from the **Start Menu** or Desktop shortcut.
4. Allow firewall for UDP **41234** and the TCP listen port (see Settings).

Installed to: `%LOCALAPPDATA%\Programs\PeerTalk\`  
Chats stay in the Windows app data folder across updates.

### Updating

1. Share a newer `PeerTalk-Setup-<version>` pack (version is in the folder name and `VERSION.txt`).
2. Users run **`Install-PeerTalk.bat` again** — it overwrites the installed app.
3. They can confirm in **Settings → About** (e.g. `PeerTalk 0.3.0`).

### WebView2

Required. Most Windows 10/11 PCs have it. Offline intranet: install **WebView2 Evergreen Standalone** from USB first.

## Build (developers)

```bat
packaging\client\build_windows.bat
```

Or:

```bat
cd app
npm install
npm run tauri:build -- --no-bundle
```

Then re-run the packaging steps in `build_windows.bat` (copies exe + install scripts into `dist\windows\PeerTalk-Setup-<ver>\`).

If GitHub is reachable, `tauri build --bundles nsis` also produces a classic setup wizard under `src-tauri\target\release\bundle\nsis\`.

## Linux `.deb`

Build on Linux/WSL with network:

```bash
cd app
npm install
npm run tauri:build
```
