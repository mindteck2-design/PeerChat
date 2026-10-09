#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/server"
mkdir -p dist
go mod tidy
go build -ldflags="-s -w" -o dist/lanmsg-server ./cmd/lanmsg-server
cp -f config.example.json dist/config.example.json
echo "Built server/dist/lanmsg-server"
