#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$ROOT/packaging/server/build_linux.sh"
sudo useradd -r -s /usr/sbin/nologin lanmsg 2>/dev/null || true
sudo mkdir -p /opt/lanmsg-server/data
sudo cp "$ROOT/server/dist/lanmsg-server" /opt/lanmsg-server/
if [[ ! -f /opt/lanmsg-server/config.json ]]; then
  sudo cp "$ROOT/server/config.example.json" /opt/lanmsg-server/config.json
  echo "Edit /opt/lanmsg-server/config.json before starting"
fi
sudo chown -R lanmsg:lanmsg /opt/lanmsg-server
sudo cp "$ROOT/packaging/server/lanmsg-server.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lanmsg-server
echo "LanMsg Server installed (systemd unit lanmsg-server)"
