#!/bin/bash
export PATH="/c/Users/vikas/.cargo/bin:$PATH"
cd /d/PeerChat/app
exec > /d/PeerChat/build-out.txt 2>&1
echo "START $(date)"
cargo --version
node -v
npm run tauri:build
echo "EXIT=$?"
echo "END $(date)"
find src-tauri/target/release/bundle -type f \( -name '*.exe' -o -name '*.deb' -o -name '*.msi' \) 2>/dev/null
