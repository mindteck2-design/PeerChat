#!/bin/bash
export PATH="/c/Users/vikas/.cargo/bin:$PATH"
cd /d/LanMsg/app
exec > /d/LanMsg/build-out.txt 2>&1
echo "START $(date)"
cargo --version
node -v
npm run tauri:build
echo "EXIT=$?"
echo "END $(date)"
find src-tauri/target/release/bundle -type f \( -name '*.exe' -o -name '*.deb' -o -name '*.msi' \) 2>/dev/null
