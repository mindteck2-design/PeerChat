import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  Fade,
  Grow,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Typography,
  CircularProgress,
} from "@mui/material";
import ChatIcon from "@mui/icons-material/ForumRounded";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import LogoutIcon from "@mui/icons-material/LogoutRounded";
import AttachFileIcon from "@mui/icons-material/AttachFileRounded";
import GroupAddIcon from "@mui/icons-material/GroupAddRounded";
import RefreshIcon from "@mui/icons-material/RefreshRounded";
import {
  peerApi,
  type Conversation,
  type Message,
  type Peer,
  type Profile,
} from "./peer";
import {
  CHUNK_SIZE,
  createGroupKey,
  decryptChunk,
  decryptFilename,
  decryptMessage,
  decryptWithGroupKey,
  encryptChunk,
  encryptFilename,
  encryptMessage,
  encryptWithGroupKey,
  exportPublic,
  fingerprintPublic,
  prepareFileEncryption,
  unwrapContentKey,
  unwrapGroupKey,
  wrapGroupKeyForMembers,
  type Identity,
} from "./crypto";
import { getOrCreateIdentity } from "./storage";

type Screen = "setup" | "chat" | "settings";

function newUserId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `u-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [boot, setBoot] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const id = await getOrCreateIdentity();
      setIdentity(id);
      try {
        const p = await peerApi.getProfile();
        if (p) {
          setProfile(p);
          setScreen("chat");
        }
      } catch {
        /* browser preview without tauri */
      }
      setBoot(false);
    })();
  }, []);

  if (boot || !identity) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (screen === "setup" || !profile) {
    return (
      <SetupScreen
        identity={identity}
        error={error}
        setError={setError}
        onReady={(p) => {
          setProfile(p);
          setScreen("chat");
        }}
      />
    );
  }

  if (screen === "settings") {
    return (
      <SettingsScreen
        profile={profile}
        identity={identity}
        onBack={() => setScreen("chat")}
        onReset={() => {
          setProfile(null);
          setScreen("setup");
        }}
      />
    );
  }

  return (
    <ChatScreen
      profile={profile}
      identity={identity}
      onSettings={() => setScreen("settings")}
    />
  );
}

function SetupScreen(props: {
  identity: Identity;
  error: string;
  setError: (s: string) => void;
  onReady: (p: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [port, setPort] = useState(9876);
  const [busy, setBusy] = useState(false);
  const pubs = exportPublic(props.identity);

  async function create() {
    props.setError("");
    setBusy(true);
    try {
      const p = await peerApi.setupProfile({
        displayName: name.trim() || "LanMsg User",
        userId: newUserId(),
        x25519Public: pubs.x25519_public,
        ed25519Public: pubs.ed25519_public,
        listenPort: port,
      });
      props.onReady(p);
    } catch (e: any) {
      props.setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "radial-gradient(ellipse 80% 50% at 10% -10%, rgba(15,107,92,0.18), transparent 55%), radial-gradient(ellipse 50% 40% at 100% 0%, rgba(196,92,38,0.12), transparent 50%), linear-gradient(180deg,#E8F2EE 0%, #F3F6F4 45%, #EEF1EF 100%)",
        display: "grid",
        placeItems: "center",
        p: 2,
      }}
    >
      <Fade in timeout={500}>
        <Paper elevation={0} sx={{ width: "min(440px, 100%)", p: 4, border: "1px solid #D5E3DD" }}>
          <Typography variant="overline" color="primary" letterSpacing={2}>
            LanMsg
          </Typography>
          <Typography variant="h4" sx={{ mt: 0.5, mb: 1 }}>
            Your desk identity
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Peer-to-peer on your LAN. No central server — chats live on your PC (SQLite) and deliver
            when peers are online.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Display name"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
            <TextField
              label="Listen port"
              type="number"
              fullWidth
              value={port}
              onChange={(e) => setPort(Number(e.target.value) || 9876)}
              helperText="TCP HTTPS peer port (default 9876). UDP discovery uses 41234."
            />
            {props.error && <Alert severity="error">{props.error}</Alert>}
            <Button variant="contained" size="large" disabled={busy} onClick={create}>
              {busy ? "Starting…" : "Start LanMsg"}
            </Button>
          </Stack>
        </Paper>
      </Fade>
    </Box>
  );
}

function ChatScreen({
  profile,
  identity,
  onSettings,
}: {
  profile: Profile;
  identity: Identity;
  onSettings: () => void;
}) {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [groupKeys, setGroupKeys] = useState<Record<string, Uint8Array>>({});
  const [tab, setTab] = useState(0);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupPick, setGroupPick] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [pinOpen, setPinOpen] = useState<Peer | null>(null);

  const others = useMemo(
    () => peers.filter((p) => p.user_id !== profile.id),
    [peers, profile.id]
  );

  async function refresh() {
    try {
      await peerApi.discoverPeers();
    } catch {
      /* ignore */
    }
    const [p, c] = await Promise.all([peerApi.listPeers(), peerApi.listConversations()]);
    setPeers(p);
    setConvs(c);
  }

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const msgs = await peerApi.listMessages(active.id);
      setMessages(msgs);
      if (active.kind === "group" && !groupKeys[active.id]) {
        const wrap = await peerApi.getGroupKey(active.id);
        if (wrap) {
          setGroupKeys((g) => ({ ...g, [active.id]: unwrapGroupKey(wrap, identity) }));
        }
      }
    })().catch(console.error);
    const t = setInterval(() => {
      peerApi.listMessages(active.id).then(setMessages).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [active?.id]);

  useEffect(() => {
    (async () => {
      const next: Record<string, string> = { ...plain };
      for (const m of messages) {
        if (next[m.id] || m.kind === "file_notice") continue;
        try {
          if (active?.kind === "group" && groupKeys[active.id]) {
            next[m.id] = await decryptWithGroupKey(m, groupKeys[active.id]);
          } else {
            next[m.id] = await decryptMessage(
              { ...m, wrapped_keys: m.wrapped_keys || {} },
              profile.id,
              identity
            );
          }
        } catch {
          next[m.id] = "[unable to decrypt]";
        }
      }
      setPlain(next);
    })();
  }, [messages, groupKeys, active?.id]);

  async function openDm(peer: Peer) {
    if (!peer.pinned && peer.tls_fingerprint) {
      setPinOpen(peer);
      return;
    }
    const c = await peerApi.openDm(peer.user_id);
    setActive(c);
    await refresh();
  }

  async function send() {
    if (!active || !text.trim()) return;
    const memberIds =
      active.kind === "dm" && active.peer_id
        ? [active.peer_id, profile.id]
        : await peerApi.memberIds(active.id);

    let message: any;
    if (active.kind === "dm" && active.peer_id) {
      const peer = peers.find((p) => p.user_id === active.peer_id);
      if (!peer) return;
      const pubs: Record<string, string> = {
        [peer.user_id]: peer.x25519_public,
        [profile.id]: exportPublic(identity).x25519_public,
      };
      const enc = await encryptMessage(text.trim(), active.id, profile.id, identity, pubs);
      message = { kind: "text", sender_id: profile.id, ...enc };
    } else {
      let gk = groupKeys[active.id];
      if (!gk) {
        const wrap = await peerApi.getGroupKey(active.id);
        if (!wrap) return;
        gk = unwrapGroupKey(wrap, identity);
        setGroupKeys((g) => ({ ...g, [active.id]: gk! }));
      }
      const enc = await encryptWithGroupKey(text.trim(), active.id, profile.id, gk, identity);
      message = { kind: "text", sender_id: profile.id, ...enc };
    }
    await peerApi.sendMessage(
      active.id,
      message,
      memberIds.filter((id) => id !== profile.id)
    );
    setText("");
    setMessages(await peerApi.listMessages(active.id));
  }

  async function sendFile(file: File) {
    if (!active) return;
    setStatus(`Encrypting ${file.name}…`);
    const memberIds = await peerApi.memberIds(active.id);
    const pubs: Record<string, string> = {
      [profile.id]: exportPublic(identity).x25519_public,
    };
    for (const mid of memberIds) {
      const p = peers.find((x) => x.user_id === mid);
      if (p) pubs[mid] = p.x25519_public;
    }
    const { contentKey, wrapped_keys } = await prepareFileEncryption(identity, pubs);
    const nameEnc = encryptFilename(contentKey, file.name);
    const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const { file_id, staging_dir } = await peerApi.createOutgoingFile({
      conversationId: active.id,
      encFilename: nameEnc.ciphertext,
      filenameNonce: nameEnc.nonce,
      sizeBytes: file.size,
      chunkCount,
      wrappedKeys: wrapped_keys,
    });
    for (let i = 0; i < chunkCount; i++) {
      const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const buf = new Uint8Array(await slice.arrayBuffer());
      const { nonce, ciphertext } = encryptChunk(contentKey, buf);
      await peerApi.writeFileChunk(staging_dir, i, Array.from(ciphertext), nonce);
      setStatus(`Staging ${i + 1}/${chunkCount}`);
    }
    // keep local plaintext copy
    try {
      await peerApi.saveDownloadedFile(file.name, Array.from(new Uint8Array(await file.arrayBuffer())));
    } catch {
      /* ignore */
    }
    await peerApi.sendFileNotice(
      active.id,
      file_id,
      memberIds.filter((id) => id !== profile.id)
    );
    setStatus("");
    setMessages(await peerApi.listMessages(active.id));
  }

  async function downloadFile(fileId: string, uploaderId: string) {
    setStatus("Downloading…");
    const file = await peerApi.getFile(fileId);
    if (!file) {
      setStatus("File metadata missing");
      return;
    }
    const key = unwrapContentKey(file.wrapped_keys, profile.id, identity);
    const parts: Uint8Array[] = [];
    for (let i = 0; i < file.chunk_count; i++) {
      if (uploaderId === profile.id && file.staging_dir) {
        // local staging — not exposed via fetch; ask peer API only for remote
      }
      const chunk = await peerApi.fetchFileChunk(fileId, i, uploaderId);
      parts.push(decryptChunk(key, chunk.nonce, fromB64(chunk.data_b64)));
      setStatus(`Decrypting ${i + 1}/${file.chunk_count}`);
    }
    let name = "file.bin";
    try {
      name = decryptFilename(key, file.filename_nonce, file.enc_filename);
    } catch {
      /* keep */
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.length;
    }
    const path = await peerApi.saveDownloadedFile(name, Array.from(merged));
    await peerApi.ackFileDownload(fileId, uploaderId);
    setStatus(`Saved to ${path}`);
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <Drawer
        variant="permanent"
        sx={{
          width: 300,
          [`& .MuiDrawer-paper`]: {
            width: 300,
            borderRight: "1px solid #D5E3DD",
            background: "linear-gradient(180deg,#F7FBFA 0%, #FFFFFF 40%)",
          },
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <ChatIcon color="primary" />
          <Box flex={1}>
            <Typography variant="subtitle1" fontWeight={700}>
              {profile.display_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              P2P · port {profile.listen_port}
            </Typography>
          </Box>
          <IconButton aria-label="Refresh peers" onClick={() => refresh()}>
            <RefreshIcon />
          </IconButton>
          <IconButton aria-label="Settings" onClick={onSettings}>
            <SettingsIcon />
          </IconButton>
        </Toolbar>
        <Divider />
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
          <Tab label="People" />
          <Tab label="Chats" />
        </Tabs>
        {tab === 0 && (
          <List dense sx={{ overflow: "auto" }}>
            {others.map((p) => (
              <ListItemButton key={p.user_id} onClick={() => openDm(p)}>
                <Avatar sx={{ width: 36, height: 36, mr: 1.5, bgcolor: "primary.main" }}>
                  {p.display_name.slice(0, 1).toUpperCase()}
                </Avatar>
                <ListItemText
                  primary={p.display_name}
                  secondary={p.online ? `${p.last_ip || "?"}:${p.last_port || ""}` : "Offline"}
                />
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: p.online ? "success.main" : "grey.400",
                  }}
                />
              </ListItemButton>
            ))}
            {!others.length && (
              <Typography sx={{ p: 2 }} color="text.secondary">
                No peers yet. Start LanMsg on another PC on this LAN and hit refresh.
              </Typography>
            )}
          </List>
        )}
        {tab === 1 && (
          <>
            <Box px={2} py={1}>
              <Button
                startIcon={<GroupAddIcon />}
                fullWidth
                variant="outlined"
                onClick={() => setGroupOpen(true)}
              >
                New group
              </Button>
            </Box>
            <List dense>
              {convs.map((c) => (
                <ListItemButton
                  key={c.id}
                  selected={active?.id === c.id}
                  onClick={() => setActive(c)}
                >
                  <ListItemText
                    primary={c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group"}
                    secondary={c.kind}
                  />
                </ListItemButton>
              ))}
            </List>
          </>
        )}
      </Drawer>

      <Box flex={1} display="flex" flexDirection="column">
        <AppBar
          position="sticky"
          color="transparent"
          elevation={0}
          sx={{ borderBottom: "1px solid #D5E3DD" }}
        >
          <Toolbar>
            <Typography variant="h6">
              {active
                ? active.kind === "dm"
                  ? active.peer_name
                  : active.title
                : "Select a conversation"}
            </Typography>
            <Box flex={1} />
            {status && <Chip size="small" label={status} />}
          </Toolbar>
        </AppBar>

        <Box flex={1} p={2} overflow="auto" display="flex" flexDirection="column" gap={1}>
          {!active && (
            <Box m="auto" textAlign="center" maxWidth={360}>
              <Typography variant="h5" gutterBottom>
                Peer chat on your LAN
              </Typography>
              <Typography color="text.secondary">
                Messages wait in your outbox if the other PC is offline, then deliver when they
                return.
              </Typography>
            </Box>
          )}
          {messages.map((m) => (
            <Grow in key={m.id} timeout={220}>
              <Paper
                elevation={0}
                sx={{
                  alignSelf: m.sender_id === profile.id ? "flex-end" : "flex-start",
                  maxWidth: "70%",
                  p: 1.5,
                  bgcolor: m.sender_id === profile.id ? "#DCEFE9" : "#FFFFFF",
                  border: "1px solid #D5E3DD",
                }}
              >
                {m.kind === "file_notice" ? (
                  <Button
                    size="small"
                    onClick={() => m.file_id && downloadFile(m.file_id, m.sender_id)}
                  >
                    Download & save locally
                  </Button>
                ) : (
                  <Typography whiteSpace="pre-wrap">{plain[m.id] || "…"}</Typography>
                )}
                <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                  {new Date(m.created_at).toLocaleString()}
                  {m.sender_id === profile.id
                    ? m.delivered
                      ? " · delivered"
                      : " · queued"
                    : ""}
                </Typography>
              </Paper>
            </Grow>
          ))}
        </Box>

        {active && (
          <Paper
            square
            elevation={0}
            sx={{ p: 1.5, borderTop: "1px solid #D5E3DD", display: "flex", gap: 1 }}
          >
            <IconButton component="label" aria-label="Attach file">
              <AttachFileIcon />
              <input
                hidden
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) sendFile(f);
                  e.target.value = "";
                }}
              />
            </IconButton>
            <TextField
              fullWidth
              size="small"
              placeholder="Encrypted message…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
            />
            <Button variant="contained" onClick={send}>
              Send
            </Button>
          </Paper>
        )}
      </Box>

      <Dialog open={!!pinOpen} onClose={() => setPinOpen(null)}>
        <DialogTitle>Trust this peer?</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            First contact with <strong>{pinOpen?.display_name}</strong>. Verify TLS fingerprint
            out-of-band, then pin.
          </Typography>
          <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
            {pinOpen?.tls_fingerprint}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPinOpen(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!pinOpen?.tls_fingerprint) return;
              await peerApi.pinPeer(pinOpen.user_id, pinOpen.tls_fingerprint);
              const c = await peerApi.openDm(pinOpen.user_id);
              setPinOpen(null);
              setActive(c);
              await refresh();
            }}
          >
            Accept & chat
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={groupOpen} onClose={() => setGroupOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create group</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Group name"
            sx={{ mt: 1, mb: 2 }}
            value={groupTitle}
            onChange={(e) => setGroupTitle(e.target.value)}
          />
          <List dense>
            {others.map((p) => (
              <ListItemButton
                key={p.user_id}
                selected={groupPick.includes(p.user_id)}
                onClick={() =>
                  setGroupPick((g) =>
                    g.includes(p.user_id) ? g.filter((x) => x !== p.user_id) : [...g, p.user_id]
                  )
                }
              >
                <ListItemText primary={p.display_name} />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              const gk = createGroupKey();
              const pubs: Record<string, string> = {
                [profile.id]: exportPublic(identity).x25519_public,
              };
              for (const id of groupPick) {
                const u = peers.find((x) => x.user_id === id)!;
                pubs[id] = u.x25519_public;
              }
              const wraps = wrapGroupKeyForMembers(gk, identity, pubs);
              const conversation = await peerApi.createGroup(groupTitle, groupPick, wraps);
              setGroupKeys((g) => ({ ...g, [conversation.id]: gk }));
              // notify members with wrap via a lightweight deliver (group announce as empty msg optional)
              for (const rid of groupPick) {
                await peerApi.sendMessage(
                  conversation.id,
                  {
                    kind: "text",
                    sender_id: profile.id,
                    ...(await encryptWithGroupKey(
                      `Joined group “${groupTitle}”`,
                      conversation.id,
                      profile.id,
                      gk,
                      identity
                    )),
                  },
                  [rid]
                );
              }
              setGroupOpen(false);
              setActive(conversation);
              await refresh();
            }}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SettingsScreen(props: {
  profile: Profile;
  identity: Identity;
  onBack: () => void;
  onReset: () => void;
}) {
  const [fp, setFp] = useState("");
  const keyFp = fingerprintPublic(exportPublic(props.identity).x25519_public);

  useEffect(() => {
    peerApi.myFingerprint().then(setFp).catch(() => setFp("(unavailable)"));
  }, []);

  return (
    <Box minHeight="100vh" p={3} maxWidth={720} mx="auto">
      <Stack direction="row" alignItems="center" spacing={1} mb={3}>
        <Button onClick={props.onBack}>Back</Button>
        <Typography variant="h5">Settings</Typography>
      </Stack>
      <Stack spacing={3}>
        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Profile
          </Typography>
          <Typography>
            {props.profile.display_name} · port {props.profile.listen_port}
          </Typography>
          <Typography variant="body2" color="text.secondary" fontFamily="monospace">
            {props.profile.id}
          </Typography>
        </Paper>
        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Security fingerprints
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your key fingerprint
          </Typography>
          <Typography fontFamily="monospace" sx={{ mb: 2, wordBreak: "break-all" }}>
            {keyFp}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your peer TLS fingerprint
          </Typography>
          <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
            {fp || "…"}
          </Typography>
        </Paper>
        <Alert severity="info">
          No central server. Data is in local SQLite under the app data folder. Outbox delivers when
          peers are reachable. Open UDP 41234 and TCP {props.profile.listen_port} on the firewall.
        </Alert>
        <Button
          color="error"
          variant="outlined"
          startIcon={<LogoutIcon />}
          onClick={props.onReset}
        >
          Back to setup screen
        </Button>
      </Stack>
    </Box>
  );
}
