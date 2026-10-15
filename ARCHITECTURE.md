# PeerChat architecture

PeerChat is a Tauri desktop app: React UI talks to a Rust backend over IPC. Chats and files live in local SQLite; peers discover each other on the LAN and deliver over HTTPS.

## Layers

```
app/src/                 React UI (features + shared)
    └── peer.ts          IPC client (stable command names)
app/src-tauri/src/
    ├── commands/        Tauri #[tauri::command] handlers by domain
    ├── runtime/         Outbox flush, group events, bootstrap / discovery start
    ├── db/              SQLite schema migrate() + domain query helpers
    ├── peer_http.rs     Inbound peer HTTP
    └── discovery.rs     LAN beacons
```

Behavior-preserving rule: product features, protocol, and IPC **command names** stay stable across refactors. Prefer move + thin wrappers over rewrites.

## Frontend layout

| Path | Responsibility |
|------|----------------|
| `app/src/app/App.tsx` | Boot, identity load, screen switch (setup / chat / settings) |
| `app/src/app/ChatScreen.tsx` | Composition shell: wires hooks, panels, dialogs |
| `features/setup` | First-run profile setup |
| `features/settings` | Settings screen |
| `features/chat` | MessageList, Composer, RichCard, decrypt/sync hooks |
| `features/files` | File preview dialog, transfer abort/pause hook |
| `features/groups` | Group create/members dialogs, group crypto + admin hooks |
| `features/announcements` | Announcement board ensure/sync hook |
| `features/peers` | Trust / pin dialogs |
| `features/shell` | NavRail, conversation/people list pane |
| `shared/` | Format helpers, transfer types, message meta |
| `peer.ts`, `crypto.ts`, `storage.ts`, `theme`, `games/` | Existing modules — leave in place unless a feature owns them |

**Where new UI goes:** `features/<name>/` (screen, panel, dialog, or hook). Keep `ChatScreen` as wiring only; avoid new god-file logic there.

**Where shared pure helpers go:** `shared/` (no React hooks, no IPC side effects).

## Backend layout

| Path | Responsibility |
|------|----------------|
| `lib.rs` | `mod`s, `run()`, `generate_handler!` only |
| `state.rs` | `AppState` |
| `util.rs` | Shared helpers (download paths, chunk limits, fingerprints) |
| `runtime/bootstrap.rs` | Start discovery + HTTP, tray-related process helpers |
| `runtime/outbox.rs` | Deliver pending outbox / kick flush |
| `runtime/group_events.rs` | Enqueue group fan-out events |
| `commands/<domain>.rs` | IPC handlers (`profile`, `peers`, `conversations`, `messages`, `groups`, `files`, `transfers`, `settings`) |
| `db/mod.rs` | `open()` + **monolithic** `migrate()` / `user_version` |
| `db/{profile,peers,...}.rs` | Query helpers; re-exported from `db/mod.rs` as `db::…` |

**Where new commands go:** `commands/<domain>.rs` (same IPC name the frontend already calls, or add a matching `peer.ts` wrapper).

**Where new SQL goes:** domain file under `db/`; schema changes only in `db/mod.rs` `migrate()` — do not fragment migrations.

## IPC

- Frontend uses `peerApi.*` in `peer.ts`.
- Rust handlers keep the same `#[tauri::command]` names so the UI does not churn during splits.
- Inbound peer HTTP stays in `peer_http.rs`; outbound delivery stays in `runtime/outbox.rs`.

## Smoke checklist (after a split)

1. `cd app && npx tsc --noEmit`
2. `cargo check --manifest-path app/src-tauri/Cargo.toml`
3. Manual: boot → People refresh → DM send → group message → file send → announcements → transfers
