# Deploy

PeerChat is client-only (no server). See [README.md](README.md) for install and build.

**Ports:** UDP **41234** (discovery), TCP **9876** (default peer API — configurable per user).

Peers must be on the same LAN/VPN. Keep the app open (or in the tray) on both PCs for offline outbox delivery.

## Release (v1.0.0+)

1. Confirm version is synced in `app/package.json`, `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`, and `app/src/version.ts`.
2. Push to `v1` or `main` (or tag `v*`) so [build-installers](.github/workflows/build-installers.yml) produces Windows NSIS + Linux `.deb` artifacts.
3. Download CI artifacts (or build locally via `packaging/client/build_windows.bat` / `build_linux.sh`).
4. Distribute the setup folder / installer from a **trusted channel** only (see [SECURITY.md](SECURITY.md)). Windows builds are unsigned — SmartScreen may warn until a code-signing cert is configured.
5. End users: run `Install-PeerChat.bat` (or install the `.deb`). Re-run from a newer pack to update; chat history is kept.
