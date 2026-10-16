import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import FolderOpenIcon from "@mui/icons-material/FolderOpenRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import MoreVertIcon from "@mui/icons-material/MoreVertRounded";
import ReplayIcon from "@mui/icons-material/ReplayRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import { open } from "@tauri-apps/plugin-dialog";
import type { SavedItem, TransferLog } from "./peer";
import { peerApi } from "./peer";
import { SLASH_COMMANDS, type CommandContext } from "./commands";

/** Match http(s) URLs for display + open-in-browser. */
export const URL_RE = /https?:\/\/[^\s<>"'\)\]]+/gi;

function trimUrlTrailingPunct(url: string) {
  return url.replace(/[.,;:!?)]+$/g, "");
}

export async function openExternalLink(url: string) {
  const clean = trimUrlTrailingPunct(url.trim());
  try {
    await peerApi.openExternalUrl(clean);
  } catch {
    window.open(clean, "_blank", "noopener,noreferrer");
  }
}

/** Render plain text with clickable http(s) links (opens in the OS default app). */
export function LinkifiedText({
  text,
  sx,
}: {
  text: string;
  sx?: object;
}) {
  const nodes = useMemo(() => {
    if (!text) return [] as ReactNode[];
    const out: ReactNode[] = [];
    const re = new RegExp(URL_RE.source, "gi");
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const raw = m[0];
      const href = trimUrlTrailingPunct(raw);
      const trailing = raw.slice(href.length);
      out.push(
        <Link
          key={`u-${i++}`}
          href={href}
          underline="hover"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void openExternalLink(href);
          }}
          sx={{ wordBreak: "break-all", cursor: "pointer" }}
        >
          {href}
        </Link>
      );
      if (trailing) out.push(trailing);
      last = m.index + raw.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text]);
  return (
    <Typography component="span" whiteSpace="pre-wrap" sx={sx}>
      {nodes}
    </Typography>
  );
}

export type BundleItem = { abs_path: string; rel_path: string; size: number };

function formatBytes(n: number) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fileExt(name: string) {
  const i = name.lastIndexOf(".");
  if (i < 0 || i === name.length - 1) return "";
  return name.slice(i + 1).toLowerCase();
}

function extColor(ext: string) {
  if (["zip", "7z", "rar", "tar", "gz"].includes(ext)) return "#1976d2";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "#7b1fa2";
  if (["mp4", "mov", "mkv", "webm", "avi"].includes(ext)) return "#c62828";
  if (["mp3", "wav", "flac", "ogg", "m4a"].includes(ext)) return "#00838f";
  if (["pdf"].includes(ext)) return "#d32f2f";
  if (["exe", "msi", "dmg", "apk"].includes(ext)) return "#455a64";
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext)) return "#1565c0";
  if (["xls", "xlsx", "csv"].includes(ext)) return "#2e7d32";
  return "#546e7a";
}

function formatTransferTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function statusMeta(row: TransferLog): {
  label: string;
  color: "default" | "success" | "error" | "warning" | "info" | "primary";
} {
  if (row.status === "completed" && row.verified) return { label: "Verified", color: "success" };
  if (row.status === "completed") return { label: "Received", color: "info" };
  if (row.status === "failed") return { label: "Failed", color: "default" };
  if (row.status === "cancelled" || row.error === "Cancelled")
    return { label: "Cancelled", color: "warning" };
  if (row.status === "interrupted") return { label: "Interrupted", color: "warning" };
  if (row.status === "verifying") return { label: "Verifying", color: "primary" };
  if (row.status === "transferring") return { label: "Transferring", color: "primary" };
  if (row.status === "queued") return { label: "Queued", color: "default" };
  return { label: row.status, color: "default" };
}

type StatusFilter = "all" | "completed" | "failed" | "active";

export function TransfersPanel({
  rows,
  onRetry,
  onClose,
  onClearHistory,
  onRemove,
}: {
  rows: TransferLog[];
  onRetry: (row: TransferLog) => void;
  onClose?: () => void;
  onClearHistory?: () => Promise<void> | void;
  onRemove?: (row: TransferLog) => Promise<void> | void;
}) {
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [menu, setMenu] = useState<{ anchor: HTMLElement; row: TransferLog } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab === 1 && row.direction !== "recv") return false;
      if (filter === "completed" && row.status !== "completed") return false;
      if (
        filter === "failed" &&
        row.status !== "failed" &&
        row.status !== "interrupted" &&
        row.status !== "cancelled"
      )
        return false;
      if (
        filter === "active" &&
        !["queued", "transferring", "verifying"].includes(row.status)
      ) {
        return false;
      }
      if (!q) return true;
      const hay = `${row.filename} ${row.peer_label || ""} ${row.status}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, tab, query, filter]);

  const clearableCount = rows.filter(
    (r) => !["queued", "transferring", "verifying"].includes(r.status)
  ).length;

  async function confirmClear() {
    if (!onClearHistory) return;
    setClearing(true);
    try {
      await onClearHistory();
      setClearOpen(false);
    } finally {
      setClearing(false);
    }
  }

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Box sx={{ px: 2.5, pt: 2, pb: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" alignItems="flex-start" spacing={1.5}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              flexShrink: 0,
              mt: 0.25,
            }}
          >
            <FolderOpenIcon />
          </Box>
          <Box flex={1} minWidth={0}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h6" fontWeight={700} flex={1} noWrap>
                File Transfers
              </Typography>
              {onClose && (
                <Button size="small" onClick={onClose} sx={{ flexShrink: 0 }}>
                  Back to chat
                </Button>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, maxWidth: 720 }}>
              All files you've sent and received are listed here. A transfer is complete only after
              the file is saved and its integrity check finishes. Older peers that omit a hash are
              marked received, not verified.
            </Typography>
          </Box>
        </Stack>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ mt: 1.25, minHeight: 36, "& .MuiTab-root": { minHeight: 36, textTransform: "none", fontWeight: 600 } }}
        >
          <Tab label="Transfers" />
          <Tab label="Downloads" />
        </Tabs>
      </Box>

      <Box sx={{ px: 2.5, pt: 1.5, pb: 1, display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="Search files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: 1, minWidth: 180 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            sx: { borderRadius: 2, bgcolor: "action.hover" },
          }}
        />
        <TextField
          select
          size="small"
          value={filter}
          onChange={(e) => setFilter(e.target.value as StatusFilter)}
          sx={{ width: 130 }}
          InputProps={{ sx: { borderRadius: 2 } }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="active">In progress</MenuItem>
          <MenuItem value="completed">Completed</MenuItem>
          <MenuItem value="failed">Failed</MenuItem>
        </TextField>
        {onClearHistory && (
          <Tooltip title={clearableCount ? "Remove finished transfers from this list" : "Nothing to clear"}>
            <span>
              <Button
                size="small"
                color="inherit"
                startIcon={<DeleteOutlineIcon />}
                disabled={!clearableCount}
                onClick={() => setClearOpen(true)}
                sx={{ borderRadius: 2, whiteSpace: "nowrap" }}
              >
                Clear history
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", px: 2.5, pb: 2.5, minHeight: 0 }}>
        {!rows.length && (
          <Alert severity="info" sx={{ mt: 1 }}>
            No transfers yet. Send a file or open one from a conversation.
          </Alert>
        )}
        {!!rows.length && !filtered.length && (
          <Alert severity="info" sx={{ mt: 1 }}>
            No transfers match your filters.
          </Alert>
        )}
        <Stack spacing={1} sx={{ mt: filtered.length ? 0.5 : 0 }}>
          {filtered.map((row) => {
            const pct = row.size_bytes
              ? Math.min(100, Math.round((100 * row.bytes_done) / row.size_bytes))
              : row.status === "completed"
                ? 100
                : 0;
            const ext = fileExt(row.filename);
            const meta = statusMeta(row);
            const active = ["queued", "transferring", "verifying"].includes(row.status);
            return (
              <Box
                key={row.id}
                sx={{
                  p: 1.35,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  bgcolor: "background.paper",
                  transition: "border-color 120ms ease, box-shadow 120ms ease",
                  "&:hover": {
                    borderColor: "action.selected",
                    boxShadow: (t) => `0 1px 0 ${t.palette.divider}`,
                  },
                }}
              >
                <Stack direction="row" spacing={1.25} alignItems="flex-start">
                  <Box
                    sx={{
                      width: 42,
                      height: 42,
                      borderRadius: 1.5,
                      bgcolor: extColor(ext),
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: 0.2,
                      textTransform: "uppercase",
                    }}
                    title={ext || "file"}
                  >
                    {ext ? ext.slice(0, 4) : <InsertDriveFileIcon sx={{ fontSize: 22 }} />}
                  </Box>
                  <Box flex={1} minWidth={0}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography fontWeight={700} noWrap flex={1} fontSize={14}>
                        {row.filename}
                      </Typography>
                      <Chip
                        size="small"
                        color={meta.color}
                        icon={
                          meta.label === "Verified" ? (
                            <CheckCircleOutlineIcon />
                          ) : meta.label === "Failed" ? (
                            <CloseIcon />
                          ) : undefined
                        }
                        label={meta.label}
                        sx={{ height: 24, fontWeight: 600, "& .MuiChip-icon": { ml: 0.5, fontSize: 16 } }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, minWidth: 56, textAlign: "right" }}>
                        {formatTransferTime(row.finished_at || row.updated_at)}
                      </Typography>
                      <IconButton
                        size="small"
                        aria-label="Transfer actions"
                        onClick={(e) => setMenu({ anchor: e.currentTarget, row })}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.15 }}>
                      {row.direction === "send" ? "To" : "From"} {row.peer_label || "peer"}
                      {" · "}
                      {formatBytes(row.size_bytes)}
                      {row.status === "completed" || active ? ` · ${pct}%` : null}
                    </Typography>
                    {active ? (
                      <LinearProgress variant="determinate" value={pct} sx={{ mt: 1, borderRadius: 1, height: 6 }} />
                    ) : null}
                    {row.error ? (
                      <Typography variant="body2" color="error" sx={{ mt: 0.6, fontSize: 13 }}>
                        {row.error}
                      </Typography>
                    ) : null}
                  </Box>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Box>

      <Menu
        anchorEl={menu?.anchor}
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {(menu?.row.status === "failed" ||
          menu?.row.status === "interrupted" ||
          menu?.row.status === "cancelled") &&
          menu.row.file_id && (
          <MenuItem
            onClick={() => {
              if (menu) onRetry(menu.row);
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <ReplayIcon fontSize="small" />
            </ListItemIcon>
            Retry
          </MenuItem>
        )}
        {onRemove && menu && !["queued", "transferring", "verifying"].includes(menu.row.status) && (
          <MenuItem
            onClick={async () => {
              if (menu) await onRemove(menu.row);
              setMenu(null);
            }}
          >
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            Remove from history
          </MenuItem>
        )}
        {menu &&
          !(
            ((menu.row.status === "failed" ||
              menu.row.status === "interrupted" ||
              menu.row.status === "cancelled") &&
              menu.row.file_id) ||
            (onRemove && !["queued", "transferring", "verifying"].includes(menu.row.status))
          ) && (
            <MenuItem disabled>
              <ListItemText primary="No actions available" />
            </MenuItem>
          )}
      </Menu>

      <Dialog open={clearOpen} onClose={() => !clearing && setClearOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Clear transfer history?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This removes finished transfers from the list. In-progress transfers stay. Files on disk
            are not deleted.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearOpen(false)} disabled={clearing}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={confirmClear} disabled={clearing}>
            Clear history
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export function BundleDialog({
  open: isOpen,
  onClose,
  busy,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  onSend: (items: BundleItem[], zip: boolean, note: string) => Promise<void>;
}) {
  const [items, setItems] = useState<BundleItem[]>([]);
  const [zip, setZip] = useState(true);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const total = items.reduce((n, i) => n + i.size, 0);

  useEffect(() => {
    if (!isOpen) {
      setItems([]);
      setNote("");
      setError("");
      setZip(true);
    }
  }, [isOpen]);

  async function addFolder() {
    setError("");
    try {
      const picked = await open({ directory: true, multiple: false, title: "Choose a folder" });
      if (!picked || Array.isArray(picked)) return;
      const { peerApi } = await import("./peer");
      const listed = await peerApi.listDirectoryFiles(picked);
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.abs_path));
        return [...prev, ...listed.filter((f) => !seen.has(f.abs_path))];
      });
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }

  async function addFiles() {
    setError("");
    try {
      const picked = await open({ multiple: true, directory: false, title: "Choose files" });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (!paths.length) return;
      const next = paths.map((abs) => ({
        abs_path: abs,
        rel_path: abs.split(/[/\\]/).pop() || "file",
        size: 0,
      }));
      setItems((prev) => [...prev, ...next]);
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  }

  return (
    <Dialog open={isOpen} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create file bundle</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Originals stay where they are. Symbolic links are skipped. The archive is built on disk, then sent with the existing encrypted transfer.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Button onClick={addFiles}>Add files</Button>
          <Button onClick={addFolder}>Add folder</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {items.length} items · {formatBytes(total)}
        </Typography>
        <List dense sx={{ maxHeight: 240, overflow: "auto" }}>
          {items.map((item) => (
            <ListItemButton
              key={item.abs_path}
              onClick={() => setItems((prev) => prev.filter((p) => p.abs_path !== item.abs_path))}
            >
              <ListItemText
                primary={item.rel_path}
                secondary={item.size ? formatBytes(item.size) : "file"}
                primaryTypographyProps={{ noWrap: true, fontSize: 13 }}
              />
              <Typography variant="caption">Remove</Typography>
            </ListItemButton>
          ))}
        </List>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Checkbox checked={zip} onChange={(_, v) => setZip(v)} />
          <Typography variant="body2">Create a ZIP archive (keeps relative paths)</Typography>
        </Stack>
        <TextField
          fullWidth
          size="small"
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          sx={{ mt: 1 }}
        />
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={busy || !items.length}
          onClick={() => onSend(items, zip, note.trim()).catch((err) => setError(err?.message || String(err)))}
        >
          {busy ? "Sending…" : "Send bundle"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function SearchDialog({
  open: isOpen,
  onClose,
  onJump,
  results,
  query,
  setQuery,
  onSearch,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  setQuery: (q: string) => void;
  onSearch: () => void;
  busy: boolean;
  results: {
    id: string;
    title: string;
    detail: string;
    conversationId?: string;
    messageId?: string;
  }[];
  onJump: (conversationId: string, messageId?: string) => void;
}) {
  return (
    <Dialog open={isOpen} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Search this computer</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          size="small"
          placeholder="Messages, chats, filenames"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearch();
          }}
          sx={{ mb: 1 }}
        />
        <Typography variant="caption" color="text.secondary">
          Only data already on this PC is searched. Offline peers are not queried.
        </Typography>
        {busy && <LinearProgress sx={{ mt: 1 }} />}
        <List dense>
          {results.map((r) => (
            <ListItemButton
              key={r.id}
              disabled={!r.conversationId}
              onClick={() => r.conversationId && onJump(r.conversationId, r.messageId)}
            >
              <ListItemText primary={r.title} secondary={r.detail} />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function AnnounceDialog({
  open: isOpen,
  onClose,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (title: string, body: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <Dialog open={isOpen} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Announcement</DialogTitle>
      <DialogContent>
        <TextField fullWidth label="Title" value={title} onChange={(e) => setTitle(e.target.value)} sx={{ mt: 1, mb: 1.5 }} />
        <TextField fullWidth multiline minRows={3} label="Message" value={body} onChange={(e) => setBody(e.target.value)} />
        {(title || body) && (
          <Box sx={{ mt: 2, p: 1.5, border: "1px solid", borderColor: "primary.main", borderRadius: 2 }}>
            <Typography variant="overline" color="primary">Preview</Typography>
            <Typography fontWeight={700}>{title || "Untitled"}</Typography>
            <LinkifiedText text={body} sx={{ display: "block", fontSize: 14 }} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!title.trim() || !body.trim()}
          onClick={() => onSend(title.trim(), body.trim())}
        >
          Send announcement
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function PollDialog({
  open: isOpen,
  onClose,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (question: string, options: string[]) => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState("Yes\nNo");
  const parsed = useMemo(
    () => options.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 8),
    [options]
  );
  return (
    <Dialog open={isOpen} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Group poll</DialogTitle>
      <DialogContent>
        <TextField fullWidth label="Question" value={question} onChange={(e) => setQuestion(e.target.value)} sx={{ mt: 1, mb: 1.5 }} />
        <TextField
          fullWidth
          multiline
          minRows={4}
          label="Options, one per line"
          value={options}
          onChange={(e) => setOptions(e.target.value)}
        />
        <Typography variant="caption" color="text.secondary">
          {parsed.length} options. Votes sync as encrypted messages. Results show only votes this computer has received.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!question.trim() || parsed.length < 2}
          onClick={() => onSend(question.trim(), parsed)}
        >
          Create poll
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function SnippetDialog({
  open: isOpen,
  onClose,
  onSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (title: string, body: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <Dialog open={isOpen} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Code snippet</DialogTitle>
      <DialogContent>
        <TextField fullWidth label="Title" value={title} onChange={(e) => setTitle(e.target.value)} sx={{ mt: 1, mb: 1.5 }} />
        <TextField
          fullWidth
          multiline
          minRows={6}
          label="Snippet"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          InputProps={{ sx: { fontFamily: "ui-monospace, monospace", fontSize: 13 } }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!body.trim()} onClick={() => onSend(title.trim() || "Snippet", body)}>
          Send snippet
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function HelpDialog({
  open: isOpen,
  onClose,
  ctx,
}: {
  open: boolean;
  onClose: () => void;
  ctx: CommandContext;
}) {
  return (
    <Dialog open={isOpen} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Commands</DialogTitle>
      <DialogContent>
        <List dense>
          {SLASH_COMMANDS.filter((c) => c.available(ctx)).map((c) => (
            <ListItemText key={c.name} primary={c.name} secondary={c.hint} sx={{ mb: 1 }} />
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export function SavedPanel({
  items,
  onOpen,
  onRemove,
}: {
  items: SavedItem[];
  onOpen: (conversationId: string, messageId?: string | null) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Box sx={{ p: 2, overflow: "auto", height: "100%" }}>
      <Typography variant="h6" gutterBottom>Saved</Typography>
      {!items.length && <Alert severity="info">Nothing saved yet. Use Save on a message.</Alert>}
      <List>
        {items.map((item) => (
          <ListItemButton
            key={item.id}
            onClick={() => onOpen(item.conversation_id, item.message_id)}
          >
            <ListItemText primary={item.preview} secondary={item.kind} primaryTypographyProps={{ noWrap: true }} />
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(item.id);
              }}
            >
              Remove
            </Button>
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

type SnakeSpeed = "slow" | "moderate" | "fast";

const SNAKE_SPEED_MS: Record<SnakeSpeed, number> = {
  slow: 220,
  moderate: 140,
  fast: 75,
};

export function SnakeGame() {
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => Number(localStorage.getItem("peerchat.snake.best") || "0"));
  const [alive, setAlive] = useState(true);
  const [tick, setTick] = useState(0);
  const [speed, setSpeed] = useState<SnakeSpeed>(() => {
    const raw = localStorage.getItem("peerchat.snake.speed");
    return raw === "slow" || raw === "moderate" || raw === "fast" ? raw : "moderate";
  });
  const size = 18;
  const cellPx = 28;
  const state = useMemo(() => {
    const start = { x: 9, y: 9 };
    return { snake: [start], dir: { x: 1, y: 0 }, food: { x: 3, y: 3 } };
  }, []);
  const [, force] = useState(0);

  useEffect(() => {
    if (!alive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), SNAKE_SPEED_MS[speed]);
    return () => window.clearInterval(id);
  }, [alive, speed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const map: Record<string, { x: number; y: number }> = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
      };
      const next = map[e.key];
      if (!next) return;
      if (next.x === -state.dir.x && next.y === -state.dir.y) return;
      e.preventDefault();
      state.dir = next;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  useEffect(() => {
    if (!tick) return;
    const head = state.snake[0];
    // Wrap through opposite border instead of dying at the edge.
    const nx = ((head.x + state.dir.x) % size + size) % size;
    const ny = ((head.y + state.dir.y) % size + size) % size;
    if (state.snake.some((p) => p.x === nx && p.y === ny)) {
      setAlive(false);
      return;
    }
    const grown = [...state.snake];
    grown.unshift({ x: nx, y: ny });
    if (nx === state.food.x && ny === state.food.y) {
      const nextScore = score + 1;
      setScore(nextScore);
      if (nextScore > best) {
        setBest(nextScore);
        localStorage.setItem("peerchat.snake.best", String(nextScore));
      }
      state.food = {
        x: Math.floor(Math.random() * size),
        y: Math.floor(Math.random() * size),
      };
    } else {
      grown.pop();
    }
    state.snake = grown;
    force((n) => n + 1);
  }, [tick]);

  function restart() {
    state.snake = [{ x: 9, y: 9 }];
    state.dir = { x: 1, y: 0 };
    state.food = { x: 3, y: 3 };
    setScore(0);
    setAlive(true);
    setTick(0);
    force((n) => n + 1);
  }

  function changeSpeed(next: SnakeSpeed) {
    setSpeed(next);
    localStorage.setItem("peerchat.snake.speed", next);
  }

  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = state.snake.some((p) => p.x === x && p.y === y);
      const food = state.food.x === x && state.food.y === y;
      cells.push(
        <Box
          key={`${x}-${y}`}
          sx={{
            width: cellPx,
            height: cellPx,
            borderRadius: 0.5,
            bgcolor: on ? "primary.main" : food ? "secondary.main" : "action.hover",
          }}
        />
      );
    }
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6">Snake</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Offline. Arrow keys · wraps edges. Score {score} · Best {best}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
        <Typography variant="caption" color="text.secondary" fontWeight={700}>
          Speed
        </Typography>
        {([
          ["slow", "Slow"],
          ["moderate", "Moderate"],
          ["fast", "Fast"],
        ] as const).map(([id, label]) => (
          <Button
            key={id}
            size="small"
            variant={speed === id ? "contained" : "outlined"}
            onClick={() => changeSpeed(id)}
            sx={{ textTransform: "none", minWidth: 0 }}
          >
            {label}
          </Button>
        ))}
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${size}, ${cellPx}px)`,
          gap: "2px",
          width: "fit-content",
          p: 1,
          borderRadius: 2,
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        {cells}
      </Box>
      {!alive && (
        <Button sx={{ mt: 1 }} variant="contained" onClick={restart}>
          Play again
        </Button>
      )}
    </Box>
  );
}
