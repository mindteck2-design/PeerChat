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
  api,
  discoverServers,
  fetchTlsFingerprint,
  getBaseUrl,
  getToken,
  setBaseUrl,
  setToken,
  type Conversation,
  type Message,
  type User,
} from "./api";
import {
  CHUNK_SIZE,
  createGroupKey,
  decryptMessage,
  decryptWithGroupKey,
  encryptChunk,
  encryptFilename,
  decryptFilename,
  encryptMessage,
  encryptWithGroupKey,
  exportPublic,
  fingerprintPublic,
  prepareFileEncryption,
  unwrapContentKey,
  unwrapGroupKey,
  wrapGroupKeyForMembers,
  type Identity,
  decryptChunk,
} from "./crypto";
import { KEYS, getOrCreateIdentity, loadLocal, removeLocal, saveLocal } from "./storage";

type Screen = "login" | "chat" | "settings";

export default function App() {
  const [screen, setScreen] = useState<Screen>("login");
  const [boot, setBoot] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [serverUrl, setServerUrl] = useState("");
  const [pinnedFp, setPinnedFp] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState<{ invite_required?: boolean; fingerprint?: string; profile?: string }>({});

  useEffect(() => {
    (async () => {
      const id = await getOrCreateIdentity();
      setIdentity(id);
      const url = (await loadLocal<string>(KEYS.serverUrl)) || "https://127.0.0.1:8765";
      const fp = (await loadLocal<string>(KEYS.pinnedFp)) || "";
      const tok = (await loadLocal<string>(KEYS.token)) || "";
      const u = await loadLocal<User>(KEYS.user);
      setServerUrl(url);
      setPinnedFp(fp);
      setBaseUrl(url);
      if (tok && u) {
        setToken(tok);
        try {
          const me = await api.me();
          if (fp && me.server_fingerprint && fp !== me.server_fingerprint) {
            setError("Server TLS fingerprint changed. Re-pin in Settings.");
          } else {
            setUser(me.user);
            setScreen("chat");
          }
        } catch {
          await removeLocal(KEYS.token);
        }
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

  if (screen === "login" || !user) {
    return (
      <LoginScreen
        identity={identity}
        serverUrl={serverUrl}
        pinnedFp={pinnedFp}
        info={info}
        error={error}
        setError={setError}
        setInfo={setInfo}
        setServerUrl={setServerUrl}
        setPinnedFp={setPinnedFp}
        onAuthed={async (u, tok, fp) => {
          setUser(u);
          setToken(tok);
          setPinnedFp(fp);
          await saveLocal(KEYS.token, tok);
          await saveLocal(KEYS.user, u);
          await saveLocal(KEYS.pinnedFp, fp);
          await saveLocal(KEYS.serverUrl, getBaseUrl());
          setScreen("chat");
        }}
      />
    );
  }

  if (screen === "settings") {
    return (
      <SettingsScreen
        user={user}
        identity={identity}
        serverUrl={serverUrl}
        pinnedFp={pinnedFp}
        onBack={() => setScreen("chat")}
        onLogout={async () => {
          try {
            await api.logout();
          } catch {
            /* ignore */
          }
          setToken("");
          setUser(null);
          await removeLocal(KEYS.token);
          await removeLocal(KEYS.user);
          setScreen("login");
        }}
        onUser={(u) => setUser(u)}
        setServerUrl={setServerUrl}
        setPinnedFp={setPinnedFp}
      />
    );
  }

  return (
    <ChatScreen
      user={user}
      identity={identity}
      onSettings={() => setScreen("settings")}
      onLogout={async () => {
        try {
          await api.logout();
        } catch {
          /* ignore */
        }
        setToken("");
        setUser(null);
        await removeLocal(KEYS.token);
        await removeLocal(KEYS.user);
        setScreen("login");
      }}
    />
  );
}

function LoginScreen(props: {
  identity: Identity;
  serverUrl: string;
  pinnedFp: string;
  info: any;
  error: string;
  setError: (s: string) => void;
  setInfo: (v: any) => void;
  setServerUrl: (s: string) => void;
  setPinnedFp: (s: string) => void;
  onAuthed: (u: User, tok: string, fp: string) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [invite, setInvite] = useState("");
  const [url, setUrl] = useState(props.serverUrl);
  const [pendingFp, setPendingFp] = useState("");
  const [tofuOpen, setTofuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pubs = exportPublic(props.identity);

  async function connectAndAuth() {
    props.setError("");
    setBusy(true);
    try {
      setBaseUrl(url);
      await saveLocal(KEYS.serverUrl, url);
      const inf = await api.info();
      props.setInfo(inf);
      const fp = inf.fingerprint || (await fetchTlsFingerprint(url));
      if (props.pinnedFp && fp && props.pinnedFp !== fp) {
        props.setError("TLS fingerprint mismatch. Clear pin in Settings or accept new cert.");
        setPendingFp(fp);
        setTofuOpen(true);
        return;
      }
      if (!props.pinnedFp && fp) {
        setPendingFp(fp);
        setTofuOpen(true);
        return;
      }
      await doAuth(fp || props.pinnedFp);
    } catch (e: any) {
      props.setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function doAuth(fp: string) {
    const body =
      mode === "signup"
        ? {
            username,
            password,
            display_name: displayName || username,
            invite,
            ...pubs,
          }
        : { username, password };
    const res = mode === "signup" ? await api.signup(body) : await api.login(body);
    const serverFp = res.server_fingerprint || fp;
    props.setPinnedFp(serverFp);
    props.onAuthed(res.user, res.token, serverFp);
  }

  async function scan() {
    props.setError("");
    const found = await discoverServers();
    if (!found.length) {
      props.setError("No LanMsg server discovered on UDP 41234. Enter URL manually.");
      return;
    }
    const s = found[0];
    setUrl(`https://${s.ip}:${s.port}`);
    props.setInfo({ fingerprint: s.fingerprint, profile: s.profile });
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
            Private desk chat
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            End-to-end encrypted. Your server never sees message plaintext.
          </Typography>

          <Stack spacing={2}>
            <Stack direction="row" spacing={1}>
              <TextField
                label="Server URL"
                fullWidth
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <IconButton aria-label="Discover server" onClick={scan}>
                <RefreshIcon />
              </IconButton>
            </Stack>
            <Tabs value={mode} onChange={(_, v) => setMode(v)}>
              <Tab value="login" label="Log in" />
              <Tab value="signup" label="Sign up" />
            </Tabs>
            {mode === "signup" && (
              <TextField
                label="Display name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                fullWidth
              />
            )}
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              fullWidth
              autoComplete="username"
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
            {mode === "signup" && props.info.invite_required && (
              <TextField
                label="Invite code"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
                fullWidth
              />
            )}
            {props.error && <Alert severity="error">{props.error}</Alert>}
            <Button variant="contained" size="large" disabled={busy} onClick={connectAndAuth}>
              {busy ? "Working…" : mode === "signup" ? "Create account" : "Enter"}
            </Button>
            {props.pinnedFp && (
              <Chip size="small" label={`Pinned TLS ${props.pinnedFp.slice(0, 12)}…`} />
            )}
          </Stack>
        </Paper>
      </Fade>

      <Dialog open={tofuOpen} onClose={() => setTofuOpen(false)}>
        <DialogTitle>Trust this server?</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            First connection — verify this TLS fingerprint out-of-band, then accept to pin it.
          </Typography>
          <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
            {pendingFp}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTofuOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              setTofuOpen(false);
              setBusy(true);
              try {
                await doAuth(pendingFp);
              } catch (e: any) {
                props.setError(e.message || String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Accept & continue
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ChatScreen({
  user,
  identity,
  onSettings,
  onLogout,
}: {
  user: User;
  identity: Identity;
  onSettings: () => void;
  onLogout: () => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
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

  const others = useMemo(() => users.filter((u) => u.id !== user.id), [users, user.id]);

  async function refresh() {
    const [u, c] = await Promise.all([api.users(), api.conversations()]);
    setUsers(u.users);
    setConvs(c.conversations);
  }

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => {}), 8000);
    let ws: WebSocket | null = null;
    try {
      const base = getBaseUrl().replace("https://", "wss://").replace("http://", "ws://");
      ws = new WebSocket(`${base}/ws?token=${encodeURIComponent(getToken())}`);
      ws.onmessage = async (ev) => {
        const data = JSON.parse(ev.data);
        if (data.type === "presence") refresh();
        if (data.type === "message" && active && data.message.conversation_id === active.id) {
          setMessages((m) => [...m, data.message]);
        }
      };
    } catch {
      /* web may block */
    }
    return () => {
      clearInterval(t);
      ws?.close();
    };
  }, [active?.id]);

  useEffect(() => {
    if (!active) return;
    (async () => {
      const { messages: msgs } = await api.messages(active.id);
      setMessages(msgs);
      if (active.kind === "group" && !groupKeys[active.id]) {
        const { wrapped_group_key } = await api.groupKey(active.id);
        if (wrapped_group_key) {
          setGroupKeys((g) => ({ ...g, [active.id]: unwrapGroupKey(wrapped_group_key, identity) }));
        }
      }
    })().catch(console.error);
  }, [active?.id]);

  useEffect(() => {
    (async () => {
      const next: Record<string, string> = { ...plain };
      for (const m of messages) {
        if (next[m.id] || m.kind === "file_notice") continue;
        try {
          if (active?.kind === "group" && groupKeys[active.id]) {
            next[m.id] = await decryptWithGroupKey(
              { ...m, conversation_id: m.conversation_id },
              groupKeys[active.id]
            );
          } else {
            next[m.id] = await decryptMessage(
              { ...m, wrapped_keys: m.wrapped_keys || {} },
              user.id,
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

  async function openDm(peer: User) {
    const { conversation } = await api.openDm(peer.id);
    setActive(conversation);
    await refresh();
  }

  async function send() {
    if (!active || !text.trim()) return;
    const memberPubs: Record<string, string> = {};
    if (active.kind === "dm" && active.peer_id) {
      const peer = users.find((u) => u.id === active.peer_id);
      if (!peer) return;
      memberPubs[peer.id] = peer.x25519_public;
      memberPubs[user.id] = exportPublic(identity).x25519_public;
      const enc = await encryptMessage(text.trim(), active.id, user.id, identity, memberPubs);
      await api.sendMessage(active.id, { kind: "text", ...enc });
    } else {
      let gk = groupKeys[active.id];
      if (!gk) {
        const { wrapped_group_key } = await api.groupKey(active.id);
        gk = unwrapGroupKey(wrapped_group_key, identity);
        setGroupKeys((g) => ({ ...g, [active.id]: gk! }));
      }
      const enc = await encryptWithGroupKey(text.trim(), active.id, user.id, gk, identity);
      await api.sendMessage(active.id, { kind: "text", ...enc });
    }
    setText("");
    const { messages: msgs } = await api.messages(active.id);
    setMessages(msgs);
  }

  async function sendFile(file: File) {
    if (!active) return;
    setStatus(`Encrypting ${file.name}…`);
    const { members } = await api.members(active.id);
    const pubs: Record<string, string> = {};
    for (const m of members) pubs[m.id] = m.x25519_public;
    const { contentKey, wrapped_keys } = await prepareFileEncryption(identity, pubs);
    const nameEnc = encryptFilename(contentKey, file.name);
    const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    const { file_id } = await api.createFile({
      conversation_id: active.id,
      enc_filename: nameEnc.ciphertext,
      filename_nonce: nameEnc.nonce,
      size_bytes: file.size,
      chunk_count: chunkCount,
      wrapped_keys,
    });
    for (let i = 0; i < chunkCount; i++) {
      const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      const buf = new Uint8Array(await slice.arrayBuffer());
      const { nonce, ciphertext } = encryptChunk(contentKey, buf);
      await api.putChunk(file_id, i, ciphertext, nonce);
      setStatus(`Uploading ${i + 1}/${chunkCount}`);
    }
    // Keep a local copy for the sender
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const buf = new Uint8Array(await file.arrayBuffer());
      await invoke("save_downloaded_file", { filename: file.name, data: Array.from(buf) });
      await api.fileDownloaded(file_id);
    } catch {
      /* browser: skip local staging path */
    }
    await api.sendMessage(active.id, {
      kind: "file_notice",
      ciphertext: "",
      nonce: "",
      wrapped_keys: {},
      signature: "",
      file_id,
    });
    setStatus("");
    const { messages: msgs } = await api.messages(active.id);
    setMessages(msgs);
  }

  async function downloadFile(fileId: string) {
    setStatus("Downloading…");
    const { file } = await api.getFile(fileId);
    if (file.purged) {
      setStatus("File no longer on server — ask sender to re-share");
      return;
    }
    const key = unwrapContentKey(file.wrapped_keys, user.id, identity);
    const parts: Uint8Array[] = [];
    for (let i = 0; i < file.chunk_count; i++) {
      const { nonce, buf } = await api.getChunk(fileId, i);
      parts.push(decryptChunk(key, nonce, buf));
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
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const path = await invoke<string>("save_downloaded_file", {
        filename: name,
        data: Array.from(merged),
      });
      await api.fileDownloaded(fileId);
      setStatus(`Saved to ${path}`);
    } catch {
      const blob = new Blob([merged]);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      try {
        await api.fileDownloaded(fileId);
      } catch {
        /* ignore */
      }
      setStatus("Saved locally");
    }
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
              {user.display_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              @{user.username}
            </Typography>
          </Box>
          <IconButton aria-label="Settings" onClick={onSettings}>
            <SettingsIcon />
          </IconButton>
          <IconButton aria-label="Log out" onClick={onLogout}>
            <LogoutIcon />
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
              <ListItemButton key={p.id} onClick={() => openDm(p)}>
                <Avatar sx={{ width: 36, height: 36, mr: 1.5, bgcolor: "primary.main" }}>
                  {p.display_name.slice(0, 1).toUpperCase()}
                </Avatar>
                <ListItemText
                  primary={p.display_name}
                  secondary={p.online ? "Online" : "Offline"}
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
                No other users yet. Ask teammates to sign up on this server.
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
        <AppBar position="sticky" color="transparent" elevation={0} sx={{ borderBottom: "1px solid #D5E3DD" }}>
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
                Start a private chat
              </Typography>
              <Typography color="text.secondary">
                Pick someone from People, or create a group. Messages are E2E encrypted on this device.
              </Typography>
            </Box>
          )}
          {messages.map((m) => (
            <Grow in key={m.id} timeout={220}>
              <Paper
                elevation={0}
                sx={{
                  alignSelf: m.sender_id === user.id ? "flex-end" : "flex-start",
                  maxWidth: "70%",
                  p: 1.5,
                  bgcolor: m.sender_id === user.id ? "#DCEFE9" : "#FFFFFF",
                  border: "1px solid #D5E3DD",
                }}
              >
                {m.kind === "file_notice" ? (
                  <Button size="small" onClick={() => m.file_id && downloadFile(m.file_id)}>
                    Download & save locally
                  </Button>
                ) : (
                  <Typography whiteSpace="pre-wrap">{plain[m.id] || "…"}</Typography>
                )}
                <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
                  {new Date(m.created_at).toLocaleString()}
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
          <Typography variant="subtitle2" gutterBottom>
            Members
          </Typography>
          <List dense>
            {others.map((p) => (
              <ListItemButton
                key={p.id}
                selected={groupPick.includes(p.id)}
                onClick={() =>
                  setGroupPick((g) =>
                    g.includes(p.id) ? g.filter((x) => x !== p.id) : [...g, p.id]
                  )
                }
              >
                <ListItemText primary={p.display_name} secondary={p.username} />
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
                [user.id]: exportPublic(identity).x25519_public,
              };
              for (const id of groupPick) {
                const u = users.find((x) => x.id === id)!;
                pubs[id] = u.x25519_public;
              }
              const wraps = wrapGroupKeyForMembers(gk, identity, pubs);
              const { conversation } = await api.createGroup(groupTitle, groupPick, wraps);
              setGroupKeys((g) => ({ ...g, [conversation.id]: gk }));
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
  user: User;
  identity: Identity;
  serverUrl: string;
  pinnedFp: string;
  onBack: () => void;
  onLogout: () => void;
  onUser: (u: User) => void;
  setServerUrl: (s: string) => void;
  setPinnedFp: (s: string) => void;
}) {
  const [name, setName] = useState(props.user.display_name);
  const [url, setUrl] = useState(props.serverUrl);
  const [oldP, setOldP] = useState("");
  const [newP, setNewP] = useState("");
  const [msg, setMsg] = useState("");
  const fp = fingerprintPublic(exportPublic(props.identity).x25519_public);

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
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              label="Display name"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              variant="contained"
              onClick={async () => {
                const { user } = await api.patchMe(name);
                props.onUser(user);
                await saveLocal(KEYS.user, user);
                setMsg("Display name updated");
              }}
            >
              Save
            </Button>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Security fingerprints
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your key fingerprint
          </Typography>
          <Typography fontFamily="monospace" sx={{ mb: 2, wordBreak: "break-all" }}>
            {fp}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Pinned server TLS fingerprint
          </Typography>
          <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
            {props.pinnedFp || "(none)"}
          </Typography>
          <Button
            sx={{ mt: 1 }}
            onClick={async () => {
              await removeLocal(KEYS.pinnedFp);
              props.setPinnedFp("");
              setMsg("TLS pin cleared — you will re-verify on next login");
            }}
          >
            Clear TLS pin
          </Button>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Server
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            <TextField
              label="Server URL"
              fullWidth
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button
              variant="outlined"
              onClick={async () => {
                setBaseUrl(url);
                props.setServerUrl(url);
                await saveLocal(KEYS.serverUrl, url);
                setMsg("Server URL saved");
              }}
            >
              Save URL
            </Button>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Change password
          </Typography>
          <Stack spacing={1}>
            <TextField
              type="password"
              label="Current password"
              value={oldP}
              onChange={(e) => setOldP(e.target.value)}
            />
            <TextField
              type="password"
              label="New password"
              value={newP}
              onChange={(e) => setNewP(e.target.value)}
            />
            <Button
              variant="contained"
              onClick={async () => {
                await api.changePassword(oldP, newP);
                setMsg("Password changed — sessions revoked. Log in again.");
                props.onLogout();
              }}
            >
              Update password
            </Button>
          </Stack>
        </Paper>

        {msg && <Alert severity="info">{msg}</Alert>}
        <Button color="error" variant="outlined" onClick={props.onLogout}>
          Log out
        </Button>
      </Stack>
    </Box>
  );
}
