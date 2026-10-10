# Packaging

## Client only (P2P)

| Platform | Script | Output |
|----------|--------|--------|
| Windows | `client/build_windows.bat` | NSIS under `bundle/nsis/` + portable `dist/windows/PeerTalk.exe` |
| Linux | `client/build_linux.sh` | `.deb` → `dist/linux/` |

Targets in `app/src-tauri/tauri.conf.json`: `nsis` + `deb`.

- **NSIS** needs download of the NSIS toolchain (GitHub) — use an open network / laptop.
- **`.deb`** must be built on **Linux/WSL**, not on native Windows.

Ready-to-copy notes: [`../dist/README.md`](../dist/README.md)

## Legacy

`packaging/server/` is for the archived Go server — not used.
