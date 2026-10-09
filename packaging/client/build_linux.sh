#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/app"
npm install
npm run tauri:build
echo "Installers under app/src-tauri/target/release/bundle/"
