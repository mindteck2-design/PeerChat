PeerTalk — install / update (Windows)
=====================================

"Unknown publisher" / SmartScreen
---------------------------------
Normal for unsigned internal apps. Click More info → Run anyway (once).
Installing with Install-PeerTalk.bat means you usually only see it once,
not every time you open a new copy from Downloads/USB.
NSIS will NOT remove this warning — only a code-signing certificate would.

First-time install
------------------
1. Keep this whole folder together (do not run only the exe from a chat download path if possible).
2. Right-click the zip → Properties → Unblock (if present) → OK, then unzip.
3. Double-click  Install-PeerTalk.bat
4. Allow Windows Firewall if prompted (UDP 41234, TCP listen port).
5. Start PeerTalk from the Start Menu or Desktop shortcut.

What gets installed
-------------------
- App:  %LOCALAPPDATA%\Programs\PeerTalk\PeerTalk.exe
- Start Menu: PeerTalk
- Optional Desktop shortcut
- Listed under Settings → Apps (current user)

Updating to a new version
-------------------------
1. Get the new PeerTalk-Setup-<version> folder (or zip).
2. Run Install-PeerTalk.bat again.
3. It overwrites the installed app. Your chats (SQLite) stay in app data.
4. Check Settings inside PeerTalk — the version number is shown there.

WebView2
--------
PeerTalk needs Microsoft Edge WebView2 Runtime.
Most Windows 10/11 PCs already have it. Offline PCs: install Evergreen Standalone first.

NSIS wizard (optional)
----------------------
If this folder also contains PeerTalk_*_x64-setup.exe, you may use that instead —
same app, Microsoft-style installer. Re-run a newer setup.exe to update.
