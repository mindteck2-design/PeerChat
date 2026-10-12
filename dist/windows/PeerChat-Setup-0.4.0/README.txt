PeerChat — install / update (Windows)
=====================================

Quick install (recommended)
---------------------------
1. Keep this whole folder together (do not move only the .exe).
2. Double-click  Install-PeerChat.bat
3. Follow the prompts.
4. Start PeerChat from the Start Menu or Desktop shortcut.

Installing with Install-PeerChat.bat means you usually only see the Windows
SmartScreen prompt once; later updates reuse the same install location.

Where it installs
-----------------
- App:  %LOCALAPPDATA%\Programs\PeerChat\PeerChat.exe
- Start Menu: PeerChat
- Chat data is kept separately and is not wiped by updates.

Updates
-------
1. Get the new PeerChat-Setup-<version> folder (or zip).
2. Run Install-PeerChat.bat again.
3. Your chats stay put.
4. Check Settings inside PeerChat — the version number is shown there.

Requirements
------------
PeerChat needs Microsoft Edge WebView2 Runtime.
Most Windows 10/11 PCs already have it.

Optional NSIS installer
-----------------------
If this folder also contains PeerChat_*_x64-setup.exe, you may use that instead —
it is optional; Install-PeerChat.bat is enough for a normal install.
