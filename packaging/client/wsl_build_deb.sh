#!/usr/bin/env bash
set -euo pipefail
LOG=/mnt/d/LanMsg/wsl-build.log
exec > >(tee "$LOG") 2>&1
echo "START $(date)"
cd /mnt/d/LanMsg/app

export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v rustc >/dev/null; then
  echo "Installing Rust via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

if ! command -v node >/dev/null; then
  echo "Installing Node 20 via nvm or nodesource may be required."
  # try using Windows node through interop as fallback
  if [ -x /mnt/c/nvm4w/nodejs/node.exe ]; then
    export PATH="/mnt/c/nvm4w/nodejs:$PATH"
    alias node=node.exe
    alias npm=npm.cmd
  fi
fi

echo "rustc: $(rustc --version 2>/dev/null || echo missing)"
echo "node: $(node -v 2>/dev/null || echo missing)"
echo "npm: $(npm -v 2>/dev/null || echo missing)"

echo "Installing apt build deps (needs sudo)..."
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential curl wget file libssl-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  librsvg2-dev patchelf

npm install
npm run tauri:build

mkdir -p /mnt/d/LanMsg/dist/linux
cp -f src-tauri/target/release/bundle/deb/*.deb /mnt/d/LanMsg/dist/linux/ || true
ls -la /mnt/d/LanMsg/dist/linux/ || true
ls -la src-tauri/target/release/bundle/deb/ || true
echo "END $(date) EXIT=$?"
