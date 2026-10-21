import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { APP_VERSION_FALLBACK, appVersion } from "../version";
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
import PauseIcon from "@mui/icons-material/PauseRounded";
import PlayArrowIcon from "@mui/icons-material/PlayArrowRounded";
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
import ChevronLeftIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightIcon from "@mui/icons-material/ChevronRightRounded";

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
} from "../peer";
import {
  MediaAlbum,
  isGridMediaName,
  isImageFileName,
  type AlbumItem,
} from "../MediaAlbum";
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
} from "../crypto";
import { EMOJI_SET, QUICK_REACTIONS, emojiOnlyCount, emojiOnlyFontSize } from "../emoji";
import { getOrCreateIdentity } from "../storage";
import { matchingCommands, SLASH_COMMANDS, type CommandContext } from "../commands";

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
} from "../panels";
import CampaignIcon from "@mui/icons-material/CampaignRounded";
import type { SavedItem, ScanResult, TransferLog } from "../peer";
import { ThemeMode } from "../theme";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { FEATURE_GAMES } from "../features";
import {
  GamesHub,
  applyInboundToSession,
  type GameDispatchFn,
  type GameMsg,
  type PendingGameInvite,
} from "../games/games";
import {
  GameInviteCard,
  matchIdOf,
  parseGameMsg,
  resolveGameCardStatus,
} from "../games/GameInviteCard";

import { RichCard } from "../features/chat/RichCard";

import {
  avatarColor,
  canMutateMessageToday,
  canPreviewFileName,
  conversationPreviewLine,
  dayKey,
  formatBytes,
  formatClock,
  formatDay,
  formatPreviewTime,
  lastSeenLabel,
  mimeForName,
  truncate,
} from "../shared/format";
import { messageAttachmentIds } from "../shared/messageMeta";
import {
  MESSAGE_PAGE_SIZE,
  mergeNewestPage,
  prependOlderPage,
} from "../shared/messagePage";
import {
  BUNDLE_MAX_BYTES,
  BUNDLE_MAX_FILES,
  FILE_FETCH_BATCH,
  type FilePreview,
  type IncomingFileState,
  type OutgoingFileState,
  type StagedFile,
} from "../shared/transferTypes";
import { NavRail, type ShellNav } from "../features/shell/NavRail";
import { ListPane } from "../features/shell/ListPane";
import { MessageList } from "../features/chat/MessageList";
import { Composer } from "../features/chat/Composer";
import type { ChatScreenVm } from "../features/chat/chatVm";
import { ScreenshotAnnotator } from "../features/screenshot/ScreenshotAnnotator";
import { PeerTrustDialogs } from "../features/peers/PeerTrustDialogs";
import { GroupCreateDialog } from "../features/groups/GroupCreateDialog";
import { GroupMembersDialog } from "../features/groups/GroupMembersDialog";
import { useGroupCrypto } from "../features/groups/useGroupCrypto";
import { useMessageDecrypt } from "../features/chat/useMessageDecrypt";
import { useChatSync } from "../features/chat/useChatSync";
import { useAnnouncementBoards } from "../features/announcements/useAnnouncementBoards";
import { useGroupAdmin } from "../features/groups/useGroupAdmin";
import { useFileTransfer } from "../features/files/useFileTransfer";
import { FilePreviewDialog } from "../features/files/FilePreviewDialog";
import { publishTransferProgress } from "../features/files/transferProgressStore";
import { appLog } from "../shared/appLog";

export function ChatScreen({
  profile: initialProfile,
  identity,
  onSettings,
  version,
  onProfileUpdated,
}: {
  profile: Profile;
  identity: Identity;
  onSettings?: () => void;
  version: string;
  onProfileUpdated?: (p: Profile) => void;
}) {
  const [profile, setProfile] = useState<Profile>(initialProfile);
  useEffect(() => {
    setProfile(initialProfile);
  }, [initialProfile]);
  useEffect(() => {
    appLog("info", "ChatScreen mounted", { profileId: profile.id });
  }, [profile.id]);

  const muiTheme = useTheme();
  const dark = muiTheme.palette.mode === "dark";
  const [peers, setPeers] = useState<Peer[]>([]);
  const [lanHosts, setLanHosts] = useState<LanHost[]>([]);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const thumbGenRef = useRef(0);
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [groupKeys, setGroupKeys] = useState<Record<string, Uint8Array>>({});
  // tab 1 = chats list (must match default nav "chats")
  const [tab, setTab] = useState(1);
  const [nav, setNav] = useState<ShellNav>("chats");
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
  const [searchHits, setSearchHits] = useState<
    { id: string; title: string; detail: string; conversationId?: string; messageId?: string }[]
  >([]);
  /** Conversation ids whose history matched the chats-sidebar query (message body). */
  const [sidebarMsgMatchIds, setSidebarMsgMatchIds] = useState<string[]>([]);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [gamesOn, setGamesOn] = useState(false);
  const filePickRef = useRef<HTMLInputElement | null>(null);
  const pauseRef = useRef(false);
  const [chatSearch, setChatSearch] = useState("");
  /** Search inside the open conversation (messages + file names). */
  const [inChatSearchOpen, setInChatSearchOpen] = useState(false);
  const [inChatQuery, setInChatQuery] = useState("");
  const inChatSearchInputRef = useRef<HTMLInputElement | null>(null);
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
  const MAX_PINNED_MESSAGES_PER_CHAT = 3;
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

  // Mirror transfer progress into a throttled store so list rows can subscribe narrowly.
  useEffect(() => {
    publishTransferProgress({ incoming: incomingFile }, true);
  }, [incomingFile]);
  useEffect(() => {
    publishTransferProgress({ outgoing: outgoingFile }, true);
  }, [outgoingFile]);

  const [msgMenu, setMsgMenu] = useState<{ anchor: HTMLElement; message: Message } | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [forwardPick, setForwardPick] = useState<string[]>([]);
  const [forwardQuery, setForwardQuery] = useState("");
  const [clearChatTarget, setClearChatTarget] = useState<Conversation | null>(null);
  const [clearIncludeFiles, setClearIncludeFiles] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    body: string;
    confirmLabel?: string;
    danger?: boolean;
    busy?: boolean;
    resolve: (ok: boolean) => void;
  } | null>(null);

  /** In-app confirm (replaces window.confirm — which can race / feel pre-deleted in WebView). */
  function askConfirm(opts: {
    title: string;
    body: string;
    confirmLabel?: string;
    danger?: boolean;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmDialog({
        title: opts.title,
        body: opts.body,
        confirmLabel: opts.confirmLabel,
        danger: opts.danger,
        busy: false,
        resolve,
      });
    });
  }

  function closeConfirmDialog(ok: boolean) {
    setConfirmDialog((cur) => {
      if (cur) cur.resolve(ok);
      return null;
    });
  }

  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [fileSizes, setFileSizes] = useState<Record<string, number>>({});
  const [fileThumbs, setFileThumbs] = useState<Record<string, string>>({});
  /** Tracks which file IDs have a saved local_path (non-empty string = downloaded). */
  const [fileLocalPaths, setFileLocalPaths] = useState<Record<string, string>>({});
  /** Attachment ids whose on-disk presence has been resolved via getFiles. */
  const [fileMetaReady, setFileMetaReady] = useState<Record<string, true>>({});
  const thumbInflightRef = useRef<Set<string>>(new Set());
  const [screenshotCaptureId, setScreenshotCaptureId] = useState<string | null>(null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const screenshotSessionRef = useRef<string | null>(null);
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
  const olderScrollAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const chatSearchRef = useRef<HTMLInputElement | null>(null);
  const groupKeysRef = useRef(groupKeys);
  groupKeysRef.current = groupKeys;
  const [groupKeyHistory, setGroupKeyHistory] = useState<Record<string, Uint8Array[]>>({});
  const groupKeyHistoryRef = useRef(groupKeyHistory);
  groupKeyHistoryRef.current = groupKeyHistory;
  const abortSendRef = useRef(false);
  const abortOpenRef = useRef(false);
  /** Soft-pause receive (keeps partial progress); cancel uses abortOpenRef + discard. */
  const pauseOpenRef = useRef(false);
  const cancelReceiveRef = useRef(false);
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
    if (!q) return convs;
    const msgHits = new Set(sidebarMsgMatchIds);
    return convs.filter((c) => {
      const title = (c.kind === "dm" ? c.peer_name : c.title) || "";
      if (title.toLowerCase().includes(q)) return true;
      const preview = (lastPreviews[c.id] || "").toLowerCase();
      if (preview.includes(q)) return true;
      return msgHits.has(c.id);
    });
  }, [convs, chatSearch, lastPreviews, sidebarMsgMatchIds]);

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

  const {
    adoptGroupKey,
    decryptGroupMessageText,
    ensureGroupKey,
    persistMyGroupWrap,
    syncGroupKeyIfRotated,
  } = useGroupCrypto({
    identity,
    profile,
    peers,
    groupKeysRef,
    groupKeyHistoryRef,
    setGroupKeys,
    setGroupKeyHistory,
  });

  async function resolveMemberIds(conv: Conversation): Promise<string[]> {
    if (conv.kind === "dm" && conv.peer_id) return [conv.peer_id, profile.id];
    return peerApi.memberIds(conv.id);
  }

  const { refresh } = useChatSync({
    setScanning,
    setPeers,
    setConvs,
    setLanHosts,
    setTransfers,
    setSavedItems,
    setGamesOn,
    setActive,
  });

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
          next[c.id] = "📎 Attachment";
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

  // Chats sidebar: also match decrypted message bodies (title/preview already covered).
  useEffect(() => {
    const q = chatSearch.trim().toLowerCase();
    if (tab !== 1 || q.length < 2) {
      setSidebarMsgMatchIds([]);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const matched: string[] = [];
        for (const c of convs) {
          if (cancel || matched.length >= 30) break;
          const title = ((c.kind === "dm" ? c.peer_name : c.title) || "").toLowerCase();
          if (title.includes(q)) continue; // already visible via title filter
          if ((lastPreviews[c.id] || "").toLowerCase().includes(q)) {
            matched.push(c.id);
            continue;
          }
          try {
            if (c.kind === "group") {
              try {
                await ensureGroupKey(c.id);
              } catch {
                continue;
              }
            }
            let beforeSortKey: string | null = null;
            let beforeId: string | null = null;
            let scanned = 0;
            let found = false;
            while (!found && scanned < 160) {
              const page = await peerApi.listMessages(c.id, {
                limit: MESSAGE_PAGE_SIZE,
                beforeSortKey,
                beforeId,
              });
              if (cancel || !page.messages.length) break;
              scanned += page.messages.length;
              for (const m of page.messages) {
                if (m.kind === "file_notice" || m.kind === "deleted" || m.kind === "poll_vote") continue;
                let textBody = "";
                try {
                  textBody =
                    c.kind === "group"
                      ? await decryptGroupMessageText(m)
                      : await decryptMessage(
                          { ...m, wrapped_keys: m.wrapped_keys || {} },
                          profile.id,
                          identity
                        );
                } catch {
                  continue;
                }
                if (textBody.toLowerCase().includes(q)) {
                  found = true;
                  matched.push(c.id);
                  break;
                }
              }
              if (!page.has_more_older) break;
              const oldest = page.messages[0]!;
              beforeSortKey = oldest.sort_at || oldest.created_at;
              beforeId = oldest.id;
            }
          } catch {
            /* skip */
          }
        }
        if (!cancel) setSidebarMsgMatchIds(matched);
      })();
    }, 280);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSearch, tab, convs, lastPreviews, identity, profile.id]);

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

        // Decrypt game_move for session + UI. Apply actionable payloads (move/reveal)
        // before result so the loser's board shows the winning move.
        if (kind === "game_move") {
          try {
            const page = await peerApi.listMessages(cid, { limit: MESSAGE_PAGE_SIZE });
            const msgs = page.messages;
            const gameRows = msgs.filter((m) => m.kind === "game_move" && m.sender_id === fromId);
            if (!gameRows.length) return;
            const peerList = await peerApi.listPeers();
            const peer = peerList.find((x) => x.user_id === fromId);
            if (!peer) return;
            const parsed: GameMsg[] = [];
            for (const row of gameRows.slice(-8)) {
              try {
                const plaintext = await decryptMessage(
                  { ...row, wrapped_keys: row.wrapped_keys || {} },
                  profile.id,
                  identity
                );
                parsed.push(JSON.parse(plaintext) as GameMsg);
              } catch {
                /* skip undecryptable */
              }
            }
            if (!parsed.length) return;
            const actionable = [...parsed]
              .reverse()
              .find((g) => {
                const t = (g.payload as { type?: string })?.type;
                return t === "move" || t === "reveal" || t === "commit" || t === "accept" || t === "invite";
              });
            const resultMsg = [...parsed]
              .reverse()
              .find((g) => (g.payload as { type?: string })?.type === "result");
            const ordered = [actionable, resultMsg].filter(Boolean) as GameMsg[];
            const toApply = ordered.length ? ordered : [parsed[parsed.length - 1]];
            for (const gameMsg of toApply) {
              applyInboundToSession(fromId, gameMsg, peerList, profile.id);
              gameDispatchRef.current?.(fromId, gameMsg);
            }
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
    setHasMoreOlder(false);
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
    thumbGenRef.current += 1;

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
      const page = await peerApi.listMessages(conv.id, { limit: MESSAGE_PAGE_SIZE });
      if (cancel) return;
      const msgs = Array.isArray(page?.messages) ? page.messages : [];
      if (isInitial) {
        setMessages(msgs);
        setHasMoreOlder(!!page?.has_more_older);
      } else {
        // Merge newest page into existing history (keep older pages loaded in memory).
        setMessages((prev) => {
          const merged = mergeNewestPage(prev, msgs);
          if (
            merged.length === prev.length &&
            merged.every(
              (m, i) =>
                m.id === prev[i].id &&
                m.kind === prev[i].kind &&
                m.delivered === prev[i].delivered &&
                m.pinned === prev[i].pinned &&
                (m.edited_at || "") === (prev[i].edited_at || "") &&
                m.queued === prev[i].queued &&
                m.failed === prev[i].failed
            )
          ) {
            return prev;
          }
          return merged;
        });
      }
      if (isInitial) {
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
    ignoreScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    stickToBottomRef.current = true;
    window.setTimeout(() => {
      ignoreScrollRef.current = false;
    }, 50);
  }

  // Keep pinned before paint when content changes (no visible jump while already revealed).
  // Do NOT depend on transfer progress ticks — those must not re-pin scroll.
  useLayoutEffect(() => {
    const el = scroller.current;
    const anchor = olderScrollAnchorRef.current;
    if (anchor && el) {
      el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
      olderScrollAnchorRef.current = null;
      return;
    }
    if (!active?.id || highlightMsgId) return;
    if (!stickToBottomRef.current) return;
    scrollChatToBottom("auto");
  }, [messages, active?.id, Object.keys(plain).length, highlightMsgId]);

  async function refreshNewestMessages(conversationId: string) {
    const page = await peerApi.listMessages(conversationId, { limit: MESSAGE_PAGE_SIZE });
    setMessages((prev) => mergeNewestPage(prev, page?.messages ?? []));
  }

  async function loadOlderMessages() {
    if (!active || loadingOlderRef.current || !hasMoreOlder || !messages.length) return;
    loadingOlderRef.current = true;
    try {
      const el = scroller.current;
      if (el) {
        olderScrollAnchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
      }
      const oldest = messages[0]!;
      const page = await peerApi.listMessages(active.id, {
        limit: MESSAGE_PAGE_SIZE,
        beforeSortKey: oldest.sort_at || oldest.created_at,
        beforeId: oldest.id,
      });
      setHasMoreOlder(!!page?.has_more_older);
      const older = page?.messages ?? [];
      if (older.length) {
        setMessages((prev) => prependOlderPage(prev, older));
      } else {
        olderScrollAnchorRef.current = null;
        setHasMoreOlder(false);
      }
    } catch (err) {
      olderScrollAnchorRef.current = null;
      console.error(err);
    } finally {
      loadingOlderRef.current = false;
    }
  }

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

  // WhatsApp-style jump + flash when opening a saved / in-chat / global-search hit.
  useEffect(() => {
    if (!highlightMsgId || !active) return;
    if (!messages.some((m) => m.id === highlightMsgId)) {
      // Target not in loaded window yet — page older history until it appears.
      if (hasMoreOlder && !loadingOlderRef.current) {
        void loadOlderMessages();
      }
      const clear = window.setTimeout(() => setHighlightMsgId(null), 12000);
      return () => window.clearTimeout(clear);
    }
    stickToBottomRef.current = false;
    requestAnimationFrame(() => {
      document.getElementById(`msg-${highlightMsgId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    const clear = window.setTimeout(() => setHighlightMsgId(null), 2800);
    return () => window.clearTimeout(clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightMsgId, active?.id, messages, hasMoreOlder]);

  useEffect(() => {
    if (!active || !messages.some((m) => m.sender_id !== profile.id)) return;
    peerApi.markConversationRead(active.id).catch(console.error);
  }, [active?.id, messages, profile.id]);

  // Ref to track active chat ID for clearing fileThumbs on switch
  const prevActiveIdRef = useRef<string | undefined>(undefined);
  
  // Clear thumbs / local-path hints when switching chats; revoke blob URLs.
  useEffect(() => {
    if (!active) {
      prevActiveIdRef.current = undefined;
      return;
    }
    if (prevActiveIdRef.current !== undefined && prevActiveIdRef.current !== active.id) {
      setFileThumbs((prev) => {
        for (const url of Object.values(prev)) {
          if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        }
        return {};
      });
      setFileLocalPaths({});
      setFileMetaReady({});
    }
    prevActiveIdRef.current = active.id;
  }, [active?.id]);

  useMessageDecrypt({
    active,
    messages,
    groupKeys,
    groupKeyHistory,
    peers,
    profile,
    identity,
    fileNames,
    fileSizes,
    decryptGroupMessageText,
    setPlain,
    setFileNames,
    setFileSizes,
    setFileLocalPaths,
    setFileMetaReady,
  });

  // Disk-cached JPEG thumbs via Rust; never decode full originals in JS for chat tiles.
  useEffect(() => {
    let cancel = false;
    const gen = thumbGenRef.current;
    (async () => {
      if (!active || messages.length === 0) return;

      const wanted: string[] = [];
      for (const m of messages) {
        if (m.kind === "deleted") continue;
        for (const fid of messageAttachmentIds(m)) {
          const name = fileNames[fid];
          if (!name || !isImageFileName(name)) continue;
          if (fileThumbs[fid] || thumbInflightRef.current.has(fid)) continue;
          if (!fileLocalPaths[fid]) continue;
          wanted.push(fid);
        }
      }

      if (wanted.length === 0) return;

      for (const fid of wanted.slice(0, 8)) {
        if (cancel || thumbGenRef.current !== gen) break;
        thumbInflightRef.current.add(fid);
        try {
          const thumb = await peerApi.ensureFileThumbnail(fid);
          if (cancel || thumbGenRef.current !== gen) break;
          const bytes = fromB64(thumb.data_b64);
          const url = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: thumb.mime || "image/jpeg" })
          );
          setFileThumbs((prev) => {
            const old = prev[fid];
            if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
            return { ...prev, [fid]: url };
          });
        } catch {
          /* thumb optional — video/docs stay as placeholders */
        } finally {
          thumbInflightRef.current.delete(fid);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [messages, fileNames, active?.id, fileThumbs, fileLocalPaths]);

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
    setInChatSearchOpen(false);
    setInChatQuery("");
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

  /** Prefer native dialog so we get real disk paths → local_path in DB. */
  async function pickAndStageFiles() {
    try {
      const picked = await openDialog({
        multiple: true,
        directory: false,
        title: "Attach files",
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length) await stageDiskPaths(paths);
    } catch {
      // Browser preview / dialog unavailable — fall back to HTML picker.
      filePickRef.current?.click();
    }
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
            previewUrl: isImageFileName(meta.name) ? convertFileSrc(meta.path) : null,
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
    if (totalBytes > 500 * 1024 * 1024) {
      const ok = await askConfirm({
        title: "Pack large folder?",
        body: `This will pack ~${formatBytes(totalBytes)} locally before sending (${entries.length} files). Continue?`,
        confirmLabel: "Pack & send",
      });
      if (!ok) return;
    }
    setStatus(`Packing folder… 0/${entries.length}`);
    let unlistenPack: (() => void) | undefined;
    try {
      unlistenPack = await listen<{
        done_files: number;
        total_files: number;
        bytes: number;
      }>("bundle-pack-progress", (ev) => {
        const { done_files, total_files, bytes } = ev.payload;
        setStatus(`Packing folder… ${done_files}/${total_files} (${formatBytes(bytes)})`);
      });
      const packed = await peerApi.packBundle(
        entries.map((e) => ({ abs_path: e.abs_path, rel_path: e.rel_path }))
      );
      setStatus(`Packed ${packed.name} — sending…`);
      await sendFile({ path: packed.path, name: packed.name, size: packed.size });
      await peerApi.deleteBundleFile(packed.path).catch(() => {});
    } finally {
      unlistenPack?.();
    }
  }

  function discardStagedCapture(sf: StagedFile | undefined) {
    if (sf?.captureId) {
      void peerApi.discardCapture(sf.captureId).catch(() => {});
    }
  }

  function removeStagedFile(id: string) {
    setStagedFiles((prev) => {
      const found = prev.find((f) => f.id === id);
      if (found?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(found.previewUrl);
      discardStagedCapture(found);
      return prev.filter((f) => f.id !== id);
    });
  }

  function clearStagedFiles() {
    setStagedFiles((prev) => {
      for (const f of prev) {
        if (f.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(f.previewUrl);
        discardStagedCapture(f);
      }
      return [];
    });
  }

  async function stageCapturePath(path: string, name: string, captureId: string) {
    try {
      const meta = await peerApi.localPathMeta(path);
      const previewUrl = URL.createObjectURL(
        // Preview from disk via read is heavy; use empty preview and let send use path.
        // Prefer object URL from capture preview when available.
        new Blob([])
      );
      URL.revokeObjectURL(previewUrl);
      let thumb: string | null = null;
      try {
        const prev = await peerApi.readCapturePreview(captureId);
        const bin = Uint8Array.from(atob(prev.data_b64), (c) => c.charCodeAt(0));
        thumb = URL.createObjectURL(new Blob([bin], { type: prev.mime || "image/png" }));
      } catch {
        thumb = null;
      }
      setStagedFiles((prev) => [
        ...prev,
        {
          id: `${name}-${meta.size}-${Math.random().toString(16).slice(2)}`,
          source: { path: meta.path, name: meta.name || name, size: meta.size },
          name: name || meta.name,
          size: meta.size,
          isDir: false,
          previewUrl: thumb,
          captureId,
        },
      ]);
    } catch (err: any) {
      setStatus(err?.message || "Could not attach screenshot");
      await peerApi.discardCapture(captureId).catch(() => {});
    }
  }

  async function startScreenshotCapture() {
    if (!active || screenshotBusy || screenshotCaptureId) return;
    if (outgoingFile && !outgoingFile.cancelled) return;
    if (editingMessage) return;
    setScreenshotBusy(true);
    try {
      // Clear any leftover overlay from a previous failed attempt.
      await peerApi.cancelScreenshotSession(screenshotSessionRef.current).catch(() => {});
      const { sessionId } = await peerApi.beginScreenshotSession();
      screenshotSessionRef.current = sessionId;
    } catch (err: any) {
      screenshotSessionRef.current = null;
      setStatus(err?.message || String(err));
      await peerApi.cancelScreenshotSession(null).catch(() => {});
    } finally {
      setScreenshotBusy(false);
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ captureId: string }>("screenshot-captured", (ev) => {
      const id = ev.payload?.captureId;
      if (!id) return;
      screenshotSessionRef.current = null;
      setScreenshotCaptureId(id);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== "s") return;
      if (!active || editingMessage || screenshotBusy || screenshotCaptureId) return;
      if (outgoingFile && !outgoingFile.cancelled) return;
      e.preventDefault();
      void startScreenshotCapture();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, editingMessage, screenshotBusy, screenshotCaptureId, outgoingFile?.cancelled]);

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
      await refreshNewestMessages(active.id);
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function togglePinMessage(message: Message) {
    if (!active) return;
    setMsgMenu(null);
    try {
      if (!message.pinned) {
        const pinnedCount = messages.filter((m) => m.pinned && m.kind !== "deleted").length;
        if (pinnedCount >= MAX_PINNED_MESSAGES_PER_CHAT ) {
          setStatus(`Pin limit reached (${MAX_PINNED_MESSAGES_PER_CHAT}). Unpin a message first.`);
          return;
        }
      }
      await sendControlMessage(active, message.pinned ? "unpin" : "pin", message.id);
      await refreshNewestMessages(active.id);
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
        if (active?.id === target.id) await refreshNewestMessages(target.id);
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
      if (!conv.pinned_at) {
        const pinnedChats = convs.filter((c) => !!c.pinned_at).length;
        if (pinnedChats >= 10) {
          setStatus("Pin limit reached (10 chats). Unpin a chat first.");
          return;
        }
      }
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
    extra?: { file_id?: string | null; attachments?: string[] | null }
  ) {
    if (!active || !body.trim()) return;
    const peer = active.kind === "dm" ? peers.find((p) => p.user_id === active.peer_id) : undefined;
    const attachments =
      extra?.attachments?.filter(Boolean) ??
      (extra?.file_id ? [extra.file_id] : null);
    const fileId = attachments?.[0] ?? extra?.file_id ?? null;
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
        file_id: fileId,
        attachments: attachments ?? [],
      };
    } else {
      const gk = await ensureGroupKey(active.id);
      const enc = await encryptWithGroupKey(body.trim(), active.id, profile.id, gk, identity);
      message = {
        kind,
        sender_id: profile.id,
        ...enc,
        reply_to: replyToId ?? null,
        file_id: fileId,
        attachments: attachments ?? [],
      };
    }
    const memberIds = await resolveMemberIds(active);
    await peerApi.sendMessage(
      active.id,
      message,
      memberIds.filter((id) => id !== profile.id)
    );
    await refreshNewestMessages(active.id);
  }

  /** One logical message for files (± optional caption). */
  async function sendAttachmentBundle(
    fileIds: string[],
    caption: string,
    replyToId?: string
  ) {
    if (!active || !fileIds.length) return;
    const memberIds = await resolveMemberIds(active);
    const recipients = memberIds.filter((id) => id !== profile.id);
    if (caption.trim()) {
      await sendEncrypted("text", caption.trim(), replyToId, {
        file_id: fileIds[0],
        attachments: fileIds,
      });
      return;
    }
    // Files-only: file_notice carrying the full attachment list.
    const message = {
      kind: "file_notice",
      sender_id: profile.id,
      ciphertext: "",
      nonce: "",
      wrapped_keys: {},
      signature: "",
      file_id: fileIds[0],
      attachments: fileIds,
      reply_to: replyToId ?? null,
    };
    await peerApi.sendMessage(active.id, message, recipients);
    await refreshNewestMessages(active.id);
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
    await refreshNewestMessages(active.id);
  }

  async function submitComposer() {
    if (!active) return;
    // While a file is staging, only allow plain text (attach stays locked).
    const files =
      editingMessage || (outgoingFile && !outgoingFile.cancelled) ? [] : stagedFiles;
    const body = text.trim();
    const replyId = replyTo?.id;
    if (!files.length && !body) return;
    if (active) draftsRef.current[active.id] = "";
    setText("");
    setReplyTo(null);
    if (editingMessage) {
      for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      if (body) await sendText(body, replyId);
      else setEditingMessage(null);
      return;
    }
    setEditingMessage(null);
    if (!files.length) {
      if (body) await sendText(body, replyId);
      return;
    }
    // Scan the complete selection before uploading anything. This prevents one
    // warning dialog per file and lets the user make one informed batch decision.
    const scanCandidates: Array<{ name: string; path: string }> = [];
    for (const sf of files) {
      const src = sf.source;
      if (sf.isDir && !(src instanceof File)) {
        // Include files inside selected folders in the same batch preflight.
        try {
          const entries = await peerApi.listDirectoryFiles(src.path);
          for (const entry of entries) {
            // listDirectoryFiles returns { abs_path, rel_path, size }.
            // Use the absolute path for scanning and the relative path for display.
            const path = entry.abs_path;
            if (path) {
              const name = entry.rel_path || path.split(/[/\\]/).pop() || path;
              scanCandidates.push({ name, path });
            }
          }
        } catch (err: any) {
          setStatus(`Could not scan folder ${src.name}: ${err?.message || String(err)}`);
          return;
        }
      } else {
        const path = src instanceof File
          ? (src as File & { path?: string }).path || ""
          : src.path;
        if (path) scanCandidates.push({ name: sf.name.replace(/\/$/, ""), path });
      }
    }

    const flaggedFiles: Array<{ name: string; detail: string }> = [];
    const scanFailures: string[] = [];
    for (const candidate of scanCandidates) {
      try {
        const result = await peerApi.scanFile(candidate.path);
        if (!result.clean) flaggedFiles.push({ name: candidate.name, detail: result.detail });
      } catch (err: any) {
        // Keep the existing non-blocking scanner-failure policy, but make it visible.
        scanFailures.push(candidate.name);
        console.warn(`Virus scan failed for ${candidate.name}`, err);
      }
    }

    if (flaggedFiles.length) {
      const confirmed = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          setScanWarn(null);
          resolve(value);
        };
        setScanWarn({
          title: `Scanner warning — ${flaggedFiles.length} file${flaggedFiles.length === 1 ? "" : "s"}`,
          detail: flaggedFiles.map((f) => `${f.name}\n${f.detail}`).join("\n\n"),
          body: `Windows Defender reported a concern for ${flaggedFiles.length === 1 ? "this file" : "these files"}. This can be a false positive. Sending will still encrypt and deliver ${flaggedFiles.length === 1 ? "it" : "them"}; the recipient's scanner may also warn.`,
          proceedLabel: "Send anyway",
          onProceed: () => finish(true),
          onCancel: () => finish(false),
        });
      });
      if (!confirmed) {
        setStatus("Nothing sent — batch cancelled after virus scan warning.");
        return;
      }
    }
    if (scanFailures.length) {
      setStatus(`Warning: virus scan unavailable for ${scanFailures.length} file${scanFailures.length === 1 ? "" : "s"}; continuing.`);
    }

    // Clear the composer only after preflight succeeds, so a cancelled batch
    // remains staged and the user can remove files or try again.
    const captureIds = files.map((f) => f.captureId).filter(Boolean) as string[];
    // Clear UI staging without discarding capture temps yet (send still needs the paths).
    if (!outgoingFile || outgoingFile.cancelled) {
      setStagedFiles((prev) => {
        for (const f of prev) {
          if (
            f.previewUrl?.startsWith("blob:") &&
            !files.some((x) => x.id === f.id && x.previewUrl === f.previewUrl)
          ) {
            URL.revokeObjectURL(f.previewUrl);
          }
        }
        return [];
      });
    }

    // Upload all attachments, then post ONE message (caption + files together).
    queueAbortRef.current = false;
    const fileIds: string[] = [];
    /** Capture temps to promote into durable outgoing cache before discard. */
    const capturePromotions: {
      fileId: string;
      captureId: string;
      sourcePath: string;
      name: string;
    }[] = [];
    const keptPreviewUrls = new Set<string>();
    const sendables = files.filter((sf) => !(sf.isDir && !(sf.source instanceof File)));
    let batchPos = 0;
    for (const sf of files) {
      if (queueAbortRef.current) break;
      const src = sf.source;
      if (sf.isDir && !(src instanceof File)) {
        if (sf.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(sf.previewUrl);
        try {
          await packFolderAndSend(src.path, src.name);
        } catch (err: any) {
          setStatus(err?.message || String(err));
        }
        continue;
      }
      batchPos += 1;
      const id = await sendFile(src, {
        skipNotice: true,
        batchIndex: batchPos,
        batchTotal: sendables.length,
      });
      if (id) {
        fileIds.push(id);
        setFileNames((s) => ({ ...s, [id]: sf.name }));
        setFileSizes((s) => ({ ...s, [id]: sf.size }));
        if (sf.previewUrl && isImageFileName(sf.name)) {
          if (sf.previewUrl.startsWith("blob:")) keptPreviewUrls.add(sf.previewUrl);
          setFileThumbs((s) => ({ ...s, [id]: sf.previewUrl! }));
        }
        if (sf.captureId && !(src instanceof File) && src.path) {
          capturePromotions.push({
            fileId: id,
            captureId: sf.captureId,
            sourcePath: src.path,
            name: sf.name,
          });
        }
      }
    }
    for (const f of files) {
      if (f.previewUrl?.startsWith("blob:") && !keptPreviewUrls.has(f.previewUrl)) {
        URL.revokeObjectURL(f.previewUrl);
      }
    }
    if (fileIds.length) {
      try {
        await sendAttachmentBundle(fileIds, body, replyId);
        // Brief status — keep it short so the toast doesn't dominate the composer.
        setStatus(
          body
            ? `Sent with ${fileIds.length} file${fileIds.length > 1 ? "s" : ""}`
            : `Sent ${fileIds.length} file${fileIds.length > 1 ? "s" : ""}`
        );
        // Keep annotated screenshots on disk (outgoing cache) so thumbs survive
        // chat switches; only then discard temp captures/.
        const discarded = new Set<string>();
        for (const item of capturePromotions) {
          try {
            const durable = await peerApi.persistOutgoingFromPath(
              item.fileId,
              item.sourcePath,
              item.name
            );
            setFileLocalPaths((prev) => ({ ...prev, [item.fileId]: durable }));
            await peerApi.discardCapture(item.captureId);
            discarded.add(item.captureId);
          } catch (err) {
            console.warn("persistOutgoingFromPath failed; keeping capture temp", err);
          }
        }
        for (const cid of captureIds) {
          // Do not discard captures we failed to promote — local_path still points there.
          if (discarded.has(cid) || capturePromotions.some((p) => p.captureId === cid)) continue;
          void peerApi.discardCapture(cid).catch(() => {});
        }
      } catch (err: any) {
        setStatus(err?.message || String(err));
      }
    } else if (body) {
      await sendText(body, replyId);
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
    // `messages` is already scoped to the active chat (cleared on switch). Do not
    // filter by conversation_id — DM history can span related legacy ids.
    const visible = active ? messages.filter((m) => m.kind !== "poll_vote") : [];
    const out: { day: string; label: string; items: Message[] }[] = [];
    for (const m of visible) {
      const day = dayKey(m.created_at);
      const last = out[out.length - 1];
      if (!last || last.day !== day) out.push({ day, label: formatDay(m.created_at), items: [m] });
      else last.items.push(m);
    }
    return out;
  }, [messages, active?.id]);

  const inChatHits = useMemo(() => {
    if (!active || !inChatSearchOpen) return [];
    const q = inChatQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    const hits: {
      messageId: string;
      kind: "text" | "file" | "media";
      preview: string;
      at: string;
      sender: string;
    }[] = [];
    const seen = new Set<string>();
    for (const m of messages) {
      if (m.conversation_id !== active.id) continue;
      if (m.kind === "deleted" || m.kind === "poll_vote" || m.kind === "reaction") continue;
      const sender = m.sender_id === profile.id ? "You" : senderLabel(m.sender_id);
      const fileIds = messageAttachmentIds(m);
      for (const fid of fileIds) {
        const name = fileNames[fid] || "";
        if (!name || !name.toLowerCase().includes(q)) continue;
        const key = `${m.id}:file:${fid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          messageId: m.id,
          kind: isGridMediaName(name) ? "media" : "file",
          preview: name,
          at: m.created_at,
          sender,
        });
      }
      if (m.kind !== "file_notice") {
        let body = plain[m.id] || "";
        if (m.kind === "announcement" || m.kind === "snippet" || m.kind === "poll") {
          try {
            const parsed = JSON.parse(body);
            body = [parsed.title, parsed.body, parsed.filename]
              .filter(Boolean)
              .join(" · ");
          } catch {
            /* keep raw */
          }
        }
        if (body.toLowerCase().includes(q)) {
          const key = `${m.id}:text`;
          if (!seen.has(key)) {
            seen.add(key);
            hits.push({
              messageId: m.id,
              kind: "text",
              preview: body.replace(/\s+/g, " ").trim().slice(0, 140),
              at: m.created_at,
              sender,
            });
          }
        }
      }
      if (hits.length >= 60) break;
    }
    return hits;
  }, [
    active,
    inChatSearchOpen,
    inChatQuery,
    messages,
    plain,
    fileNames,
    profile.id,
    members,
    peers,
  ]);

  function jumpToInChatHit(messageId: string) {
    setHighlightMsgId(messageId);
    stickToBottomRef.current = false;
    requestAnimationFrame(() => {
      document.getElementById(`msg-${messageId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  const {
    abortOutgoingTransfer,
    abortIncomingTransfer,
    dismissOutgoingTransfer,
    dismissIncomingTransfer,
    pauseOutgoingTransfer,
    resumeOutgoingTransfer,
    pauseIncomingTransfer,
    resumeIncomingTransfer,
    closeFilePreview,
  } = useFileTransfer({
    outgoingFile,
    incomingFile,
    setOutgoingFile,
    setIncomingFile,
    setFilePreview,
    setFileThumbs,
    setPreviewBusy,
    setStatus,
    abortSendRef,
    queueAbortRef,
    pauseRef,
    cancelReceiveRef,
    pauseOpenRef,
    abortOpenRef,
  });

  async function retryOutgoingTransfer() {
    const cur = outgoingFile;
    if (!cur?.cancelled || !cur.sourcePath) {
      setStatus("Re-attach the file to send again.");
      return;
    }
    const path = cur.sourcePath;
    const name = cur.name;
    const size = cur.sizeBytes || 0;
    setOutgoingFile(null);
    try {
      await sendFile({ path, name, size });
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function retryIncomingTransfer() {
    const cur = incomingFile;
    if (!cur?.cancelled || !cur.fileId) return;
    const uploaderId = cur.uploaderId || profile.id;
    setIncomingFile(null);
    cancelReceiveRef.current = false;
    abortOpenRef.current = false;
    pauseOpenRef.current = false;
    await downloadFileToDownloads(cur.fileId, uploaderId, { openAfter: true });
  }

  /**
   * Open attachment from disk when we already have it (sender original / prior download).
   * Otherwise download once, then open with the OS viewer — no re-download on later clicks.
   */
  async function openAttachment(fileId: string, uploaderId: string) {
    if (incomingFile?.fileId === fileId) {
      if (incomingFile.paused) {
        pauseOpenRef.current = false;
        abortOpenRef.current = false;
        cancelReceiveRef.current = false;
        setIncomingFile((f) =>
          f ? { ...f, paused: false, label: "Downloading…" } : f
        );
        await downloadFileToDownloads(fileId, uploaderId, { openAfter: true });
      } else {
        abortIncomingTransfer();
      }
      return;
    }
    try {
      const file = await peerApi.getFile(fileId);
      if (!file) throw new Error("File metadata missing");
      const name = fileNames[fileId] || "";
      // Route previewable files (images, PDFs, etc.) through the in-app previewer.
      if (name && canPreviewFileName(name)) {
        const galleryFileIds = messages
          .filter((m) => m.conversation_id === active?.id && messageAttachmentIds(m).some(
            (id) => { const n = fileNames[id]; return n && canPreviewFileName(n); }
          ))
          .flatMap((m) => messageAttachmentIds(m))
          .filter((id) => { const n = fileNames[id]; return n && canPreviewFileName(n); });
        const index = galleryFileIds.indexOf(fileId);
        const gallery = galleryFileIds.length > 1
          ? { fileIds: galleryFileIds, index: Math.max(0, index) }
          : undefined;
        await previewFile(fileId, uploaderId, gallery);
        return;
      }
      if (file.local_path) {
        try {
          await peerApi.openLocalFile(fileId);
          setStatus(`Opened ${name || "file"}`);
          return;
        } catch {
          // Stale path — fall through to rebuild from staging / peer.
        }
      }
      // Sender: rebuild from our encrypted staging (and pin local_path), don't give up.
      // Receiver: download from the uploader peer.
      await downloadFileToDownloads(fileId, uploaderId, { openAfter: true });
    } catch (err: any) {
      if (String(err?.message || err) !== "aborted" && String(err?.message || err) !== "paused") {
        setStatus(err?.message || String(err));
      }
    }
  }

  async function retrySend(message: Message) {
    try {
      await peerApi.retryMessage(message.id);
      if (active) await refreshNewestMessages(active.id);
      setStatus("Retrying…");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function deleteForMe(message: Message) {
    setMsgMenu(null);
    try {
      await peerApi.deleteMessageForMe(message.id);
      if (active) await refreshNewestMessages(active.id);
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
      if (active) await refreshNewestMessages(active.id);
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
    const terminal =
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "interrupted" ||
      row.status === "cancelled";
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
    opts?: { skipNotice?: boolean; batchIndex?: number; batchTotal?: number }
  ): Promise<string | undefined> {
    if (!active) return undefined;
    const name = file instanceof File ? file.name : file.name;
    const size = file instanceof File ? file.size : file.size;
    const conversationId = active.id;

    // Outgoing virus scanning is performed once for the whole selected batch in
    // submitComposer(), before any file is uploaded. Keep this function transfer-only.
    const chunkCount = Math.max(1, Math.ceil(size / CHUNK_SIZE));
    const transferId = `send-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const started = new Date().toISOString();
    abortSendRef.current = false;
    pauseRef.current = false;
    let fileId: string | undefined;
    const sourcePath =
      file instanceof File ? (file as File & { path?: string }).path || undefined : file.path;
    setOutgoingFile({
      conversationId,
      name,
      done: 0,
      total: chunkCount,
      sourcePath,
      sizeBytes: size,
      paused: false,
      cancelled: false,
      batchIndex: opts?.batchIndex,
      batchTotal: opts?.batchTotal,
    });
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
      setOutgoingFile((o) =>
        o
          ? {
              ...o,
              fileId,
              sourcePath: sourcePath || o.sourcePath,
              cancelled: false,
              paused: false,
            }
          : o
      );
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

      const pickedPath =
        file instanceof File ? (file as File & { path?: string }).path || "" : file.path;

      if (pickedPath) {
        // Fast path: native Rust encrypt+stage (no Base64 IPC per chunk).
        let unlistenStage: (() => void) | undefined;
        try {
          unlistenStage = await listen<{
            file_id: string;
            done: number;
            total: number;
            bytes_done: number;
          }>("file-stage-progress", (ev) => {
            if (ev.payload.file_id !== fileId) return;
            if (abortSendRef.current) return;
            setOutgoingFile((prev) => {
              if (!prev || prev.cancelled) return prev;
              return {
                ...prev,
                conversationId,
                fileId,
                name,
                done: ev.payload.done,
                total: ev.payload.total || chunkCount,
                // Preserve paused so spinner stays off while Rust parks.
                paused: prev.paused,
              };
            });
            sentBytes = Number(ev.payload.bytes_done) || sentBytes;
          });
          const staged = await peerApi.stageOutgoingFromPath(
            fileId,
            pickedPath,
            b64(contentKey)
          );
          if (abortSendRef.current) throw new Error("aborted");
          sentBytes = Number(staged.bytes_written) || size;
          setOutgoingFile({
            conversationId,
            fileId,
            name,
            done: staged.chunk_count || chunkCount,
            total: chunkCount,
          });
        } finally {
          unlistenStage?.();
        }
      } else {
        // Path-less File blob (rare HTML picker) — keep JS chunk loop.
        const hasher = newContentHasher();
        for (let i = 0; i < chunkCount; i++) {
          while (pauseRef.current) {
            if (abortSendRef.current) throw new Error("aborted");
            await new Promise((r) => setTimeout(r, 200));
          }
          if (abortSendRef.current) throw new Error("aborted");
          const buf = await readNextPlainChunk(
            file instanceof File ? file : { path: (file as { path: string }).path },
            i * CHUNK_SIZE
          );
          hasher.update(buf);
          const { nonce, ciphertextB64 } = encryptChunk(contentKey, buf, i);
          await peerApi.writeFileChunk(fileId, i, ciphertextB64, nonce);
          sentBytes += buf.length;
          if (i === 0 || i + 1 === chunkCount || (i + 1) % 4 === 0) {
            setOutgoingFile((prev) => ({
              conversationId,
              fileId,
              name,
              done: i + 1,
              total: chunkCount,
              paused: prev?.paused,
            }));
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
        await peerApi.setFileContentHash(fileId, finishHasher(hasher));
        // Cache small path-less blobs only — never arrayBuffer a multi‑GB File.
        if (file instanceof File && size > 0 && size <= 32 * 1024 * 1024) {
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            await peerApi.cacheOutgoingPlain(fileId, name, b64(bytes));
          } catch (cacheErr) {
            console.warn("cacheOutgoingPlain failed", cacheErr);
          }
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
      if (!opts?.skipNotice) {
        await peerApi.sendFileNotice(
          conversationId,
          fileId,
          memberIds.filter((id) => id !== profile.id)
        );
        await refreshNewestMessages(conversationId);
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
        // Staging may already be purged by abortOutgoingTransfer; ignore missing file.
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
          status: "cancelled",
          size_bytes: size,
          file_id: fileId,
          error: "Cancelled",
          conversation_id: conversationId,
          peer_label: labelForConversation(conversationId),
          started_at: started,
        });
        setOutgoingFile((o) =>
          o
            ? {
                ...o,
                fileId: fileId || o.fileId,
                name,
                cancelled: true,
                paused: false,
                sourcePath: sourcePath || o.sourcePath,
                sizeBytes: size,
              }
            : {
                conversationId,
                fileId,
                name,
                done: 0,
                total: chunkCount,
                cancelled: true,
                paused: false,
                sourcePath,
                sizeBytes: size,
              }
        );
        setStatus("Send cancelled");
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
        setOutgoingFile(null);
      }
      return undefined;
    } finally {
      // Keep cancelled bubble visible; clear only after success / non-cancel failure.
      setOutgoingFile((o) => (o?.cancelled ? o : null));
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
    setIncomingFile({
      fileId,
      conversationId: active?.id,
      name,
      done: 0,
      total: totalChunks,
      label: "Opening…",
    });
    const parts: Uint8Array[] = [];
    for (let i = 0; i < totalChunks; ) {
      if (abortOpenRef.current) throw new Error("aborted");
      const n = Math.min(FILE_FETCH_BATCH, totalChunks - i);
      const batch = await peerApi.fetchFileChunks(fileId, i, n, uploaderId);
      for (const chunk of batch) {
        const idx = Number(chunk.index ?? i);
        parts.push(
          decryptChunk(
            key,
            chunk.nonce,
            fromB64(chunk.data_b64),
            cryptoV >= 2 ? idx : undefined
          )
        );
        i = idx + 1;
        if (i === 1 || i === totalChunks || i % 4 === 0) {
          setIncomingFile({
            fileId,
            conversationId: active?.id,
            name,
            done: i,
            total: totalChunks,
            label: "Opening…",
          });
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (!batch.length) break;
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

  async function previewFile(
    fileId: string,
    uploaderId: string,
    gallery?: { fileIds: string[]; index: number }
  ) {
    // Prefer known name so zip/exe never enter the preview path.
    const known = fileNames[fileId];
    if (known && !canPreviewFileName(known)) {
      await downloadFileToDownloads(fileId, uploaderId);
      return;
    }

    setPreviewBusy(true);
    setStatus("");
    try {
      // Step 1: ensure the file is on disk first (download if needed).
      // This shows the progress bar and saves local_path so future opens are offline.
      const fileMeta = await peerApi.getFile(fileId);
      if (!fileMeta) throw new Error("File metadata missing");

      let localPath = fileMeta.local_path;
      if (!localPath) {
        // Not yet downloaded — download it fully before showing the preview.
        // downloadFileToDownloads manages its own setPreviewBusy/setIncomingFile.
        setPreviewBusy(false);
        await downloadFileToDownloads(fileId, uploaderId);
        // After download, re-fetch meta to get the local_path.
        const updated = await peerApi.getFile(fileId);
        localPath = updated?.local_path ?? null;
        if (!localPath) return; // download was cancelled/failed
        setPreviewBusy(true);
      }

      // Step 2: decrypt from the local file for the in-memory blob/preview.
      const { file, name, data } = await decryptFile(fileId, uploaderId);
      if (abortOpenRef.current) return;
      if (!canPreviewFileName(name)) {
        // Shouldn't happen since we checked above, but be safe.
        return;
      }
      const mime = mimeForName(name);
      const bytes = new Uint8Array(data);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      if (isGridMediaName(name)) {
        setFileThumbs((prev) => {
          const old = prev[fileId];
          if (old && old.startsWith("blob:") && old !== url) URL.revokeObjectURL(old);
          return { ...prev, [fileId]: url };
        });
      }
      setFilePreview((current) => {
        if (current && current.url !== url) {
          setFileThumbs((thumbs) => {
            if (thumbs[current.fileId] !== current.url) {
              URL.revokeObjectURL(current.url);
            }
            return thumbs;
          });
        }
        return {
          fileId,
          uploaderId,
          name,
          url,
          mime,
          data,
          localPath: file.local_path,
          gallery,
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

  async function previewGalleryStep(delta: number) {
    if (!filePreview?.gallery || !active) return;
    const { fileIds, index } = filePreview.gallery;
    const next = (index + delta + fileIds.length) % fileIds.length;
    const fid = fileIds[next];
    const msg = messages.find((m) => messageAttachmentIds(m).includes(fid));
    const uploaderId = msg?.sender_id || filePreview.uploaderId;
    await previewFile(fid, uploaderId, { fileIds, index: next });
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
      setFileLocalPaths((prev) => ({ ...prev, [filePreview.fileId]: path }));
      setFileMetaReady((prev) => ({ ...prev, [filePreview.fileId]: true }));
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

  async function downloadFileToDownloads(
    fileId: string,
    uploaderId: string,
    opts?: { openAfter?: boolean }
  ) {
    setPreviewBusy(true);
    setStatus("Downloading…");
    abortOpenRef.current = false;
    pauseOpenRef.current = false;
    cancelReceiveRef.current = false;
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
        try {
          await peerApi.openLocalFile(fileId);
          setStatus(`Opened ${name}`);
          return;
        } catch {
          /* path gone — re-download */
        }
      }
      const totalChunks = Math.max(1, Number(file.chunk_count) || 1);
      const cryptoV = Number(file.file_crypto_v) || 1;
      const progress = await peerApi.beginFileReceive(fileId);
      let next = Number(progress.next_index) || 0;
      const convId = active?.id;
      setIncomingFile({
        fileId,
        conversationId: convId,
        name,
        done: next,
        total: totalChunks,
        label: "Downloading…",
        paused: false,
        cancelled: false,
        uploaderId,
      });
      await recordTransfer({
        id: transferId,
        filename: name,
        direction: "recv",
        status: next > 0 ? "transferring" : "connecting",
        size_bytes: Number(file.size_bytes) || 0,
        bytes_done: next * CHUNK_SIZE,
        file_id: fileId,
        conversation_id: convId,
        peer_label: senderLabel(uploaderId),
        started_at: started,
      });
      // Prefer one TLS binary stream (IPMsg-style); fall back to chunk HTTP for old peers.
      let usedStream = false;
      if (next < totalChunks && !abortOpenRef.current) {
        let unlistenStream: (() => void) | undefined;
        try {
          let lastUi = 0;
          unlistenStream = await listen<{
            file_id: string;
            done: number;
            total: number;
          }>("file-stream-progress", (ev) => {
            if (ev.payload.file_id !== fileId) return;
            const snap = {
              fileId,
              conversationId: convId,
              name,
              done: ev.payload.done,
              total: ev.payload.total || totalChunks,
              label: "Downloading…" as const,
            };
            // Store updates ~8 Hz for the progress chrome; React state less often.
            publishTransferProgress({ incoming: snap });
            const now = Date.now();
            if (now - lastUi > 250) {
              lastUi = now;
              setIncomingFile(snap);
            }
          });
          const streamed = await peerApi.downloadFileStream(
            fileId,
            uploaderId,
            b64(key),
            next
          );
          if (abortOpenRef.current) {
            throw new Error(cancelReceiveRef.current ? "aborted" : "paused");
          }
          next = Number(streamed.next_index) || totalChunks;
          usedStream = next >= totalChunks;
          setIncomingFile({
            fileId,
            conversationId: convId,
            name,
            done: next,
            total: totalChunks,
            label: "Downloading…",
          });
        } catch (streamErr: any) {
          usedStream = false;
          // Resume chunk path from whatever stream already wrote.
          try {
            const prog = await peerApi.getReceiveProgress(fileId);
            next = Number(prog.next_index) || next;
          } catch {
            /* keep next */
          }
          const streamMsg = String(streamErr?.message || streamErr || "");
          if (pauseOpenRef.current && !cancelReceiveRef.current) {
            throw new Error("paused");
          }
          if (abortOpenRef.current && cancelReceiveRef.current) {
            throw new Error("aborted");
          }
          // Mid-stream cancel from pause/stop (Rust cancel_file_stream).
          if (/cancelled/i.test(streamMsg)) {
            throw new Error(cancelReceiveRef.current ? "aborted" : "paused");
          }
          // Clear soft abort so chunk fallback can continue after a stream drop.
          abortOpenRef.current = false;
        } finally {
          unlistenStream?.();
        }
      }
      if (!usedStream && next < totalChunks) {
        for (let i = next; i < totalChunks; ) {
          while (pauseOpenRef.current) {
            if (abortOpenRef.current) {
              throw new Error(cancelReceiveRef.current ? "aborted" : "paused");
            }
            await new Promise((r) => setTimeout(r, 200));
          }
          if (abortOpenRef.current) {
            throw new Error(cancelReceiveRef.current ? "aborted" : "paused");
          }
          const n = Math.min(FILE_FETCH_BATCH, totalChunks - i);
          let batch;
          try {
            batch = await peerApi.fetchFileChunks(fileId, i, n, uploaderId);
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
          for (const chunk of batch) {
            const idx = Number(chunk.index ?? i);
            while (pauseOpenRef.current) {
              if (abortOpenRef.current) {
                throw new Error(cancelReceiveRef.current ? "aborted" : "paused");
              }
              await new Promise((r) => setTimeout(r, 200));
            }
            if (abortOpenRef.current) {
              throw new Error(cancelReceiveRef.current ? "aborted" : "paused");
            }
            const plain = decryptChunk(
              key,
              chunk.nonce,
              fromB64(chunk.data_b64),
              cryptoV >= 2 ? idx : undefined
            );
            await peerApi.appendFileReceive(fileId, idx, b64(plain));
            i = idx + 1;
            setIncomingFile({
              fileId,
              conversationId: convId,
              name,
              done: i,
              total: totalChunks,
              label: "Downloading…",
              paused: false,
            });
          }
          if (!batch.length) break;
        }
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
      // Record local path so the UI immediately knows this file is saved.
      setFileLocalPaths((prev) => ({ ...prev, [fileId]: path }));
      setFileMetaReady((prev) => ({ ...prev, [fileId]: true }));
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
            title: "Scanner warning",
            detail: scanResult.detail,
            body:
              "Windows Defender reported a concern for this downloaded file. It is still saved so you can open or delete it. Treat unexpected files from unknown peers with caution.",
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
      if (opts?.openAfter) {
        try {
          await peerApi.openLocalFile(fileId);
          setStatus(`Downloaded & opened (${verifyNote})`);
        } catch {
          setStatus(`Saved (${verifyNote}${scanNote ? ` · ${scanNote}` : ""}): ${path}`);
        }
      } else {
        setStatus(`Saved (${verifyNote}${scanNote ? ` · ${scanNote}` : ""}): ${path}`);
      }
    } catch (err: any) {
      const raw = String(err?.message || err);
      if (raw === "paused") {
        await recordTransfer({
          id: transferId,
          filename: name,
          direction: "recv",
          status: "interrupted",
          file_id: fileId,
          error: "Paused — click the file again to resume",
          peer_label: senderLabel(uploaderId),
          started_at: started,
        });
        setStatus("Download paused — click resume or the file again");
        setIncomingFile((f) =>
          f
            ? { ...f, paused: true, label: "Paused" }
            : {
                fileId,
                conversationId: active?.id,
                name,
                done: 0,
                total: 1,
                label: "Paused",
                paused: true,
              }
        );
        setPreviewBusy(false);
        abortOpenRef.current = false;
        return;
      }
      if (raw === "aborted") {
        await peerApi.discardFileReceive(fileId).catch(() => {});
        await recordTransfer({
          id: transferId,
          filename: name,
          direction: "recv",
          status: "cancelled",
          file_id: fileId,
          error: "Cancelled",
          peer_label: senderLabel(uploaderId),
          started_at: started,
        });
        setIncomingFile((f) =>
          f
            ? { ...f, cancelled: true, paused: false, label: "Cancelled", uploaderId }
            : {
                fileId,
                conversationId: active?.id,
                name,
                done: 0,
                total: 1,
                label: "Cancelled",
                cancelled: true,
                paused: false,
                uploaderId,
              }
        );
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
      // Keep paused / cancelled UI on the message bubble; clear only when active download ends.
      setIncomingFile((f) => (f?.paused || f?.cancelled ? f : null));
      setPreviewBusy(false);
      abortOpenRef.current = false;
      // Leave cancelReceiveRef until UI dismisses so finally doesn't race a second clear.
      if (!pauseOpenRef.current) {
        cancelReceiveRef.current = false;
      }
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
    const ok = await askConfirm({
      title: "Remove member?",
      body: `Remove ${displayName} from the group?`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
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
      await refreshNewestMessages(active.id);
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
    const ok = await askConfirm({
      title: "Leave group?",
      body: "Leave this group? You will keep the messages already here.",
      confirmLabel: "Leave",
      danger: true,
    });
    if (!ok) return;
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
    // Only when you're no longer a member (left or removed).
    const left =
      target.i_am_member === false ||
      (target.id === active?.id && membersLoaded && !inGroup);
    if (!left) {
      setStatus("You're still in this group. Leave the group first, or use Delete messages.");
      return;
    }
    const ok = await askConfirm({
      title: "Remove left group?",
      body: "Remove this group from your chat list? Messages and files for this group will be deleted on this computer only.",
      confirmLabel: "Remove group",
      danger: true,
    });
    if (!ok) return;
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

  /** Remove a DM thread locally; keeps peer trust/pin so reopening does not ask first-pass again. */
  async function handleDeleteDmChat(conv: Conversation) {
    if (conv.kind !== "dm") return;
    const name = conv.peer_name || "this person";
    const ok = await askConfirm({
      title: "Delete chat?",
      body: `Delete chat with ${name}? Messages are removed on this computer only. You can message them again later without re-trusting.`,
      confirmLabel: "Delete chat",
      danger: true,
    });
    if (!ok) return;
    try {
      await peerApi.deleteConversationLocal(conv.id);
      if (active?.id === conv.id) setActive(null);
      await refresh();
      setStatus("Chat deleted");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  const { ensureAnnounceBoards } = useAnnouncementBoards({
    profile,
    identity,
    peers,
    ensureGroupKey,
    setAnnounceBoards,
    setStatus,
  });

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
        {
          file_id: fileId ?? null,
          attachments: fileId ? [fileId] : null,
        }
      );
      setAnnounceCompose({ title: "", body: "" });
      setStatus(fileId ? "Announcement posted with attachment" : "Announcement posted");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setAnnounceBusy(false);
    }
  }

  const {
    handleAddMembers,
    handleRenameGroup,
    handleDeleteGroup,
    handleToggleMembersCanAdd,
    handleSetMemberRole,
  } = useGroupAdmin({
    active,
    identity,
    peers,
    addPick,
    renameDraft,
    ensureGroupKey,
    askConfirm,
    refresh,
    setAddPick,
    setMembers,
    setActive,
    setMembersOpen,
    setStatus,
  });

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
      void pickAndStageFiles();
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
    const hits: {
      id: string;
      title: string;
      detail: string;
      conversationId?: string;
      messageId?: string;
    }[] = [];
    for (const c of convs) {
      const title = (c.kind === "dm" ? c.peer_name : c.title) || "";
      if (title.toLowerCase().includes(q)) {
        hits.push({ id: `c-${c.id}`, title, detail: c.kind === "group" ? "Group" : "Direct message", conversationId: c.id });
      }
    }
    for (const item of savedItems) {
      if (item.preview.toLowerCase().includes(q)) {
        hits.push({
          id: `s-${item.id}`,
          title: item.preview,
          detail: "Saved",
          conversationId: item.conversation_id,
          messageId: item.message_id || undefined,
        });
      }
    }
    for (const row of transfers) {
      if (row.filename.toLowerCase().includes(q)) {
        hits.push({ id: `t-${row.id}`, title: row.filename, detail: `Transfer · ${row.status}`, conversationId: row.conversation_id || undefined });
      }
    }
    for (const c of convs) {
      try {
        if (c.kind === "group") {
          try {
            await ensureGroupKey(c.id);
          } catch {
            continue;
          }
        }
        let beforeSortKey: string | null = null;
        let beforeId: string | null = null;
        let scanned = 0;
        const SCAN_CAP = 400;
        while (hits.length <= 40 && scanned < SCAN_CAP) {
          const page = await peerApi.listMessages(c.id, {
            limit: MESSAGE_PAGE_SIZE,
            beforeSortKey,
            beforeId,
          });
          if (!page.messages.length) break;
          scanned += page.messages.length;
          // Newest→older pages arrive ASC within page; walk newest first.
          for (const m of [...page.messages].reverse()) {
            if (m.kind === "file_notice" || m.kind === "deleted" || m.kind === "poll_vote") continue;
            let textBody = "";
            try {
              if (c.kind === "group") {
                textBody = await decryptGroupMessageText(m);
              } else {
                textBody = await decryptMessage(
                  { ...m, wrapped_keys: m.wrapped_keys || {} },
                  profile.id,
                  identity
                );
              }
            } catch {
              continue;
            }
            if (textBody.toLowerCase().includes(q)) {
              const title = c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
              hits.push({
                id: `m-${m.id}`,
                title,
                detail: textBody.slice(0, 140),
                conversationId: c.id,
                messageId: m.id,
              });
            }
            if (hits.length > 40) break;
          }
          if (!page.has_more_older) break;
          const oldest = page.messages[0]!;
          beforeSortKey = oldest.sort_at || oldest.created_at;
          beforeId = oldest.id;
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

  const vm: ChatScreenVm = {
    SLASH_NAMES,
    abortIncomingTransfer,
    abortOutgoingTransfer,
    dismissIncomingTransfer,
    dismissOutgoingTransfer,
    retryIncomingTransfer,
    retryOutgoingTransfer,
    active,
    activeDmPeer,
    announceBoards,
    announceBusy,
    announceCompose,
    bottomSentinelRef,
    cancelEdit,
    chatSearch,
    chatSearchRef,
    clearStagedFiles,
    composerRef,
    dark,
    dayGroups,
    draftsRef,
    editingMessage,
    hasMoreOlder,
    loadOlderMessages,
    stickToBottomRef,
    ensureAnnounceBoards,
    fileNames,
    filePickRef,
    fileSizes,
    fileThumbs,
    fileLocalPaths,
    fileMetaReady,
    filteredConvs,
    gameInviteBusy,
    gamesOn,
    handleRemoveLeftGroup,
    highlightMsgId,
    setHighlightMsgId,
    inGroup,
    canAddMembers,
    incomingFile,
    isAnnounceBoard,
    lanHosts,
    lastPreviews,
    membersLoaded,
    messages,
    nav,
    notifyTyping,
    openAttachment,
    openDm,
    others,
    outgoingFile,
    pauseIncomingTransfer,
    pauseOutgoingTransfer,
    peerApi,
    peers,
    plain,
    postAnnouncement,
    profile,
    reactToMessage,
    refresh,
    removeStagedFile,
    replyTo,
    resumeOutgoingTransfer,
    retrySend,
    runSlash,
    scanning,
    selectConversation,
    sendEncrypted,
    sendGameMsg,
    senderLabel,
    setAnnounceCompose,
    setChatSearch,
    setConvMenu,
    setEmojiAnchor,
    setGameInviteBusy,
    setGamesOn,
    setGroupOpen,
    setMessages,
    setMsgMenu,
    setNav,
    setPendingGameInvite,
    setReplyTo,
    setSlashIndex,
    setStatus,
    setText,
    slashIndex,
    slashSuggestions,
    slashToken,
    pickAndStageFiles,
    stageFiles,
    stagedFiles,
    startScreenshotCapture,
    status,
    submitComposer,
    tab,
    text,
    thumbInflightRef,
    toggleBlockPeer,
    transfers,
    version
,
    addPick,
    closeFilePreview,
    convs,
    createGroup,
    filePreview,
    firstContact,
    groupOpen,
    groupPick,
    groupTitle,
    handleAddMembers,
    handleDeleteGroup,
    handleLeaveGroup,
    handleRemoveMember,
    handleRenameGroup,
    handleSetMemberRole,
    handleToggleMembersCanAdd,
    isAdmin,
    members,
    membersOpen,
    openPreviewedFile,
    pinOpen,
    previewBusy,
    previewGalleryStep,
    renameDraft,
    savePreviewedFile,
    setAddPick,
    setFirstContact,
    setGroupPick,
    setGroupTitle,
    setMembersOpen,
    setPinOpen,
    setRenameDraft,
    setTab
  };

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
      <NavRail
        nav={nav}
        gamesOn={gamesOn}
        onSettings={() => {
          setNav("settings");
          onSettings?.();
        }}
        setNav={setNav}
        setTab={setTab}
        ensureAnnounceBoards={ensureAnnounceBoards}
        selectConversation={selectConversation}
        listConversations={() => peerApi.listConversations()}
      />

      <ListPane vm={vm} />

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
                const msg = messages.find((m) =>
                  messageAttachmentIds(m).includes(row.file_id!)
                );
                void openAttachment(row.file_id, msg?.sender_id || profile.id);
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
              const out: GameMsg[] = [];
              let beforeSortKey: string | null = null;
              let beforeId: string | null = null;
              for (let pageN = 0; pageN < 20; pageN++) {
                const page = await peerApi.listMessages(conv.id, {
                  limit: MESSAGE_PAGE_SIZE,
                  beforeSortKey,
                  beforeId,
                });
                for (const m of page.messages) {
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
                if (!page.has_more_older || !page.messages.length) break;
                const oldest = page.messages[0]!;
                beforeSortKey = oldest.sort_at || oldest.created_at;
                beforeId = oldest.id;
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
        {nav === "settings" && (
          <Box sx={{ flex: 1, height: "100%", overflowY: "auto", bgcolor: "background.default" }}>
            <SettingsScreen
              profile={profile}
              identity={identity}
              version={version}
              onBack={() => {
                setNav("chats");
                setTab(1);
              }}
              onNameUpdated={(p) => {
                setProfile(p);
                onProfileUpdated?.(p);
              }}
            />
          </Box>
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
            {active && inChatSearchOpen ? (
              <>
                <TextField
                  inputRef={inChatSearchInputRef}
                  size="small"
                  fullWidth
                  autoFocus
                  placeholder="Search messages & files…"
                  value={inChatQuery}
                  onChange={(e) => setInChatQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setInChatSearchOpen(false);
                      setInChatQuery("");
                    } else if (e.key === "Enter" && inChatHits[0]) {
                      e.preventDefault();
                      jumpToInChatHit(inChatHits[0].messageId);
                    }
                  }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    ),
                    sx: { borderRadius: 2, bgcolor: "action.hover" },
                  }}
                />
                <IconButton
                  aria-label="Close search"
                  onClick={() => {
                    setInChatSearchOpen(false);
                    setInChatQuery("");
                  }}
                >
                  <CloseIcon />
                </IconButton>
              </>
            ) : (
              <>
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
                {active && (
                  <Tooltip title="Search in chat">
                    <IconButton
                      aria-label="Search in chat"
                      onClick={() => {
                        setInChatSearchOpen(true);
                        requestAnimationFrame(() => inChatSearchInputRef.current?.focus());
                      }}
                    >
                      <SearchIcon />
                    </IconButton>
                  </Tooltip>
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
              </>
            )}
          </Toolbar>
          {active && inChatSearchOpen && (
            <Box
              sx={{
                borderTop: "1px solid",
                borderColor: "divider",
                maxHeight: 280,
                overflow: "auto",
                bgcolor: "background.paper",
              }}
            >
              {!inChatQuery.trim() ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
                  Type to find messages, images, and files in this chat.
                </Typography>
              ) : inChatHits.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
                  No matches for “{inChatQuery.trim()}”.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {inChatHits.map((hit, i) => (
                    <ListItemButton
                      key={`${hit.messageId}-${hit.kind}-${i}`}
                      onClick={() => jumpToInChatHit(hit.messageId)}
                      sx={{ alignItems: "flex-start", py: 1 }}
                    >
                      <ListItemIcon sx={{ minWidth: 36, mt: 0.35 }}>
                        {hit.kind === "file" || hit.kind === "media" ? (
                          <InsertDriveFileIcon fontSize="small" color="primary" />
                        ) : (
                          <ChatIcon fontSize="small" color="action" />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Typography variant="body2" noWrap fontWeight={600}>
                            {hit.preview || "…"}
                          </Typography>
                        }
                        secondary={
                          <Typography variant="caption" color="text.secondary" noWrap component="span">
                            {hit.sender}
                            {" · "}
                            {formatClock(hit.at)}
                            {hit.kind === "file"
                              ? " · File"
                              : hit.kind === "media"
                                ? " · Media"
                                : ""}
                          </Typography>
                        }
                      />
                    </ListItemButton>
                  ))}
                </List>
              )}
            </Box>
          )}
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
            if (dist < 80) stickToBottomRef.current = true;
            else if (dist > 120) stickToBottomRef.current = false;
            if (el.scrollTop < 120) void loadOlderMessages();
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
          <MessageList vm={vm} />
          </Box>
        </Box>

        <Composer vm={vm} />
        <ScreenshotAnnotator
          open={!!screenshotCaptureId}
          captureId={screenshotCaptureId}
          onCancel={() => {
            const id = screenshotCaptureId;
            setScreenshotCaptureId(null);
            if (id) void peerApi.discardCapture(id).catch(() => {});
          }}
          onDone={({ captureId, path, name }) => {
            setScreenshotCaptureId(null);
            void stageCapturePath(path, name, captureId);
          }}
        />
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
        {convMenu?.conv.kind === "dm" && (
          <MenuItem
            onClick={() => {
              const c = convMenu.conv;
              setConvMenu(null);
              void handleDeleteDmChat(c);
            }}
          >
            <ListItemIcon>
              <DeleteForeverIcon fontSize="small" color="error" />
            </ListItemIcon>
            <Typography color="error.main" fontWeight={600}>
              Delete chat…
            </Typography>
          </MenuItem>
        )}
        {convMenu?.conv.kind === "group" && convMenu.conv.i_am_member === false && (
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

      <PeerTrustDialogs vm={vm} />


      <GroupCreateDialog vm={vm} />

      <Dialog
        open={!!confirmDialog}
        onClose={() => !confirmDialog?.busy && closeConfirmDialog(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ fontWeight: 800, pr: 6 }}>
          {confirmDialog?.title}
          <IconButton
            aria-label="Close"
            disabled={!!confirmDialog?.busy}
            onClick={() => closeConfirmDialog(false)}
            sx={{ position: "absolute", right: 10, top: 10 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {confirmDialog?.body}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2.5, pb: 2 }}>
          <Button
            disabled={!!confirmDialog?.busy}
            onClick={() => closeConfirmDialog(false)}
            sx={{ textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button
            color={confirmDialog?.danger ? "error" : "primary"}
            variant="contained"
            disabled={!!confirmDialog?.busy}
            onClick={() => closeConfirmDialog(true)}
            sx={{ textTransform: "none", fontWeight: 700 }}
          >
            {confirmDialog?.confirmLabel || "Confirm"}
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

      <FilePreviewDialog vm={vm} />

      <GroupMembersDialog vm={vm} />

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
        onJump={(conversationId, messageId) => {
          const conv = convs.find((c) => c.id === conversationId);
          if (conv) {
            if (messageId) {
              stickToBottomRef.current = false;
              setHighlightMsgId(messageId);
            }
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
              if (sum > 500 * 1024 * 1024) {
                const ok = await askConfirm({
                  title: "Pack large selection?",
                  body: `This will pack ~${formatBytes(sum)} locally before sending (${items.length} files). Continue?`,
                  confirmLabel: "Pack & send",
                });
                if (!ok) return;
              }
              setStatus(`Packing… 0/${items.length}`);
              const unlistenPack = await listen<{
                done_files: number;
                total_files: number;
                bytes: number;
              }>("bundle-pack-progress", (ev) => {
                const { done_files, total_files, bytes } = ev.payload;
                setStatus(`Packing… ${done_files}/${total_files} (${formatBytes(bytes)})`);
              });
              let result;
              try {
                result = await peerApi.packBundle(
                  items.map((i) => ({ abs_path: i.abs_path, rel_path: i.rel_path }))
                );
              } finally {
                unlistenPack();
              }
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
        autoHideDuration={3500}
        onClose={() => setStatus("")}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        sx={{ top: { xs: 72, sm: 80 } }}
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
              // Flatten attachment ids from file notices and captioned messages.
              type Row = { key: string; messageId: string; fileId: string; name: string; at: string };
              const rows: Row[] = [];
              for (const m of messages) {
                if (m.kind === "deleted" || m.kind === "poll_vote") continue;
                for (const fid of messageAttachmentIds(m)) {
                  const name = fileNames[fid] || "Encrypted file";
                  const isImg = IMAGE_RE.test(name);
                  if (chatInfoTab === 0 ? isImg : !isImg) {
                    rows.push({
                      key: `${m.id}:${fid}`,
                      messageId: m.id,
                      fileId: fid,
                      name,
                      at: m.created_at,
                    });
                  }
                }
              }
              if (!rows.length) {
                return (
                  <Typography color="text.secondary" sx={{ p: 2.5 }}>
                    {chatInfoTab === 0 ? "No media in this chat yet." : "No documents in this chat yet."}
                  </Typography>
                );
              }
              return (
                <List dense>
                  {rows.map((row) => {
                    const thumb = fileThumbs[row.fileId];
                    return (
                      <ListItemButton key={row.key} onClick={() => jump(row.messageId)}>
                        <ListItemAvatar sx={{ minWidth: 56 }}>
                          {thumb ? (
                            <Avatar
                              variant="rounded"
                              src={thumb}
                              alt=""
                              sx={{ width: 44, height: 44 }}
                            />
                          ) : (
                            <Avatar
                              variant="rounded"
                              sx={{
                                width: 44,
                                height: 44,
                                bgcolor: chatInfoTab === 0 ? "primary.main" : "action.selected",
                              }}
                            >
                              <InsertDriveFileIcon fontSize="small" />
                            </Avatar>
                          )}
                        </ListItemAvatar>
                        <ListItemText
                          primary={row.name}
                          secondary={formatClock(row.at)}
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
          {scanWarn?.title || "Scanner warning"}
        </DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 1.5, whiteSpace: "pre-wrap" }}>
            {scanWarn?.detail}
          </Alert>
          <Typography variant="body2">
            {scanWarn?.body ||
              "Windows Defender reported a concern for this file. It can be a false positive. Sending will still encrypt and deliver it; the recipient's scanner may also warn."}
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
