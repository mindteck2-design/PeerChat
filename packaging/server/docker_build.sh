#!/usr/bin/env bash
set -euo pipefail
export MSYS_NO_PATHCONV=1
DOCKER="/c/Program Files/Docker/Docker/resources/bin/docker.exe"
"$DOCKER" run --rm -v "D:/LanMsg/server:/src" -w "/src" golang:1.22-bookworm \
  bash -c "go mod tidy && mkdir -p dist && GOOS=windows GOARCH=amd64 go build -ldflags='-s -w' -o dist/lanmsg-server.exe ./cmd/lanmsg-server && go build -ldflags='-s -w' -o dist/lanmsg-server ./cmd/lanmsg-server && ls -la dist/ go.sum"
echo "OK"
