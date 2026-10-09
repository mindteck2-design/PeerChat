#!/usr/bin/env bash
# Run on Linux (or WSL) with network — produces .deb
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/app"
export PATH="$HOME/.cargo/bin:$PATH"
npm install
npm run tauri:build
mkdir -p "$ROOT/dist/linux"
cp -f src-tauri/target/release/bundle/deb/*.deb "$ROOT/dist/linux/" 2>/dev/null || true
ls -la "$ROOT/dist/linux/" || ls -la src-tauri/target/release/bundle/deb/
echo "Install with: sudo apt install ./dist/linux/lanmsg_*.deb"
