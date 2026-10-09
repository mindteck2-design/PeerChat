# Packaging

## LanMsg Server

| Platform | Script | Output |
|----------|--------|--------|
| Windows | `server/build_windows.bat` | `server/dist/lanmsg-server.exe` (+ NSSM notes for service) |
| Linux | `server/build_linux.sh` + `server/install_systemd.sh` | binary + systemd unit |

Requires Go 1.22+ and PostgreSQL 18 on the host. Copy `config.example.json` → `config.json` and set `database_url` / `profile`.

## LanMsg Client

| Platform | Script | Output |
|----------|--------|--------|
| Windows | `client/build_windows.bat` | NSIS/MSI under `app/src-tauri/target/release/bundle/` |
| Linux | `client/build_linux.sh` | `.deb` under the same bundle path |

Requires Node 20+, Rust stable, and platform webview dependencies (WebView2 on Windows).
