# LanMsg deployment (Mindteck)

Two **isolated** environments — separate Postgres, separate LanMsg Server processes. Same client binary; different server URL.

| Environment | Example server IP | Client network | Signup |
|-------------|-------------------|----------------|--------|
| **Intranet** | `172.195.120.180` (last two octets may vary; prefix `172.195` is fixed on your LAN) | Same `172.195.x.x` users | Open self-signup |
| **Internet** | `172.16.69.164` | Clients that can reach that host | Invite code required |

There is **no** federation between the two databases.

## 1. PostgreSQL 18 on each server PC

On the **intranet** host:

```bash
psql -U postgres -f server/deploy/postgres_intranet.sql
```

On the **internet** host:

```bash
psql -U postgres -f server/deploy/postgres_internet.sql
```

Change `CHANGE_ME_*` passwords before production.

## 2. LanMsg Server on each host

```bash
cd server
# Intranet host:
copy deploy\config.intranet.example.json config.json
# Internet host:
copy deploy\config.internet.example.json config.json

# Edit database_url password, then:
go build -o dist\lanmsg-server.exe .\cmd\lanmsg-server
.\dist\lanmsg-server.exe -config config.json
```

Server binds `0.0.0.0:8765` (HTTPS) and UDP discovery `41234`.  
Note the **TLS fingerprint** printed at startup.

Open firewall:

- TCP **8765** (API / WSS)
- UDP **41234** (optional auto-discovery on LAN)

## 3. Client URLs

| Environment | Typical server URL in Settings / Login |
|-------------|----------------------------------------|
| Intranet | `https://172.195.120.180:8765` (use the actual host IP) |
| Internet | `https://172.16.69.164:8765` |

On first connect: accept TLS fingerprint (TOFU). Intranet clients on `172.195.*` can also use **Discover** if UDP is allowed.

## 4. Laptop workflow (download deps, build)

```bash
git clone https://github.com/mindteck2-design/LanMsg.git
cd LanMsg

# Server
cd server
go mod tidy
go mod vendor   # optional: for offline builds later
go build -o dist/lanmsg-server.exe ./cmd/lanmsg-server

# Client
cd ../app
npm install
npm run tauri:build
```

Copy `server/dist/lanmsg-server.exe` and client installers (under `app/src-tauri/target/release/bundle/`) to the office PCs.  
Postgres must already be installed on each server PC.

## 5. Security notes

- Never reuse the same Postgres DB or invite code across intranet and internet.
- Distribute client installers from a trusted channel.
- See `SECURITY.md` for the full checklist.
