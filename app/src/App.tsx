import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { APP_VERSION_FALLBACK, appVersion } from "./version";
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
  Fade,
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
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  CircularProgress,
  FormControlLabel,
  LinearProgress,
  useTheme,
} from "@mui/material";
import ChatIcon from "@mui/icons-material/ForumRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import DownloadingIcon from "@mui/icons-material/DownloadingRounded";
import SportsEsportsIcon from "@mui/icons-material/SportsEsportsRounded";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorderRounded";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import AttachFileIcon from "@mui/icons-material/AttachFileRounded";
import GroupAddIcon from "@mui/icons-material/GroupAddRounded";
import RefreshIcon from "@mui/icons-material/RefreshRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import DownloadIcon from "@mui/icons-material/DownloadRounded";
import GroupIcon from "@mui/icons-material/GroupRounded";
import PersonRemoveIcon from "@mui/icons-material/PersonRemoveRounded";
import PeopleAltIcon from "@mui/icons-material/PeopleAltRounded";
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
import EditIcon from "@mui/icons-material/EditRounded";
import PushPinIcon from "@mui/icons-material/PushPinRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotionsRounded";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import VolumeUpIcon from "@mui/icons-material/VolumeUpRounded";
import VolumeOffIcon from "@mui/icons-material/VolumeOffRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutlineRounded";
import SendIcon from "@mui/icons-material/SendRounded";

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
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
  finishHasher,
  newContentHasher,
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
import { matchingCommands, SLASH_COMMANDS, type CommandContext } from "./commands";

const SLASH_NAMES = new Set(SLASH_COMMANDS.map((c) => c.name));
import {
  AnnounceDialog,
  BundleDialog,
  HelpDialog,
  PollDialog,
  SavedPanel,
  SearchDialog,
  SnippetDialog,
  TransfersPanel,
  type BundleItem,
} from "./panels";
import type { SavedItem, ScanResult, TransferLog } from "./peer";
import { ThemeMode } from "./theme";
import { FEATURE_GAMES } from "./features";
import { GamesHub, type GameDispatchFn, type GameMsg } from "./games/games";

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

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const colors = ["#0F6B5C", "#C45C26", "#2F6FED", "#7B5EA7", "#B45309", "#0E7490", "#BE185D"];
  return colors[h % colors.length];
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
  const [version, setVersion] = useState(APP_VERSION_FALLBACK);

  useEffect(() => {
    (async () => {
      const ver = await appVersion();
      setVersion(ver);
      try {
        await getCurrentWindow().setTitle(`PeerChat ${ver}`);
      } catch {
        /* browser preview */
      }
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
        version={version}
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
        version={version}
        onBack={() => setScreen("chat")}
        onNameUpdated={(p) => setProfile(p)}
      />
    );
  }

  return (
    <ChatScreen
      profile={profile}
      identity={identity}
      version={version}
      onSettings={() => setScreen("settings")}
    />
  );
}

function SetupScreen(props: {
  identity: Identity;
  error: string;
  setError: (s: string) => void;
  version: string;
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
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography variant="overline" color="primary" letterSpacing={2}>
              PeerChat
            </Typography>
            <Typography variant="caption" color="text.secondary">
              v{props.version}
            </Typography>
          </Stack>
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
              {busy ? "Starting…" : "Start PeerChat"}
            </Button>
          </Stack>
        </Paper>
      </Fade>
    </Box>
  );
}

function RichCard({
  kind,
  raw,
  votes,
  plain,
  onVote,
}: {
  kind: string;
  raw: string;
  votes: Message[];
  plain: Record<string, string>;
  onVote: (option: string) => void;
}) {
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (kind === "poll" && parsed?.question && Array.isArray(parsed.options)) {
    const tally = new Map<string, number>();
    const seen = new Set<string>();
    for (const vote of votes) {
      if (seen.has(vote.sender_id)) continue;
      seen.add(vote.sender_id);
      const choice = plain[vote.id];
      if (!choice) continue;
      tally.set(choice, (tally.get(choice) || 0) + 1);
    }
    return (
      <Box sx={{ pr: 1 }}>
        <Typography variant="overline" color="primary">Poll</Typography>
        <Typography fontWeight={700} sx={{ mb: 0.5 }}>{parsed.question}</Typography>
        <Stack spacing={0.5}>
          {parsed.options.map((option: string) => (
            <Button key={option} size="small" variant="outlined" onClick={() => onVote(option)} sx={{ justifyContent: "space-between" }}>
              <span>{option}</span>
              <span>{tally.get(option) || 0}</span>
            </Button>
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">{seen.size} vote{seen.size === 1 ? "" : "s"} received on this computer</Typography>
      </Box>
    );
  }
  if (kind === "snippet") {
    const title = parsed?.title || "Snippet";
    const body = parsed?.body || raw;
    return (
      <Box sx={{ pr: 1 }}>
        <Typography variant="overline" color="primary">{title}</Typography>
        <Typography component="pre" sx={{ m: 0, fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>{body}</Typography>
      </Box>
    );
  }
  const title = parsed?.title || "Announcement";
  const body = parsed?.body || raw;
  return (
    <Box sx={{ pr: 1 }}>
      <Typography variant="overline" color="primary">Announcement</Typography>
      <Typography fontWeight={700}>{title}</Typography>
      <Typography variant="body2" whiteSpace="pre-wrap">{body}</Typography>
    </Box>
  );
}

function ChatScreen({
  profile,
  identity,
  onSettings,
  version,
}: {
  profile: Profile;
  identity: Identity;
  onSettings: () => void;
  version: string;
}) {
  const muiTheme = useTheme();
  const dark = muiTheme.palette.mode === "dark";
  const [peers, setPeers] = useState<Peer[]>([]);
  const [lanHosts, setLanHosts] = useState<LanHost[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [groupKeys, setGroupKeys] = useState<Record<string, Uint8Array>>({});
  const [tab, setTab] = useState(0);
  const [nav, setNav] = useState<"people" | "chats" | "groups" | "transfers" | "games" | "saved">("chats");
  const [scanning, setScanning] = useState(false);
  const [transfers, setTransfers] = useState<TransferLog[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchHits, setSearchHits] = useState<{ id: string; title: string; detail: string; conversationId?: string }[]>([]);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [gamesOn, setGamesOn] = useState(true);
  const filePickRef = useRef<HTMLInputElement | null>(null);
  const pauseRef = useRef(false);
  const [chatSearch, setChatSearch] = useState("");

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [typingLabel, setTypingLabel] = useState<string | null>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);

  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupPick, setGroupPick] = useState<string[]>([]);
  const [renameDraft, setRenameDraft] = useState("");

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
  const [pendingShareFiles, setPendingShareFiles] = useState<string[]>([]);
  const [scanWarn, setScanWarn] = useState<{ detail: string; onProceed: () => void } | null>(null);

  // Ref for the active game's inbound message dispatcher (set by each game component)
  const gameDispatchRef = useRef<GameDispatchFn | null>(null);

  const scroller = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const chatSearchRef = useRef<HTMLInputElement | null>(null);
  const groupKeysRef = useRef(groupKeys);
  groupKeysRef.current = groupKeys;
  const abortSendRef = useRef(false);
  const abortOpenRef = useRef(false);
  const queueAbortRef = useRef(false);
  const activeRef = useRef<Conversation | null>(null);
  const textRef = useRef("");
  const draftsRef = useRef<Record<string, string>>({});
  const typingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTtlRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  const others = useMemo(
    () => peers.filter((p) => p.user_id !== profile.id),
    [peers, profile.id]
  );

  const filteredConvs = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    return convs.filter((c) => {
      if (nav === "groups" && c.kind !== "group") return false;
      if (nav === "chats" && c.kind !== "dm") return false;
      if (!q) return true;
      const title = (c.kind === "dm" ? c.peer_name : c.title) || "";
      return title.toLowerCase().includes(q);
    });
  }, [convs, chatSearch, nav]);

  const isAdmin = useMemo(
    () =>
      !!active &&
      active.kind === "group" &&
      members.some((m) => m.user_id === profile.id && m.role === "admin"),
    [active, members, profile.id]
  );

  const inGroup =
    active?.kind !== "group" || !membersLoaded || members.some((m) => m.user_id === profile.id);

  const canAddMembers =
    !!active &&
    active.kind === "group" &&
    inGroup &&
    (isAdmin || active.members_can_add !== false);

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

  async function refresh() {
    setScanning(true);
    try {
      await peerApi.discoverPeers();
    } catch {
      /* ignore */
    }
    const [p, c, hosts, logs, saved, gamesFlag] = await Promise.all([
      peerApi.listPeers(),
      peerApi.listConversations(),
      peerApi.listLanHosts().catch(() => []),
      peerApi.listTransfers().catch(() => [] as TransferLog[]),
      peerApi.listSavedItems().catch(() => [] as SavedItem[]),
      FEATURE_GAMES ? peerApi.getAppSetting("games_enabled").catch(() => "1") : Promise.resolve("0"),
    ]);
    setScanning(false);
    setPeers(p);
    setConvs(c);
    setLanHosts(hosts);
    setTransfers(logs);
    setSavedItems(saved);
    setGamesOn(FEATURE_GAMES && gamesFlag !== "0");
    setActive((prev) => {
      if (!prev) return prev;
      const fresh = c.find((x) => x.id === prev.id);
      return fresh ?? prev;
    });
  }

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
    let unlisten: (() => void) | undefined;
    listen<{
      conversation_id?: string;
      from_name?: string;
      from_id?: string;
      kind?: string;
    }>("inbox-updated", (ev) => {
      refresh().catch(() => {});
      const p = ev.payload || {};
      const cid = p.conversation_id || "";
      if (!cid) return;
      if (p.from_id === profile.id) return;
      const kind = p.kind || "";
      if (kind === "reaction" || kind === "pin" || kind === "unpin" || kind === "deleted") return;

      // Route game_move messages to the active game component.
      if (kind === "game_move" && gameDispatchRef.current && p.from_id) {
        const fromId = p.from_id;
        void (async () => {
          try {
            const msgs = await peerApi.listMessages(cid);
            const latest = msgs.filter((m) => m.kind === "game_move" && m.sender_id === fromId).at(-1);
            if (!latest) return;
            const peer = peers.find((x) => x.user_id === fromId);
            if (!peer) return;
            const pubs: Record<string, string> = {
              [peer.user_id]: peer.x25519_public,
              [profile.id]: exportPublic(identity).x25519_public,
            };
            const plaintext = await decryptMessage({ ...latest, wrapped_keys: latest.wrapped_keys || {} }, profile.id, identity);
            const gameMsg = JSON.parse(plaintext) as GameMsg;
            gameDispatchRef.current?.(fromId, gameMsg);
          } catch { /* ignore malformed game messages */ }
        })();
        return; // don't toast for game moves
      }

      // Native OS toast (not Web Notification — that flash-prompted on WebView2).
      void (async () => {
        try {
          const enabled = await peerApi.getNotificationsEnabled();
          if (!enabled) return;
          const muted = await peerApi.conversationIsMuted(cid).catch(() => false);
          if (muted) return;
          const focused = await getCurrentWindow().isFocused().catch(() => true);
          const viewing = activeRef.current?.id === cid;
          if (focused && viewing) return;
          let granted = await isPermissionGranted();
          if (!granted) {
            granted = (await requestPermission()) === "granted";
          }
          if (!granted) return;
          const title = (p.from_name || "PeerChat").trim() || "PeerChat";
          const body =
            kind === "file_notice"
              ? "Sent a file"
              : kind === "system" || kind === "group_event"
                ? "Group update"
                : "New message";
          sendNotification({ title, body });
        } catch (err) {
          console.error("notify", err);
        }
      })();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [profile.id]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ conversation_id?: string; user_id?: string; display_name?: string }>(
      "peer-typing",
      (ev) => {
        const p = ev.payload;
        if (!p?.conversation_id || p.conversation_id !== activeRef.current?.id) return;
        if (p.user_id === profile.id) return;
        const name = (p.display_name || "Someone").trim() || "Someone";
        setTypingLabel(`${name} is typing…`);
        if (typingTtlRef.current) clearTimeout(typingTtlRef.current);
        typingTtlRef.current = setTimeout(() => setTypingLabel(null), 3000);
      }
    ).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
      if (typingTtlRef.current) clearTimeout(typingTtlRef.current);
      if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    };
  }, [profile.id]);

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
    setEditingMessage(null);
    setTypingLabel(null);
    setRenameDraft(conv.title || "");
    setText(draftsRef.current[conv.id] ?? "");
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
    const t = setInterval(() => pull().catch(() => {}), 750);
    let unlisten: (() => void) | undefined;
    listen("inbox-updated", () => {
      pull().catch(() => {});
    }).then((fn) => {
      if (cancel) fn();
      else unlisten = fn;
    });
    return () => {
      cancel = true;
      clearInterval(t);
      unlisten?.();
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
        if (
          m.conversation_id !== active.id ||
          m.kind === "file_notice" ||
          m.kind === "deleted"
        ) {
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

  // Listen for --share <file> launched from the Windows right-click context menu.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<string[]>("share-files", (event) => {
      setPendingShareFiles(event.payload || []);
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // When pendingShareFiles arrives, stage them as outgoing files on the active conversation.
  // If no conversation is active, just keep them queued and let the user select one first.
  useEffect(() => {
    if (!pendingShareFiles.length || !active) return;
    const files = pendingShareFiles;
    setPendingShareFiles([]);
    for (const path of files) {
      const name = path.replace(/\\/g, "/").split("/").pop() || "shared-file";
      sendFile({ path, name, size: 0 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShareFiles, active?.id]);

  function selectConversation(c: Conversation) {
    const prev = activeRef.current;
    if (prev && prev.id !== c.id) {
      draftsRef.current[prev.id] = textRef.current;
    }
    setMessages([]);
    setPlain({});
    setReplyTo(null);
    setEditingMessage(null);
    setTypingLabel(null);
    setText(draftsRef.current[c.id] ?? "");
    clearStagedFiles();
    setActive(c);
  }

  function notifyTyping() {
    if (!active) return;
    if (typingDebounceRef.current) clearTimeout(typingDebounceRef.current);
    typingDebounceRef.current = setTimeout(() => {
      resolveMemberIds(active)
        .then((ids) =>
          peerApi.sendTyping(
            active.id,
            ids.filter((id) => id !== profile.id)
          )
        )
        .catch(() => {});
    }, 400);
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
    setEditingMessage(null);
    setMsgMenu(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function startEdit(message: Message) {
    if (message.kind !== "text" || message.sender_id !== profile.id) return;
    setEditingMessage(message);
    setReplyTo(null);
    setText(plain[message.id] || "");
    setMsgMenu(null);
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  function cancelEdit() {
    setEditingMessage(null);
    const draft = active ? draftsRef.current[active.id] ?? "" : "";
    setText(draft);
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

  async function sendGroupSystemNotice(
    conv: Conversation,
    body: string,
    recipientIds?: string[]
  ) {
    const gk = await ensureGroupKey(conv.id);
    const enc = await encryptWithGroupKey(body, conv.id, profile.id, gk, identity);
    const members = recipientIds ?? (await peerApi.memberIds(conv.id));
    await peerApi.sendMessage(
      conv.id,
      { kind: "system", sender_id: profile.id, ...enc },
      members.filter((id) => id !== profile.id)
    );
  }

  async function sendEncrypted(kind: string, body: string, replyToId?: string) {
    if (!active || !body.trim()) return;
    const peer = active.kind === "dm" ? peers.find((p) => p.user_id === active.peer_id) : undefined;
    if (peer?.identity_changed) {
      setStatus("This peer's certificate changed. Review it in People before sending.");
      return;
    }
    let message: any;
    if (active.kind === "dm" && active.peer_id) {
      if (!peer) {
        setStatus("Peer not found");
        return;
      }
      const pubs: Record<string, string> = {
        [peer.user_id]: peer.x25519_public,
        [profile.id]: exportPublic(identity).x25519_public,
      };
      const enc = await encryptMessage(body.trim(), active.id, profile.id, identity, pubs);
      message = { kind, sender_id: profile.id, ...enc, reply_to: replyToId ?? null };
    } else {
      const gk = await ensureGroupKey(active.id);
      const enc = await encryptWithGroupKey(body.trim(), active.id, profile.id, gk, identity);
      message = { kind, sender_id: profile.id, ...enc, reply_to: replyToId ?? null };
    }
    const memberIds = await resolveMemberIds(active);
    await peerApi.sendMessage(
      active.id,
      message,
      memberIds.filter((id) => id !== profile.id)
    );
    setMessages(await peerApi.listMessages(active.id));
  }

  /**
   * Send a game message to a specific peer via their DM conversation.
   * Opens or reuses the DM conversation, encrypts, and sends kind=game_move.
   */
  async function sendGameMsg(peerId: string, msg: GameMsg): Promise<void> {
    const peer = peers.find((p) => p.user_id === peerId);
    if (!peer) throw new Error("Peer not found");
    const conv = await peerApi.openDm(peerId);
    const pubs: Record<string, string> = {
      [peer.user_id]: peer.x25519_public,
      [profile.id]: exportPublic(identity).x25519_public,
    };
    const body = JSON.stringify(msg);
    const enc = await encryptMessage(body, conv.id, profile.id, identity, pubs);
    await peerApi.sendMessage(
      conv.id,
      { kind: "game_move", sender_id: profile.id, ...enc },
      [peerId]
    );
  }

  async function sendText(body: string, replyToId?: string) {
    if (!active || !body.trim()) return;
    const editing = editingMessage;
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
      message = {
        kind: "text",
        sender_id: profile.id,
        ...enc,
        reply_to: editing ? editing.reply_to ?? null : replyToId ?? null,
      };
    } else {
      const gk = await ensureGroupKey(active.id);
      const enc = await encryptWithGroupKey(body.trim(), active.id, profile.id, gk, identity);
      message = {
        kind: "text",
        sender_id: profile.id,
        ...enc,
        reply_to: editing ? editing.reply_to ?? null : replyToId ?? null,
      };
    }
    if (editing) {
      message.id = editing.id;
      message.created_at = editing.created_at;
    }
    const memberIds = await resolveMemberIds(active);
    await peerApi.sendMessage(
      active.id,
      message,
      memberIds.filter((id) => id !== profile.id),
      !!editing
    );
    setEditingMessage(null);
    setMessages(await peerApi.listMessages(active.id));
  }

  async function submitComposer() {
    if (!active) return;
    const files = editingMessage ? [] : stagedFiles;
    const body = text.trim();
    const replyId = replyTo?.id;
    if (!files.length && !body) return;
    if (active) draftsRef.current[active.id] = "";
    setText("");
    setReplyTo(null);
    setStagedFiles([]);
    for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    if (body) await sendText(body, replyId);
    else setEditingMessage(null);
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
    const visible = active
      ? messages.filter((m) => m.conversation_id === active.id && m.kind !== "poll_vote")
      : [];
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

  function labelForConversation(conversationId: string) {
    const c = convs.find((x) => x.id === conversationId) || (active?.id === conversationId ? active : null);
    if (!c) return "conversation";
    return c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
  }

  async function recordTransfer(row: {
    id: string;
    filename: string;
    direction: string;
    status: string;
    size_bytes?: number;
    bytes_done?: number;
    file_id?: string;
    conversation_id?: string;
    peer_label?: string;
    error?: string | null;
    verified?: boolean;
    started_at?: string;
  }) {
    const terminal = row.status === "completed" || row.status === "failed" || row.status === "interrupted";
    try {
      await peerApi.upsertTransfer({
        size_bytes: row.size_bytes ?? 0,
        bytes_done: row.bytes_done ?? 0,
        verified: !!row.verified,
        started_at: row.started_at || new Date().toISOString(),
        finished_at: terminal ? new Date().toISOString() : null,
        error: row.error || null,
        ...row,
      });
      setTransfers(await peerApi.listTransfers());
    } catch (err) {
      console.error("transfer log", err);
    }
  }

  async function readNextPlainChunk(source: File | { path: string }, offset: number) {
    if (source instanceof File) {
      const slice = source.slice(offset, offset + CHUNK_SIZE);
      return new Uint8Array(await slice.arrayBuffer());
    }
    const data = await peerApi.readBundleChunk(source.path, offset, CHUNK_SIZE);
    return fromB64(data);
  }

  async function sendFile(file: File | { path: string; name: string; size: number }) {
    if (!active) return;
    const blocked = peers.find((p) => p.user_id === active.peer_id && p.identity_changed);
    if (blocked) {
      setStatus("This peer's certificate changed. Review it in People before sending.");
      return;
    }
    const name = file instanceof File ? file.name : file.name;
    const size = file instanceof File ? file.size : file.size;
    const conversationId = active.id;

    // Virus scan outgoing file before encrypting.
    const scanPath = file instanceof File
      ? (file as File & { path?: string }).path ?? ""
      : file.path;
    if (scanPath) {
      try {
        const scan = await peerApi.scanFile(scanPath);
        if (!scan.clean) {
          // Threat found — require explicit confirmation before sending.
          await new Promise<void>((resolve, reject) => {
            setScanWarn({
              detail: scan.detail,
              onProceed: () => { setScanWarn(null); resolve(); },
            });
            // If user closes without confirming, reject after 60 s to avoid hanging.
            setTimeout(() => { setScanWarn(null); reject(new Error("scan warning dismissed")); }, 60_000);
          });
        }
      } catch (err: any) {
        if (String(err?.message || err).includes("dismissed")) {
          setStatus("File not sent (virus scan warning).");
          return;
        }
        // scan infrastructure error — proceed (non-blocking for scanner failures)
      }
    }
    const chunkCount = Math.max(1, Math.ceil(size / CHUNK_SIZE));
    const transferId = `send-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const started = new Date().toISOString();
    abortSendRef.current = false;
    pauseRef.current = false;
    let fileId: string | undefined;
    setOutgoingFile({ conversationId, name, done: 0, total: chunkCount });
    await recordTransfer({
      id: transferId,
      filename: name,
      direction: "send",
      status: "connecting",
      size_bytes: size,
      conversation_id: conversationId,
      peer_label: labelForConversation(conversationId),
      started_at: started,
    });
    const startedMs = Date.now();
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
      const nameEnc = encryptFilename(contentKey, name);
      const created = await peerApi.createOutgoingFile({
        conversationId,
        encFilename: nameEnc.ciphertext,
        filenameNonce: nameEnc.nonce,
        sizeBytes: size,
        chunkCount,
        wrappedKeys: wrapped_keys,
        originalPath: file instanceof File ? (file as File & { path?: string }).path || null : file.path,
        fileCryptoV: 2,
      });
      fileId = created.file_id;
      setFileNames((s) => ({ ...s, [fileId!]: name }));
      const hasher = newContentHasher();
      let sentBytes = 0;
      await recordTransfer({
        id: transferId,
        filename: name,
        direction: "send",
        status: "transferring",
        size_bytes: size,
        file_id: fileId,
        conversation_id: conversationId,
        peer_label: labelForConversation(conversationId),
        started_at: started,
      });
      for (let i = 0; i < chunkCount; i++) {
        while (pauseRef.current) {
          if (abortSendRef.current) throw new Error("aborted");
          await new Promise((r) => setTimeout(r, 200));
        }
        if (abortSendRef.current) throw new Error("aborted");
        const buf = await readNextPlainChunk(file instanceof File ? file : { path: file.path }, i * CHUNK_SIZE);
        hasher.update(buf);
        const { nonce, ciphertextB64 } = encryptChunk(contentKey, buf, i);
        await peerApi.writeFileChunk(fileId, i, ciphertextB64, nonce);
        sentBytes += buf.length;
        if (i === 0 || i + 1 === chunkCount || (i + 1) % 2 === 0) {
          setOutgoingFile({ conversationId, fileId, name, done: i + 1, total: chunkCount });
          await recordTransfer({
            id: transferId,
            filename: name,
            direction: "send",
            status: "transferring",
            size_bytes: size,
            bytes_done: sentBytes,
            file_id: fileId,
            conversation_id: conversationId,
            peer_label: labelForConversation(conversationId),
            started_at: started,
          });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (abortSendRef.current) throw new Error("aborted");
      await recordTransfer({
        id: transferId,
        filename: name,
        direction: "send",
        status: "verifying",
        size_bytes: size,
        bytes_done: sentBytes,
        file_id: fileId,
        conversation_id: conversationId,
        peer_label: labelForConversation(conversationId),
        started_at: started,
      });
      const digest = finishHasher(hasher);
      await peerApi.setFileContentHash(fileId, digest);
      await peerApi.sendFileNotice(
        conversationId,
        fileId,
        memberIds.filter((id) => id !== profile.id)
      );
      setMessages(await peerApi.listMessages(conversationId));
      const seconds = Math.max(0.1, (Date.now() - startedMs) / 1000);
      await recordTransfer({
        id: transferId,
        filename: name,
        direction: "send",
        status: "completed",
        size_bytes: size,
        bytes_done: sentBytes,
        verified: true,
        file_id: fileId,
        conversation_id: conversationId,
        peer_label: labelForConversation(conversationId),
        started_at: started,
      });
      setStatus(`Sent ${name} · verified · ${Math.round(sentBytes / seconds / 1024)} KB/s`);
    } catch (err: any) {
      const raw = String(err?.message || err);
      if (raw === "aborted") {
        if (fileId) {
          try {
            await peerApi.abortOutgoingFile(fileId);
          } catch {
            /* ignore */
          }
        }
        await recordTransfer({
          id: transferId,
          filename: name,
          direction: "send",
          status: "interrupted",
          size_bytes: size,
          file_id: fileId,
          error: "Cancelled",
          conversation_id: conversationId,
          peer_label: labelForConversation(conversationId),
          started_at: started,
        });
      } else {
        setStatus(explainTransferError(raw));
        await recordTransfer({
          id: transferId,
          filename: name,
          direction: "send",
          status: "failed",
          size_bytes: size,
          file_id: fileId,
          error: explainTransferError(raw),
          conversation_id: conversationId,
          peer_label: labelForConversation(conversationId),
          started_at: started,
        });
      }
    } finally {
      setOutgoingFile(null);
      abortSendRef.current = false;
      pauseRef.current = false;
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
    setStatus("Saving to Downloads…");
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
      setStatus(`Saved to Downloads: ${filePreview.name}`);
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  /** One-click: fetch from peer (sender must be online) → save under Downloads. */
  function explainTransferError(raw: string) {
    if (/space/i.test(raw)) return `Not enough disk space. ${raw}`;
    if (/permission/i.test(raw)) return `Permission denied while writing the file. ${raw}`;
    if (/integrity/i.test(raw)) return raw;
    if (/invalid destination/i.test(raw)) return raw;
    if (/offline|no ip|no port|uploader|connect|tls|fingerprint|forbidden|missing chunk/i.test(raw)) {
      return "Can't reach the sender. Keep PeerChat open on both computers on the same LAN, then retry.";
    }
    return raw;
  }

  async function downloadFileToDownloads(fileId: string, uploaderId: string) {
    setPreviewBusy(true);
    setStatus("Downloading…");
    abortOpenRef.current = false;
    const transferId = `recv-${fileId}`;
    const started = new Date().toISOString();
    let name = "file";
    try {
      const file = await peerApi.getFile(fileId);
      if (!file) throw new Error("File metadata missing");
      const key = unwrapContentKey(file.wrapped_keys, profile.id, identity);
      try {
        name = decryptFilename(key, file.filename_nonce, file.enc_filename);
      } catch {
        name = "file.bin";
      }
      if (file.local_path) {
        const check = await peerApi.verifyDownloadedFile(fileId);
        setStatus(check.verified ? `Already saved and verified: ${file.local_path}` : `Saved, hash not provided by sender: ${file.local_path}`);
        await recordTransfer({
          id: transferId,
          filename: name,
          direction: "recv",
          status: "completed",
          size_bytes: Number(file.size_bytes) || 0,
          bytes_done: Number(file.size_bytes) || 0,
          verified: !!check.verified,
          file_id: fileId,
          error: check.reason || null,
          peer_label: senderLabel(uploaderId),
          started_at: started,
        });
        return;
      }
      const totalChunks = Math.max(1, Number(file.chunk_count) || 1);
      const cryptoV = Number(file.file_crypto_v) || 1;
      const progress = await peerApi.beginFileReceive(fileId);
      let next = Number(progress.next_index) || 0;
      setIncomingFile({ fileId, name, done: next, total: totalChunks });
      await recordTransfer({
        id: transferId,
        filename: name,
        direction: "recv",
        status: next > 0 ? "transferring" : "connecting",
        size_bytes: Number(file.size_bytes) || 0,
        bytes_done: next * CHUNK_SIZE,
        file_id: fileId,
        conversation_id: active?.id,
        peer_label: senderLabel(uploaderId),
        started_at: started,
      });
      for (let i = next; i < totalChunks; i++) {
        if (abortOpenRef.current) throw new Error("aborted");
        let chunk;
        try {
          chunk = await peerApi.fetchFileChunk(fileId, i, uploaderId);
        } catch (err) {
          await recordTransfer({
            id: transferId,
            filename: name,
            direction: "recv",
            status: "interrupted",
            file_id: fileId,
            error: explainTransferError(String((err as any)?.message || err)),
            peer_label: senderLabel(uploaderId),
            started_at: started,
          });
          throw err;
        }
        const plain = decryptChunk(key, chunk.nonce, fromB64(chunk.data_b64), cryptoV >= 2 ? i : undefined);
        await peerApi.appendFileReceive(fileId, i, b64(plain));
        setIncomingFile({ fileId, name, done: i + 1, total: totalChunks });
      }
      await recordTransfer({
        id: transferId,
        filename: name,
        direction: "recv",
        status: "verifying",
        size_bytes: Number(file.size_bytes) || 0,
        bytes_done: Number(file.size_bytes) || 0,
        file_id: fileId,
        peer_label: senderLabel(uploaderId),
        started_at: started,
      });
      const path = await peerApi.finalizeFileReceive(fileId, name);
      const check = await peerApi.verifyDownloadedFile(fileId);

      // Virus scan the assembled file before accepting it.
      const scanResult = await peerApi.scanFile(path).catch((): ScanResult => ({
        clean: true, engine: "none", detail: "scan unavailable", skipped: true,
      }));
      if (!scanResult.clean) {
        // Threat confirmed — delete the file and abort.
        try { await import("@tauri-apps/api/path").then(() => peerApi.discardFileReceive(fileId)); } catch {}
        try { await (await import("@tauri-apps/api/core")).invoke("plugin:fs|remove_file", { path }); } catch {}
        throw new Error(`Blocked by virus scanner (${scanResult.engine}): ${scanResult.detail}`);
      }

      if (uploaderId !== profile.id) {
        await peerApi.ackFileDownload(fileId, uploaderId).catch(() => {});
      }
      const scanNote = scanResult.skipped ? null : `Scanned clean by ${scanResult.engine}`;
      await recordTransfer({
        id: transferId,
        filename: name,
        direction: "recv",
        status: "completed",
        size_bytes: Number(file.size_bytes) || 0,
        bytes_done: Number(file.size_bytes) || 0,
        verified: !!check.verified,
        file_id: fileId,
        error: check.verified ? null : (check.reason || null),
        peer_label: senderLabel(uploaderId),
        started_at: started,
      });
      const verifyNote = check.verified ? "verified ✓" : "sender sent no hash";
      setStatus(`Saved (${verifyNote}${scanNote ? ` · ${scanNote}` : ""}): ${path}`);
    } catch (err: any) {
      const raw = String(err?.message || err);
      if (raw === "aborted") {
        await peerApi.discardFileReceive(fileId).catch(() => {});
        setStatus("Download cancelled");
        return;
      }
      const message = explainTransferError(raw);
      setStatus(message);
      await recordTransfer({
        id: transferId,
        filename: name,
        direction: "recv",
        status: /integrity|space|permission|destination/i.test(raw) ? "failed" : "interrupted",
        file_id: fileId,
        error: message,
        peer_label: senderLabel(uploaderId),
        started_at: started,
      });
    } finally {
      setIncomingFile(null);
      setPreviewBusy(false);
      abortOpenRef.current = false;
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
      const remainingIds = remaining.map((m) => m.user_id);
      try {
        await sendGroupSystemNotice(
          active,
          `${profile.display_name} removed ${displayName}`,
          remainingIds
        );
      } catch (e) {
        console.error(e);
      }
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

  async function handleRenameGroup() {
    if (!active || active.kind !== "group") return;
    const title = renameDraft.trim();
    if (!title || title === active.title) return;
    try {
      await peerApi.renameGroup(active.id, title);
      setActive({ ...active, title });
      await refresh();
      setStatus("Group renamed");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function handleDeleteGroup() {
    if (!active || active.kind !== "group") return;
    if (
      !window.confirm(
        "Delete this group for everyone? Chats and membership will be removed on all devices."
      )
    ) {
      return;
    }
    try {
      await peerApi.deleteGroup(active.id);
      setMembersOpen(false);
      setActive(null);
      await refresh();
      setStatus("Group deleted");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function handleToggleMembersCanAdd(allowed: boolean) {
    if (!active || active.kind !== "group") return;
    try {
      await peerApi.setGroupMembersCanAdd(active.id, allowed);
      setActive({ ...active, members_can_add: allowed });
      await refresh();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function handleSetMemberRole(userId: string, role: "admin" | "member") {
    if (!active || active.kind !== "group") return;
    try {
      await peerApi.setGroupMemberRole(active.id, userId, role);
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
      await sendGroupSystemNotice(
        conversation,
        `${profile.display_name} started the group`,
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

  const commandCtx: CommandContext = {
    hasConversation: !!active && inGroup,
    isGroup: active?.kind === "group" && inGroup,
    hasMessageSelection: !!(replyTo || msgMenu),
  };
  const slashToken = text.startsWith("/") ? text.split(/\s/)[0] : "";
  const slashSuggestions =
    slashToken && !editingMessage && !text.includes("\n") ? matchingCommands(slashToken, commandCtx) : [];

  async function runSlash(name: string) {
    setText("");
    if (active) draftsRef.current[active.id] = "";
    if (name === "/send") {
      filePickRef.current?.click();
    } else if (name === "/bundle") {
      setBundleOpen(true);
    } else if (name === "/transfers") {
      setNav("transfers");
    } else if (name === "/peers") {
      setNav("people");
      setTab(0);
    } else if (name === "/announce") {
      setAnnounceOpen(true);
    } else if (name === "/poll") {
      setPollOpen(true);
    } else if (name === "/snippet") {
      setSnippetOpen(true);
    } else if (name === "/search") {
      setSearchOpen(true);
    } else if (name === "/pin") {
      const target = replyTo || msgMenu?.message;
      if (!target) setStatus("Select or reply to a message, then use /pin.");
      else await togglePinMessage(target);
    } else if (name === "/help") {
      setHelpOpen(true);
    }
  }

  async function runSearch() {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setSearchHits([]);
      return;
    }
    setSearchBusy(true);
    const hits: { id: string; title: string; detail: string; conversationId?: string }[] = [];
    for (const c of convs) {
      const title = (c.kind === "dm" ? c.peer_name : c.title) || "";
      if (title.toLowerCase().includes(q)) {
        hits.push({ id: `c-${c.id}`, title, detail: c.kind === "group" ? "Group" : "Direct message", conversationId: c.id });
      }
    }
    for (const item of savedItems) {
      if (item.preview.toLowerCase().includes(q)) {
        hits.push({ id: `s-${item.id}`, title: item.preview, detail: "Saved", conversationId: item.conversation_id });
      }
    }
    for (const row of transfers) {
      if (row.filename.toLowerCase().includes(q)) {
        hits.push({ id: `t-${row.id}`, title: row.filename, detail: `Transfer · ${row.status}`, conversationId: row.conversation_id || undefined });
      }
    }
    for (const c of convs) {
      try {
        const msgs = await peerApi.listMessages(c.id);
        if (c.kind === "group") {
          try {
            await ensureGroupKey(c.id);
          } catch {
            continue;
          }
        }
        for (const m of msgs) {
          if (m.kind === "file_notice" || m.kind === "deleted" || m.kind === "poll_vote") continue;
          let textBody = "";
          try {
            if (c.kind === "group") {
              const gk = await ensureGroupKey(c.id);
              textBody = await decryptWithGroupKey(m, gk);
            } else {
              textBody = await decryptMessage({ ...m, wrapped_keys: m.wrapped_keys || {} }, profile.id, identity);
            }
          } catch {
            continue;
          }
          if (textBody.toLowerCase().includes(q)) {
            const title = c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
            hits.push({ id: `m-${m.id}`, title, detail: textBody.slice(0, 140), conversationId: c.id });
          }
          if (hits.length > 40) break;
        }
      } catch {
        /* skip locked conversation */
      }
      if (hits.length > 40) break;
    }
    setSearchHits(hits);
    setSearchBusy(false);
  }

  const activeTitle = active
    ? active.kind === "dm"
      ? active.peer_name || "Direct"
      : active.title || "Group"
    : "";

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
      {/* Icon rail */}
      <Box
        sx={{
          width: 64,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          py: 1.5,
          gap: 0.5,
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        {(
          [
            ["chats", "Chats", <ChatIcon key="c" />],
            ["groups", "Groups", <GroupsIcon key="g" />],
            ["people", "People", <PeopleAltIcon key="p" />],
            ["transfers", "Transfers", <DownloadingIcon key="t" />],
            ...(FEATURE_GAMES ? [["games", "Games", <SportsEsportsIcon key="s" />] as const] : []),
            ["saved", "Saved", <BookmarkBorderIcon key="b" />],
          ] as const
        ).map(([id, label, icon]) => (
          <Tooltip key={id} title={label} placement="right">
            <IconButton
              color={nav === id ? "primary" : "default"}
              aria-label={label}
              onClick={() => {
                setNav(id);
                if (id === "people") setTab(0);
                if (id === "chats" || id === "groups") setTab(1);
              }}
              sx={{
                bgcolor: nav === id ? "action.selected" : "transparent",
                borderRadius: 2.5,
              }}
            >
              {icon}
            </IconButton>
          </Tooltip>
        ))}
        <Box flex={1} />
        <Tooltip title="Settings" placement="right">
          <IconButton onClick={onSettings} sx={{ borderRadius: 2.5 }}>
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* List pane */}
      <Box
        sx={{
          width: 300,
          flexShrink: 0,
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          display: nav === "transfers" || nav === "games" || nav === "saved" ? "none" : "flex",
        }}
      >
        <Box sx={{ px: 2, pt: 1.75, pb: 1, display: "flex", alignItems: "center", gap: 1 }}>
          <Box flex={1} minWidth={0}>
            <Typography variant="subtitle1" fontWeight={700} lineHeight={1.2}>
              PeerChat{" "}
              <Typography component="span" variant="caption" color="text.secondary" fontWeight={500}>
                v{version}
              </Typography>
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {scanning ? "Scanning LAN…" : profile.display_name}
            </Typography>
          </Box>
          <IconButton size="small" aria-label="Refresh peers" onClick={() => refresh()}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{ px: 1.5, pb: 1 }}>
          <TextField
            inputRef={chatSearchRef}
            size="small"
            fullWidth
            placeholder={tab === 1 ? "Search chats… (Ctrl/Cmd+K)" : "Search people…"}
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment:
                tab === 1 ? (
                  <InputAdornment position="end">
                    <Tooltip title="New group">
                      <IconButton
                        size="small"
                        edge="end"
                        aria-label="New group"
                        onClick={() => setGroupOpen(true)}
                      >
                        <GroupAddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ) : undefined,
              sx: { borderRadius: 999, bgcolor: "#F3F6F4" },
            }}
          />
        </Box>
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, pb: 1 }}>
          {tab === 0 && (
            <List dense disablePadding>
              {others
                .filter((p) => {
                  const q = chatSearch.trim().toLowerCase();
                  if (!q) return true;
                  return p.display_name.toLowerCase().includes(q);
                })
                .map((p) => (
                  <ListItemButton key={p.user_id} onClick={() => openDm(p)} sx={{ py: 0.85 }}>
                    <Avatar
                      sx={{
                        width: 40,
                        height: 40,
                        mr: 1.25,
                        bgcolor: avatarColor(p.display_name),
                        fontSize: 15,
                      }}
                    >
                      {p.display_name.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <ListItemText
                      primary={p.display_name}
                      secondary={
                        p.identity_changed
                          ? "Certificate changed — review before chatting"
                          : p.online
                            ? "Online"
                            : lastSeenLabel(p.last_seen_at)
                      }
                      primaryTypographyProps={{ fontWeight: 600, fontSize: 14, noWrap: true }}
                      secondaryTypographyProps={{ fontSize: 12 }}
                    />
                    {p.identity_changed && (
                      <Button
                        size="small"
                        color="warning"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await peerApi.acceptPendingIdentity(p.user_id);
                          setStatus(`Accepted the new certificate for ${p.display_name}`);
                          await refresh();
                        }}
                      >
                        Review
                      </Button>
                    )}
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: p.identity_changed ? "warning.main" : p.online ? "success.main" : "grey.400",
                      }}
                    />
                  </ListItemButton>
                ))}
              {!others.length && (
                <Typography sx={{ p: 2 }} color="text.secondary" variant="body2">
                  No peers yet. Start PeerChat on another PC on this LAN and hit refresh.
                </Typography>
              )}
              {lanHosts.length > 0 && (
                <>
                  <Divider sx={{ my: 1, mx: 2 }} />
                  <Typography variant="overline" color="text.secondary" sx={{ px: 2.5 }}>
                    Other devices on this network
                  </Typography>
                  {lanHosts.map((h) => (
                    <Box
                      key={h.ip}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.25,
                        px: 2.5,
                        py: 0.85,
                        opacity: 0.55,
                      }}
                    >
                      <Avatar sx={{ width: 40, height: 40, bgcolor: "grey.300", color: "grey.600", fontSize: 15 }}>
                        {h.label.slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box flex={1} minWidth={0}>
                        <Typography noWrap fontSize={14} fontWeight={600}>
                          {h.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {h.ip} · No PeerChat
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </>
              )}
            </List>
          )}
          {tab === 1 && (
            <List dense disablePadding>
              {filteredConvs.map((c) => {
                const title = c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
                return (
                  <ListItemButton
                    key={c.id}
                    selected={active?.id === c.id}
                    onClick={() => selectConversation(c)}
                    sx={{
                      py: 0.9,
                      alignItems: "flex-start",
                      "& .chat-row-actions": {
                        opacity: 0,
                        pointerEvents: "none",
                        transition: "opacity 0.12s ease",
                      },
                      "&:hover .chat-row-actions, &:focus-within .chat-row-actions": {
                        opacity: 1,
                        pointerEvents: "auto",
                      },
                    }}
                  >
                    <Avatar
                      sx={{
                        width: 42,
                        height: 42,
                        mr: 1.25,
                        mt: 0.25,
                        bgcolor: avatarColor(title),
                        fontSize: 16,
                      }}
                    >
                      {title.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <ListItemText
                      primary={
                        <Box display="flex" alignItems="center" gap={0.5}>
                          <Typography
                            fontWeight={c.unread_count ? 800 : 700}
                            fontSize={14}
                            noWrap
                            flex={1}
                          >
                            {title}
                          </Typography>
                          {c.muted && <VolumeOffIcon sx={{ fontSize: 14, color: "text.disabled" }} />}
                          {c.pinned_at && <PushPinIcon sx={{ fontSize: 13, color: "primary.main" }} />}
                        </Box>
                      }
                      secondary={c.kind === "group" ? "Group" : "Direct message"}
                      secondaryTypographyProps={{ fontSize: 12, noWrap: true }}
                    />
                    {!!c.unread_count && active?.id !== c.id && (
                      <Chip
                        size="small"
                        label={c.unread_count > 99 ? "99+" : c.unread_count}
                        color="primary"
                        sx={{
                          height: 22,
                          minWidth: 22,
                          mt: 0.85,
                          mr: 0.25,
                          fontWeight: 800,
                          fontSize: 11,
                          "& .MuiChip-label": { px: 0.75 },
                        }}
                      />
                    )}
                    <Stack direction="row" spacing={0} className="chat-row-actions" sx={{ mt: 0.2 }}>
                      <Tooltip title={c.pinned_at ? "Unpin" : "Pin"}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinChat(c);
                          }}
                        >
                          {c.pinned_at ? (
                            <PushPinIcon sx={{ fontSize: 15 }} color="primary" />
                          ) : (
                            <PushPinOutlinedIcon sx={{ fontSize: 15, opacity: 0.55 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={c.muted ? "Unmute" : "Mute"}>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMuteChat(c);
                          }}
                        >
                          {c.muted ? (
                            <VolumeOffIcon sx={{ fontSize: 15 }} color="disabled" />
                          ) : (
                            <VolumeUpIcon sx={{ fontSize: 15, opacity: 0.55 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </ListItemButton>
                );
              })}
              {!filteredConvs.length && (
                <Typography sx={{ p: 2 }} color="text.secondary" variant="body2">
                  {chatSearch ? "No chats match your search." : "No chats yet. Start one from People."}
                </Typography>
              )}
            </List>
          )}
        </Box>
      </Box>

      <Box
        flex={1}
        display="flex"
        flexDirection="column"
        minWidth={0}
        minHeight={0}
        height="100%"
        overflow="hidden"
      >
        {nav === "transfers" && (
          <TransfersPanel
            rows={transfers}
            onClose={() => setNav("chats")}
            onRetry={(row) => {
              if (row.direction === "recv" && row.file_id) {
                const msg = messages.find((m) => m.file_id === row.file_id);
                downloadFileToDownloads(row.file_id, msg?.sender_id || profile.id);
              } else {
                setStatus("Open the conversation and send the file again to retry an upload.");
              }
            }}
          />
        )}
        {FEATURE_GAMES && nav === "games" && (gamesOn ? (
          <GamesHub
            peers={peers}
            myId={profile.id}
            myName={profile.display_name}
            sendGameMsg={sendGameMsg}
            dispatchRef={gameDispatchRef}
          />
        ) : (
          <Box p={3}><Alert severity="info">Games are turned off in Settings.</Alert></Box>
        ))}
        {nav === "saved" && (
          <SavedPanel
            items={savedItems}
            onOpen={(id) => {
              const conv = convs.find((c) => c.id === id);
              if (conv) {
                selectConversation(conv);
                setNav(conv.kind === "group" ? "groups" : "chats");
                setTab(1);
              }
            }}
            onRemove={async (id) => {
              await peerApi.deleteSavedItem(id);
              setSavedItems(await peerApi.listSavedItems());
            }}
          />
        )}
        <Box
          sx={{
            display: nav === "chats" || nav === "groups" || nav === "people" ? "flex" : "none",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
        <AppBar
          position="static"
          elevation={0}
          sx={{
            flexShrink: 0,
            bgcolor: "background.paper",
            color: "text.primary",
            borderBottom: "1px solid",
            borderColor: "divider",
            zIndex: 2,
          }}
        >
          <Toolbar sx={{ gap: 1, minHeight: 64 }}>
            {active && (
              <Avatar
                sx={{
                  width: 40,
                  height: 40,
                  bgcolor: avatarColor(activeTitle),
                  fontSize: 16,
                }}
              >
                {activeTitle.slice(0, 1).toUpperCase()}
              </Avatar>
            )}
            <Box flex={1} minWidth={0}>
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                {active ? activeTitle : "Select a conversation"}
              </Typography>
              {active?.kind === "group" && membersLoaded && !typingLabel && (
                <Typography variant="caption" color="text.secondary">
                  {members.length} {members.length === 1 ? "member" : "members"}
                </Typography>
              )}
              {typingLabel && (
                <Typography variant="caption" color="primary" display="block">
                  {typingLabel}
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
            {active?.kind === "dm" && peers.some((p) => p.user_id === active.peer_id && p.identity_changed) && (
              <Chip size="small" color="warning" label="Identity changed" />
            )}
            {active?.kind === "group" && (
              <IconButton
                aria-label="Group members"
                onClick={() => {
                  setRenameDraft(active.title || "");
                  setMembersOpen(true);
                }}
              >
                <GroupIcon />
              </IconButton>
            )}
          </Toolbar>
        </AppBar>

        <Box
          ref={scroller}
          flex={1}
          minHeight={0}
          px={2}
          py={1.5}
          overflow="auto"
          display="flex"
          flexDirection="column"
          gap={0.75}
          sx={{
            bgcolor: "background.default",
            backgroundImage: dark
              ? "radial-gradient(rgba(76,141,255,0.08) 1px, transparent 1px)"
              : "radial-gradient(rgba(15,107,92,0.06) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
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
            <Box key={group.day} display="flex" flexDirection="column" gap={0.65}>
              <Box display="flex" justifyContent="center" my={0.75}>
                <Chip
                  label={group.label}
                  size="small"
                  sx={{
                    height: 22,
                    px: 0.75,
                    bgcolor: "rgba(255,255,255,0.92)",
                    color: "text.secondary",
                    fontWeight: 600,
                    fontSize: 11,
                    border: "1px solid #D5E3DD",
                  }}
                />
              </Box>
              {group.items.map((m) => {
                const mine = m.sender_id === profile.id;
                const quoted = m.reply_to ? messages.find((x) => x.id === m.reply_to) : undefined;
                const label = senderLabel(m.sender_id);
                const isGroup = active?.kind === "group";
                if (m.kind === "system") {
                  return (
                    <Grow in key={m.id} timeout={180}>
                      <Box display="flex" justifyContent="center" my={0.35}>
                        <Chip
                          size="small"
                          label={plain[m.id] || "…"}
                          sx={{
                            height: "auto",
                            py: 0.55,
                            px: 0.5,
                            maxWidth: "85%",
                            bgcolor: "rgba(255,255,255,0.92)",
                            border: "1px solid #D5E3DD",
                            color: "text.secondary",
                            fontWeight: 600,
                            fontSize: 12,
                            "& .MuiChip-label": {
                              whiteSpace: "normal",
                              textAlign: "center",
                              lineHeight: 1.35,
                            },
                          }}
                        />
                      </Box>
                    </Grow>
                  );
                }
                return (
                  <Grow in key={m.id} timeout={180}>
                    <Box
                      sx={{
                        alignSelf: mine ? "flex-end" : "flex-start",
                        maxWidth: "min(68%, 460px)",
                      }}
                    >
                        <Paper
                          elevation={0}
                          onContextMenu={(e) => {
                            if (m.kind === "deleted") return;
                            e.preventDefault();
                            setMsgMenu({ anchor: e.currentTarget as HTMLElement, message: m });
                          }}
                          sx={{
                            px: 1,
                            py: 0.4,
                            bgcolor:
                              m.kind === "deleted"
                                ? "#F1F4F3"
                                : mine
                                  ? "#DCEFE9"
                                  : "#FFFFFF",
                            border:
                              m.kind === "deleted"
                                ? "1px solid #C8D5CF"
                                : mine
                                  ? "1px solid #C5DFD6"
                                  : "1px solid #D5E3DD",
                            borderRadius: mine ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
                            position: "relative",
                            boxShadow: "0 1px 1px rgba(20,32,28,0.04)",
                          }}
                        >
                          {m.pinned && (
                            <PushPinIcon
                              sx={{
                                position: "absolute",
                                top: -7,
                                left: mine ? undefined : -7,
                                right: mine ? -7 : undefined,
                                fontSize: 14,
                                color: "secondary.main",
                                bgcolor: "background.paper",
                                borderRadius: "50%",
                                p: 0.15,
                              }}
                            />
                          )}
                          {m.kind !== "deleted" && (
                            <IconButton
                              size="small"
                              aria-label="Message options"
                              onClick={(e) => setMsgMenu({ anchor: e.currentTarget, message: m })}
                              sx={{
                                position: "absolute",
                                top: 0,
                                right: 0,
                                opacity: 0.4,
                                p: 0.35,
                              }}
                            >
                              <MoreVertIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          )}
                          {isGroup && m.kind !== "deleted" && (
                            <Typography
                              variant="caption"
                              color="primary"
                              fontWeight={700}
                              display="block"
                              noWrap
                              title={label}
                              sx={{
                                fontSize: 11,
                                lineHeight: 1.2,
                                mb: 0.15,
                                pr: 2,
                                maxWidth: 200,
                              }}
                            >
                              {truncate(label, 22)}
                            </Typography>
                          )}
                          {quoted && m.kind !== "deleted" && (
                            <Box
                              sx={{
                                borderLeft: "3px solid",
                                borderColor: "primary.main",
                                pl: 0.85,
                                mb: 0.4,
                                opacity: 0.85,
                              }}
                            >
                              <Typography
                                variant="caption"
                                fontWeight={700}
                                color="primary"
                                display="block"
                                sx={{ fontSize: 11 }}
                              >
                                {senderLabel(quoted.sender_id)}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                noWrap
                                display="block"
                                sx={{ maxWidth: 200, fontSize: 11 }}
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
                            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pr: 0.5 }}>
                              <DeleteOutlineIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                              <Typography
                                fontStyle="italic"
                                color="text.secondary"
                                sx={{ fontSize: 13, lineHeight: 1.35 }}
                              >
                                This message was deleted
                              </Typography>
                            </Stack>
                          ) : m.kind === "file_notice" ? (
                            <Stack direction="row" spacing={0.25} alignItems="center">
                              <Button
                                size="small"
                                startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
                                disabled={previewBusy || !!incomingFile || !m.file_id}
                                onClick={() =>
                                  m.file_id && downloadFileToDownloads(m.file_id, m.sender_id)
                                }
                                sx={{
                                  textTransform: "none",
                                  fontWeight: 700,
                                  fontSize: 13,
                                  py: 0.25,
                                  minHeight: 0,
                                }}
                              >
                                {(m.file_id && fileNames[m.file_id]) || "Encrypted file"}
                              </Button>
                              <Tooltip title="Preview">
                                <span>
                                  <IconButton
                                    size="small"
                                    disabled={previewBusy || !!incomingFile || !m.file_id}
                                    onClick={() => m.file_id && previewFile(m.file_id, m.sender_id)}
                                    aria-label="Preview file"
                                    sx={{ p: 0.4 }}
                                  >
                                    <OpenInNewIcon sx={{ fontSize: 16 }} />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </Stack>
                          ) : (
                            m.kind === "announcement" || m.kind === "snippet" || m.kind === "poll" ? (
                              <RichCard
                                kind={m.kind}
                                raw={plain[m.id] || ""}
                                votes={messages.filter((v) => v.kind === "poll_vote" && v.reply_to === m.id)}
                                plain={plain}
                                onVote={(option) => sendEncrypted("poll_vote", option, m.id)}
                              />
                            ) : (
                            <Typography
                              whiteSpace="pre-wrap"
                              sx={{ pr: 1.5, fontSize: 14, lineHeight: 1.35 }}
                            >
                              {plain[m.id] || "…"}
                            </Typography>
                            )
                          )}
                          <Box
                            sx={{
                              mt: 0.2,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              gap: 0.35,
                              color: "text.secondary",
                            }}
                          >
                            {m.edited_at && m.kind === "text" && (
                              <Typography
                                variant="caption"
                                sx={{ fontStyle: "italic", fontSize: 10, mr: 0.25 }}
                              >
                                edited
                              </Typography>
                            )}
                            {m.failed ? (
                              <Tooltip
                                title={
                                  m.last_error ||
                                  "Could not reach the other PC (offline / no LAN IP). Keep PeerChat open on both sides, then Retry."
                                }
                              >
                                <Typography
                                  variant="caption"
                                  color="error"
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 0.5,
                                    fontSize: 11,
                                  }}
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
                              </Tooltip>
                            ) : (
                              <Typography variant="caption" sx={{ fontSize: 10.5 }}>
                                {formatClock(m.created_at)}
                              </Typography>
                            )}
                            {mine && m.kind !== "deleted" && !m.failed && (
                              m.read ? (
                                <DoneAllIcon
                                  titleAccess="Read"
                                  sx={{ fontSize: 14, color: "success.main" }}
                                />
                              ) : m.delivered ? (
                                <DoneAllIcon titleAccess="Received" sx={{ fontSize: 14 }} />
                              ) : (
                                <DoneIcon titleAccess="Queued" sx={{ fontSize: 14 }} />
                              )
                            )}
                          </Box>
                        </Paper>
                        {!!m.reactions?.length && (
                          <Stack
                            direction="row"
                            spacing={0.4}
                            sx={{
                              mt: 0.35,
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
                                sx={{ height: 20, fontSize: 11 }}
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
              px: 1.5,
              py: 1.25,
              borderTop: "1px solid #D5E3DD",
              display: "flex",
              flexDirection: "column",
              gap: 0.85,
              bgcolor: "#FFFFFF",
              zIndex: 2,
            }}
          >
            {editingMessage && (
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
                <EditIcon fontSize="small" color="primary" />
                <Box flex={1} minWidth={0}>
                  <Typography variant="caption" fontWeight={700} color="primary" display="block">
                    Editing message
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {truncate(plain[editingMessage.id] || "…", 90)}
                  </Typography>
                </Box>
                <IconButton size="small" aria-label="Cancel edit" onClick={cancelEdit}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            )}
            {replyTo && !editingMessage && (
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
            {stagedFiles.length > 0 && !editingMessage && (
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
            {!!slashSuggestions.length && (
              <List dense sx={{ py: 0 }}>
                {slashSuggestions.map((cmd, idx) => (
                  <ListItemButton
                    key={cmd.name}
                    selected={idx === slashIndex}
                    onClick={() => runSlash(cmd.name)}
                  >
                    <ListItemText primary={cmd.name} secondary={cmd.hint} />
                  </ListItemButton>
                ))}
              </List>
            )}
            <Box
              display="flex"
              gap={0.5}
              alignItems="flex-end"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) stageFiles(files);
              }}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 999,
                bgcolor: dark ? "action.hover" : "#F7FBFA",
                px: 0.75,
                py: 0.35,
              }}
            >
              <IconButton
                aria-label="Emoji picker"
                disabled={!!outgoingFile}
                onClick={(e) => setEmojiAnchor(e.currentTarget)}
                size="small"
              >
                <EmojiEmotionsIcon fontSize="small" />
              </IconButton>
              <IconButton
                component="label"
                aria-label="Attach files"
                disabled={!!outgoingFile || !!editingMessage}
                size="small"
              >
                <AttachFileIcon fontSize="small" />
                <input
                  ref={filePickRef}
                  hidden
                  type="file"
                  multiple
                  disabled={!!outgoingFile || !!editingMessage}
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
                maxRows={5}
                placeholder={
                  editingMessage ? "Edit message… (Esc to cancel)" : "Type a message…"
                }
                value={text}
                disabled={!!outgoingFile}
                variant="standard"
                InputProps={{ disableUnderline: true }}
                onChange={(e) => {
                  const v = e.target.value;
                  setText(v);
                  if (active && !editingMessage) draftsRef.current[active.id] = v;
                  if (v.trim() && !editingMessage) notifyTyping();
                }}
                onKeyDown={(e) => {
                  if (slashSuggestions.length && e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((n) => (n + 1) % slashSuggestions.length);
                    return;
                  }
                  if (slashSuggestions.length && e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((n) => (n + slashSuggestions.length - 1) % slashSuggestions.length);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey && slashToken) {
                    e.preventDefault();
                    const exact = SLASH_NAMES.has(slashToken);
                    if (exact) runSlash(slashToken);
                    else if (slashSuggestions[slashIndex]) runSlash(slashSuggestions[slashIndex].name);
                    else setStatus("Unknown command. Type /help to see what is available. The draft was kept.");
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitComposer();
                  } else if (e.key === "Escape" && slashSuggestions.length) {
                    e.preventDefault();
                    setText((t) => (t.startsWith("/") ? "" : t));
                  } else if (e.key === "Escape" && editingMessage) {
                    e.preventDefault();
                    cancelEdit();
                  } else if (e.key === "Escape" && replyTo) {
                    e.preventDefault();
                    setReplyTo(null);
                  }
                }}
                sx={{
                  mx: 0.5,
                  "& .MuiInputBase-root": { fontSize: 14, py: 0.6 },
                }}
              />
              <IconButton
                color="primary"
                disabled={
                  !!outgoingFile ||
                  (!text.trim() && !stagedFiles.length) ||
                  (!!editingMessage && !text.trim())
                }
                onClick={submitComposer}
                aria-label={editingMessage ? "Save edit" : "Send"}
                sx={{
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                  width: 36,
                  height: 36,
                  "&:hover": { bgcolor: "primary.dark" },
                  "&.Mui-disabled": { bgcolor: "#C5D5CF", color: "#FFFFFF" },
                }}
              >
                {editingMessage ? <EditIcon fontSize="small" /> : <SendIcon fontSize="small" />}
              </IconButton>
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
        {msgMenu?.message.kind === "text" &&
          msgMenu.message.sender_id === profile.id &&
          !msgMenu.message.failed && (
            <MenuItem onClick={() => msgMenu && startEdit(msgMenu.message)}>
              <ListItemIcon>
                <EditIcon fontSize="small" />
              </ListItemIcon>
              Edit
            </MenuItem>
          )}
        <MenuItem
          onClick={async () => {
            if (!msgMenu || !active) return;
            const preview = (plain[msgMenu.message.id] || msgMenu.message.kind).slice(0, 500);
            await peerApi.saveItem({
              id: `save-${msgMenu.message.id}`,
              message_id: msgMenu.message.id,
              conversation_id: active.id,
              kind: msgMenu.message.kind,
              preview,
              created_at: new Date().toISOString(),
            });
            setSavedItems(await peerApi.listSavedItems());
            setStatus("Saved on this computer");
            setMsgMenu(null);
          }}
        >
          <ListItemIcon>
            <BookmarkBorderIcon fontSize="small" />
          </ListItemIcon>
          Save
        </MenuItem>
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
            {filePreview?.localPath ? "Save another copy" : "Save to Downloads"}
          </Button>
          <Button variant="contained" startIcon={<OpenInNewIcon />} onClick={openPreviewedFile}>
            Open
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={membersOpen && active?.kind === "group"} onClose={() => setMembersOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{active?.title || "Group"}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ mt: 0.5 }}>
            {isAdmin && (
              <>
                <Paper
                  variant="outlined"
                  sx={{ p: 1.5, borderColor: "#D5E3DD", borderRadius: 2 }}
                >
                  <Typography variant="overline" color="text.secondary" display="block" mb={1}>
                    Group name
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      size="small"
                      fullWidth
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      placeholder="Group name"
                    />
                    <Button
                      variant="outlined"
                      startIcon={<DriveFileRenameOutlineIcon />}
                      disabled={!renameDraft.trim() || renameDraft.trim() === (active?.title || "")}
                      onClick={handleRenameGroup}
                      sx={{ flexShrink: 0 }}
                    >
                      Rename
                    </Button>
                  </Stack>
                </Paper>

                <Paper
                  variant="outlined"
                  sx={{ px: 1.5, py: 0.75, borderColor: "#D5E3DD", borderRadius: 2 }}
                >
                  <FormControlLabel
                    sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
                    labelPlacement="start"
                    control={
                      <Switch
                        checked={active?.members_can_add !== false}
                        onChange={(_, v) => handleToggleMembersCanAdd(v)}
                      />
                    }
                    label="Members can add others"
                  />
                </Paper>

                <Button
                  color="error"
                  variant="outlined"
                  fullWidth
                  size="large"
                  onClick={handleDeleteGroup}
                  sx={{ borderRadius: 2, py: 1.1 }}
                >
                  Delete group for everyone
                </Button>
              </>
            )}

            <Paper variant="outlined" sx={{ borderColor: "#D5E3DD", borderRadius: 2, overflow: "hidden" }}>
              <Typography variant="overline" color="text.secondary" sx={{ px: 1.5, pt: 1.25, display: "block" }}>
                Members
              </Typography>
              <List dense disablePadding>
                {members.map((m) => (
                  <ListItemButton key={m.user_id} disableRipple sx={{ cursor: "default", py: 0.85 }}>
                    <ListItemText
                      primary={m.user_id === profile.id ? `${m.display_name} (you)` : m.display_name}
                      secondary={m.role === "admin" ? "Admin" : "Member"}
                      primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }}
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
                      <>
                        <Button
                          size="small"
                          sx={{ mr: 0.5, textTransform: "none" }}
                          onClick={() =>
                            handleSetMemberRole(
                              m.user_id,
                              m.role === "admin" ? "member" : "admin"
                            )
                          }
                        >
                          {m.role === "admin" ? "Demote" : "Make admin"}
                        </Button>
                        <IconButton
                          aria-label={`Remove ${m.display_name}`}
                          size="small"
                          onClick={() => handleRemoveMember(m.user_id, m.display_name)}
                        >
                          <PersonRemoveIcon fontSize="small" />
                        </IconButton>
                      </>
                    )}
                  </ListItemButton>
                ))}
              </List>
            </Paper>

            {canAddMembers && (
              <Paper variant="outlined" sx={{ borderColor: "#D5E3DD", borderRadius: 2, overflow: "hidden" }}>
                <Box
                  sx={{
                    px: 1.5,
                    pt: 1.25,
                    pb: 0.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                  }}
                >
                  <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>
                    Add people
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!addPick.length}
                    onClick={handleAddMembers}
                  >
                    Add{addPick.length ? ` (${addPick.length})` : ""}
                  </Button>
                </Box>
                <List dense disablePadding>
                  {others
                    .filter((p) => !members.some((m) => m.user_id === p.user_id))
                    .map((p) => (
                      <ListItemButton
                        key={p.user_id}
                        selected={addPick.includes(p.user_id)}
                        onClick={() =>
                          setAddPick((g) =>
                            g.includes(p.user_id)
                              ? g.filter((x) => x !== p.user_id)
                              : [...g, p.user_id]
                          )
                        }
                      >
                        <ListItemText
                          primary={p.display_name}
                          secondary={p.online ? "Online" : "Offline"}
                          primaryTypographyProps={{ fontWeight: 600, fontSize: 14 }}
                        />
                      </ListItemButton>
                    ))}
                </List>
                {!others.filter((p) => !members.some((m) => m.user_id === p.user_id)).length && (
                  <Typography color="text.secondary" variant="body2" sx={{ px: 1.5, pb: 1.5 }}>
                    No other people on the LAN to add.
                  </Typography>
                )}
              </Paper>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {inGroup && (
            <Button color="error" onClick={handleLeaveGroup}>
              Leave group
            </Button>
          )}
          <Box flex={1} />
          <Button onClick={() => setMembersOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <AnnounceDialog
        open={announceOpen}
        onClose={() => setAnnounceOpen(false)}
        onSend={async (title, body) => {
          await sendEncrypted("announcement", JSON.stringify({ title, body }));
          setAnnounceOpen(false);
        }}
      />

      <PollDialog
        open={pollOpen}
        onClose={() => setPollOpen(false)}
        onSend={async (question, options) => {
          await sendEncrypted("poll", JSON.stringify({ question, options, votes: {} }));
          setPollOpen(false);
        }}
      />

      <SnippetDialog
        open={snippetOpen}
        onClose={() => setSnippetOpen(false)}
        onSend={async (title, body) => {
          await sendEncrypted("snippet", JSON.stringify({ title, body }));
          setSnippetOpen(false);
        }}
      />

      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        query={searchQuery}
        setQuery={setSearchQuery}
        onSearch={runSearch}
        busy={searchBusy}
        results={searchHits}
        onJump={(conversationId) => {
          const conv = convs.find((c) => c.id === conversationId);
          if (conv) {
            selectConversation(conv);
            setNav(conv.kind === "group" ? "groups" : "chats");
            setTab(1);
          }
          setSearchOpen(false);
        }}
      />

      <BundleDialog
        open={bundleOpen}
        onClose={() => setBundleOpen(false)}
        busy={bundleBusy}
        onSend={async (items, zip, note) => {
          if (!active) return;
          setBundleBusy(true);
          try {
            let filePath: string;
            let fileSize: number;
            let fileName: string;
            if (zip) {
              const result = await peerApi.packBundle(items.map((i) => ({ abs_path: i.abs_path, rel_path: i.rel_path })));
              filePath = result.path;
              fileSize = result.size;
              fileName = result.name;
            } else {
              if (items.length !== 1) throw new Error("Select exactly one file or use ZIP for multiple files.");
              filePath = items[0].abs_path;
              fileSize = items[0].size;
              fileName = items[0].rel_path;
            }
            if (note) {
              await sendEncrypted("text", note);
            }
            await sendFile({ path: filePath, name: fileName, size: fileSize });
            if (zip) {
              await peerApi.deleteBundleFile(filePath).catch(() => {});
            }
            setBundleOpen(false);
          } catch (err: any) {
            setStatus(err?.message || String(err));
          } finally {
            setBundleBusy(false);
          }
        }}
      />

      <HelpDialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        ctx={commandCtx}
      />

      {/* Virus scan warning — threat found on outgoing file */}
      <Dialog open={!!scanWarn} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ color: "error.main" }}>⚠ Virus threat detected</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {scanWarn?.detail}
          </Alert>
          <Typography variant="body2">
            Windows Defender flagged this file before encryption. Sending it will still
            encrypt and deliver it, but the recipient's scanner may also block it.
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }} color="text.secondary">
            For most use cases you should <strong>not</strong> send this file.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setScanWarn(null); setStatus("File not sent (virus scan warning)."); }}>
            Cancel — don't send
          </Button>
          <Button color="error" variant="contained" onClick={() => scanWarn?.onProceed()}>
            Send anyway
          </Button>
        </DialogActions>
      </Dialog>

      {/* Pending share files notice — shown when launched via right-click Share */}
      {pendingShareFiles.length > 0 && !active && (
        <Alert
          severity="info"
          sx={{ position: "absolute", bottom: 80, left: 16, right: 16, zIndex: 10 }}
          onClose={() => setPendingShareFiles([])}
        >
          {pendingShareFiles.length === 1
            ? `Ready to share "${pendingShareFiles[0].split(/[/\\]/).pop()}" — select a conversation first.`
            : `${pendingShareFiles.length} files ready to share — select a conversation first.`}
        </Alert>
      )}
    </Box>
  );
}

function SettingsScreen(props: {
  profile: Profile;
  identity: Identity;
  version: string;
  onBack: () => void;
  onNameUpdated: (p: Profile) => void;
}) {
  const { mode, setMode } = useContext(ThemeMode);
  const [fp, setFp] = useState("");
  const [name, setName] = useState(props.profile.display_name);
  const [savingName, setSavingName] = useState(false);
  const [status, setStatus] = useState("");
  const [notifOn, setNotifOn] = useState(true);
  const [notifBusy, setNotifBusy] = useState(false);
  const [downloadDir, setDownloadDir] = useState("");
  const [gamesEnabled, setGamesEnabled] = useState(true);
  const [shellExt, setShellExt] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const keyFp = fingerprintPublic(exportPublic(props.identity).x25519_public);

  useEffect(() => {
    peerApi.myFingerprint().then(setFp).catch(() => setFp("(unavailable)"));
    peerApi.getNotificationsEnabled().then(setNotifOn).catch(() => setNotifOn(true));
    peerApi.getAppSetting("download_dir").then((v) => setDownloadDir(v || "")).catch(() => {});
    peerApi.getAppSetting("games_enabled").then((v) => setGamesEnabled(v !== "0")).catch(() => setGamesEnabled(true));
    peerApi.shellExtensionInstalled().then(setShellExt).catch(() => setShellExt(false));
  }, []);

  async function toggleNotifications(enabled: boolean) {
    setNotifBusy(true);
    try {
      if (enabled) {
        let granted = await isPermissionGranted();
        if (!granted) {
          granted = (await requestPermission()) === "granted";
        }
        if (!granted) {
          setStatus("Windows blocked notification permission");
          setNotifOn(false);
          await peerApi.setNotificationsEnabled(false);
          return;
        }
      }
      await peerApi.setNotificationsEnabled(enabled);
      setNotifOn(enabled);
      setStatus(enabled ? "Desktop notifications on" : "Desktop notifications off");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setNotifBusy(false);
    }
  }

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
        <Chip size="small" label={`v${props.version}`} sx={{ ml: "auto" }} />
      </Stack>
      <Stack spacing={3}>
        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            About
          </Typography>
          <Typography variant="body1" fontWeight={600}>
            PeerChat {props.version}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Installed builds update in place — run a newer Install-PeerChat.bat (or setup.exe) to
            upgrade. Chat data stays in your Windows app data folder.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Notifications
          </Typography>
          <FormControlLabel
            sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
            labelPlacement="start"
            disabled={notifBusy}
            control={
              <Switch checked={notifOn} onChange={(_, v) => toggleNotifications(v)} />
            }
            label="Desktop notifications for new messages"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Uses Windows toast notifications (not the browser prompt). Muted chats stay quiet.
            Toasts appear when the chat is not open or PeerChat is in the background.
          </Typography>
        </Paper>

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

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Windows shell integration
          </Typography>
          <FormControlLabel
            sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
            labelPlacement="start"
            disabled={shellBusy}
            control={
              <Switch
                checked={shellExt}
                onChange={async (_, v) => {
                  setShellBusy(true);
                  try {
                    if (v) {
                      // Pass the exe path so the registry command value is correct.
                      // On Windows, process.argv[0] or Tauri's currentExe would work;
                      // here we fall back to a known install path as a best-effort default.
                      const exePath = (window as any).__TAURI_INTERNALS__?.metadata?.currentExe
                        || (window as any).__TAURI__?.metadata?.currentExe
                        || "PeerChat.exe";
                      await peerApi.installShellExtension(exePath);
                      setShellExt(true);
                      setStatus("Right-click 'Share in PeerChat' registered");
                    } else {
                      await peerApi.uninstallShellExtension();
                      setShellExt(false);
                      setStatus("Right-click 'Share in PeerChat' removed");
                    }
                  } catch (err: any) {
                    setStatus(err?.message || String(err));
                  } finally {
                    setShellBusy(false);
                  }
                }}
              />
            }
            label="Add 'Share in PeerChat' to right-click menu"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Right-clicking any file in Explorer will show "Share in PeerChat". The app
            opens directly to the file ready to send. No admin rights required — stored
            in your user registry (HKCU). The installer also sets this automatically.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Appearance
          </Typography>
          <FormControlLabel
            sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
            labelPlacement="start"
            control={
              <Switch
                checked={mode === "light"}
                onChange={(_, v) => {
                  const next = v ? "light" : "dark";
                  setMode(next);
                  peerApi.setAppSetting("theme", next).catch(() => {});
                }}
              />
            }
            label="Light theme"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Dark theme is the default. Your choice is saved locally.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Downloads
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label="Download folder"
              size="small"
              fullWidth
              placeholder="(default: system Downloads folder)"
              value={downloadDir}
              onChange={(e) => setDownloadDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  peerApi.setAppSetting("download_dir", downloadDir.trim()).then(() => setStatus("Download folder saved")).catch((err: any) => setStatus(err?.message || String(err)));
                }
              }}
            />
            <Button
              variant="contained"
              onClick={() => {
                peerApi.setAppSetting("download_dir", downloadDir.trim()).then(() => setStatus("Download folder saved")).catch((err: any) => setStatus(err?.message || String(err)));
              }}
            >
              Save
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Received files land here. Leave blank to use the system Downloads folder.
          </Typography>
        </Paper>

        {FEATURE_GAMES && (
          <Paper sx={{ p: 2.5 }} variant="outlined">
            <Typography variant="h6" gutterBottom>
              Games
            </Typography>
            <FormControlLabel
              sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
              labelPlacement="start"
              control={
                <Switch
                  checked={gamesEnabled}
                  onChange={(_, v) => {
                    setGamesEnabled(v);
                    peerApi.setAppSetting("games_enabled", v ? "1" : "0").then(() => setStatus(v ? "Games enabled" : "Games disabled")).catch((err: any) => setStatus(err?.message || String(err)));
                  }}
                />
              }
              label="Enable offline games"
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Shows the Games tab in the sidebar. Currently includes Snake, 2048, Tic-Tac-Toe, Rock Paper Scissors, and Dots & Boxes.
            </Typography>
          </Paper>
        )}

        <Alert severity="info">
          No central server — chats live in local SQLite and deliver when peers come online. For
          reliable discovery and delivery, allow PeerChat through your firewall: UDP 41234 for
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
