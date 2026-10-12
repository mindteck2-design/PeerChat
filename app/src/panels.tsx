import { useEffect, useMemo, useState } from "react";
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
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { open } from "@tauri-apps/plugin-dialog";
import type { SavedItem, TransferLog } from "./peer";
import { SLASH_COMMANDS, type CommandContext } from "./commands";

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

export function TransfersPanel({
  rows,
  onRetry,
  onClose,
}: {
  rows: TransferLog[];
  onRetry: (row: TransferLog) => void;
  onClose?: () => void;
}) {
  return (
    <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" flex={1}>
          Transfers
        </Typography>
        {onClose && <Button onClick={onClose}>Back to chat</Button>}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        A transfer is complete only after the file is saved and its integrity check finishes.
        Older peers that omit a hash are marked received, not verified.
      </Typography>
      {!rows.length && (
        <Alert severity="info">No transfers yet. Send a file or open one from a conversation.</Alert>
      )}
      <Stack spacing={1}>
        {rows.map((row) => {
          const pct = row.size_bytes
            ? Math.min(100, Math.round((100 * row.bytes_done) / row.size_bytes))
            : row.status === "completed"
              ? 100
              : 0;
          return (
            <Box key={row.id} sx={{ p: 1.25, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography fontWeight={700} noWrap flex={1}>
                  {row.filename}
                </Typography>
                <Chip size="small" label={row.status} />
                {row.verified && <Chip size="small" color="success" label="Verified" />}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {row.direction === "send" ? "To" : "From"} {row.peer_label || "peer"} · {formatBytes(row.size_bytes)}
              </Typography>
              {row.status === "transferring" || row.status === "verifying" ? (
                <LinearProgress variant="determinate" value={pct} sx={{ mt: 1 }} />
              ) : null}
              {row.error && (
                <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                  {row.error}
                </Typography>
              )}
              {(row.status === "failed" || row.status === "interrupted") && row.file_id && (
                <Button size="small" sx={{ mt: 0.5 }} onClick={() => onRetry(row)}>
                  Retry
                </Button>
              )}
            </Box>
          );
        })}
      </Stack>
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
  results: { id: string; title: string; detail: string; conversationId?: string }[];
  onJump: (conversationId: string) => void;
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
              onClick={() => r.conversationId && onJump(r.conversationId)}
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
            <Typography variant="body2" whiteSpace="pre-wrap">{body}</Typography>
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

export function SnakeGame() {
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => Number(localStorage.getItem("peerchat.snake.best") || "0"));
  const [alive, setAlive] = useState(true);
  const [tick, setTick] = useState(0);
  const size = 18;
  const cellPx = 28;
  const state = useMemo(() => {
    const start = { x: 9, y: 9 };
    return { snake: [start], dir: { x: 1, y: 0 }, food: { x: 3, y: 3 } };
  }, []);
  const [, force] = useState(0);

  useEffect(() => {
    if (!alive) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 140);
    return () => window.clearInterval(id);
  }, [alive]);

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
    const nx = head.x + state.dir.x;
    const ny = head.y + state.dir.y;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size || state.snake.some((p) => p.x === nx && p.y === ny)) {
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
        Offline. Arrow keys. Score {score} · Best {best}
      </Typography>
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
