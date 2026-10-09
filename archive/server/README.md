# LanMsg Server

Go HTTPS/WSS API backed by PostgreSQL 18.

```bash
cp config.example.json config.json
# set database_url, profile=intranet|internet
go mod tidy
go run ./cmd/lanmsg-server -config config.json
```

Auto-migrates schema on startup. TLS cert fingerprint is printed at boot and announced on UDP `41234`.

Encrypted file chunks are staged under `data/files/<id>/` until all members download or `file_retention_hours` elapses, then deleted.
