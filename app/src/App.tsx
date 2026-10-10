import { useEffect, useMemo, useRef, useState } from "react";
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
  FormControlLabel,
  Grow,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  CircularProgress,
  LinearProgress,
} from "@mui/material";
import ChatIcon from "@mui/icons-material/ForumRounded";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import AttachFileIcon from "@mui/icons-material/AttachFileRounded";
import GroupAddIcon from "@mui/icons-material/GroupAddRounded";
import RefreshIcon from "@mui/icons-material/RefreshRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import DownloadIcon from "@mui/icons-material/DownloadRounded";
import GroupIcon from "@mui/icons-material/GroupRounded";
import PersonRemoveIcon from "@mui/icons-material/PersonRemoveRounded";
import DoneIcon from "@mui/icons-material/DoneRounded";
import DoneAllIcon from "@mui/icons-material/DoneAllRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import MoreVertIcon from "@mui/icons-material/MoreVertRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import DeleteForeverIcon from "@mui/icons-material/DeleteForeverRounded";
import StopCircleIcon from "@mui/icons-material/StopCircleRounded";
import ReplyIcon from "@mui/icons-material/ReplyRounded";
import ForwardIcon from "@mui/icons-material/ForwardRounded";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import PushPinIcon from "@mui/icons-material/PushPinRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotionsRounded";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import VolumeUpIcon from "@mui/icons-material/VolumeUpRounded";
import VolumeOffIcon from "@mui/icons-material/VolumeOffRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import { getCurrentWindow } from "@tauri-apps/api/window";

async function ensureBrowserNotifyPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

function showDesktopToast(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, silent: false });
  } catch {
    /* ignore */
  }
}
import {
  peerApi,
  type Conversation,
  type LanHost,
  type Member,
  type Message,
  type Peer,
  type Profile,
} from "./peer";
import {
  CHUNK_SIZE,
  b64,
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
  fromB64,
  prepareFileEncryption,
  unwrapContentKey,
  unwrapGroupKey,
  wrapGroupKeyForMembers,
  type Identity,
} from "./crypto";
import { EMOJI_SET, QUICK_REACTIONS } from "./emoji";
import { getOrCreateIdentity } from "./storage";

type Screen = "setup" | "chat" | "settings";

function newUserId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `u-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatDay(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function formatClock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${m} ${ap}`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeForName(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    md: "text/markdown",
  };
  return (ext && types[ext]) || "application/octet-stream";
}

function lastSeenLabel(iso?: string | null) {
  if (!iso) return "Offline";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Offline";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "Offline";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Offline · last seen just now";
  if (mins < 60) return `Offline · last seen ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Offline · last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Offline · last seen ${days}d ago`;
}

function truncate(s: string, n: number) {
  if (!s) return s;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

type FilePreview = {
  fileId: string;
  uploaderId: string;
  name: string;
  url: string;
  mime: string;
  data: Uint8Array;
  localPath?: string | null;
};

type StagedFile = {
  id: string;
  file: File;
  previewUrl: string | null;
};

type OutgoingFileState = {
  conversationId: string;
  fileId?: string;
  stagingDir?: string;
  name: string;
  done: number;
  total: number;
};

type IncomingFileState = {
  fileId: string;
  name: string;
  done: number;
  total: number;
};

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
        onNameUpdated={(p) => setProfile(p)}
      />
    );
  }

  return (
    <ChatScreen profile={profile} identity={identity} onSettings={() => setScreen("settings")} />
  );
}

function SetupScreen(props: {
  identity: Identity;
  error: string;
  setError: (s: string) => void;
  onReady: (p: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const pubs = exportPublic(props.identity);

  async function create() {
    props.setError("");
    const displayName = name.trim();
    if (!displayName) {
      props.setError("Please enter a display name");
      return;
    }
    setBusy(true);
    try {
      const p = await peerApi.setupProfile({
        displayName,
        userId: newUserId(),
        x25519Public: pubs.x25519_public,
        ed25519Public: pubs.ed25519_public,
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
            PeerTalk
          </Typography>
          <Typography variant="h4" sx={{ mt: 0.5, mb: 1 }}>
            Your desk identity
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Peer-to-peer on your LAN. No central server — chats live on your PC (SQLite) and
            deliver when peers are online. Your listening port is managed automatically.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Display name"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
            />
            {props.error && <Alert severity="error">{props.error}</Alert>}
            <Button variant="contained" size="large" disabled={busy} onClick={create}>
              {busy ? "Starting…" : "Start PeerTalk"}
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
  const [lanHosts, setLanHosts] = useState<LanHost[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [groupKeys, setGroupKeys] = useState<Record<string, Uint8Array>>({});
  const [tab, setTab] = useState(0);
  const [chatSearch, setChatSearch] = useState("");

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);

  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupPick, setGroupPick] = useState<string[]>([]);

  const [status, setStatus] = useState("");
  const [pinOpen, setPinOpen] = useState<Peer | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [addPick, setAddPick] = useState<string[]>([]);

  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [outgoingFile, setOutgoingFile] = useState<OutgoingFileState | null>(null);
  const [incomingFile, setIncomingFile] = useState<IncomingFileState | null>(null);

  const [msgMenu, setMsgMenu] = useState<{ anchor: HTMLElement; message: Message } | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [forwardPick, setForwardPick] = useState("");

  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [notifEnabled, setNotifEnabled] = useState(true);

  const scroller = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const chatSearchRef = useRef<HTMLInputElement | null>(null);
  const groupKeysRef = useRef(groupKeys);
  groupKeysRef.current = groupKeys;
  const abortSendRef = useRef(false);
  const abortOpenRef = useRef(false);
  const queueAbortRef = useRef(false);
  const activeRef = useRef<Conversation | null>(null);
  const notifEnabledRef = useRef(true);
  const lastMsgIdRef = useRef<Record<string, string>>({});

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    notifEnabledRef.current = notifEnabled;
  }, [notifEnabled]);

  const others = useMemo(
    () => peers.filter((p) => p.user_id !== profile.id),
    [peers, profile.id]
  );

  const filteredConvs = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    if (!q) return convs;
    return convs.filter((c) => {
      const title = (c.kind === "dm" ? c.peer_name : c.title) || "";
      return title.toLowerCase().includes(q);
    });
  }, [convs, chatSearch]);

  const isAdmin = useMemo(
    () =>
      !!active &&
      active.kind === "group" &&
      members.some((m) => m.user_id === profile.id && m.role === "admin"),
    [active, members, profile.id]
  );

  const inGroup =
    active?.kind !== "group" || !membersLoaded || members.some((m) => m.user_id === profile.id);

  async function ensureNotifPermission() {
    return ensureBrowserNotifyPermission();
  }

  async function ensureGroupKey(convId: string) {
    const existing = groupKeysRef.current[convId];
    if (existing) return existing;
    const wrap = await peerApi.getGroupKey(convId);
    if (!wrap) throw new Error("Missing group key");
    const gk = unwrapGroupKey(wrap, identity);
    setGroupKeys((g) => ({ ...g, [convId]: gk }));
    groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
    return gk;
  }

  async function resolveMemberIds(conv: Conversation): Promise<string[]> {
    if (conv.kind === "dm" && conv.peer_id) return [conv.peer_id, profile.id];
    return peerApi.memberIds(conv.id);
  }

  async function pollNotifications(conversations: Conversation[]) {
    if (!notifEnabledRef.current) return;
    for (const conv of conversations) {
      try {
        const msgs = await peerApi.listMessages(conv.id);
        const last = msgs[msgs.length - 1];
        const prevId = lastMsgIdRef.current[conv.id];
        if (prevId === undefined) {
          lastMsgIdRef.current[conv.id] = last?.id ?? "";
          continue;
        }
        if (!last || last.id === prevId) continue;
        const prevIdx = msgs.findIndex((m) => m.id === prevId);
        const newOnes = prevIdx === -1 ? [last] : msgs.slice(prevIdx + 1);
        lastMsgIdRef.current[conv.id] = last.id;
        const incoming = newOnes.filter((m) => m.sender_id !== profile.id);
        if (!incoming.length || conv.muted) continue;
        let focused = false;
        if (activeRef.current?.id === conv.id) {
          try {
            focused = await getCurrentWindow().isFocused();
          } catch {
            focused = false;
          }
        }
        if (activeRef.current?.id === conv.id && focused) continue;
        const granted = await ensureNotifPermission();
        if (!granted) continue;
        for (const m of incoming) {
          let body = "";
          if (m.kind === "file_notice") {
            body = "Sent a file";
          } else if (m.kind === "text") {
            try {
              if (conv.kind === "group") {
                const gk = await ensureGroupKey(conv.id);
                body = await decryptWithGroupKey(m, gk);
              } else {
                body = await decryptMessage(
                  { ...m, wrapped_keys: m.wrapped_keys || {} },
                  profile.id,
                  identity
                );
              }
            } catch {
              body = "New message";
            }
          } else {
            continue;
          }
          const title = conv.kind === "dm" ? conv.peer_name || "PeerTalk" : conv.title || "Group";
          showDesktopToast(title, body.slice(0, 80));
        }
      } catch {
        /* ignore this conversation this cycle */
      }
    }
  }

  async function refresh() {
    try {
      await peerApi.discoverPeers();
    } catch {
      /* ignore */
    }
    const [p, c, hosts] = await Promise.all([
      peerApi.listPeers(),
      peerApi.listConversations(),
      peerApi.listLanHosts().catch(() => []),
    ]);
    setPeers(p);
    setConvs(c);
    setLanHosts(hosts);
    pollNotifications(c).catch(() => {});
  }

  useEffect(() => {
    peerApi.getNotificationsEnabled().then(setNotifEnabled).catch(() => {});
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setTab(1);
        requestAnimationFrame(() => chatSearchRef.current?.focus());
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!active) return;
    const conv = active;
    let cancel = false;
    setMessages([]);
    setPlain({});
    setMembers([]);
    setMembersLoaded(conv.kind !== "group");
    setMembersOpen(false);
    setAddPick([]);
    setReplyTo(null);
    clearStagedFiles();

    async function pull() {
      if (conv.kind === "group" && !groupKeysRef.current[conv.id]) {
        try {
          const wrap = await peerApi.getGroupKey(conv.id);
          if (!cancel && wrap) {
            const gk = unwrapGroupKey(wrap, identity);
            setGroupKeys((g) => (g[conv.id] ? g : { ...g, [conv.id]: gk }));
          }
        } catch (err) {
          console.error(err);
          if (!cancel) setStatus("Couldn't unlock this group");
        }
      }
      if (conv.kind === "group") {
        try {
          const list = await peerApi.listMembers(conv.id);
          if (!cancel) {
            setMembers(list);
            setMembersLoaded(true);
          }
        } catch (err) {
          console.error(err);
        }
      }
      const msgs = await peerApi.listMessages(conv.id);
      if (!cancel) setMessages(msgs);
    }

    pull().catch(console.error);
    const t = setInterval(() => pull().catch(() => {}), 2000);
    return () => {
      cancel = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, active?.id, outgoingFile?.done, incomingFile?.done]);

  useEffect(() => {
    if (!active || !messages.some((m) => m.sender_id !== profile.id)) return;
    peerApi.markConversationRead(active.id).catch(console.error);
  }, [active?.id, messages, profile.id]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!active) return;
      const gk = active.kind === "group" ? groupKeys[active.id] : undefined;
      if (active.kind === "group" && !gk) return;
      const next: Record<string, string> = {};
      for (const m of messages) {
        if (m.conversation_id !== active.id || m.kind === "file_notice" || m.kind === "deleted") {
          continue;
        }
        try {
          if (active.kind === "group" && gk) {
            next[m.id] = await decryptWithGroupKey(m, gk);
          } else {
            next[m.id] = await decryptMessage(
              { ...m, wrapped_keys: m.wrapped_keys || {} },
              profile.id,
              identity
            );
          }
        } catch (err) {
          console.error("decrypt", m.id, err);
          next[m.id] = "[unable to decrypt]";
        }
      }
      if (!cancel) setPlain(next);
    })();
    return () => {
      cancel = true;
    };
  }, [messages, groupKeys, active?.id, active?.kind]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const m of messages) {
        if (m.kind !== "file_notice" || !m.file_id || fileNames[m.file_id]) continue;
        try {
          const file = await peerApi.getFile(m.file_id);
          if (!file?.wrapped_keys || !file.filename_nonce || !file.enc_filename) continue;
          const key = unwrapContentKey(file.wrapped_keys, profile.id, identity);
          next[m.file_id] = decryptFilename(key, file.filename_nonce, file.enc_filename);
        } catch (err) {
          console.error("filename", m.file_id, err);
        }
      }
      if (!cancel && Object.keys(next).length) {
        setFileNames((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [messages, active?.id]);

  function selectConversation(c: Conversation) {
    setMessages([]);
    setPlain({});
    setReplyTo(null);
    setActive(c);
  }

  async function openDm(peer: Peer) {
    if (!peer.pinned && peer.tls_fingerprint) {
      setPinOpen(peer);
      return;
    }
    const c = await peerApi.openDm(peer.user_id);
    selectConversation(c);
    setTab(1);
    await refresh();
  }

  function stageFiles(files: File[]) {
    const next = files.map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(16).slice(2)}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setStagedFiles((prev) => [...prev, ...next]);
  }

  function removeStagedFile(id: string) {
    setStagedFiles((prev) => {
      const found = prev.find((f) => f.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }

  function clearStagedFiles() {
    setStagedFiles((prev) => {
      for (const f of prev) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return [];
    });
  }

  async function sendControlMessage(
    conv: Conversation,
    kind: "reaction" | "pin" | "unpin",
    targetId: string,
    emoji = ""
  ) {
    const memberIds = await resolveMemberIds(conv);
    await peerApi.sendMessage(
      conv.id,
      {
        kind,
        sender_id: profile.id,
        ciphertext: emoji,
        nonce: "",
        wrapped_keys: {},
        signature: "",
        reply_to: targetId,
      },
      memberIds.filter((id) => id !== profile.id)
    );
  }

  async function reactToMessage(message: Message, emoji: string) {
    if (!active) return;
    try {
      await sendControlMessage(active, "reaction", message.id, emoji);
      setMessages(await peerApi.listMessages(active.id));
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function togglePinMessage(message: Message) {
    if (!active) return;
    setMsgMenu(null);
    try {
      await sendControlMessage(active, message.pinned ? "unpin" : "pin", message.id);
      setMessages(await peerApi.listMessages(active.id));
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  function startReply(message: Message) {
    setReplyTo(message);
    setMsgMenu(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function copyMessage(message: Message) {
    setMsgMenu(null);
    const content = plain[message.id] || "";
    try {
      await navigator.clipboard.writeText(content);
      setStatus("Copied to clipboard");
    } catch {
      setStatus("Could not copy");
    }
  }

  function startForward(message: Message) {
    setForwardMessage(message);
    setForwardPick("");
    setMsgMenu(null);
  }

  async function confirmForward() {
    if (!forwardMessage || !forwardPick) return;
    const target = convs.find((c) => c.id === forwardPick);
    if (!target) return;
    const body = plain[forwardMessage.id];
    if (!body) {
      setStatus("Nothing to forward");
      return;
    }
    try {
      if (target.kind === "dm" && target.peer_id) {
        const peer = peers.find((p) => p.user_id === target.peer_id);
        if (!peer) throw new Error("Peer not found");
        const pubs: Record<string, string> = {
          [peer.user_id]: peer.x25519_public,
          [profile.id]: exportPublic(identity).x25519_public,
        };
        const enc = await encryptMessage(body, target.id, profile.id, identity, pubs);
        await peerApi.sendMessage(
          target.id,
          { kind: "text", sender_id: profile.id, ...enc },
          [peer.user_id]
        );
      } else {
        const gk = await ensureGroupKey(target.id);
        const enc = await encryptWithGroupKey(body, target.id, profile.id, gk, identity);
        const memberIds = await peerApi.memberIds(target.id);
        await peerApi.sendMessage(
          target.id,
          { kind: "text", sender_id: profile.id, ...enc },
          memberIds.filter((id) => id !== profile.id)
        );
      }
      setStatus("Forwarded");
      if (active?.id === target.id) setMessages(await peerApi.listMessages(target.id));
      setForwardMessage(null);
      setForwardPick("");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function togglePinChat(conv: Conversation) {
    try {
      await peerApi.setConversationPinned(conv.id, !conv.pinned_at);
      await refresh();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function toggleMuteChat(conv: Conversation) {
    try {
      await peerApi.setConversationMuted(conv.id, !conv.muted);
      await refresh();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function sendText(body: string, replyToId?: string) {
    if (!active || !body.trim()) return;
    let message: any;
    if (active.kind === "dm" && active.peer_id) {
      const peer = peers.find((p) => p.user_id === active.peer_id);
      if (!peer) {
        setStatus("Peer not found");
        return;
      }
      const pubs: Record<string, string> = {
        [peer.user_id]: peer.x25519_public,
        [profile.id]: exportPublic(identity).x25519_public,
      };
      const enc = await encryptMessage(body.trim(), active.id, profile.id, identity, pubs);
      message = { kind: "text", sender_id: profile.id, ...enc, reply_to: replyToId ?? null };
    } else {
      const gk = await ensureGroupKey(active.id);
      const enc = await encryptWithGroupKey(body.trim(), active.id, profile.id, gk, identity);
      message = { kind: "text", sender_id: profile.id, ...enc, reply_to: replyToId ?? null };
    }
    const memberIds = await resolveMemberIds(active);
    await peerApi.sendMessage(
      active.id,
      message,
      memberIds.filter((id) => id !== profile.id)
    );
    setMessages(await peerApi.listMessages(active.id));
  }

  async function submitComposer() {
    if (!active) return;
    const files = stagedFiles;
    const body = text.trim();
    const replyId = replyTo?.id;
    if (!files.length && !body) return;
    setText("");
    setReplyTo(null);
    setStagedFiles([]);
    for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    if (body) await sendText(body, replyId);
    queueAbortRef.current = false;
    for (const sf of files) {
      if (queueAbortRef.current) break;
      await sendFile(sf.file);
    }
  }

  function senderLabel(id: string) {
    if (id === profile.id) return profile.display_name;
    return (
      members.find((m) => m.user_id === id)?.display_name ||
      peers.find((p) => p.user_id === id)?.display_name ||
      "Member"
    );
  }

  const dayGroups = useMemo(() => {
    const visible = active ? messages.filter((m) => m.conversation_id === active.id) : [];
    const out: { day: string; label: string; items: Message[] }[] = [];
    for (const m of visible) {
      const day = dayKey(m.created_at);
      const last = out[out.length - 1];
      if (!last || last.day !== day) out.push({ day, label: formatDay(m.created_at), items: [m] });
      else last.items.push(m);
    }
    return out;
  }, [messages, active?.id]);

  async function abortOutgoingTransfer() {
    abortSendRef.current = true;
    queueAbortRef.current = true;
    const current = outgoingFile;
    if (current?.fileId) {
      try {
        await peerApi.abortOutgoingFile(current.fileId);
      } catch {
        /* best effort */
      }
    }
    setOutgoingFile(null);
  }

  function abortIncomingTransfer() {
    abortOpenRef.current = true;
    setIncomingFile(null);
    setPreviewBusy(false);
    setStatus("");
  }

  async function retrySend(message: Message) {
    try {
      await peerApi.retryMessage(message.id);
      if (active) setMessages(await peerApi.listMessages(active.id));
      setStatus("Retrying…");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function deleteForMe(message: Message) {
    setMsgMenu(null);
    try {
      await peerApi.deleteMessageForMe(message.id);
      if (active) setMessages(await peerApi.listMessages(active.id));
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function deleteForEveryone(message: Message) {
    setMsgMenu(null);
    try {
      await peerApi.deleteMessageForEveryone(message.id);
      if (active) setMessages(await peerApi.listMessages(active.id));
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function sendFile(file: File) {
    if (!active) return;
    const conversationId = active.id;
    const chunkCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
    abortSendRef.current = false;
    let fileId: string | undefined;
    setOutgoingFile({ conversationId, name: file.name, done: 0, total: chunkCount });
    try {
      const memberIds = await peerApi.memberIds(conversationId);
      const pubs: Record<string, string> = {
        [profile.id]: exportPublic(identity).x25519_public,
      };
      for (const mid of memberIds) {
        const p = peers.find((x) => x.user_id === mid);
        if (p) pubs[mid] = p.x25519_public;
      }
      const { contentKey, wrapped_keys } = await prepareFileEncryption(identity, pubs);
      const nameEnc = encryptFilename(contentKey, file.name);
      const created = await peerApi.createOutgoingFile({
        conversationId,
        encFilename: nameEnc.ciphertext,
        filenameNonce: nameEnc.nonce,
        sizeBytes: file.size,
        chunkCount,
        wrappedKeys: wrapped_keys,
        originalPath: (file as File & { path?: string }).path || null,
        fileCryptoV: 2,
      });
      fileId = created.file_id;
      setFileNames((s) => ({ ...s, [fileId!]: file.name }));
      setOutgoingFile({
        conversationId,
        fileId,
        name: file.name,
        done: 0,
        total: chunkCount,
      });
      for (let i = 0; i < chunkCount; i++) {
        if (abortSendRef.current) throw new Error("aborted");
        const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const buf = new Uint8Array(await slice.arrayBuffer());
        const { nonce, ciphertextB64 } = encryptChunk(contentKey, buf, i);
        await peerApi.writeFileChunk(fileId, i, ciphertextB64, nonce);
        if (i === 0 || i + 1 === chunkCount || (i + 1) % 2 === 0) {
          setOutgoingFile({
            conversationId,
            fileId,
            name: file.name,
            done: i + 1,
            total: chunkCount,
          });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (abortSendRef.current) throw new Error("aborted");
      await peerApi.sendFileNotice(
        conversationId,
        fileId,
        memberIds.filter((id) => id !== profile.id)
      );
      setMessages(await peerApi.listMessages(conversationId));
    } catch (err: any) {
      if (String(err?.message || err) === "aborted") {
        if (fileId) {
          try {
            await peerApi.abortOutgoingFile(fileId);
          } catch {
            /* ignore */
          }
        }
      } else {
        setStatus(err?.message || String(err));
      }
    } finally {
      setOutgoingFile(null);
      abortSendRef.current = false;
    }
  }

  async function decryptFile(fileId: string, uploaderId: string) {
    abortOpenRef.current = false;
    const file = await peerApi.getFile(fileId);
    if (!file) throw new Error("File metadata missing");
    const key = unwrapContentKey(file.wrapped_keys, profile.id, identity);
    let name = "file.bin";
    try {
      name = decryptFilename(key, file.filename_nonce, file.enc_filename);
    } catch {
      /* keep fallback */
    }
    if (file.local_path) {
      try {
        return { file, name, data: fromB64(await peerApi.readLocalFile(fileId)) };
      } catch {
        // The file may have moved; fall back to the encrypted chat copy.
      }
    }
    const totalChunks = Math.max(1, Number(file.chunk_count) || 1);
    const cryptoV = Number(file.file_crypto_v) || 1;
    setIncomingFile({ fileId, name, done: 0, total: totalChunks });
    const parts: Uint8Array[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (abortOpenRef.current) throw new Error("aborted");
      const chunk = await peerApi.fetchFileChunk(fileId, i, uploaderId);
      parts.push(
        decryptChunk(
          key,
          chunk.nonce,
          fromB64(chunk.data_b64),
          cryptoV >= 2 ? i : undefined
        )
      );
      if (i === 0 || i + 1 === totalChunks || (i + 1) % 2 === 0) {
        setIncomingFile({ fileId, name, done: i + 1, total: totalChunks });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.length;
    }
    return { file, name, data: merged };
  }

  function closeFilePreview() {
    setFilePreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }

  async function previewFile(fileId: string, uploaderId: string) {
    setPreviewBusy(true);
    setStatus("");
    try {
      const { file, name, data } = await decryptFile(fileId, uploaderId);
      if (abortOpenRef.current) return;
      const mime = mimeForName(name);
      const bytes = new Uint8Array(data);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setFilePreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return {
          fileId,
          uploaderId,
          name,
          url,
          mime,
          data,
          localPath: file.local_path,
        };
      });
    } catch (err: any) {
      if (String(err?.message || err) !== "aborted") {
        setStatus(err?.message || String(err));
      }
    } finally {
      setIncomingFile(null);
      setPreviewBusy(false);
      abortOpenRef.current = false;
    }
  }

  async function savePreviewedFile() {
    if (!filePreview) return;
    setStatus("Saving…");
    try {
      const path = await peerApi.saveDownloadedFile(
        filePreview.name,
        b64(filePreview.data),
        filePreview.fileId
      );
      if (filePreview.uploaderId !== profile.id) {
        await peerApi.ackFileDownload(filePreview.fileId, filePreview.uploaderId);
      }
      setFilePreview((p) => (p ? { ...p, localPath: path } : p));
      setStatus("");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function openPreviewedFile() {
    if (!filePreview) return;
    try {
      if (!filePreview.localPath) await savePreviewedFile();
      await peerApi.openLocalFile(filePreview.fileId);
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function handleRemoveMember(userId: string, displayName: string) {
    if (!active) return;
    if (!window.confirm(`Remove ${displayName} from the group?`)) return;
    try {
      const remaining = members.filter((m) => m.user_id !== userId);
      const newKey = createGroupKey();
      const pubs: Record<string, string> = {
        [profile.id]: exportPublic(identity).x25519_public,
      };
      const missing: string[] = [];
      for (const m of remaining) {
        if (m.user_id === profile.id) continue;
        const p = peers.find((x) => x.user_id === m.user_id);
        if (p) pubs[m.user_id] = p.x25519_public;
        else missing.push(m.display_name);
      }
      const wraps = wrapGroupKeyForMembers(newKey, identity, pubs);
      await peerApi.removeGroupMember(active.id, userId, wraps);
      setGroupKeys((g) => ({ ...g, [active.id]: newKey }));
      groupKeysRef.current = { ...groupKeysRef.current, [active.id]: newKey };
      setMembers(await peerApi.listMembers(active.id));
      setMessages(await peerApi.listMessages(active.id));
      setStatus(
        missing.length
          ? `Removed. ${missing.join(", ")} will need to come online to get the new key.`
          : "Removed from group"
      );
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function handleLeaveGroup() {
    if (!active) return;
    if (!window.confirm("Leave this group? You will keep the messages already here.")) return;
    try {
      const remaining = members.filter((m) => m.user_id !== profile.id);
      let wraps: Record<string, string> | undefined;
      if (remaining.length) {
        const newKey = createGroupKey();
        const pubs: Record<string, string> = {};
        for (const m of remaining) {
          const p = peers.find((x) => x.user_id === m.user_id);
          if (p) pubs[m.user_id] = p.x25519_public;
        }
        if (Object.keys(pubs).length) wraps = wrapGroupKeyForMembers(newKey, identity, pubs);
      }
      await peerApi.leaveGroup(active.id, wraps);
      setMembersOpen(false);
      setActive(null);
      await refresh();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function handleAddMembers() {
    if (!active || !addPick.length) return;
    try {
      const gk = await ensureGroupKey(active.id);
      const pubs: Record<string, string> = {};
      for (const id of addPick) {
        const p = peers.find((x) => x.user_id === id);
        if (p) pubs[id] = p.x25519_public;
      }
      if (!Object.keys(pubs).length) {
        setStatus("None of the selected people have been discovered yet");
        return;
      }
      await peerApi.addGroupMembers(active.id, wrapGroupKeyForMembers(gk, identity, pubs));
      setAddPick([]);
      setMembers(await peerApi.listMembers(active.id));
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function createGroup() {
    if (!groupTitle.trim() || !groupPick.length) return;
    try {
      const gk = createGroupKey();
      const pubs: Record<string, string> = {
        [profile.id]: exportPublic(identity).x25519_public,
      };
      for (const id of groupPick) {
        const u = peers.find((x) => x.user_id === id);
        if (u) pubs[id] = u.x25519_public;
      }
      const wraps = wrapGroupKeyForMembers(gk, identity, pubs);
      const conversation = await peerApi.createGroup(groupTitle.trim(), groupPick, wraps);
      setGroupKeys((g) => ({ ...g, [conversation.id]: gk }));
      groupKeysRef.current = { ...groupKeysRef.current, [conversation.id]: gk };
      const enc = await encryptWithGroupKey(
        `${profile.display_name} started the group`,
        conversation.id,
        profile.id,
        gk,
        identity
      );
      await peerApi.sendMessage(
        conversation.id,
        { kind: "text", sender_id: profile.id, ...enc },
        groupPick
      );
      setGroupOpen(false);
      setGroupTitle("");
      setGroupPick([]);
      selectConversation(conversation);
      setTab(1);
      await refresh();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  return (
    <Box
      sx={{
        display: "flex",
        height: "100vh",
        maxHeight: "100vh",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      <Drawer
        variant="permanent"
        sx={{
          width: 320,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: 320,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRight: "1px solid #D5E3DD",
            background: "linear-gradient(180deg,#F7FBFA 0%, #FFFFFF 40%)",
          },
        }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <ChatIcon color="primary" />
          <Box flex={1} minWidth={0}>
            <Typography variant="subtitle1" fontWeight={700}>
              PeerTalk
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {profile.display_name}
            </Typography>
          </Box>
          <IconButton aria-label="Refresh peers" onClick={() => refresh()}>
            <RefreshIcon />
          </IconButton>
        </Toolbar>
        <Divider />
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth">
          <Tab label="People" />
          <Tab label="Chats" />
        </Tabs>
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {tab === 0 && (
            <List dense>
              {others.map((p) => (
                <ListItemButton key={p.user_id} onClick={() => openDm(p)}>
                  <Avatar sx={{ width: 36, height: 36, mr: 1.5, bgcolor: "primary.main" }}>
                    {p.display_name.slice(0, 1).toUpperCase()}
                  </Avatar>
                  <ListItemText
                    primary={p.display_name}
                    secondary={p.online ? "Online" : lastSeenLabel(p.last_seen_at)}
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
                  No peers yet. Start PeerTalk on another PC on this LAN and hit refresh.
                </Typography>
              )}
              {lanHosts.length > 0 && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="overline" color="text.secondary" sx={{ px: 2 }}>
                    Other devices on this network
                  </Typography>
                  {lanHosts.map((h) => (
                    <Box
                      key={h.ip}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        px: 2,
                        py: 1,
                        opacity: 0.5,
                      }}
                    >
                      <Avatar sx={{ width: 36, height: 36, bgcolor: "grey.300", color: "grey.600" }}>
                        {h.label.slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box flex={1} minWidth={0}>
                        <Typography noWrap>{h.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {h.ip} · No PeerTalk
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </>
              )}
            </List>
          )}
          {tab === 1 && (
            <>
              <Box px={2} py={1} display="flex" flexDirection="column" gap={1}>
                <Button
                  startIcon={<GroupAddIcon />}
                  fullWidth
                  variant="outlined"
                  onClick={() => setGroupOpen(true)}
                >
                  New group
                </Button>
                <TextField
                  inputRef={chatSearchRef}
                  size="small"
                  fullWidth
                  placeholder="Search chats… (Ctrl/Cmd+K)"
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
              <List dense>
                {filteredConvs.map((c) => {
                  const title = c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
                  return (
                    <Box key={c.id} sx={{ display: "flex", alignItems: "center", pr: 0.5 }}>
                      <ListItemButton
                        selected={active?.id === c.id}
                        onClick={() => selectConversation(c)}
                        sx={{ flex: 1, minWidth: 0 }}
                      >
                        <Avatar
                          sx={{
                            width: 36,
                            height: 36,
                            mr: 1.5,
                            bgcolor: c.kind === "group" ? "secondary.main" : "primary.main",
                          }}
                        >
                          {title.slice(0, 1).toUpperCase()}
                        </Avatar>
                        <ListItemText
                          primary={title}
                          secondary={c.kind === "group" ? "Group" : undefined}
                          primaryTypographyProps={{ noWrap: true }}
                        />
                      </ListItemButton>
                      <Tooltip title={c.pinned_at ? "Unpin chat" : "Pin chat"}>
                        <IconButton size="small" onClick={() => togglePinChat(c)}>
                          {c.pinned_at ? (
                            <PushPinIcon fontSize="small" color="primary" />
                          ) : (
                            <PushPinOutlinedIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={c.muted ? "Unmute chat" : "Mute chat"}>
                        <IconButton size="small" onClick={() => toggleMuteChat(c)}>
                          {c.muted ? (
                            <VolumeOffIcon fontSize="small" color="disabled" />
                          ) : (
                            <VolumeUpIcon fontSize="small" sx={{ opacity: 0.4 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Box>
                  );
                })}
                {!filteredConvs.length && (
                  <Typography sx={{ p: 2 }} color="text.secondary">
                    {chatSearch ? "No chats match your search." : "No chats yet. Start one from People."}
                  </Typography>
                )}
              </List>
            </>
          )}
        </Box>
        <Box sx={{ mt: "auto", borderTop: "1px solid #D5E3DD", p: 1.5 }}>
          <Button
            fullWidth
            color="inherit"
            startIcon={<SettingsIcon />}
            onClick={onSettings}
            sx={{ justifyContent: "flex-start", color: "text.primary" }}
          >
            Settings
          </Button>
        </Box>
      </Drawer>

      <Box
        flex={1}
        display="flex"
        flexDirection="column"
        minWidth={0}
        minHeight={0}
        height="100%"
        overflow="hidden"
      >
        <AppBar
          position="static"
          elevation={0}
          sx={{
            flexShrink: 0,
            bgcolor: "#FFFFFF",
            color: "text.primary",
            borderBottom: "1px solid #D5E3DD",
            zIndex: 2,
          }}
        >
          <Toolbar sx={{ gap: 1 }}>
            <Box flex={1} minWidth={0}>
              <Typography variant="h6" noWrap>
                {active
                  ? active.kind === "dm"
                    ? active.peer_name
                    : active.title
                  : "Select a conversation"}
              </Typography>
              {active?.kind === "group" && membersLoaded && (
                <Typography variant="caption" color="text.secondary">
                  {members.length} {members.length === 1 ? "member" : "members"}
                </Typography>
              )}
            </Box>
            {isAdmin && (
              <Chip
                size="small"
                icon={<AdminPanelSettingsIcon fontSize="small" />}
                label="Admin"
                color="primary"
                variant="outlined"
              />
            )}
            {status && <Chip size="small" label={status} onDelete={() => setStatus("")} />}
            {active?.kind === "group" && (
              <IconButton aria-label="Group members" onClick={() => setMembersOpen(true)}>
                <GroupIcon />
              </IconButton>
            )}
          </Toolbar>
        </AppBar>

        <Box
          ref={scroller}
          flex={1}
          minHeight={0}
          p={2}
          overflow="auto"
          display="flex"
          flexDirection="column"
          gap={1}
          sx={{ bgcolor: "background.default" }}
        >
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
          {dayGroups.map((group) => (
            <Box key={group.day} display="flex" flexDirection="column" gap={1}>
              <Box display="flex" justifyContent="center" my={0.5}>
                <Chip
                  label={group.label}
                  size="small"
                  sx={{
                    height: 22,
                    px: 0.5,
                    bgcolor: "rgba(15,107,92,0.12)",
                    color: "primary.dark",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                />
              </Box>
              {group.items.map((m) => {
                const mine = m.sender_id === profile.id;
                const quoted = m.reply_to ? messages.find((x) => x.id === m.reply_to) : undefined;
                return (
                  <Grow in key={m.id} timeout={220}>
                    <Box sx={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "70%" }}>
                      <Paper
                        elevation={0}
                        sx={{
                          p: 1.5,
                          bgcolor:
                            m.kind === "deleted" ? "#F1F4F3" : mine ? "#DCEFE9" : "#FFFFFF",
                          border: "1px solid #D5E3DD",
                          position: "relative",
                        }}
                      >
                        {m.pinned && (
                          <PushPinIcon
                            sx={{
                              position: "absolute",
                              top: -8,
                              left: -8,
                              fontSize: 16,
                              color: "secondary.main",
                              bgcolor: "background.paper",
                              borderRadius: "50%",
                              p: 0.2,
                            }}
                          />
                        )}
                        {m.kind !== "deleted" && (
                          <IconButton
                            size="small"
                            aria-label="Message options"
                            onClick={(e) => setMsgMenu({ anchor: e.currentTarget, message: m })}
                            sx={{ position: "absolute", top: 2, right: 2, opacity: 0.55 }}
                          >
                            <MoreVertIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        )}
                        {active?.kind === "group" && !mine && m.kind !== "deleted" && (
                          <Typography variant="caption" color="primary" fontWeight={700} display="block">
                            {senderLabel(m.sender_id)}
                          </Typography>
                        )}
                        {quoted && m.kind !== "deleted" && (
                          <Box
                            sx={{
                              borderLeft: "3px solid",
                              borderColor: "primary.main",
                              pl: 1,
                              mb: 0.5,
                              opacity: 0.85,
                            }}
                          >
                            <Typography variant="caption" fontWeight={700} color="primary" display="block">
                              {senderLabel(quoted.sender_id)}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              noWrap
                              display="block"
                              sx={{ maxWidth: 220 }}
                            >
                              {quoted.kind === "file_notice"
                                ? "📎 File"
                                : quoted.kind === "deleted"
                                  ? "Deleted message"
                                  : truncate(plain[quoted.id] || "…", 80)}
                            </Typography>
                          </Box>
                        )}
                        {m.kind === "deleted" ? (
                          <Typography fontStyle="italic" color="text.secondary" sx={{ pr: 2 }}>
                            This message was deleted
                          </Typography>
                        ) : m.kind === "file_notice" ? (
                          <Button
                            size="small"
                            startIcon={<InsertDriveFileIcon />}
                            endIcon={<OpenInNewIcon />}
                            disabled={previewBusy || !!incomingFile}
                            onClick={() => m.file_id && previewFile(m.file_id, m.sender_id)}
                            sx={{
                              textTransform: "none",
                              fontWeight: 700,
                              justifyContent: "flex-start",
                              pr: 3,
                            }}
                          >
                            {(m.file_id && fileNames[m.file_id]) || "Encrypted file"}
                          </Button>
                        ) : (
                          <Typography whiteSpace="pre-wrap" sx={{ pr: 2 }}>
                            {plain[m.id] || "…"}
                          </Typography>
                        )}
                        <Box
                          sx={{
                            mt: 0.5,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 0.4,
                            color: "text.secondary",
                          }}
                        >
                          {m.failed ? (
                            <Typography
                              variant="caption"
                              color="error"
                              sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                            >
                              Failed ·
                              <Box
                                component="span"
                                sx={{ cursor: "pointer", textDecoration: "underline" }}
                                onClick={() => retrySend(m)}
                              >
                                Retry
                              </Box>
                            </Typography>
                          ) : (
                            <Typography variant="caption">{formatClock(m.created_at)}</Typography>
                          )}
                          {mine && m.kind !== "deleted" && !m.failed && (
                            m.read ? (
                              <DoneAllIcon
                                titleAccess="Read"
                                sx={{ fontSize: 16, color: "success.main" }}
                              />
                            ) : m.delivered ? (
                              <DoneAllIcon titleAccess="Received" sx={{ fontSize: 16 }} />
                            ) : (
                              <DoneIcon titleAccess="Queued" sx={{ fontSize: 16 }} />
                            )
                          )}
                        </Box>
                      </Paper>
                      {!!m.reactions?.length && (
                        <Stack
                          direction="row"
                          spacing={0.5}
                          sx={{
                            mt: 0.5,
                            flexWrap: "wrap",
                            justifyContent: mine ? "flex-end" : "flex-start",
                          }}
                        >
                          {m.reactions.map((r) => (
                            <Chip
                              key={r.emoji}
                              size="small"
                              label={`${r.emoji} ${r.count}`}
                              onClick={() => reactToMessage(m, r.emoji)}
                              variant={r.users.includes(profile.id) ? "filled" : "outlined"}
                              color={r.users.includes(profile.id) ? "primary" : "default"}
                              sx={{ height: 22 }}
                            />
                          ))}
                        </Stack>
                      )}
                    </Box>
                  </Grow>
                );
              })}
            </Box>
          ))}
          {outgoingFile && active?.id === outgoingFile.conversationId && (
            <Paper
              elevation={0}
              sx={{
                alignSelf: "flex-end",
                maxWidth: "70%",
                p: 1.5,
                bgcolor: "#E8EEEC",
                border: "1px dashed #B7C7C1",
                opacity: 0.85,
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <CircularProgress size={18} thickness={5} />
                <Box minWidth={0} flex={1}>
                  <Typography noWrap fontWeight={700} color="text.secondary">
                    {outgoingFile.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Encrypting & preparing…
                    {outgoingFile.total
                      ? ` ${Math.min(
                          100,
                          Math.round((100 * outgoingFile.done) / outgoingFile.total)
                        )}%`
                      : ""}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={
                      outgoingFile.total
                        ? Math.min(100, (100 * outgoingFile.done) / outgoingFile.total)
                        : 0
                    }
                    sx={{ mt: 0.75, height: 4, borderRadius: 999 }}
                  />
                </Box>
                <IconButton
                  size="small"
                  color="error"
                  aria-label="Abort file send"
                  onClick={abortOutgoingTransfer}
                >
                  <StopCircleIcon />
                </IconButton>
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" mt={0.75} textAlign="right">
                Sending · tap stop to abort
              </Typography>
            </Paper>
          )}
          {incomingFile && (
            <Paper
              elevation={0}
              sx={{
                alignSelf: "flex-start",
                maxWidth: "70%",
                p: 1.5,
                bgcolor: "#E8EEEC",
                border: "1px dashed #B7C7C1",
                opacity: 0.85,
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                <CircularProgress size={18} thickness={5} />
                <Box minWidth={0} flex={1}>
                  <Typography noWrap fontWeight={700} color="text.secondary">
                    {incomingFile.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Opening…
                    {incomingFile.total
                      ? ` ${Math.min(
                          100,
                          Math.round((100 * incomingFile.done) / incomingFile.total)
                        )}%`
                      : ""}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={
                      incomingFile.total
                        ? Math.min(100, (100 * incomingFile.done) / incomingFile.total)
                        : 0
                    }
                    sx={{ mt: 0.75, height: 4, borderRadius: 999 }}
                  />
                </Box>
                <IconButton
                  size="small"
                  color="error"
                  aria-label="Abort file open"
                  onClick={abortIncomingTransfer}
                >
                  <StopCircleIcon />
                </IconButton>
              </Stack>
            </Paper>
          )}
        </Box>

        {active && inGroup && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              p: 1.5,
              borderTop: "1px solid #D5E3DD",
              display: "flex",
              flexDirection: "column",
              gap: 1,
              bgcolor: "#FFFFFF",
              zIndex: 2,
            }}
          >
            {replyTo && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  p: 1,
                  border: "1px solid #D5E3DD",
                  borderRadius: 2,
                  bgcolor: "#F7FBFA",
                }}
              >
                <ReplyIcon fontSize="small" color="primary" />
                <Box flex={1} minWidth={0}>
                  <Typography variant="caption" fontWeight={700} color="primary" display="block">
                    Replying to {senderLabel(replyTo.sender_id)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {replyTo.kind === "file_notice" ? "📎 File" : truncate(plain[replyTo.id] || "…", 90)}
                  </Typography>
                </Box>
                <IconButton size="small" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            )}
            {stagedFiles.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {stagedFiles.map((sf) => (
                  <Box
                    key={sf.id}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      p: 1,
                      border: "1px solid #D5E3DD",
                      borderRadius: 2,
                      bgcolor: "#F7FBFA",
                    }}
                  >
                    {sf.previewUrl ? (
                      <Box
                        component="img"
                        src={sf.previewUrl}
                        alt=""
                        sx={{ width: 40, height: 40, objectFit: "cover", borderRadius: 1 }}
                      />
                    ) : (
                      <InsertDriveFileIcon color="primary" />
                    )}
                    <Box minWidth={0}>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 160 }}>
                        {sf.file.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatBytes(sf.file.size)}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      aria-label={`Remove ${sf.file.name}`}
                      onClick={() => removeStagedFile(sf.id)}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            )}
            <Box display="flex" gap={1} alignItems="flex-end">
              <IconButton
                aria-label="Emoji picker"
                disabled={!!outgoingFile}
                onClick={(e) => setEmojiAnchor(e.currentTarget)}
              >
                <EmojiEmotionsIcon />
              </IconButton>
              <IconButton component="label" aria-label="Attach files" disabled={!!outgoingFile}>
                <AttachFileIcon />
                <input
                  hidden
                  type="file"
                  multiple
                  disabled={!!outgoingFile}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) stageFiles(files);
                    e.target.value = "";
                  }}
                />
              </IconButton>
              <TextField
                inputRef={composerRef}
                fullWidth
                size="small"
                multiline
                minRows={1}
                maxRows={6}
                placeholder="Encrypted message… (Shift+Enter for newline)"
                value={text}
                disabled={!!outgoingFile}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitComposer();
                  } else if (e.key === "Escape" && replyTo) {
                    e.preventDefault();
                    setReplyTo(null);
                  }
                }}
              />
              <Button
                variant="contained"
                disabled={!!outgoingFile || (!text.trim() && !stagedFiles.length)}
                onClick={submitComposer}
              >
                Send
              </Button>
            </Box>
          </Paper>
        )}
        {active?.kind === "group" && membersLoaded && !inGroup && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              p: 2,
              borderTop: "1px solid #D5E3DD",
              textAlign: "center",
              bgcolor: "#FFFFFF",
              zIndex: 2,
            }}
          >
            <Typography color="text.secondary">You're no longer in this group.</Typography>
          </Paper>
        )}
      </Box>

      <Popover
        open={!!emojiAnchor}
        anchorEl={emojiAnchor}
        onClose={() => setEmojiAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Box
          sx={{
            p: 1,
            width: 280,
            display: "grid",
            gridTemplateColumns: "repeat(8, 1fr)",
            gap: 0.25,
            maxHeight: 240,
            overflow: "auto",
          }}
        >
          {EMOJI_SET.map((e, idx) => (
            <IconButton key={`${e}-${idx}`} size="small" onClick={() => setText((t) => t + e)}>
              <Typography fontSize={18}>{e}</Typography>
            </IconButton>
          ))}
        </Box>
      </Popover>

      <Menu
        anchorEl={msgMenu?.anchor ?? null}
        open={!!msgMenu}
        onClose={() => setMsgMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Box sx={{ display: "flex", gap: 0.25, px: 1, py: 0.5 }}>
          {QUICK_REACTIONS.map((e) => (
            <IconButton
              key={e}
              size="small"
              onClick={() => {
                if (msgMenu) reactToMessage(msgMenu.message, e);
                setMsgMenu(null);
              }}
            >
              <Typography fontSize={18}>{e}</Typography>
            </IconButton>
          ))}
        </Box>
        <Divider />
        <MenuItem onClick={() => msgMenu && startReply(msgMenu.message)}>
          <ListItemIcon>
            <ReplyIcon fontSize="small" />
          </ListItemIcon>
          Reply
        </MenuItem>
        {msgMenu?.message.kind === "text" && (
          <MenuItem onClick={() => msgMenu && startForward(msgMenu.message)}>
            <ListItemIcon>
              <ForwardIcon fontSize="small" />
            </ListItemIcon>
            Forward
          </MenuItem>
        )}
        {msgMenu?.message.kind === "text" && (
          <MenuItem onClick={() => msgMenu && copyMessage(msgMenu.message)}>
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            Copy text
          </MenuItem>
        )}
        <MenuItem onClick={() => msgMenu && togglePinMessage(msgMenu.message)}>
          <ListItemIcon>
            <PushPinIcon fontSize="small" />
          </ListItemIcon>
          {msgMenu?.message.pinned ? "Unpin message" : "Pin message"}
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => msgMenu && deleteForMe(msgMenu.message)}>
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          Delete for me
        </MenuItem>
        {msgMenu?.message.sender_id === profile.id && msgMenu.message.kind !== "deleted" && (
          <MenuItem onClick={() => msgMenu && deleteForEveryone(msgMenu.message)}>
            <ListItemIcon>
              <DeleteForeverIcon fontSize="small" color="error" />
            </ListItemIcon>
            Delete for everyone
          </MenuItem>
        )}
      </Menu>

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
              selectConversation(c);
              setTab(1);
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
          <Button variant="contained" disabled={!groupTitle.trim() || !groupPick.length} onClick={createGroup}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!forwardMessage} onClose={() => setForwardMessage(null)} fullWidth maxWidth="sm">
        <DialogTitle>Forward message</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {truncate(forwardMessage ? plain[forwardMessage.id] || "" : "", 160)}
          </Typography>
          <List dense>
            {convs.map((c) => (
              <ListItemButton
                key={c.id}
                selected={forwardPick === c.id}
                onClick={() => setForwardPick(c.id)}
              >
                <ListItemText primary={c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group"} />
              </ListItemButton>
            ))}
            {!convs.length && (
              <Typography color="text.secondary" sx={{ p: 1 }}>
                No chats to forward to yet.
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForwardMessage(null)}>Cancel</Button>
          <Button variant="contained" disabled={!forwardPick} onClick={confirmForward}>
            Forward
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!filePreview} onClose={closeFilePreview} fullWidth maxWidth="md">
        <DialogTitle sx={{ pr: 6 }}>
          <Typography fontWeight={700} noWrap>
            {filePreview?.name}
          </Typography>
          <IconButton
            aria-label="Close preview"
            onClick={closeFilePreview}
            sx={{ position: "absolute", right: 12, top: 12 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            minHeight: 240,
            display: "grid",
            placeItems: "center",
            bgcolor: "#EEF2F0",
            p: 2,
          }}
        >
          {filePreview?.mime.startsWith("image/") ? (
            <Box
              component="img"
              src={filePreview.url}
              alt={filePreview.name}
              sx={{ maxWidth: "100%", maxHeight: "65vh", objectFit: "contain" }}
            />
          ) : filePreview?.mime.startsWith("video/") ? (
            <Box
              component="video"
              src={filePreview.url}
              controls
              sx={{ maxWidth: "100%", maxHeight: "65vh" }}
            />
          ) : filePreview?.mime.startsWith("audio/") ? (
            <Box component="audio" src={filePreview.url} controls sx={{ width: "min(520px, 100%)" }} />
          ) : filePreview?.mime === "application/pdf" ? (
            <Box
              component="iframe"
              src={filePreview.url}
              title={filePreview.name}
              sx={{ width: "100%", height: "65vh", border: 0, bgcolor: "white" }}
            />
          ) : filePreview?.mime.startsWith("text/") ||
            filePreview?.mime === "application/json" ? (
            <Box
              component="pre"
              sx={{
                width: "100%",
                maxHeight: "65vh",
                overflow: "auto",
                m: 0,
                p: 2,
                bgcolor: "white",
                borderRadius: 1,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {new TextDecoder().decode(filePreview.data)}
            </Box>
          ) : (
            <Stack alignItems="center" spacing={1}>
              <InsertDriveFileIcon color="primary" sx={{ fontSize: 64 }} />
              <Typography>{filePreview?.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                Preview is not supported for this file type.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: "auto" }}>
            {filePreview?.localPath ? "Available on this computer" : "Encrypted chat copy"}
          </Typography>
          <Button startIcon={<DownloadIcon />} onClick={savePreviewedFile}>
            {filePreview?.localPath ? "Save a copy" : "Save"}
          </Button>
          <Button variant="contained" startIcon={<OpenInNewIcon />} onClick={openPreviewedFile}>
            Open
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={membersOpen && active?.kind === "group"} onClose={() => setMembersOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{active?.title || "Group"}</DialogTitle>
        <DialogContent>
          <Typography variant="overline" color="text.secondary">
            Members
          </Typography>
          <List dense>
            {members.map((m) => (
              <ListItemButton key={m.user_id} disableRipple sx={{ cursor: "default" }}>
                <Avatar sx={{ width: 32, height: 32, mr: 1.5, bgcolor: "primary.main", fontSize: 14 }}>
                  {m.display_name.slice(0, 1).toUpperCase()}
                </Avatar>
                <ListItemText
                  primary={m.user_id === profile.id ? `${m.display_name} (you)` : m.display_name}
                />
                {m.role === "admin" && (
                  <Chip
                    size="small"
                    label="Admin"
                    icon={<AdminPanelSettingsIcon fontSize="small" />}
                    sx={{ mr: 1 }}
                  />
                )}
                {isAdmin && m.user_id !== profile.id && (
                  <IconButton
                    aria-label={`Remove ${m.display_name}`}
                    size="small"
                    onClick={() => handleRemoveMember(m.user_id, m.display_name)}
                  >
                    <PersonRemoveIcon fontSize="small" />
                  </IconButton>
                )}
              </ListItemButton>
            ))}
          </List>
          {isAdmin && (
            <>
              <Typography variant="overline" color="text.secondary">
                Add people
              </Typography>
              <List dense>
                {others
                  .filter((p) => !members.some((m) => m.user_id === p.user_id))
                  .map((p) => (
                    <ListItemButton
                      key={p.user_id}
                      selected={addPick.includes(p.user_id)}
                      onClick={() =>
                        setAddPick((g) =>
                          g.includes(p.user_id) ? g.filter((x) => x !== p.user_id) : [...g, p.user_id]
                        )
                      }
                    >
                      <ListItemText primary={p.display_name} secondary={p.online ? "Online" : "Offline"} />
                    </ListItemButton>
                  ))}
              </List>
              {!others.filter((p) => !members.some((m) => m.user_id === p.user_id)).length && (
                <Typography color="text.secondary" variant="body2" sx={{ px: 1, pb: 1 }}>
                  No other people on the LAN to add.
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {inGroup && (
            <Button color="error" onClick={handleLeaveGroup}>
              Leave group
            </Button>
          )}
          <Box flex={1} />
          <Button onClick={() => setMembersOpen(false)}>Close</Button>
          {isAdmin && (
            <Button variant="contained" disabled={!addPick.length} onClick={handleAddMembers}>
              Add
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SettingsScreen(props: {
  profile: Profile;
  identity: Identity;
  onBack: () => void;
  onNameUpdated: (p: Profile) => void;
}) {
  const [fp, setFp] = useState("");
  const [name, setName] = useState(props.profile.display_name);
  const [savingName, setSavingName] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [status, setStatus] = useState("");
  const keyFp = fingerprintPublic(exportPublic(props.identity).x25519_public);

  useEffect(() => {
    peerApi.myFingerprint().then(setFp).catch(() => setFp("(unavailable)"));
    peerApi.getNotificationsEnabled().then(setNotifEnabled).catch(() => {});
  }, []);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === props.profile.display_name) return;
    setSavingName(true);
    try {
      const p = await peerApi.updateDisplayName(trimmed);
      props.onNameUpdated(p);
      setStatus("Display name updated");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setSavingName(false);
    }
  }

  async function toggleNotifications(checked: boolean) {
    setNotifEnabled(checked);
    try {
      await peerApi.setNotificationsEnabled(checked);
      if (checked) {
        const granted = await ensureBrowserNotifyPermission();
        if (!granted) setStatus("Notifications are blocked in the browser/OS");
      }
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied`);
    } catch {
      setStatus("Could not copy");
    }
  }

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
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <TextField
              label="Display name"
              size="small"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveName();
                }
              }}
            />
            <Button
              variant="contained"
              disabled={savingName || !name.trim() || name.trim() === props.profile.display_name}
              onClick={saveName}
            >
              Save
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography
              variant="body2"
              color="text.secondary"
              fontFamily="monospace"
              sx={{ wordBreak: "break-all" }}
              flex={1}
            >
              {props.profile.id}
            </Typography>
            <IconButton size="small" aria-label="Copy user id" onClick={() => copy("User id", props.profile.id)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Listening port: Managed automatically
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Notifications
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={notifEnabled}
                onChange={(e) => toggleNotifications(e.target.checked)}
              />
            }
            label="Desktop notifications for new messages"
          />
          <Typography variant="body2" color="text.secondary">
            Muted chats never notify, even when this is on.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Security fingerprints
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box flex={1} minWidth={0}>
              <Typography variant="body2" color="text.secondary">
                Your key fingerprint
              </Typography>
              <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
                {keyFp}
              </Typography>
            </Box>
            <IconButton
              size="small"
              aria-label="Copy key fingerprint"
              onClick={() => copy("Key fingerprint", keyFp)}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
            <Box flex={1} minWidth={0}>
              <Typography variant="body2" color="text.secondary">
                Your peer TLS fingerprint
              </Typography>
              <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
                {fp || "…"}
              </Typography>
            </Box>
            <IconButton
              size="small"
              aria-label="Copy TLS fingerprint"
              disabled={!fp}
              onClick={() => copy("TLS fingerprint", fp)}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Paper>

        <Alert severity="info">
          No central server — chats live in local SQLite and deliver when peers come online. For
          reliable discovery and delivery, allow PeerTalk through your firewall: UDP 41234 for
          discovery and TCP {props.profile.listen_port} for peer delivery (this TCP port is chosen
          automatically and may change if it's busy).
        </Alert>
        {status && (
          <Alert severity="success" onClose={() => setStatus("")}>
            {status}
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
