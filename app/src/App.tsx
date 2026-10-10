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
  LinearProgress,
  Menu,
  MenuItem,
  ListItemIcon,
} from "@mui/material";
import ChatIcon from "@mui/icons-material/ForumRounded";
import SettingsIcon from "@mui/icons-material/SettingsRounded";
import LogoutIcon from "@mui/icons-material/LogoutRounded";
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
import {
  peerApi,
  type Conversation,
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

type FilePreview = {
  fileId: string;
  uploaderId: string;
  name: string;
  url: string;
  mime: string;
  data: Uint8Array;
  localPath?: string | null;
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [addPick, setAddPick] = useState<string[]>([]);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [outgoingFile, setOutgoingFile] = useState<{
    conversationId: string;
    fileId?: string;
    stagingDir?: string;
    name: string;
    done: number;
    total: number;
  } | null>(null);
  const [incomingFile, setIncomingFile] = useState<{
    fileId: string;
    name: string;
    done: number;
    total: number;
  } | null>(null);
  const [msgMenu, setMsgMenu] = useState<{
    anchor: HTMLElement;
    message: Message;
  } | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const groupKeysRef = useRef(groupKeys);
  groupKeysRef.current = groupKeys;
  const abortSendRef = useRef(false);
  const abortOpenRef = useRef(false);

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
    const conv = active;
    let cancel = false;
    setMessages([]);
    setPlain({});
    setMembers([]);
    setMembersLoaded(conv.kind !== "group");
    setMembersOpen(false);
    setAddPick([]);
    clearStagedFile();

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

  async function openDm(peer: Peer) {
    if (!peer.pinned && peer.tls_fingerprint) {
      setPinOpen(peer);
      return;
    }
    const c = await peerApi.openDm(peer.user_id);
    setMessages([]);
    setPlain({});
    setActive(c);
    await refresh();
  }

  function stageFile(file: File) {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    });
    setPendingFile(file);
  }

  function clearStagedFile() {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPendingFile(null);
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

  async function sendText(body: string) {
    if (!active || !body.trim()) return;
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
      const enc = await encryptMessage(body.trim(), active.id, profile.id, identity, pubs);
      message = { kind: "text", sender_id: profile.id, ...enc };
    } else {
      const gk = await ensureGroupKey(active.id);
      const enc = await encryptWithGroupKey(body.trim(), active.id, profile.id, gk, identity);
      message = { kind: "text", sender_id: profile.id, ...enc };
    }
    await peerApi.sendMessage(
      active.id,
      message,
      memberIds.filter((id) => id !== profile.id)
    );
    setMessages(await peerApi.listMessages(active.id));
  }

  async function submitComposer() {
    if (!active) return;
    const file = pendingFile;
    const body = text.trim();
    if (!file && !body) return;
    if (file) clearStagedFile();
    if (body) setText("");
    if (file) await sendFile(file);
    if (body) await sendText(body);
  }

  function senderLabel(id: string) {
    if (id === profile.id) return profile.display_name;
    return (
      members.find((m) => m.user_id === id)?.display_name ||
      peers.find((p) => p.user_id === id)?.display_name ||
      "Member"
    );
  }

  const inGroup =
    active?.kind !== "group" || !membersLoaded || members.some((m) => m.user_id === profile.id);

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
      });
      fileId = created.file_id;
      const staging_dir = created.staging_dir;
      setFileNames((s) => ({ ...s, [fileId!]: file.name }));
      setOutgoingFile({
        conversationId,
        fileId,
        stagingDir: staging_dir,
        name: file.name,
        done: 0,
        total: chunkCount,
      });
      for (let i = 0; i < chunkCount; i++) {
        if (abortSendRef.current) throw new Error("aborted");
        const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        const buf = new Uint8Array(await slice.arrayBuffer());
        const { nonce, ciphertextB64 } = encryptChunk(contentKey, buf);
        await peerApi.writeFileChunk(staging_dir, i, ciphertextB64, nonce);
        if (i === 0 || i + 1 === chunkCount || (i + 1) % 2 === 0) {
          setOutgoingFile({
            conversationId,
            fileId,
            stagingDir: staging_dir,
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
    setIncomingFile({ fileId, name, done: 0, total: totalChunks });
    const parts: Uint8Array[] = [];
    for (let i = 0; i < totalChunks; i++) {
      if (abortOpenRef.current) throw new Error("aborted");
      const chunk = await peerApi.fetchFileChunk(fileId, i, uploaderId);
      parts.push(decryptChunk(key, chunk.nonce, fromB64(chunk.data_b64)));
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

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <Drawer
        variant="permanent"
        sx={{
          width: 300,
          [`& .MuiDrawer-paper`]: {
            width: 300,
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
                  onClick={() => {
                    setMessages([]);
                    setPlain({});
                    setActive(c);
                  }}
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

      <Box flex={1} display="flex" flexDirection="column">
        <AppBar
          position="sticky"
          color="transparent"
          elevation={0}
          sx={{ borderBottom: "1px solid #D5E3DD" }}
        >
          <Toolbar>
            <Box>
              <Typography variant="h6">
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
            <Box flex={1} />
            {status && <Chip size="small" label={status} />}
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
          p={2}
          overflow="auto"
          display="flex"
          flexDirection="column"
          gap={1}
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
              {group.items.map((m) => (
                <Grow in key={m.id} timeout={220}>
                  <Paper
                    elevation={0}
                    sx={{
                      alignSelf: m.sender_id === profile.id ? "flex-end" : "flex-start",
                      maxWidth: "70%",
                      p: 1.5,
                      bgcolor:
                        m.kind === "deleted"
                          ? "#F1F4F3"
                          : m.sender_id === profile.id
                            ? "#DCEFE9"
                            : "#FFFFFF",
                      border: "1px solid #D5E3DD",
                      position: "relative",
                    }}
                  >
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
                    {active?.kind === "group" && m.sender_id !== profile.id && m.kind !== "deleted" && (
                      <Typography variant="caption" color="primary" fontWeight={700} display="block">
                        {senderLabel(m.sender_id)}
                      </Typography>
                    )}
                    {m.kind === "deleted" ? (
                      <Typography
                        fontStyle="italic"
                        color="text.secondary"
                        sx={{ pr: 2 }}
                      >
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
                      <Typography variant="caption">{formatClock(m.created_at)}</Typography>
                      {m.sender_id === profile.id &&
                        m.kind !== "deleted" &&
                        (m.read ? (
                          <DoneAllIcon
                            titleAccess="Read"
                            sx={{ fontSize: 16, color: "success.main" }}
                          />
                        ) : m.delivered ? (
                          <DoneAllIcon titleAccess="Received" sx={{ fontSize: 16 }} />
                        ) : (
                          <DoneIcon titleAccess="Queued" sx={{ fontSize: 16 }} />
                        ))}
                    </Box>
                  </Paper>
                </Grow>
              ))}
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
            sx={{ p: 1.5, borderTop: "1px solid #D5E3DD", display: "flex", flexDirection: "column" }}
          >
            {pendingFile && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  mb: 1,
                  p: 1,
                  border: "1px solid #D5E3DD",
                  borderRadius: 2,
                  bgcolor: "#F7FBFA",
                }}
              >
                {previewUrl ? (
                  <Box
                    component="img"
                    src={previewUrl}
                    alt=""
                    sx={{ width: 56, height: 56, objectFit: "cover", borderRadius: 1 }}
                  />
                ) : (
                  <InsertDriveFileIcon color="primary" />
                )}
                <Box flex={1} minWidth={0}>
                  <Typography noWrap fontWeight={700}>
                    {pendingFile.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatBytes(pendingFile.size)} · not sent yet
                  </Typography>
                </Box>
                <IconButton aria-label="Remove file" size="small" onClick={clearStagedFile}>
                  <CloseIcon />
                </IconButton>
              </Box>
            )}
            <Box display="flex" gap={1}>
              <IconButton
                component="label"
                aria-label="Attach file"
                disabled={!!outgoingFile}
              >
                <AttachFileIcon />
                <input
                  hidden
                  type="file"
                  disabled={!!outgoingFile}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) stageFile(f);
                    e.target.value = "";
                  }}
                />
              </IconButton>
              <TextField
                fullWidth
                size="small"
                placeholder="Encrypted message…"
                value={text}
                disabled={!!outgoingFile}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submitComposer())
                }
              />
              <Button
                variant="contained"
                disabled={!!outgoingFile || (!text.trim() && !pendingFile)}
                onClick={submitComposer}
              >
                Send
              </Button>
            </Box>
          </Paper>
        )}
        {active?.kind === "group" && membersLoaded && !inGroup && (
          <Paper square elevation={0} sx={{ p: 2, borderTop: "1px solid #D5E3DD", textAlign: "center" }}>
            <Typography color="text.secondary">You're no longer in this group.</Typography>
          </Paper>
        )}
      </Box>

      <Menu
        anchorEl={msgMenu?.anchor ?? null}
        open={!!msgMenu}
        onClose={() => setMsgMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => msgMenu && deleteForMe(msgMenu.message)}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          Delete for me
        </MenuItem>
        {msgMenu?.message.sender_id === profile.id && msgMenu.message.kind !== "deleted" && (
          <MenuItem
            onClick={() => msgMenu && deleteForEveryone(msgMenu.message)}
          >
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
              setMessages([]);
              setPlain({});
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
              groupKeysRef.current = { ...groupKeysRef.current, [conversation.id]: gk };
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
              setMessages([]);
              setPlain({});
              setActive(conversation);
              await refresh();
            }}
          >
            Create
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
              <ListItemButton key={m.user_id} disableRipple>
                <Avatar sx={{ width: 32, height: 32, mr: 1.5, bgcolor: "primary.main", fontSize: 14 }}>
                  {m.display_name.slice(0, 1).toUpperCase()}
                </Avatar>
                <ListItemText
                  primary={m.user_id === profile.id ? `${m.display_name} (you)` : m.display_name}
                />
                {members.some((x) => x.user_id === profile.id) && m.user_id !== profile.id && (
                  <IconButton
                    aria-label={`Remove ${m.display_name}`}
                    size="small"
                    onClick={async () => {
                      if (!active) return;
                      if (!window.confirm(`Remove ${m.display_name} from the group?`)) return;
                      try {
                        const gk = await ensureGroupKey(active.id);
                        const ids = await peerApi.memberIds(active.id);
                        await peerApi.sendMessage(
                          active.id,
                          {
                            kind: "text",
                            sender_id: profile.id,
                            ...(await encryptWithGroupKey(
                              `${profile.display_name} removed ${m.display_name}`,
                              active.id,
                              profile.id,
                              gk,
                              identity
                            )),
                          },
                          ids.filter((id) => id !== profile.id)
                        );
                        await peerApi.removeGroupMember(active.id, m.user_id);
                        setMembers(await peerApi.listMembers(active.id));
                        setMessages(await peerApi.listMessages(active.id));
                      } catch (err: any) {
                        setStatus(err?.message || String(err));
                      }
                    }}
                  >
                    <PersonRemoveIcon fontSize="small" />
                  </IconButton>
                )}
              </ListItemButton>
            ))}
          </List>
          {members.some((x) => x.user_id === profile.id) && (
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
          {members.some((x) => x.user_id === profile.id) && (
            <Button
              color="error"
              onClick={async () => {
                if (!active) return;
                if (!window.confirm("Leave this group? You will keep the messages already here.")) return;
                try {
                  const gk = await ensureGroupKey(active.id);
                  const ids = await peerApi.memberIds(active.id);
                  await peerApi.sendMessage(
                    active.id,
                    {
                      kind: "text",
                      sender_id: profile.id,
                      ...(await encryptWithGroupKey(
                        `${profile.display_name} left the group`,
                        active.id,
                        profile.id,
                        gk,
                        identity
                      )),
                    },
                    ids.filter((id) => id !== profile.id)
                  );
                  await peerApi.leaveGroup(active.id);
                  setMembers(await peerApi.listMembers(active.id));
                  setMessages(await peerApi.listMessages(active.id));
                  setMembersOpen(false);
                } catch (err: any) {
                  setStatus(err?.message || String(err));
                }
              }}
            >
              Exit group
            </Button>
          )}
          <Box flex={1} />
          <Button onClick={() => setMembersOpen(false)}>Close</Button>
          {members.some((x) => x.user_id === profile.id) && (
            <Button
              variant="contained"
              disabled={!addPick.length}
              onClick={async () => {
                if (!active || !addPick.length) return;
                try {
                  const gk = await ensureGroupKey(active.id);
                  const pubs: Record<string, string> = {};
                  const names: string[] = [];
                  for (const id of addPick) {
                    const u = peers.find((x) => x.user_id === id);
                    if (!u) continue;
                    pubs[id] = u.x25519_public;
                    names.push(u.display_name);
                  }
                  if (!names.length) return;
                  await peerApi.addGroupMembers(active.id, wrapGroupKeyForMembers(gk, identity, pubs));
                  const ids = await peerApi.memberIds(active.id);
                  await peerApi.sendMessage(
                    active.id,
                    {
                      kind: "text",
                      sender_id: profile.id,
                      ...(await encryptWithGroupKey(
                        `${profile.display_name} added ${names.join(", ")}`,
                        active.id,
                        profile.id,
                        gk,
                        identity
                      )),
                    },
                    ids.filter((id) => id !== profile.id)
                  );
                  setAddPick([]);
                  setMembers(await peerApi.listMembers(active.id));
                  setMessages(await peerApi.listMessages(active.id));
                } catch (err: any) {
                  setStatus(err?.message || String(err));
                }
              }}
            >
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
