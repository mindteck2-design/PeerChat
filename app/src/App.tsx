import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { APP_VERSION_FALLBACK, appVersion } from "./version";
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Checkbox,
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
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
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
import PersonOffIcon from "@mui/icons-material/PersonOffRounded";
import BlockIcon from "@mui/icons-material/BlockRounded";
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
import LogoutIcon from "@mui/icons-material/LogoutRounded";
import PersonAddAltIcon from "@mui/icons-material/PersonAddAltRounded";
import VisibilityIcon from "@mui/icons-material/VisibilityRounded";

import {
  isPermissionGranted,
  onAction,
  requestPermission,
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
  LinkifiedText,
  openExternalLink,
  PollDialog,
  SavedPanel,
  SearchDialog,
  SnippetDialog,
  TransfersPanel,
  URL_RE,
  type BundleItem,
} from "./panels";
import CampaignIcon from "@mui/icons-material/CampaignRounded";
import type { SavedItem, ScanResult, TransferLog } from "./peer";
import { ThemeMode } from "./theme";
import { FEATURE_GAMES } from "./features";
import {
  GamesHub,
  applyInboundToSession,
  type GameDispatchFn,
  type GameMsg,
  type PendingGameInvite,
} from "./games/games";
import {
  GameInviteCard,
  matchIdOf,
  parseGameMsg,
  resolveGameCardStatus,
} from "./games/GameInviteCard";

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

/** WhatsApp-style relative time for conversation list rows. */
function formatPreviewTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function conversationPreviewLine(
  kind: string | null | undefined,
  decrypted: string,
  myId: string,
  senderId: string | null | undefined,
  senderLabel: string,
  isGroup: boolean
): string {
  if (!kind) return "";
  let body = decrypted;
  if (kind === "file_notice") return "📎 File";
  if (kind === "system") return body.trim() || "Group update";
  if (kind === "game_move") {
    try {
      const j = JSON.parse(decrypted) as GameMsg;
      const t = j?.payload?.type;
      const g =
        j?.game === "ttt"
          ? "Tic-Tac-Toe"
          : j?.game === "rps"
            ? "Rock Paper Scissors"
            : j?.game === "dab"
              ? "Dots & Boxes"
              : "Game";
      if (t === "invite") {
        body = senderId === myId ? `Game invite: ${g}` : `Invited you to ${g}`;
      } else if (t === "accept") body = `Accepted ${g}`;
      else if (t === "decline") body = `Declined ${g}`;
      else if (t === "result") body = `${g} finished`;
      else body = g;
    } catch {
      body = "Game";
    }
    const prefix =
      senderId === myId ? "You: " : isGroup && senderLabel ? `${senderLabel}: ` : "";
    return truncate(prefix + body, 80);
  }
  if (kind === "announcement" || kind === "poll" || kind === "snippet") {
    try {
      const j = JSON.parse(decrypted);
      if (kind === "poll") body = j.question || "Poll";
      else if (kind === "announcement") body = j.title || j.body || decrypted;
      else body = j.title || decrypted;
    } catch {
      body = decrypted;
    }
  }
  body = body.replace(/\s+/g, " ").trim();
  if (!body) body = kind === "forwarded" ? "Forwarded message" : "Message";
  const prefix =
    senderId === myId ? "You: " : isGroup && senderLabel ? `${senderLabel}: ` : "";
  return truncate(prefix + body, 80);
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extOfName(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function mimeForName(name: string) {
  const ext = extOfName(name);
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    md: "text/markdown",
    log: "text/plain",
    html: "text/html",
    htm: "text/html",
    xml: "text/xml",
  };
  return (ext && types[ext]) || "application/octet-stream";
}

/** True when we can show an in-app preview (not zip/exe/archives/etc.). */
function canPreviewFileName(name: string) {
  const ext = extOfName(name);
  if (!ext) return false;
  const previewable = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
    "pdf",
    "mp4", "webm", "mov", "mkv",
    "mp3", "wav", "ogg", "m4a",
    "txt", "csv", "json", "md", "log", "html", "htm", "xml",
  ]);
  return previewable.has(ext);
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

function canMutateMessageToday(createdAt: string | null | undefined) {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
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
  /** Browser File from picker, or a disk path from Tauri drag-drop / Share. */
  source: File | { path: string; name: string; size: number };
  name: string;
  size: number;
  /** True only for disk folders (ZIP on send). Never infer from display name. */
  isDir: boolean;
  previewUrl: string | null;
};

const BUNDLE_MAX_FILES = 5000;
const BUNDLE_MAX_BYTES = 5 * 1024 * 1024 * 1024;

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
  /** Progress chip label — "Downloading…" for saves, "Opening…" only for in-app preview. */
  label?: string;
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
  const [team, setTeam] = useState("");
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
        team: team.trim(),
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
            <TextField
              label="Team"
              fullWidth
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="HMIS"
              helperText="Your project or team — e.g. HMIS, Shakti"
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
  fileId,
  fileName,
  mine,
  onOpenFile,
  onDownloadFile,
}: {
  kind: string;
  raw: string;
  votes: Message[];
  plain: Record<string, string>;
  onVote: (option: string) => void;
  fileId?: string | null;
  fileName?: string;
  mine?: boolean;
  onOpenFile?: (fileId: string) => void;
  onDownloadFile?: (fileId: string) => void;
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
        <Typography component="pre" sx={{ m: 0, fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
          <LinkifiedText text={body} sx={{ fontFamily: "inherit", fontSize: "inherit" }} />
        </Typography>
      </Box>
    );
  }
  const title = parsed?.title || "Announcement";
  const body = parsed?.body || raw;
  const attachedName =
    fileName ||
    (typeof parsed?.filename === "string" ? parsed.filename : "") ||
    "Attachment";
  return (
    <Box sx={{ pr: 1 }}>
      <Typography variant="overline" color="primary">Announcement</Typography>
      <Typography fontWeight={700}>{title}</Typography>
      <LinkifiedText text={body} sx={{ display: "block", fontSize: 14 }} />
      {fileId && (
        <Button
          size="small"
          startIcon={
            mine ? (
              <InsertDriveFileIcon sx={{ fontSize: 16 }} />
            ) : (
              <DownloadIcon sx={{ fontSize: 16 }} />
            )
          }
          onClick={() => {
            if (mine) onOpenFile?.(fileId);
            else onDownloadFile?.(fileId);
          }}
          sx={{
            mt: 1,
            textTransform: "none",
            fontWeight: 700,
            fontSize: 13,
            px: 0,
            justifyContent: "flex-start",
          }}
        >
          {attachedName}
        </Button>
      )}
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
  // tab 1 = chats list (must match default nav "chats")
  const [tab, setTab] = useState(1);
  const [nav, setNav] = useState<"people" | "chats" | "transfers" | "games" | "saved" | "announcements">("chats");
  const [announceBoards, setAnnounceBoards] = useState<Conversation[]>([]);
  const [announceCompose, setAnnounceCompose] = useState({ title: "", body: "" });
  const [announceBusy, setAnnounceBusy] = useState(false);
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
  const [gamesOn, setGamesOn] = useState(false);
  const filePickRef = useRef<HTMLInputElement | null>(null);
  const pauseRef = useRef(false);
  const [chatSearch, setChatSearch] = useState("");
  const [lastPreviews, setLastPreviews] = useState<Record<string, string>>({});
  const [convMenu, setConvMenu] = useState<{ anchor: HTMLElement; conv: Conversation } | null>(null);

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
  const statusClearRef = useRef<number | null>(null);
  useEffect(() => {
    if (!status) return;
    if (statusClearRef.current) window.clearTimeout(statusClearRef.current);
    statusClearRef.current = window.setTimeout(() => setStatus(""), 8000);
    return () => {
      if (statusClearRef.current) window.clearTimeout(statusClearRef.current);
    };
  }, [status]);
  const [pinOpen, setPinOpen] = useState<Peer | null>(null);
  /** Inbound first message from someone you have not trusted/pinned yet. */
  const [firstContact, setFirstContact] = useState<{
    peer: Peer;
    conversationId: string;
  } | null>(null);

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
  const [forwardPick, setForwardPick] = useState<string[]>([]);
  const [forwardQuery, setForwardQuery] = useState("");
  const [clearChatTarget, setClearChatTarget] = useState<Conversation | null>(null);
  const [clearIncludeFiles, setClearIncludeFiles] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [pendingShareFiles, setPendingShareFiles] = useState<string[]>([]);
  const [scanWarn, setScanWarn] = useState<{
    detail: string;
    title?: string;
    body?: string;
    proceedLabel?: string;
    onProceed: () => void;
    onCancel?: () => void;
  } | null>(null);
  const [dragOverChat, setDragOverChat] = useState(false);
  const stickToBottomRef = useRef(true);
  const ignoreScrollRef = useRef(false);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  /** Hide scroller until first bottom-pin so chat never flashes at the top. */
  const [chatPaintReady, setChatPaintReady] = useState(true);
  const groupUnlockWarnedRef = useRef<string | null>(null);
  const [highlightMsgId, setHighlightMsgId] = useState<string | null>(null);
  const [chatInfoOpen, setChatInfoOpen] = useState(false);
  const [chatInfoTab, setChatInfoTab] = useState(0);
  const convsRef = useRef(convs);
  convsRef.current = convs;

  // Ref for the active game's inbound message dispatcher (set by each game component)
  const gameDispatchRef = useRef<GameDispatchFn | null>(null);
  const [pendingGameInvite, setPendingGameInvite] = useState<PendingGameInvite | null>(null);
  const [gameInviteBusy, setGameInviteBusy] = useState(false);

  const scroller = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const chatSearchRef = useRef<HTMLInputElement | null>(null);
  const groupKeysRef = useRef(groupKeys);
  groupKeysRef.current = groupKeys;
  const [groupKeyHistory, setGroupKeyHistory] = useState<Record<string, Uint8Array[]>>({});
  const groupKeyHistoryRef = useRef(groupKeyHistory);
  groupKeyHistoryRef.current = groupKeyHistory;
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
    () => peers.filter((p) => p.user_id !== profile.id && !p.blocked),
    [peers, profile.id]
  );

  const filteredConvs = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    return convs.filter((c) => {
      if (!q) return true;
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

  const isAnnounceBoard = !!active && (active.id === "board:org" || active.id.startsWith("board:team:"));

  const canAddMembers =
    !!active &&
    active.kind === "group" &&
    inGroup &&
    !isAnnounceBoard &&
    (isAdmin || active.members_can_add !== false);

  const GROUP_KEY_HIST_PREFIX = "group_key_history:";

  function groupKeysEqual(a: Uint8Array, b: Uint8Array) {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  async function loadPersistedKeyHistory(convId: string): Promise<Uint8Array[]> {
    const raw = await peerApi.getAppSetting(`${GROUP_KEY_HIST_PREFIX}${convId}`).catch(() => null);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as string[];
      return parsed.map((s) => fromB64(s));
    } catch {
      return [];
    }
  }

  async function savePersistedKeyHistory(convId: string, keys: Uint8Array[]) {
    if (!keys.length) return;
    const payload = JSON.stringify(keys.map((k) => b64(k)));
    await peerApi.setAppSetting(`${GROUP_KEY_HIST_PREFIX}${convId}`, payload);
  }

  /** Keep prior group keys so messages encrypted before a rotation still decrypt. */
  async function adoptGroupKey(convId: string, newKey: Uint8Array) {
    const prev = groupKeysRef.current[convId];
    let hist = groupKeyHistoryRef.current[convId] || [];
    if (prev && !groupKeysEqual(prev, newKey)) {
      if (!hist.some((k) => groupKeysEqual(k, prev))) {
        hist = [...hist, prev];
      }
    }
    groupKeysRef.current = { ...groupKeysRef.current, [convId]: newKey };
    groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
    setGroupKeys((g) => ({ ...g, [convId]: newKey }));
    setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
    await savePersistedKeyHistory(convId, hist);
  }

  async function decryptGroupMessageText(m: Message): Promise<string> {
    const convId = m.conversation_id;
    const current = groupKeysRef.current[convId];
    const hist = groupKeyHistoryRef.current[convId] || [];
    const candidates: Uint8Array[] = [];
    if (current) candidates.push(current);
    for (const k of hist) {
      if (!current || !groupKeysEqual(k, current)) candidates.push(k);
    }
    const sender = peers.find((p) => p.user_id === m.sender_id);
    const edPub = sender?.ed25519_public;
    for (const gk of candidates) {
      try {
        return await decryptWithGroupKey(m, gk, edPub);
      } catch {
        /* try older key */
      }
    }
    throw new Error("unable to decrypt");
  }

  async function persistMyGroupWrap(convId: string, gk: Uint8Array) {
    const pubs = { [profile.id]: exportPublic(identity).x25519_public };
    const wraps = wrapGroupKeyForMembers(gk, identity, pubs);
    const mine = wraps[profile.id];
    if (mine) await peerApi.setMyGroupKey(convId, mine);
  }

  async function syncGroupKeyIfRotated(convId: string) {
    const wrap = await peerApi.getGroupKey(convId);
    const current = groupKeysRef.current[convId];
    if (!wrap) {
      // Solo / unrepaired group: keep working key in memory and save a wrap for next launch.
      if (current) {
        try {
          await persistMyGroupWrap(convId, current);
        } catch (e) {
          console.error(e);
        }
      }
      return;
    }
    try {
      const gk = unwrapGroupKey(wrap, identity);
      if (!current) {
        const hist = await loadPersistedKeyHistory(convId);
        groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
        setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
        groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
        setGroupKeys((g) => ({ ...g, [convId]: gk }));
        return;
      }
      if (!groupKeysEqual(current, gk)) {
        await adoptGroupKey(convId, gk);
      }
    } catch (err) {
      // Wrap present but not for this identity — keep in-memory key, or mint for solo use.
      if (current) {
        try {
          await persistMyGroupWrap(convId, current);
        } catch (e) {
          console.error(e);
        }
        return;
      }
      const gk = createGroupKey();
      await persistMyGroupWrap(convId, gk);
      const hist = await loadPersistedKeyHistory(convId);
      groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
      setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
      groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
      setGroupKeys((g) => ({ ...g, [convId]: gk }));
      console.warn("Repaired group key after unwrap failure", err);
    }
  }

  async function ensureGroupKey(convId: string) {
    const existing = groupKeysRef.current[convId];
    if (existing) return existing;
    const wrap = await peerApi.getGroupKey(convId);
    if (wrap) {
      try {
        const gk = unwrapGroupKey(wrap, identity);
        const hist = await loadPersistedKeyHistory(convId);
        groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
        setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
        groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
        setGroupKeys((g) => ({ ...g, [convId]: gk }));
        return gk;
      } catch (err) {
        console.error(err);
      }
    }
    const gk = createGroupKey();
    await persistMyGroupWrap(convId, gk);
    const hist = await loadPersistedKeyHistory(convId);
    groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
    setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
    groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
    setGroupKeys((g) => ({ ...g, [convId]: gk }));
    return gk;
  }

  async function resolveMemberIds(conv: Conversation): Promise<string[]> {
    if (conv.kind === "dm" && conv.peer_id) return [conv.peer_id, profile.id];
    return peerApi.memberIds(conv.id);
  }

  async function refresh(opts?: { manual?: boolean }) {
    const manual = !!opts?.manual;
    if (manual) setScanning(true);
    try {
      await peerApi.discoverPeers();
    } catch {
      /* ignore */
    }
    try {
      const [p, c, hosts, logs, saved, gamesFlag] = await Promise.all([
        peerApi.listPeers(),
        peerApi.listConversations(),
        peerApi.listLanHosts().catch(() => []),
        peerApi.listTransfers().catch(() => [] as TransferLog[]),
        peerApi.listSavedItems().catch(() => [] as SavedItem[]),
        FEATURE_GAMES ? peerApi.getAppSetting("games_enabled").catch(() => "0") : Promise.resolve("0"),
      ]);
      setPeers(p);
      setConvs(c);
      setLanHosts(hosts);
      setTransfers(logs);
      setSavedItems(saved);
      setGamesOn(FEATURE_GAMES && gamesFlag === "1");
      setActive((prev) => {
        if (!prev) return prev;
        const fresh = c.find((x) => x.id === prev.id);
        return fresh ?? prev;
      });
    } finally {
      if (manual) setScanning(false);
    }
  }

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const gkNext: Record<string, Uint8Array> = {};
      for (const c of convs) {
        if (c.kind !== "group" || !c.last_message_kind || groupKeys[c.id]) continue;
        try {
          const wrap = await peerApi.getGroupKey(c.id);
          if (wrap) gkNext[c.id] = unwrapGroupKey(wrap, identity);
        } catch {
          /* locked or missing */
        }
      }
      if (!cancel && Object.keys(gkNext).length) {
        setGroupKeys((g) => ({ ...g, ...gkNext }));
      }

      const keys = { ...groupKeys, ...gkNext };
      const next: Record<string, string> = {};
      for (const c of convs) {
        const kind = c.last_message_kind;
        if (!kind) {
          next[c.id] = "";
          continue;
        }
        if (kind === "file_notice") {
          next[c.id] = "📎 File";
          continue;
        }
        const ct = c.last_message_ciphertext;
        if (!ct) {
          next[c.id] = kind === "system" ? "Group update" : "";
          continue;
        }
        let plainText = "";
        try {
          const stub: Message = {
            id: "preview",
            conversation_id: c.id,
            sender_id: c.last_message_sender || "",
            kind,
            ciphertext: ct,
            nonce: c.last_message_nonce || "",
            wrapped_keys: c.last_message_wrapped_keys || {},
            signature: "",
            created_at: c.last_message_at || "",
          };
          if (c.kind === "group") {
            const gk = keys[c.id];
            if (!gk) {
              next[c.id] = "…";
              continue;
            }
            plainText = await decryptGroupMessageText(stub);
          } else if (c.peer_id) {
            plainText = await decryptMessage(
              { ...stub, wrapped_keys: stub.wrapped_keys || {} },
              profile.id,
              identity
            );
          }
        } catch {
          plainText = "";
        }
        const sid = c.last_message_sender || "";
        const senderName =
          sid === profile.id
            ? "You"
            : c.kind === "dm"
              ? c.peer_name || "Contact"
              : peers.find((p) => p.user_id === sid)?.display_name || "Member";
        next[c.id] = conversationPreviewLine(
          kind,
          plainText,
          profile.id,
          c.last_message_sender,
          senderName,
          c.kind === "group"
        );
      }
      if (!cancel) setLastPreviews(next);
    })();
    return () => {
      cancel = true;
    };
  }, [convs, peers, groupKeys, groupKeyHistory, identity, profile.id]);

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
      const p = ev.payload || {};
      const cid = p.conversation_id || "";
      const fromId = p.from_id || "";
      const kind = p.kind || "";
      void (async () => {
        await refresh().catch(() => {});
        if (!cid || fromId === profile.id) return;
        if (kind === "reaction" || kind === "pin" || kind === "unpin" || kind === "deleted") return;

        // Decrypt game_move for session persistence + active game UI.
        // Moves carry boardAfter so a single latest snapshot can resync state.
        if (kind === "game_move") {
          try {
            const msgs = await peerApi.listMessages(cid);
            const latest = msgs.filter((m) => m.kind === "game_move" && m.sender_id === fromId).at(-1);
            if (!latest) return;
            const peerList = await peerApi.listPeers();
            const peer = peerList.find((x) => x.user_id === fromId);
            if (!peer) return;
            const plaintext = await decryptMessage(
              { ...latest, wrapped_keys: latest.wrapped_keys || {} },
              profile.id,
              identity
            );
            const gameMsg = JSON.parse(plaintext) as GameMsg;
            applyInboundToSession(fromId, gameMsg, peerList, profile.id);
            gameDispatchRef.current?.(fromId, gameMsg);
          } catch {
            /* ignore malformed game messages */
          }
          return;
        }

        // Surface first contact from an untrusted peer so inbound DMs are obvious.
        if (fromId && kind !== "system" && kind !== "group_event") {
          try {
            const peerList = await peerApi.listPeers();
            const peer = peerList.find((x) => x.user_id === fromId);
            if (peer && !peer.pinned && !peer.blocked) {
              setNav("chats");
              setTab(1);
              setFirstContact({ peer, conversationId: cid });
            }
          } catch {
            /* ignore */
          }
        }
        // OS toasts are owned by Rust (desktop_notify_if_needed) to avoid duplicates.
      })();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [profile.id, identity]);

  // Toast click: Rust tray toasts + onAction when a listener is registered.
  useEffect(() => {
    let unAction: { unregister: () => Promise<void> } | undefined;
    let unListen: (() => void) | undefined;
    const openFromNotify = (conversationId?: string) => {
      void getCurrentWindow().show().catch(() => {});
      void getCurrentWindow().setFocus().catch(() => {});
      setNav("chats");
      setTab(1);
      if (!conversationId) return;
      const conv =
        convsRef.current.find((c) => c.id === conversationId) ||
        (activeRef.current?.id === conversationId ? activeRef.current : null);
      if (conv) selectConversation(conv);
      else {
        peerApi.listConversations().then((list) => {
          const found = list.find((c) => c.id === conversationId);
          if (found) selectConversation(found);
        }).catch(() => {});
      }
    };
    onAction((event) => {
      const extra = event.notification?.extra as Record<string, unknown> | undefined;
      const cid = typeof extra?.conversation_id === "string" ? extra.conversation_id : "";
      openFromNotify(cid || undefined);
    })
      .then((fn) => {
        unAction = fn;
      })
      .catch(() => {});
    listen<{ conversation_id?: string }>("notification-open", (ev) => {
      openFromNotify(ev.payload?.conversation_id);
    }).then((fn) => {
      unListen = fn;
    });
    return () => {
      unListen?.();
      void unAction?.unregister();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!active) {
      setChatPaintReady(true);
      return;
    }
    const conv = active;
    let cancel = false;
    stickToBottomRef.current = true;
    setChatPaintReady(false);
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

    async function pull(isInitial = false) {
      if (conv.kind === "group") {
        try {
          if (!cancel) await syncGroupKeyIfRotated(conv.id);
        } catch (err) {
          console.error(err);
          if (
            !cancel &&
            isInitial &&
            !groupKeysRef.current[conv.id] &&
            groupUnlockWarnedRef.current !== conv.id
          ) {
            groupUnlockWarnedRef.current = conv.id;
            setStatus("Couldn't unlock this group");
          }
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
      if (cancel) return;
      // Avoid churning React state (and scroll) when the poll returns the same list.
      setMessages((prev) => {
        if (
          prev.length === msgs.length &&
          prev.every(
            (m, i) =>
              m.id === msgs[i].id &&
              m.kind === msgs[i].kind &&
              m.delivered === msgs[i].delivered &&
              m.pinned === msgs[i].pinned &&
              (m.edited_at || "") === (msgs[i].edited_at || "")
          )
        ) {
          return prev;
        }
        return msgs;
      });
      if (isInitial) {
        // After messages commit, pin once then reveal — no top→bottom flash.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (cancel) return;
            if (stickToBottomRef.current && !highlightMsgId) scrollChatToBottom("auto");
            setChatPaintReady(true);
          });
        });
      }
    }

    pull(true).catch((err) => {
      console.error(err);
      if (!cancel) setChatPaintReady(true);
    });
    const t = setInterval(() => pull(false).catch(() => {}), 750);
    let unlisten: (() => void) | undefined;
    listen("inbox-updated", () => {
      pull(false).catch(() => {});
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

  function scrollChatToBottom(_behavior: ScrollBehavior = "auto") {
    const el = scroller.current;
    if (!el) return;
    // Prevent onScroll from treating a programmatic snap as "user scrolled up".
    ignoreScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    window.setTimeout(() => {
      ignoreScrollRef.current = false;
    }, 50);
  }

  // Keep pinned before paint when content changes (no visible jump while already revealed).
  useLayoutEffect(() => {
    if (!active?.id || highlightMsgId) return;
    if (!stickToBottomRef.current) return;
    scrollChatToBottom("auto");
  }, [
    messages,
    active?.id,
    outgoingFile?.done,
    incomingFile?.done,
    Object.keys(plain).length,
    highlightMsgId,
  ]);

  // Keep pinned to bottom when bubbles grow (decrypt / images) without yanking
  // the user if they scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const inner = el.firstElementChild;
    const ro = new ResizeObserver(() => {
      if (!stickToBottomRef.current || highlightMsgId) return;
      scrollChatToBottom("auto");
    });
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [active?.id, highlightMsgId, messages.length]);

  // WhatsApp-style jump + flash when opening a saved message.
  useEffect(() => {
    if (!highlightMsgId || !active) return;
    if (!messages.some((m) => m.id === highlightMsgId)) return;
    stickToBottomRef.current = false;
    const t = window.setTimeout(() => {
      const node = document.getElementById(`msg-${highlightMsgId}`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const clear = window.setTimeout(() => setHighlightMsgId(null), 2800);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(clear);
    };
  }, [highlightMsgId, active?.id, messages]);

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
            next[m.id] = await decryptGroupMessageText(m);
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
  }, [messages, groupKeys, groupKeyHistory, peers, active?.id, active?.kind]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const m of messages) {
        if (
          (m.kind !== "file_notice" && m.kind !== "announcement") ||
          !m.file_id ||
          fileNames[m.file_id]
        ) {
          continue;
        }
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

  // Native OS drag-drop (WebView HTML5 File DnD often has empty paths on Windows).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragOverChat(true);
        } else if (payload.type === "leave") {
          setDragOverChat(false);
        } else if (payload.type === "drop") {
          setDragOverChat(false);
          const paths = payload.paths || [];
          if (!paths.length) return;
          if (!activeRef.current) {
            setPendingShareFiles(paths);
            setStatus("Select a conversation, then drop again — or files are queued.");
            return;
          }
          void stageDiskPaths(paths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  // When pendingShareFiles arrives, stage them on the active conversation.
  useEffect(() => {
    if (!pendingShareFiles.length || !active) return;
    const files = pendingShareFiles;
    setPendingShareFiles([]);
    void stageDiskPaths(files);
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
    if (peer.blocked) {
      const c = await peerApi.openDm(peer.user_id);
      selectConversation(c);
      setTab(1);
      await refresh();
      return;
    }
    if (!peer.pinned && peer.tls_fingerprint) {
      setPinOpen(peer);
      return;
    }
    const c = await peerApi.openDm(peer.user_id);
    selectConversation(c);
    setTab(1);
    await refresh();
  }

  async function toggleBlockPeer(peerId: string, blocked: boolean) {
    try {
      await peerApi.setPeerBlocked(peerId, blocked);
      await refresh();
      setStatus(blocked ? "Blocked — they can no longer DM you" : "Unblocked");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  function stageFiles(files: File[]) {
    const next: StagedFile[] = files.map((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(16).slice(2)}`,
      source: file,
      name: file.name,
      size: file.size,
      isDir: false,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setStagedFiles((prev) => [...prev, ...next]);
  }

  async function stageDiskPaths(paths: string[]) {
    const next: StagedFile[] = [];
    for (const path of paths) {
      try {
        const meta = await peerApi.localPathMeta(path);
        if (meta.is_dir) {
          next.push({
            id: `${meta.name}-dir-${Math.random().toString(16).slice(2)}`,
            source: { path: meta.path, name: meta.name, size: meta.size },
            name: `${meta.name}/`,
            size: meta.size,
            isDir: true,
            previewUrl: null,
          });
        } else {
          next.push({
            id: `${meta.name}-${meta.size}-${Math.random().toString(16).slice(2)}`,
            source: { path: meta.path, name: meta.name, size: meta.size },
            name: meta.name,
            size: meta.size,
            isDir: false,
            previewUrl: null,
          });
        }
      } catch (err: any) {
        setStatus(err?.message || `Can't read ${path}`);
      }
    }
    if (next.length) setStagedFiles((prev) => [...prev, ...next]);
  }

  async function packFolderAndSend(folderPath: string, folderName: string) {
    const entries = await peerApi.listDirectoryFiles(folderPath);
    if (!entries.length) {
      setStatus(`Folder empty: ${folderName}`);
      return;
    }
    if (entries.length > BUNDLE_MAX_FILES) {
      setStatus(
        `Folder has ${entries.length} files (max ${BUNDLE_MAX_FILES}). Try a smaller folder — large trees like node_modules often exceed this.`
      );
      return;
    }
    const totalBytes = entries.reduce((sum, e) => sum + (Number(e.size) || 0), 0);
    if (totalBytes > BUNDLE_MAX_BYTES) {
      setStatus(
        `Folder is about ${formatBytes(totalBytes)} (max 5 GiB). Choose fewer/smaller files.`
      );
      return;
    }
    const packed = await peerApi.packBundle(
      entries.map((e) => ({ abs_path: e.abs_path, rel_path: e.rel_path }))
    );
    await sendFile({ path: packed.path, name: packed.name, size: packed.size });
    await peerApi.deleteBundleFile(packed.path).catch(() => {});
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
    if (!canMutateMessageToday(message.created_at)) {
      setMsgMenu(null);
      return;
    }
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
    if (message.kind !== "text" && message.kind !== "forwarded") return;
    setForwardMessage(message);
    setForwardPick([]);
    setForwardQuery("");
    setMsgMenu(null);
  }

  function isTextLikeMessage(m: Message) {
    return m.kind === "text" || m.kind === "forwarded";
  }

  async function confirmForward() {
    if (!forwardMessage || !forwardPick.length) return;
    const body = plain[forwardMessage.id];
    if (!body) {
      setStatus("Nothing to forward");
      return;
    }
    try {
      let sent = 0;
      for (const convId of forwardPick) {
        const target = convs.find((c) => c.id === convId);
        if (!target) continue;
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
            { kind: "forwarded", sender_id: profile.id, ...enc },
            [peer.user_id]
          );
        } else {
          const gk = await ensureGroupKey(target.id);
          const enc = await encryptWithGroupKey(body, target.id, profile.id, gk, identity);
          const memberIds = await peerApi.memberIds(target.id);
          await peerApi.sendMessage(
            target.id,
            { kind: "forwarded", sender_id: profile.id, ...enc },
            memberIds.filter((id) => id !== profile.id)
          );
        }
        if (active?.id === target.id) setMessages(await peerApi.listMessages(target.id));
        sent += 1;
      }
      setStatus(sent > 1 ? `Forwarded to ${sent} chats` : "Forwarded");
      setForwardMessage(null);
      setForwardPick([]);
      await refresh();
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

  async function confirmClearChatMessages() {
    if (!clearChatTarget) return;
    setClearBusy(true);
    try {
      await peerApi.clearConversationMessages(
        clearChatTarget.id,
        clearIncludeFiles
      );
      if (active?.id === clearChatTarget.id) {
        setMessages([]);
        setPlain({});
        setFileNames({});
      }
      setClearChatTarget(null);
      setClearIncludeFiles(false);
      setStatus(
        clearIncludeFiles
          ? "Deleted messages and files in this chat"
          : "Deleted messages in this chat"
      );
      await refresh();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setClearBusy(false);
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

  async function blockDmFromConv(conv: Conversation) {
    if (conv.kind !== "dm" || !conv.peer_id) return;
    const peer = peers.find((p) => p.user_id === conv.peer_id);
    await toggleBlockPeer(conv.peer_id, !peer?.blocked);
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

  async function sendEncrypted(
    kind: string,
    body: string,
    replyToId?: string,
    extra?: { file_id?: string | null }
  ) {
    if (!active || !body.trim()) return;
    const peer = active.kind === "dm" ? peers.find((p) => p.user_id === active.peer_id) : undefined;
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
      message = {
        kind,
        sender_id: profile.id,
        ...enc,
        reply_to: replyToId ?? null,
        file_id: extra?.file_id ?? null,
      };
    } else {
      const gk = await ensureGroupKey(active.id);
      const enc = await encryptWithGroupKey(body.trim(), active.id, profile.id, gk, identity);
      message = {
        kind,
        sender_id: profile.id,
        ...enc,
        reply_to: replyToId ?? null,
        file_id: extra?.file_id ?? null,
      };
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
      const src = sf.source;
      if (sf.isDir && !(src instanceof File)) {
        try {
          await packFolderAndSend(src.path, src.name);
        } catch (err: any) {
          setStatus(err?.message || String(err));
        }
        continue;
      }
      await sendFile(src);
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
      setSavedItems(await peerApi.listSavedItems().catch(() => []));
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function deleteForEveryone(message: Message) {
    setMsgMenu(null);
    if (!canMutateMessageToday(message.created_at)) return;
    try {
      await peerApi.deleteMessageForEveryone(message.id);
      if (active) setMessages(await peerApi.listMessages(active.id));
      setSavedItems(await peerApi.listSavedItems().catch(() => []));
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
    // Prefer general file read — drag-drop paths live outside app bundles/.
    // Fall back to bundle reader for staged ZIP packs under app data.
    try {
      const data = await peerApi.readFileChunk(source.path, offset, CHUNK_SIZE);
      return fromB64(data);
    } catch {
      const data = await peerApi.readBundleChunk(source.path, offset, CHUNK_SIZE);
      return fromB64(data);
    }
  }

  /** Upload encrypted file chunks. When `skipNotice`, no separate file_notice is posted (caller attaches file_id). */
  async function sendFile(
    file: File | { path: string; name: string; size: number },
    opts?: { skipNotice?: boolean }
  ): Promise<string | undefined> {
    if (!active) return undefined;
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
          return undefined;
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
      if (!opts?.skipNotice) {
        await peerApi.sendFileNotice(
          conversationId,
          fileId,
          memberIds.filter((id) => id !== profile.id)
        );
        setMessages(await peerApi.listMessages(conversationId));
      }
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
      if (!opts?.skipNotice) {
        setStatus(`Sent ${name} · verified · ${Math.round(sentBytes / seconds / 1024)} KB/s`);
      }
      return fileId;
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
      return undefined;
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
    setIncomingFile({ fileId, name, done: 0, total: totalChunks, label: "Opening…" });
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
        setIncomingFile({
          fileId,
          name,
          done: i + 1,
          total: totalChunks,
          label: "Opening…",
        });
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
    // Prefer known name so zip/exe never enter the decrypt→"Opening…" path.
    const known = fileNames[fileId];
    if (known && !canPreviewFileName(known)) {
      await downloadFileToDownloads(fileId, uploaderId);
      return;
    }
    setPreviewBusy(true);
    setStatus("");
    try {
      const { file, name, data } = await decryptFile(fileId, uploaderId);
      if (abortOpenRef.current) return;
      if (!canPreviewFileName(name)) {
        setIncomingFile(null);
        setPreviewBusy(false);
        abortOpenRef.current = false;
        await downloadFileToDownloads(fileId, uploaderId);
        return;
      }
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
      setIncomingFile({
        fileId,
        name,
        done: next,
        total: totalChunks,
        label: "Downloading…",
      });
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
        setIncomingFile({
          fileId,
          name,
          done: i + 1,
          total: totalChunks,
          label: "Downloading…",
        });
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

      // Virus scan — warn on hit but keep the download (preview/save already bypassed scan).
      const scanResult = await peerApi.scanFile(path).catch((): ScanResult => ({
        clean: true, engine: "none", detail: "scan unavailable", skipped: true,
      }));
      let scanWarned = false;
      if (!scanResult.clean) {
        scanWarned = true;
        await new Promise<void>((resolve) => {
          setScanWarn({
            title: "Virus scanner warning",
            detail: scanResult.detail,
            body:
              "Windows Defender flagged this file. It is still saved so you can open or delete it yourself. Treat unexpected files from unknown peers with caution.",
            proceedLabel: "Keep file",
            onProceed: () => {
              setScanWarn(null);
              resolve();
            },
            onCancel: () => {
              setScanWarn(null);
              resolve();
            },
          });
        });
      }

      if (uploaderId !== profile.id) {
        await peerApi.ackFileDownload(fileId, uploaderId).catch(() => {});
      }
      const scanNote = scanResult.skipped
        ? null
        : scanWarned
          ? `⚠ ${scanResult.engine} warning`
          : `Scanned clean by ${scanResult.engine}`;
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
      await adoptGroupKey(active.id, newKey);
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

  async function handleRemoveLeftGroup(conv?: Conversation | null) {
    const target = conv || active;
    if (!target || target.kind !== "group") return;
    if (
      !window.confirm(
        "Remove this group from your chat list? Messages and files for this group will be deleted on this computer only."
      )
    ) {
      return;
    }
    try {
      await peerApi.deleteConversationLocal(target.id);
      setMembersOpen(false);
      if (active?.id === target.id) setActive(null);
      await refresh();
      setStatus("Group removed from your chats");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function ensureAnnounceBoards() {
    try {
      const boards = await peerApi.ensureAnnouncementBoards();
      setAnnounceBoards(boards);
      const myTeam = (profile.team || "").trim().toLowerCase();
      for (const board of boards) {
        try {
          const gk = await ensureGroupKey(board.id);
          const pubs: Record<string, string> = {};
          for (const p of peers) {
            if (p.user_id === profile.id) continue;
            if (board.id === "board:org") {
              pubs[p.user_id] = p.x25519_public;
            } else if (
              myTeam &&
              (p.team || "").trim().toLowerCase() === myTeam
            ) {
              pubs[p.user_id] = p.x25519_public;
            }
          }
          if (Object.keys(pubs).length) {
            await peerApi.addGroupMembers(
              board.id,
              wrapGroupKeyForMembers(gk, identity, pubs)
            );
          }
        } catch (e) {
          console.error("announce board sync", board.id, e);
        }
      }
      return boards;
    } catch (err: any) {
      setStatus(err?.message || String(err));
      return [] as Conversation[];
    }
  }

  async function postAnnouncement() {
    if (!active) return;
    const title = announceCompose.title.trim();
    const body = announceCompose.body.trim();
    const files = [...stagedFiles];
    if (!title && !body && !files.length) return;
    if (!title || !body) {
      if (files.length && (!title || !body)) {
        setStatus("Add a title and message for the announcement (file attaches to the same post).");
        return;
      }
      return;
    }
    setAnnounceBusy(true);
    try {
      await ensureGroupKey(active.id);
      let fileId: string | undefined;
      let fileLabel: string | undefined;
      if (files.length) {
        if (files.length > 1) {
          setStatus("One file per announcement — using the first attachment.");
        }
        const sf = files[0];
        clearStagedFiles();
        if (sf.isDir && !(sf.source instanceof File)) {
          await packFolderAndSend(sf.source.path, sf.name);
          // folder send posts its own notice; fall back to text-only announcement
          fileId = undefined;
        } else {
          fileId = await sendFile(
            sf.source instanceof File ? sf.source : sf.source,
            { skipNotice: true }
          );
          fileLabel = sf.name;
          if (fileId) setFileNames((s) => ({ ...s, [fileId!]: sf.name }));
        }
      }
      await sendEncrypted(
        "announcement",
        JSON.stringify({
          title,
          body,
          ...(fileLabel ? { filename: fileLabel } : {}),
        }),
        undefined,
        { file_id: fileId ?? null }
      );
      setAnnounceCompose({ title: "", body: "" });
      setStatus(fileId ? "Announcement posted with attachment" : "Announcement posted");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setAnnounceBusy(false);
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
              await ensureGroupKey(c.id);
              textBody = await decryptGroupMessageText(m);
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
  const activeDmPeer =
    active?.kind === "dm" && active.peer_id
      ? peers.find((p) => p.user_id === active.peer_id)
      : undefined;

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
            ["people", "People", <PeopleAltIcon key="p" />],
            ["announcements", "Announcements", <CampaignIcon key="a" />],
            ["transfers", "Transfers", <DownloadingIcon key="t" />],
            ...(FEATURE_GAMES && gamesOn
              ? [["games", "Games", <SportsEsportsIcon key="s" />] as const]
              : []),
            ["saved", "Saved", <BookmarkBorderIcon key="b" />],
          ] as const
        ).map(([id, label, icon]) => (
          <Tooltip key={id} title={label} placement="right">
            <IconButton
              color={nav === id ? "primary" : "default"}
              aria-label={label}
              onClick={() => {
                setNav(id as typeof nav);
                if (id === "people") setTab(0);
                if (id === "chats") setTab(1);
                if (id === "announcements") {
                  void (async () => {
                    const boards = await ensureAnnounceBoards();
                    if (boards[0]) {
                      const full =
                        (await peerApi.listConversations()).find((c) => c.id === boards[0].id) ||
                        boards[0];
                      await selectConversation(full);
                    }
                  })();
                }
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
              {nav === "announcements" ? "Announcements" : "PeerChat"}{" "}
              {nav !== "announcements" && (
                <Typography component="span" variant="caption" color="text.secondary" fontWeight={500}>
                  v{version}
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {nav === "announcements"
                ? profile.team?.trim()
                  ? `${profile.team.trim()} · team board + org updates`
                  : "Org updates — set a Team in Settings for a team board"
                : scanning
                  ? "Scanning LAN…"
                  : profile.team?.trim()
                    ? `${profile.display_name} · ${profile.team.trim()}`
                    : profile.display_name}
            </Typography>
          </Box>
          <IconButton
            size="small"
            aria-label="Refresh peers"
            onClick={() => {
              if (nav === "announcements") void ensureAnnounceBoards();
              else void refresh({ manual: true });
            }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Box>
        {nav !== "announcements" && (
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
              sx: { borderRadius: 999, bgcolor: "action.hover" },
            }}
          />
        </Box>
        )}
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, pb: 1 }}>
          {nav === "announcements" && (
            <List dense disablePadding>
              {announceBoards.map((b) => (
                <ListItemButton
                  key={b.id}
                  selected={active?.id === b.id}
                  onClick={() => selectConversation(b)}
                  sx={{ py: 1.1, px: 2 }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <CampaignIcon fontSize="small" color={active?.id === b.id ? "primary" : "action"} />
                  </ListItemIcon>
                  <ListItemText
                    primary={b.title || (b.id === "board:org" ? "Org updates" : "Team board")}
                    secondary={
                      b.id === "board:org"
                        ? "Everyone · builds, circulars"
                        : "Your team only"
                    }
                    primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }}
                    secondaryTypographyProps={{ fontSize: 12 }}
                  />
                </ListItemButton>
              ))}
              {!announceBoards.length && (
                <Typography sx={{ p: 2 }} color="text.secondary" variant="body2">
                  Opening announcement boards…
                </Typography>
              )}
            </List>
          )}
          {nav !== "announcements" && tab === 0 && (
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
                        width: 32,
                        height: 32,
                        mr: 1.1,
                        bgcolor: avatarColor(p.display_name),
                        fontSize: 14,
                        fontWeight: 800,
                      }}
                    >
                      {p.display_name.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <ListItemText
                      primary={p.display_name}
                      secondary={
                        p.online ? "Online" : lastSeenLabel(p.last_seen_at)
                      }
                      primaryTypographyProps={{ fontWeight: 600, fontSize: 14, noWrap: true }}
                      secondaryTypographyProps={{ fontSize: 12 }}
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
                      <Avatar
                        sx={{
                          width: 32,
                          height: 32,
                          bgcolor: "grey.300",
                          color: "grey.600",
                          fontSize: 14,
                          fontWeight: 800,
                        }}
                      >
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
          {nav !== "announcements" && tab === 1 && (
            <List dense disablePadding>
              {filteredConvs.map((c) => {
                const title = c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
                const dmPeer =
                  c.kind === "dm" && c.peer_id
                    ? peers.find((p) => p.user_id === c.peer_id)
                    : undefined;
                const peerOnline = !!dmPeer?.online;
                const needsTrust = !!dmPeer && !dmPeer.pinned && !dmPeer.blocked;
                const isBlocked = !!dmPeer?.blocked;
                const preview = lastPreviews[c.id] || "";
                const timeLabel = formatPreviewTime(c.last_message_at || c.created_at);
                const unread = !!c.unread_count && active?.id !== c.id;
                return (
                  <ListItemButton
                    key={c.id}
                    selected={active?.id === c.id}
                    onClick={() => selectConversation(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setConvMenu({ anchor: e.currentTarget as HTMLElement, conv: c });
                    }}
                    sx={{
                      py: 1.1,
                      px: 2,
                      alignItems: "center",
                      gap: 1.5,
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
                    <Box sx={{ position: "relative", flexShrink: 0 }}>
                      <Avatar
                        sx={{
                          width: 36,
                          height: 36,
                          bgcolor: avatarColor(title),
                          fontSize: c.kind === "group" ? 18 : 15,
                          fontWeight: 800,
                        }}
                      >
                        {c.kind === "group" ? (
                          <GroupsIcon sx={{ fontSize: 18 }} />
                        ) : (
                          title.slice(0, 1).toUpperCase()
                        )}
                      </Avatar>
                      {c.kind === "dm" && (
                        <Box
                          sx={{
                            position: "absolute",
                            bottom: 0,
                            right: 0,
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            border: "2px solid",
                            borderColor: "background.paper",
                            bgcolor: peerOnline ? "success.main" : "grey.400",
                          }}
                        />
                      )}
                    </Box>
                    <Box flex={1} minWidth={0}>
                      <Box display="flex" alignItems="baseline" gap={1}>
                        <Typography
                          component="span"
                          fontWeight={unread ? 700 : 600}
                          fontSize={15}
                          noWrap
                          flex={1}
                        >
                          {title}
                        </Typography>
                        <Typography
                          component="span"
                          variant="caption"
                          color={unread ? "primary.main" : "text.secondary"}
                          sx={{ flexShrink: 0, fontSize: 11.5, fontWeight: unread ? 600 : 400 }}
                        >
                          {timeLabel}
                        </Typography>
                      </Box>
                      <Box display="flex" alignItems="center" gap={0.5} mt={0.15}>
                        {isBlocked && (
                          <Chip
                            size="small"
                            label="Blocked"
                            sx={{ height: 18, fontSize: 10, fontWeight: 700, flexShrink: 0 }}
                          />
                        )}
                        {needsTrust && (
                          <Chip
                            size="small"
                            label="New"
                            color="warning"
                            sx={{ height: 18, fontSize: 10, fontWeight: 700, flexShrink: 0 }}
                          />
                        )}
                        {c.muted && (
                          <VolumeOffIcon sx={{ fontSize: 14, color: "text.disabled", flexShrink: 0 }} />
                        )}
                        {c.pinned_at && (
                          <PushPinIcon sx={{ fontSize: 13, color: "text.disabled", flexShrink: 0 }} />
                        )}
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                          flex={1}
                          sx={{ fontSize: 13, lineHeight: 1.35 }}
                        >
                          {preview || (needsTrust ? "First message — tap to open" : "\u00a0")}
                        </Typography>
                        {unread && (
                          <Box
                            sx={{
                              flexShrink: 0,
                              minWidth: 20,
                              height: 20,
                              px: 0.5,
                              borderRadius: 10,
                              bgcolor: "primary.main",
                              color: "primary.contrastText",
                              fontSize: 11,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {c.unread_count! > 99 ? "99+" : c.unread_count}
                          </Box>
                        )}
                      </Box>
                    </Box>
                    <IconButton
                      size="small"
                      className="chat-row-actions"
                      aria-label="Chat options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConvMenu({ anchor: e.currentTarget, conv: c });
                      }}
                      sx={{ ml: -0.5 }}
                    >
                      <MoreVertIcon sx={{ fontSize: 18, opacity: 0.5 }} />
                    </IconButton>
                  </ListItemButton>
                );
              })}
              {!filteredConvs.length && (
                <Typography sx={{ p: 2 }} color="text.secondary" variant="body2">
                  {chatSearch
                    ? "No chats match your search."
                    : "No chats yet. When someone messages you, their chat appears here — or start one from People."}
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
            onClose={() => {
              setNav("chats");
              setTab(1);
            }}
            onRetry={(row) => {
              if (row.direction === "recv" && row.file_id) {
                const msg = messages.find((m) => m.file_id === row.file_id);
                downloadFileToDownloads(row.file_id, msg?.sender_id || profile.id);
              } else {
                setStatus("Open the conversation and send the file again to retry an upload.");
              }
            }}
            onRemove={async (row) => {
              try {
                await peerApi.deleteTransfer(row.id);
                setTransfers(await peerApi.listTransfers());
              } catch (err: any) {
                setStatus(err?.message || String(err));
              }
            }}
            onClearHistory={async () => {
              try {
                await peerApi.clearTransferHistory();
                setTransfers(await peerApi.listTransfers());
                setStatus("Transfer history cleared");
              } catch (err: any) {
                setStatus(err?.message || String(err));
              }
            }}
          />
        )}
        {FEATURE_GAMES && nav === "games" && (gamesOn || pendingGameInvite ? (
          <GamesHub
            peers={peers}
            myId={profile.id}
            myName={profile.display_name}
            sendGameMsg={sendGameMsg}
            dispatchRef={gameDispatchRef}
            pendingInvite={pendingGameInvite}
            onPendingConsumed={() => setPendingGameInvite(null)}
            replayLanMoves={async (peerId, matchId) => {
              const conv = await peerApi.openDm(peerId);
              const msgs = await peerApi.listMessages(conv.id);
              const out: GameMsg[] = [];
              for (const m of msgs) {
                if (m.kind !== "game_move") continue;
                try {
                  const plaintext = await decryptMessage(
                    { ...m, wrapped_keys: m.wrapped_keys || {} },
                    profile.id,
                    identity
                  );
                  const gm = JSON.parse(plaintext) as GameMsg;
                  if (matchIdOf(gm) === matchId) out.push(gm);
                } catch {
                  /* skip */
                }
              }
              return out;
            }}
          />
        ) : (
          <Box p={3}><Alert severity="info">Games are turned off in Settings.</Alert></Box>
        ))}
        {nav === "saved" && (
          <SavedPanel
            items={savedItems}
            onOpen={(id, messageId) => {
              const conv = convs.find((c) => c.id === id);
              if (conv) {
                if (messageId) setHighlightMsgId(messageId);
                selectConversation(conv);
                setNav("chats");
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
            display:
              nav === "chats" || nav === "people" || nav === "announcements" ? "flex" : "none",
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
                onClick={() => {
                  setChatInfoTab(0);
                  setChatInfoOpen(true);
                }}
                sx={{
                  width: 40,
                  height: 40,
                  bgcolor: avatarColor(activeTitle),
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                {activeTitle.slice(0, 1).toUpperCase()}
              </Avatar>
            )}
            <Box
              flex={1}
              minWidth={0}
              onClick={() => {
                if (!active) return;
                setChatInfoTab(0);
                setChatInfoOpen(true);
              }}
              sx={{ cursor: active ? "pointer" : "default" }}
            >
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                {active ? activeTitle : "Select a conversation"}
              </Typography>
              {typingLabel ? (
                <Typography variant="caption" color="primary" display="block">
                  {typingLabel}
                </Typography>
              ) : active?.kind === "group" && membersLoaded ? (
                <Typography variant="caption" color="text.secondary" display="block">
                  {members.length} {members.length === 1 ? "member" : "members"}
                </Typography>
              ) : active?.kind === "dm" && activeDmPeer ? (
                <Typography
                  variant="caption"
                  display="block"
                  sx={{ color: activeDmPeer.online ? "success.main" : "text.secondary" }}
                >
                  {activeDmPeer.online ? "Online" : lastSeenLabel(activeDmPeer.last_seen_at)}
                </Typography>
              ) : active ? (
                <Typography variant="caption" color="text.secondary" display="block">
                  Media, docs & links
                </Typography>
              ) : null}
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
            {active && (
              <IconButton
                aria-label="Chat options"
                onClick={(e) => setConvMenu({ anchor: e.currentTarget, conv: active })}
              >
                <MoreVertIcon />
              </IconButton>
            )}
          </Toolbar>
        </AppBar>

        {active && (() => {
          const pinned = messages.filter((m) => m.pinned && m.kind !== "deleted");
          if (!pinned.length) return null;
          return (
            <Box
              sx={{
                flexShrink: 0,
                px: 1.5,
                py: 0.75,
                borderBottom: "1px solid",
                borderColor: "divider",
                bgcolor: dark ? "rgba(76,180,160,0.12)" : "rgba(220,239,233,0.9)",
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                maxHeight: 120,
                overflow: "auto",
              }}
            >
              {pinned.slice(0, 5).map((m) => {
                const preview =
                  m.kind === "file_notice"
                    ? `📎 ${(m.file_id && fileNames[m.file_id]) || "File"}`
                    : (plain[m.id] || m.kind).slice(0, 120);
                return (
                  <Box
                    key={m.id}
                    onClick={() => {
                      setHighlightMsgId(m.id);
                      stickToBottomRef.current = false;
                      requestAnimationFrame(() => {
                        document.getElementById(`msg-${m.id}`)?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      });
                    }}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                      cursor: "pointer",
                      borderRadius: 1,
                      px: 0.5,
                      py: 0.25,
                      "&:hover": { bgcolor: "action.hover" },
                    }}
                  >
                    <PushPinIcon sx={{ fontSize: 14, color: "primary.main" }} />
                    <Typography variant="caption" noWrap sx={{ flex: 1, fontWeight: 600 }}>
                      {preview}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          );
        })()}

        {active?.kind === "dm" && activeDmPeer?.blocked && (
          <Alert
            severity="info"
            sx={{ borderRadius: 0, flexShrink: 0 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => toggleBlockPeer(activeDmPeer.user_id, false)}
              >
                Unblock
              </Button>
            }
          >
            You blocked <strong>{activeDmPeer.display_name}</strong>. They can’t DM you until you
            unblock them.
          </Alert>
        )}
        {active?.kind === "dm" && activeDmPeer && !activeDmPeer.pinned && !activeDmPeer.blocked && (
          <Alert
            severity="warning"
            sx={{ borderRadius: 0, flexShrink: 0 }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setPinOpen(activeDmPeer)}
              >
                Trust
              </Button>
            }
          >
            First contact with <strong>{activeDmPeer.display_name}</strong>. You can read their
            messages now — tap Trust to pin their identity.
          </Alert>
        )}

        <Box
          ref={scroller}
          flex={1}
          minHeight={0}
          px={2}
          py={1.5}
          overflow="auto"
          position="relative"
          onScroll={(e) => {
            if (ignoreScrollRef.current) return;
            const el = e.currentTarget;
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            // Hysteresis: easier to lock to bottom than to unlock while reading.
            if (dist < 80) stickToBottomRef.current = true;
            else if (dist > 120) stickToBottomRef.current = false;
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverChat(true);
          }}
          onDragLeave={() => setDragOverChat(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverChat(false);
            const files = Array.from(e.dataTransfer.files || []);
            if (files.length) stageFiles(files);
          }}
          sx={{
            bgcolor: "background.default",
            backgroundImage: dark
              ? "radial-gradient(rgba(76,141,255,0.08) 1px, transparent 1px)"
              : "radial-gradient(rgba(15,107,92,0.06) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
            outline: dragOverChat ? "2px dashed" : "none",
            outlineColor: "primary.main",
            outlineOffset: -8,
            // Hide until first bottom-pin so opening a chat never flashes at the top.
            opacity: chatPaintReady ? 1 : 0,
            transition: chatPaintReady ? "opacity 80ms ease-out" : "none",
          }}
        >
          {/*
            Inner column with minHeight 100% + justify flex-end keeps short threads
            visually at the bottom without a flex:1 spacer (which inflates scrollHeight
            and lets you scroll into empty space past the last message).
          */}
          <Box
            minHeight="100%"
            display="flex"
            flexDirection="column"
            justifyContent="flex-end"
            gap={0.75}
          >
          {dragOverChat && (
            <Box
              position="absolute"
              top={0}
              left={0}
              right={0}
              bottom={0}
              zIndex={5}
              display="flex"
              alignItems="center"
              justifyContent="center"
              sx={{ bgcolor: "rgba(15,107,92,0.12)", pointerEvents: "none" }}
            >
              <Paper sx={{ px: 3, py: 2 }}>
                <Typography fontWeight={700}>Drop files to attach</Typography>
              </Paper>
            </Box>
          )}
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
                    bgcolor: "background.paper",
                    color: "text.secondary",
                    fontWeight: 600,
                    fontSize: 11,
                    border: "1px solid",
                    borderColor: "divider",
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
                            bgcolor: "background.paper",
                            border: "1px solid",
                            borderColor: "divider",
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
                if (m.kind === "game_move") {
                  const gm = parseGameMsg(plain[m.id] || "");
                  if (!gm || gm.payload.type !== "invite") return null;
                  const mid = matchIdOf(gm);
                  const related = messages
                    .filter((x) => x.kind === "game_move" && x.id !== m.id)
                    .map((x) => ({
                      msg: parseGameMsg(plain[x.id] || ""),
                      senderId: x.sender_id,
                    }))
                    .filter((x): x is { msg: GameMsg; senderId: string } => !!x.msg);
                  const status = resolveGameCardStatus({
                    invite: gm,
                    mine,
                    myId: profile.id,
                    related,
                  });
                  const peerName =
                    active?.kind === "dm"
                      ? active.peer_name ||
                        peers.find((p) => p.user_id === active.peer_id)?.display_name ||
                        "Peer"
                      : senderLabel(m.sender_id);
                  const fromName = mine
                    ? peerName
                    : (gm.payload as { fromName?: string }).fromName || senderLabel(m.sender_id);
                  return (
                    <Grow in key={m.id} timeout={180}>
                      <Box
                        sx={{
                          alignSelf: mine ? "flex-end" : "flex-start",
                          maxWidth: "min(72%, 320px)",
                        }}
                      >
                        <Paper
                          elevation={0}
                          sx={{
                            px: 1.25,
                            py: 1,
                            bgcolor: mine
                              ? dark
                                ? "rgba(76,141,255,0.22)"
                                : "#DCEFE9"
                              : "background.paper",
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: mine ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
                          }}
                        >
                          <GameInviteCard
                            game={gm.game}
                            fromName={fromName}
                            mine={mine}
                            status={status}
                            busy={gameInviteBusy}
                            onAccept={async () => {
                              if (!FEATURE_GAMES) {
                                setStatus("Games are not available in this build.");
                                return;
                              }
                              setGameInviteBusy(true);
                              try {
                                if (!gamesOn) {
                                  setGamesOn(true);
                                  await peerApi.setAppSetting("games_enabled", "1").catch(() => {});
                                }
                                const invite: PendingGameInvite = {
                                  game: gm.game,
                                  matchId: mid,
                                  fromId: m.sender_id,
                                  fromName,
                                };
                                if (gm.game === "rps") {
                                  invite.format = (gm.payload as { format?: 1 | 3 | 5 }).format || 3;
                                }
                                if (gm.game === "dab") {
                                  invite.rows = (gm.payload as { rows?: number }).rows || 4;
                                  invite.cols = (gm.payload as { cols?: number }).cols || 4;
                                }
                                setPendingGameInvite(invite);
                                setNav("games");
                              } finally {
                                setGameInviteBusy(false);
                              }
                            }}
                            onDecline={async () => {
                              setGameInviteBusy(true);
                              try {
                                await sendGameMsg(m.sender_id, {
                                  game: gm.game,
                                  payload: { type: "decline", matchId: mid },
                                });
                                if (active) {
                                  setMessages(await peerApi.listMessages(active.id));
                                }
                              } catch (err: any) {
                                setStatus(err?.message || String(err));
                              } finally {
                                setGameInviteBusy(false);
                              }
                            }}
                            onOpenGame={() => {
                              if (!gamesOn) {
                                setGamesOn(true);
                                peerApi.setAppSetting("games_enabled", "1").catch(() => {});
                              }
                              const open: PendingGameInvite = {
                                game: gm.game,
                                matchId: mid,
                                fromId: mine ? (active?.peer_id || m.sender_id) : m.sender_id,
                                fromName,
                                openOnly: true,
                              };
                              if (gm.game === "rps") {
                                open.format = (gm.payload as { format?: 1 | 3 | 5 }).format || 3;
                              }
                              if (gm.game === "dab") {
                                open.rows = (gm.payload as { rows?: number }).rows || 4;
                                open.cols = (gm.payload as { cols?: number }).cols || 4;
                              }
                              setPendingGameInvite(open);
                              setNav("games");
                            }}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", textAlign: "right", fontSize: 10.5, mt: 0.5 }}
                          >
                            {formatClock(m.created_at)}
                          </Typography>
                        </Paper>
                      </Box>
                    </Grow>
                  );
                }
                const highlighted = highlightMsgId === m.id;
                return (
                  <Grow in key={m.id} timeout={180}>
                    <Box
                      id={`msg-${m.id}`}
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
                            bgcolor: highlighted
                              ? dark
                                ? "rgba(76, 180, 160, 0.32)"
                                : "rgba(196, 232, 220, 0.95)"
                              : m.kind === "deleted"
                                ? "action.selected"
                                : mine
                                  ? dark
                                    ? "rgba(76,141,255,0.22)"
                                    : "#DCEFE9"
                                  : "background.paper",
                            border: "1px solid",
                            borderColor: highlighted
                              ? dark
                                ? "rgba(120, 210, 190, 0.7)"
                                : "#7FBFB0"
                              : m.kind === "deleted"
                                ? "divider"
                                : mine
                                  ? dark
                                    ? "rgba(76,141,255,0.35)"
                                    : "#C5DFD6"
                                  : "divider",
                            borderRadius: mine ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
                            position: "relative",
                            boxShadow: dark
                              ? "0 1px 2px rgba(0,0,0,0.25)"
                              : "0 1px 1px rgba(20,32,28,0.04)",
                            transition: "background-color 0.35s ease, border-color 0.35s ease",
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
                                top: 2,
                                right: 2,
                                opacity: 0.45,
                                p: 0.45,
                                zIndex: 1,
                              }}
                            >
                              <MoreVertIcon sx={{ fontSize: 15 }} />
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
                          {m.kind === "forwarded" && (
                            <Stack
                              direction="row"
                              alignItems="center"
                              spacing={0.35}
                              sx={{ mb: 0.35, color: "text.secondary", pr: 2 }}
                            >
                              <ForwardIcon sx={{ fontSize: 13, transform: "scaleX(-1)" }} />
                              <Typography
                                variant="caption"
                                sx={{ fontSize: 11, fontWeight: 600, fontStyle: "italic" }}
                              >
                                Forwarded
                              </Typography>
                            </Stack>
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
                            <Stack
                              direction="row"
                              spacing={0.75}
                              alignItems="center"
                              sx={{ pr: 3.25 }}
                            >
                              {(() => {
                                const fname =
                                  (m.file_id && fileNames[m.file_id]) || "Encrypted file";
                                const mine = m.sender_id === profile.id;
                                const previewable =
                                  !!m.file_id &&
                                  !!fileNames[m.file_id] &&
                                  canPreviewFileName(fileNames[m.file_id]);
                                return (
                                  <>
                                    <Button
                                      size="small"
                                      startIcon={
                                        mine ? (
                                          <InsertDriveFileIcon sx={{ fontSize: 16 }} />
                                        ) : (
                                          <DownloadIcon sx={{ fontSize: 16 }} />
                                        )
                                      }
                                      disabled={previewBusy || !!incomingFile || !m.file_id}
                                      onClick={() => {
                                        if (!m.file_id) return;
                                        if (mine) {
                                          peerApi.openLocalFile(m.file_id).catch(() =>
                                            downloadFileToDownloads(m.file_id!, m.sender_id)
                                          );
                                        } else {
                                          downloadFileToDownloads(m.file_id, m.sender_id);
                                        }
                                      }}
                                      sx={{
                                        textTransform: "none",
                                        fontWeight: 700,
                                        fontSize: 13,
                                        py: 0.25,
                                        minHeight: 0,
                                      }}
                                    >
                                      {fname}
                                    </Button>
                                    {previewable && (
                                      <Tooltip title="Preview">
                                        <span>
                                          <IconButton
                                            size="small"
                                            disabled={
                                              previewBusy || !!incomingFile || !m.file_id
                                            }
                                            onClick={() =>
                                              m.file_id &&
                                              previewFile(m.file_id, m.sender_id)
                                            }
                                            aria-label="Preview file"
                                            sx={{ p: 0.5 }}
                                          >
                                            <VisibilityIcon sx={{ fontSize: 16 }} />
                                          </IconButton>
                                        </span>
                                      </Tooltip>
                                    )}
                                  </>
                                );
                              })()}
                            </Stack>
                          ) : (
                            m.kind === "announcement" || m.kind === "snippet" || m.kind === "poll" ? (
                              <RichCard
                                kind={m.kind}
                                raw={plain[m.id] || ""}
                                votes={messages.filter((v) => v.kind === "poll_vote" && v.reply_to === m.id)}
                                plain={plain}
                                onVote={(option) => sendEncrypted("poll_vote", option, m.id)}
                                fileId={m.kind === "announcement" ? m.file_id : null}
                                fileName={
                                  m.kind === "announcement" && m.file_id
                                    ? fileNames[m.file_id]
                                    : undefined
                                }
                                mine={m.sender_id === profile.id}
                                onOpenFile={(fid) => {
                                  peerApi.openLocalFile(fid).catch(() =>
                                    downloadFileToDownloads(fid, m.sender_id)
                                  );
                                }}
                                onDownloadFile={(fid) =>
                                  downloadFileToDownloads(fid, m.sender_id)
                                }
                              />
                            ) : (
                            <Box sx={{ pr: 1.5, fontSize: 14, lineHeight: 1.35 }}>
                              <LinkifiedText
                                text={plain[m.id] || "…"}
                                sx={{ fontSize: 14, lineHeight: 1.35 }}
                              />
                            </Box>
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
                                  "Could not deliver for over 2 days. Keep PeerChat open on both PCs on the same LAN, then Retry."
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
                            ) : m.queued || (mine && !m.delivered && m.kind !== "deleted") ? (
                              <Tooltip title="Saved on this PC — will send when their PeerChat is open on the LAN">
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 0.35,
                                    fontSize: 10.5,
                                    color: "text.secondary",
                                  }}
                                >
                                  {formatClock(m.created_at)} · Queued
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
                bgcolor: "action.hover",
                border: "1px dashed",
                borderColor: "divider",
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
                bgcolor: "action.hover",
                border: "1px dashed",
                borderColor: "divider",
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
                    {incomingFile.label || "Downloading…"}
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
          <Box ref={bottomSentinelRef} aria-hidden sx={{ height: 1, width: "100%", flexShrink: 0 }} />
          </Box>
        </Box>

        {active && inGroup && isAnnounceBoard && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              px: 1.5,
              py: 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
              gap: 1,
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              One-way posts — others can react. Use the message menu to reply privately to the author.
            </Typography>
            {stagedFiles.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {stagedFiles.map((sf) => (
                  <Chip
                    key={sf.id}
                    label={sf.name}
                    onDelete={() => removeStagedFile(sf.id)}
                    size="small"
                  />
                ))}
              </Stack>
            )}
            <TextField
              size="small"
              fullWidth
              placeholder="Title"
              value={announceCompose.title}
              onChange={(e) => setAnnounceCompose((c) => ({ ...c, title: e.target.value }))}
            />
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              maxRows={6}
              placeholder="Memo, circular, or update… (links are clickable)"
              value={announceCompose.body}
              onChange={(e) => setAnnounceCompose((c) => ({ ...c, body: e.target.value }))}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
              <Button
                component="label"
                size="small"
                startIcon={<AttachFileIcon />}
                disabled={announceBusy || !!outgoingFile}
                sx={{ textTransform: "none", mr: "auto" }}
              >
                Attach file
                <input
                  hidden
                  type="file"
                  disabled={announceBusy || !!outgoingFile}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) {
                      // One attachment per announcement post.
                      clearStagedFiles();
                      stageFiles(files.slice(0, 1));
                    }
                    e.target.value = "";
                  }}
                />
              </Button>
              <Button
                variant="contained"
                disabled={
                  announceBusy ||
                  !!outgoingFile ||
                  !announceCompose.title.trim() ||
                  !announceCompose.body.trim()
                }
                onClick={() => void postAnnouncement()}
                sx={{ textTransform: "none", fontWeight: 700 }}
              >
                Post
              </Button>
            </Stack>
          </Paper>
        )}

        {active && activeDmPeer?.blocked && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              p: 2,
              borderTop: "1px solid",
              borderColor: "divider",
              textAlign: "center",
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            <Typography color="text.secondary" sx={{ mb: 1.25 }}>
              Messaging is disabled while this person is blocked.
            </Typography>
            <Button
              variant="outlined"
              startIcon={<PersonOffIcon />}
              onClick={() => toggleBlockPeer(activeDmPeer.user_id, false)}
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              Unblock
            </Button>
          </Paper>
        )}

        {active && inGroup && !isAnnounceBoard && !activeDmPeer?.blocked && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              px: 1.5,
              py: 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
              gap: 0.85,
              bgcolor: "background.paper",
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
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  bgcolor: "action.hover",
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
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  bgcolor: "action.hover",
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
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      bgcolor: "action.hover",
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
                        {sf.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatBytes(sf.size)}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      aria-label={`Remove ${sf.name}`}
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
                bgcolor: "action.hover",
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
                  "&.Mui-disabled": {
                    bgcolor: "action.disabledBackground",
                    color: "action.disabled",
                  },
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
              borderTop: "1px solid",
              borderColor: "divider",
              textAlign: "center",
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            <Typography color="text.secondary" sx={{ mb: 1.25 }}>
              You're no longer in this group.
            </Typography>
            <Button
              color="error"
              variant="outlined"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => handleRemoveLeftGroup(active)}
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              Remove from chat list
            </Button>
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
        anchorEl={convMenu?.anchor ?? null}
        open={!!convMenu}
        onClose={() => setConvMenu(null)}
      >
        <MenuItem
          onClick={() => {
            if (convMenu) togglePinChat(convMenu.conv);
            setConvMenu(null);
          }}
        >
          <ListItemIcon>
            {convMenu?.conv.pinned_at ? (
              <PushPinIcon fontSize="small" color="primary" />
            ) : (
              <PushPinOutlinedIcon fontSize="small" />
            )}
          </ListItemIcon>
          {convMenu?.conv.pinned_at ? "Unpin chat" : "Pin chat"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (convMenu) toggleMuteChat(convMenu.conv);
            setConvMenu(null);
          }}
        >
          <ListItemIcon>
            {convMenu?.conv.muted ? (
              <VolumeOffIcon fontSize="small" />
            ) : (
              <VolumeUpIcon fontSize="small" />
            )}
          </ListItemIcon>
          {convMenu?.conv.muted ? "Unmute" : "Mute"}
        </MenuItem>
        {convMenu?.conv.kind === "dm" && convMenu.conv.peer_id && (
          <MenuItem
            onClick={() => {
              const c = convMenu.conv;
              setConvMenu(null);
              void blockDmFromConv(c);
            }}
          >
            <ListItemIcon>
              {peers.find((p) => p.user_id === convMenu.conv.peer_id)?.blocked ? (
                <PersonOffIcon fontSize="small" />
              ) : (
                <BlockIcon fontSize="small" color="error" />
              )}
            </ListItemIcon>
            {peers.find((p) => p.user_id === convMenu.conv.peer_id)?.blocked
              ? "Unblock"
              : "Block DMs"}
          </MenuItem>
        )}
        <Divider />
        <MenuItem
          onClick={() => {
            if (convMenu) {
              setClearIncludeFiles(false);
              setClearChatTarget(convMenu.conv);
            }
            setConvMenu(null);
          }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <Typography color="error.main" fontWeight={600}>
            Delete messages…
          </Typography>
        </MenuItem>
        {convMenu?.conv.kind === "group" && (
            <MenuItem
              onClick={() => {
                const c = convMenu.conv;
                setConvMenu(null);
                void handleRemoveLeftGroup(c);
              }}
            >
              <ListItemIcon>
                <DeleteForeverIcon fontSize="small" color="error" />
              </ListItemIcon>
              <Typography color="error.main" fontWeight={600}>
                Remove left group…
              </Typography>
            </MenuItem>
          )}
      </Menu>

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
        {(!isAnnounceBoard || !msgMenu) && (
          <MenuItem onClick={() => msgMenu && startReply(msgMenu.message)}>
            <ListItemIcon>
              <ReplyIcon fontSize="small" />
            </ListItemIcon>
            Reply
          </MenuItem>
        )}
        {msgMenu &&
          msgMenu.message.sender_id !== profile.id &&
          (isAnnounceBoard || msgMenu.message.kind === "announcement") && (
            <MenuItem
              onClick={async () => {
                const peer = peers.find((p) => p.user_id === msgMenu.message.sender_id);
                setMsgMenu(null);
                if (!peer) {
                  setStatus("Author is not on the LAN right now");
                  return;
                }
                setNav("chats");
                setTab(1);
                await openDm(peer);
                setStatus(`Private reply to ${peer.display_name}`);
              }}
            >
              <ListItemIcon>
                <ReplyIcon fontSize="small" />
              </ListItemIcon>
              Reply privately
            </MenuItem>
          )}
        {msgMenu && isTextLikeMessage(msgMenu.message) && (
          <MenuItem onClick={() => msgMenu && startForward(msgMenu.message)}>
            <ListItemIcon>
              <ForwardIcon fontSize="small" />
            </ListItemIcon>
            Forward
          </MenuItem>
        )}
        {msgMenu && isTextLikeMessage(msgMenu.message) && (
          <MenuItem onClick={() => msgMenu && copyMessage(msgMenu.message)}>
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            Copy
          </MenuItem>
        )}
        {msgMenu?.message.kind === "text" &&
          msgMenu.message.sender_id === profile.id &&
          !msgMenu.message.failed &&
          canMutateMessageToday(msgMenu.message.created_at) && (
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
        {msgMenu?.message.sender_id === profile.id &&
          msgMenu.message.kind !== "deleted" &&
          canMutateMessageToday(msgMenu.message.created_at) && (
          <MenuItem onClick={() => msgMenu && deleteForEveryone(msgMenu.message)}>
            <ListItemIcon>
              <DeleteForeverIcon fontSize="small" color="error" />
            </ListItemIcon>
            Delete for everyone
          </MenuItem>
        )}
      </Menu>
        </Box>

      <Dialog open={!!firstContact} onClose={() => setFirstContact(null)}>
        <DialogTitle>New message</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            <strong>{firstContact?.peer.display_name}</strong> messaged you for the first time.
            Their chat is in your Chats list — you do not need to accept before reading it.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Trusting them pins their certificate so you can spot impersonation later.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFirstContact(null)}>Later</Button>
          <Button
            onClick={async () => {
              if (!firstContact) return;
              const conv =
                convs.find((c) => c.id === firstContact.conversationId) ||
                (await peerApi.openDm(firstContact.peer.user_id));
              setFirstContact(null);
              selectConversation(conv);
              setNav("chats");
              setTab(1);
            }}
          >
            Open chat
          </Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!firstContact) return;
              const peer = firstContact.peer;
              if (peer.tls_fingerprint) {
                await peerApi.pinPeer(peer.user_id, peer.tls_fingerprint);
              }
              const conv = await peerApi.openDm(peer.user_id);
              setFirstContact(null);
              selectConversation(conv);
              setNav("chats");
              setTab(1);
              await refresh();
            }}
          >
            Trust & open
          </Button>
        </DialogActions>
      </Dialog>

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
              setNav("chats");
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

      <Dialog
        open={!!clearChatTarget}
        onClose={() => !clearBusy && setClearChatTarget(null)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ fontWeight: 800, pr: 6 }}>
          Delete messages
          <IconButton
            aria-label="Close"
            disabled={clearBusy}
            onClick={() => setClearChatTarget(null)}
            sx={{ position: "absolute", right: 10, top: 10 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Remove all messages in{" "}
            <strong>
              {clearChatTarget?.kind === "dm"
                ? clearChatTarget.peer_name || "this chat"
                : clearChatTarget?.title || "this group"}
            </strong>{" "}
            on this PC only. Other people keep their copies.
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={clearIncludeFiles}
                onChange={(_, v) => setClearIncludeFiles(v)}
                disabled={clearBusy}
              />
            }
            label="Also delete files from this chat"
          />
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button
            disabled={clearBusy}
            onClick={() => setClearChatTarget(null)}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={clearBusy}
            onClick={confirmClearChatMessages}
            sx={{ textTransform: "none", fontWeight: 700 }}
          >
            {clearBusy ? "Deleting…" : "Delete messages"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!forwardMessage}
        onClose={() => setForwardMessage(null)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: 3, overflow: "hidden" } }}
      >
        <DialogTitle sx={{ pb: 0.5, pr: 6 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <ForwardIcon color="primary" sx={{ transform: "scaleX(-1)" }} />
            <Box minWidth={0}>
              <Typography fontWeight={800} fontSize={18} lineHeight={1.2}>
                Forward message
              </Typography>
              <Typography variant="body2" color="text.secondary">
                1 message
              </Typography>
            </Box>
          </Stack>
          <IconButton
            aria-label="Close"
            onClick={() => setForwardMessage(null)}
            sx={{ position: "absolute", right: 10, top: 10 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 1.5 }}>
          <TextField
            fullWidth
            size="small"
            value={forwardQuery}
            onChange={(e) => setForwardQuery(e.target.value)}
            placeholder="Search chats…"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
            sx={{
              mb: 1.5,
              "& .MuiOutlinedInput-root": { borderRadius: 999, bgcolor: "action.hover" },
            }}
          />
          <List dense disablePadding sx={{ maxHeight: 360, overflow: "auto", mx: -0.5 }}>
            {convs
              .filter((c) => {
                const label =
                  c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
                const q = forwardQuery.trim().toLowerCase();
                return !q || label.toLowerCase().includes(q);
              })
              .map((c) => {
                const label =
                  c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
                const selected = forwardPick.includes(c.id);
                const peer = c.kind === "dm" ? peers.find((p) => p.user_id === c.peer_id) : null;
                return (
                  <ListItemButton
                    key={c.id}
                    selected={selected}
                    onClick={() =>
                      setForwardPick((ids) =>
                        ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id]
                      )
                    }
                    sx={{
                      borderRadius: 2,
                      mb: 0.35,
                      py: 0.85,
                      "&.Mui-selected": { bgcolor: "action.selected" },
                    }}
                  >
                    <Checkbox
                      edge="start"
                      size="small"
                      checked={selected}
                      tabIndex={-1}
                      disableRipple
                      sx={{ mr: 0.5 }}
                    />
                    <ListItemAvatar sx={{ minWidth: 44 }}>
                      <Avatar
                        sx={{
                          width: 36,
                          height: 36,
                          bgcolor: avatarColor(label),
                          fontSize: 14,
                          fontWeight: 700,
                        }}
                      >
                        {c.kind === "group" ? (
                          <GroupIcon sx={{ fontSize: 18 }} />
                        ) : (
                          label.slice(0, 1).toUpperCase()
                        )}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={label}
                      primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }}
                      secondary={
                        c.kind === "group"
                          ? "Group"
                          : peer?.online
                            ? "Online"
                            : "Chat"
                      }
                    />
                  </ListItemButton>
                );
              })}
            {!convs.length && (
              <Typography color="text.secondary" sx={{ p: 1.5 }}>
                No chats to forward to yet.
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2, pt: 0.5 }}>
          <Button onClick={() => setForwardMessage(null)} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!forwardPick.length}
            onClick={confirmForward}
            sx={{ textTransform: "none", borderRadius: 2, px: 2, fontWeight: 700 }}
          >
            Forward{forwardPick.length ? ` (${forwardPick.length})` : ""}
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
            bgcolor: "action.hover",
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
              sx={{ width: "100%", height: "65vh", border: 0, bgcolor: "background.paper" }}
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
                bgcolor: "background.paper",
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

      <Dialog
        open={membersOpen && active?.kind === "group"}
        onClose={() => setMembersOpen(false)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: 3, overflow: "hidden" } }}
      >
        <DialogTitle sx={{ pr: 6, pb: 1 }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Avatar sx={{ bgcolor: "primary.main", width: 40, height: 40 }}>
              <GroupsIcon />
            </Avatar>
            <Typography fontWeight={800} fontSize={20} noWrap>
              {active?.title || "Group"}
            </Typography>
          </Stack>
          <IconButton
            aria-label="Close"
            onClick={() => setMembersOpen(false)}
            sx={{ position: "absolute", right: 10, top: 10 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 0.5 }}>
          <Stack spacing={2} divider={<Divider flexItem />}>
            {isAdmin && (
              <Box>
                <Typography fontWeight={800} fontSize={13} sx={{ mb: 1.25 }}>
                  Group details
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={700}
                  letterSpacing={0.6}
                  display="block"
                  mb={0.5}
                >
                  GROUP NAME
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
                  <TextField
                    size="small"
                    fullWidth
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    placeholder="Group name"
                    sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
                  />
                  <Button
                    variant="contained"
                    color="primary"
                    startIcon={<DriveFileRenameOutlineIcon />}
                    disabled={!renameDraft.trim() || renameDraft.trim() === (active?.title || "")}
                    onClick={handleRenameGroup}
                    sx={{
                      flexShrink: 0,
                      textTransform: "none",
                      borderRadius: 2,
                      bgcolor: "action.selected",
                      color: "primary.main",
                      boxShadow: "none",
                      "&:hover": { bgcolor: "action.hover", boxShadow: "none" },
                    }}
                  >
                    Rename
                  </Button>
                </Stack>
                <FormControlLabel
                  sx={{
                    m: 0,
                    mb: 1.5,
                    width: "100%",
                    justifyContent: "space-between",
                    ml: 0,
                  }}
                  labelPlacement="start"
                  control={
                    <Switch
                      checked={active?.members_can_add !== false}
                      onChange={(_, v) => handleToggleMembersCanAdd(v)}
                    />
                  }
                  label={
                    <Typography fontWeight={600} fontSize={14}>
                      Members can add others
                    </Typography>
                  }
                />
                <Button
                  color="error"
                  variant="outlined"
                  fullWidth
                  startIcon={<DeleteForeverIcon />}
                  onClick={handleDeleteGroup}
                  sx={{ borderRadius: 2, py: 1.1, textTransform: "none", fontWeight: 700 }}
                >
                  Delete group for everyone
                </Button>
              </Box>
            )}

            <Box>
              <Typography fontWeight={800} fontSize={13} sx={{ mb: 1 }}>
                Members
              </Typography>
              <List dense disablePadding>
                {members.map((m) => {
                  const label =
                    m.user_id === profile.id ? `${m.display_name} (you)` : m.display_name;
                  return (
                    <ListItemButton
                      key={m.user_id}
                      disableRipple
                      sx={{ cursor: "default", py: 0.9, px: 0.5, borderRadius: 2 }}
                    >
                      <ListItemAvatar sx={{ minWidth: 44 }}>
                        <Avatar
                          sx={{
                            width: 36,
                            height: 36,
                            bgcolor: avatarColor(m.display_name),
                            fontSize: 14,
                            fontWeight: 700,
                          }}
                        >
                          {m.display_name.slice(0, 1).toUpperCase()}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={label}
                        secondary={m.role === "admin" ? "Admin" : "Member"}
                        primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }}
                      />
                      {m.role === "admin" && (
                        <Chip
                          size="small"
                          label="Admin"
                          icon={<AdminPanelSettingsIcon sx={{ fontSize: "16px !important" }} />}
                          sx={{
                            mr: 0.5,
                            height: 24,
                            fontWeight: 700,
                            bgcolor: "action.selected",
                            color: "primary.main",
                          }}
                        />
                      )}
                      {isAdmin && m.user_id !== profile.id && (
                        <>
                          <Button
                            size="small"
                            sx={{ mr: 0.25, textTransform: "none", fontWeight: 600 }}
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
                  );
                })}
              </List>
            </Box>

            {canAddMembers && (
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <Typography fontWeight={800} fontSize={13} sx={{ flex: 1 }}>
                    Add people
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<PersonAddAltIcon />}
                    disabled={!addPick.length}
                    onClick={handleAddMembers}
                    sx={{ textTransform: "none", borderRadius: 2, fontWeight: 700 }}
                  >
                    Add{addPick.length ? ` (${addPick.length})` : ""}
                  </Button>
                </Stack>
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
                        sx={{ borderRadius: 2, py: 0.85, px: 0.5 }}
                      >
                        <ListItemAvatar sx={{ minWidth: 44 }}>
                          <Avatar
                            sx={{
                              width: 36,
                              height: 36,
                              bgcolor: avatarColor(p.display_name),
                              fontSize: 14,
                              fontWeight: 700,
                            }}
                          >
                            {p.display_name.slice(0, 1).toUpperCase()}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={p.display_name}
                          secondary={p.online ? "Online" : "Offline"}
                          primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }}
                        />
                        <Checkbox
                          edge="end"
                          size="small"
                          checked={addPick.includes(p.user_id)}
                          tabIndex={-1}
                          disableRipple
                        />
                      </ListItemButton>
                    ))}
                </List>
                {!others.filter((p) => !members.some((m) => m.user_id === p.user_id)).length && (
                  <Typography color="text.secondary" variant="body2" sx={{ py: 1 }}>
                    No other people on the LAN to add.
                  </Typography>
                )}
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2, pt: 1 }}>
          {!isAnnounceBoard && inGroup && (
            <Button
              color="error"
              startIcon={<LogoutIcon />}
              onClick={handleLeaveGroup}
              sx={{ textTransform: "none", fontWeight: 700, mr: "auto" }}
            >
              Leave group
            </Button>
          )}
          {!isAnnounceBoard && !inGroup && (
            <Button
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => handleRemoveLeftGroup(active)}
              sx={{ textTransform: "none", fontWeight: 700, mr: "auto" }}
            >
              Remove from chat list
            </Button>
          )}
          <Button
            color="primary"
            onClick={() => setMembersOpen(false)}
            sx={{ textTransform: "none", fontWeight: 700 }}
          >
            Close
          </Button>
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
            setNav("chats");
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
              if (items.length > BUNDLE_MAX_FILES) {
                throw new Error(
                  `Too many files (${items.length}; max ${BUNDLE_MAX_FILES}). Large trees like node_modules often exceed this.`
                );
              }
              const sum = items.reduce((n, i) => n + (Number(i.size) || 0), 0);
              if (sum > BUNDLE_MAX_BYTES) {
                throw new Error(`Selection is about ${formatBytes(sum)} (max 5 GiB).`);
              }
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

      <Snackbar
        open={!!status}
        autoHideDuration={8000}
        onClose={() => setStatus("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ bottom: { xs: 88, sm: 24 } }}
      >
        <Alert
          severity="info"
          variant="filled"
          onClose={() => setStatus("")}
          sx={{ maxWidth: 480, boxShadow: 3 }}
        >
          {status}
        </Alert>
      </Snackbar>

      <Dialog
        open={chatInfoOpen && !!active}
        onClose={() => setChatInfoOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{activeTitle} — Media & links</DialogTitle>
        <Tabs
          value={chatInfoTab}
          onChange={(_, v) => setChatInfoTab(v)}
          sx={{ px: 2, borderBottom: 1, borderColor: "divider" }}
        >
          <Tab label="Media" />
          <Tab label="Docs" />
          <Tab label="Links" />
        </Tabs>
        <DialogContent dividers sx={{ minHeight: 280, p: 0 }}>
          {(() => {
            const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i;
            const jump = (messageId: string) => {
              setChatInfoOpen(false);
              setHighlightMsgId(messageId);
              stickToBottomRef.current = false;
              requestAnimationFrame(() => {
                document.getElementById(`msg-${messageId}`)?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              });
            };
            if (chatInfoTab === 0 || chatInfoTab === 1) {
              const files = messages.filter((m) => m.kind === "file_notice" && m.file_id);
              const rows = files.filter((m) => {
                const name = (m.file_id && fileNames[m.file_id]) || "";
                const isImg = IMAGE_RE.test(name);
                return chatInfoTab === 0 ? isImg : !isImg;
              });
              if (!rows.length) {
                return (
                  <Typography color="text.secondary" sx={{ p: 2.5 }}>
                    {chatInfoTab === 0 ? "No media in this chat yet." : "No documents in this chat yet."}
                  </Typography>
                );
              }
              return (
                <List dense>
                  {rows.map((m) => {
                    const name = (m.file_id && fileNames[m.file_id]) || "Encrypted file";
                    return (
                      <ListItemButton key={m.id} onClick={() => jump(m.id)}>
                        <ListItemIcon>
                          {chatInfoTab === 0 ? (
                            <InsertDriveFileIcon fontSize="small" color="primary" />
                          ) : (
                            <InsertDriveFileIcon fontSize="small" />
                          )}
                        </ListItemIcon>
                        <ListItemText
                          primary={name}
                          secondary={formatClock(m.created_at)}
                          primaryTypographyProps={{ noWrap: true }}
                        />
                      </ListItemButton>
                    );
                  })}
                </List>
              );
            }
            const linkRows: { id: string; url: string; at: string }[] = [];
            for (const m of messages) {
              if (m.kind === "deleted" || m.kind === "file_notice") continue;
              const body = plain[m.id] || "";
              const found = body.match(URL_RE);
              if (!found) continue;
              for (const url of found) {
                linkRows.push({ id: m.id, url, at: m.created_at });
              }
            }
            if (!linkRows.length) {
              return (
                <Typography color="text.secondary" sx={{ p: 2.5 }}>
                  No links in this chat yet.
                </Typography>
              );
            }
            return (
              <List dense>
                {linkRows.map((row, i) => (
                  <ListItemButton
                    key={`${row.id}-${i}`}
                    onClick={() => {
                      void openExternalLink(row.url);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      jump(row.id);
                    }}
                  >
                    <ListItemText
                      primary={row.url}
                      secondary={`${formatClock(row.at)} · open in browser · right-click to jump`}
                      primaryTypographyProps={{ noWrap: true, fontSize: 13, color: "primary.main" }}
                    />
                  </ListItemButton>
                ))}
              </List>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChatInfoOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Virus scan warning — outgoing send confirm, or inbound download notice */}
      <Dialog open={!!scanWarn} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ color: "warning.main" }}>
          {scanWarn?.title || "Virus threat detected"}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {scanWarn?.detail}
          </Alert>
          <Typography variant="body2">
            {scanWarn?.body ||
              "Windows Defender flagged this file before encryption. Sending it will still encrypt and deliver it, but the recipient's scanner may also flag it."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (scanWarn?.onCancel) scanWarn.onCancel();
              else {
                setScanWarn(null);
                setStatus("File not sent (virus scan warning).");
              }
            }}
          >
            {scanWarn?.onCancel ? "Dismiss" : "Cancel — don't send"}
          </Button>
          <Button color="warning" variant="contained" onClick={() => scanWarn?.onProceed()}>
            {scanWarn?.proceedLabel || "Send anyway"}
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
  const [team, setTeam] = useState(props.profile.team || "");
  const [savingName, setSavingName] = useState(false);
  const [status, setStatus] = useState("");
  const [notifOn, setNotifOn] = useState(true);
  const [notifBusy, setNotifBusy] = useState(false);
  const [downloadDir, setDownloadDir] = useState("");
  const [gamesEnabled, setGamesEnabled] = useState(false);
  const [shellExt, setShellExt] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const keyFp = fingerprintPublic(exportPublic(props.identity).x25519_public);

  useEffect(() => {
    peerApi.myFingerprint().then(setFp).catch(() => setFp("(unavailable)"));
    peerApi.getNotificationsEnabled().then(setNotifOn).catch(() => setNotifOn(true));
    peerApi.getAppSetting("download_dir").then((v) => setDownloadDir(v || "")).catch(() => {});
    peerApi.getAppSetting("games_enabled").then((v) => setGamesEnabled(v === "1")).catch(() => setGamesEnabled(false));
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
    const teamTrimmed = team.trim();
    if (!trimmed) return;
    const nameSame = trimmed === props.profile.display_name;
    const teamSame = teamTrimmed === (props.profile.team || "").trim();
    if (nameSame && teamSame) return;
    setSavingName(true);
    try {
      const p = await peerApi.updateDisplayName(trimmed, teamTrimmed);
      props.onNameUpdated(p);
      setStatus("Profile updated");
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
            A lightweight, secure peer-to-peer messaging app for direct communication and file sharing over your network.
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
            Get desktop alerts for new messages. Muted chats stay silent.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Profile
          </Typography>
          <Stack spacing={1.5} sx={{ mb: 1.5 }}>
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
            <TextField
              label="Team"
              size="small"
              fullWidth
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="HMIS"
              helperText="e.g. HMIS, Shakti"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveName();
                }
              }}
            />
            <Button
              variant="contained"
              disabled={
                savingName ||
                !name.trim() ||
                (name.trim() === props.profile.display_name &&
                  team.trim() === (props.profile.team || "").trim())
              }
              onClick={saveName}
              sx={{ alignSelf: "flex-start" }}
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
          Add "Share in PeerChat" to the File Explorer right-click menu to share files easily.
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
          No central server — chats live in local SQLite and deliver when peers come online.
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
