#!/bin/bash
set -e
exec > >(tee /mnt/d/LanMsg/wsl-rust.txt) 2>&1
echo START
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rustup.sh
sh /tmp/rustup.sh -y
# shellcheck source=/dev/null
source "$HOME/.cargo/env"
rustc --version
cargo --version
echo END
