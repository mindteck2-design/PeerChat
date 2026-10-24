import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddRounded";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightIcon from "@mui/icons-material/ChevronRightRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import EventIcon from "@mui/icons-material/EventRounded";
import { listen } from "@tauri-apps/api/event";
import { peerApi, type CalendarItem, type CalendarKind, type Peer } from "../../peer";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDay(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function monthLabel(y: number, m: number) {
  return new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

const KINDS: { value: CalendarKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "reminder", label: "Reminder" },
  { value: "meeting", label: "Meeting" },
  { value: "todo", label: "To-do" },
];

type Draft = {
  id?: string;
  title: string;
  body: string;
  kind: CalendarKind;
  day: string;
  time: string;
  participant_ids: string[];
  done: boolean;
};

function emptyDraft(day: string): Draft {
  return {
    title: "",
    body: "",
    kind: "note",
    day,
    time: "",
    participant_ids: [],
    done: false,
  };
}

export function CalendarScreen({
  peers,
  myId,
  myName,
  onStatus,
}: {
  peers: Peer[];
  myId: string;
  myName: string;
  onStatus?: (s: string) => void;
}) {
  const today = useMemo(() => dayKey(new Date()), []);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(today);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [editor, setEditor] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const others = useMemo(
    () => peers.filter((p) => p.user_id !== myId && !p.blocked),
    [peers, myId]
  );

  const range = useMemo(() => {
    const from = `${cursor.y}-${pad2(cursor.m + 1)}-01`;
    const last = daysInMonth(cursor.y, cursor.m);
    const to = `${cursor.y}-${pad2(cursor.m + 1)}-${pad2(last)}`;
    return { from, to };
  }, [cursor]);

  const refresh = useCallback(async () => {
    try {
      const rows = await peerApi.listCalendarItems(range.from, range.to);
      setItems(rows);
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    }
  }, [onStatus, range.from, range.to]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let un: (() => void) | undefined;
    void listen<{ kind?: string }>("inbox-updated", (ev) => {
      if (ev.payload?.kind === "calendar_share") void refresh();
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, [refresh]);

  // Due-soon desktop notifications (local reminders/meetings).
  useEffect(() => {
    const tick = () => {
      void peerApi.pollCalendarDue().catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const list = map.get(it.day) || [];
      list.push(it);
      map.set(it.day, list);
    }
    return map;
  }, [items]);

  const dayItems = byDay.get(selectedDay) || [];

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startPad = first.getDay(); // 0 = Sun
    const total = daysInMonth(cursor.y, cursor.m);
    const cells: Array<{ day: number | null; key: string }> = [];
    for (let i = 0; i < startPad; i++) cells.push({ day: null, key: `e-${i}` });
    for (let d = 1; d <= total; d++) {
      const key = `${cursor.y}-${pad2(cursor.m + 1)}-${pad2(d)}`;
      cells.push({ day: d, key });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: null, key: `t-${cells.length}` });
    }
    return cells;
  }, [cursor]);

  async function saveDraft() {
    if (!editor || !editor.title.trim()) {
      onStatus?.("Add a title first");
      return;
    }
    setBusy(true);
    try {
      await peerApi.upsertCalendarItem({
        id: editor.id,
        title: editor.title.trim(),
        body: editor.body.trim(),
        kind: editor.kind,
        day: editor.day,
        time: editor.time.trim() || null,
        participant_ids: editor.participant_ids,
        done: editor.done,
        shared: editor.participant_ids.length > 0,
        created_by: myId,
      });
      setEditor(null);
      await refresh();
      onStatus?.(
        editor.participant_ids.length
          ? "Saved and shared with selected people"
          : "Saved to your calendar"
      );
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: string) {
    setBusy(true);
    try {
      await peerApi.deleteCalendarItem(id);
      if (editor?.id === id) setEditor(null);
      await refresh();
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTodo(it: CalendarItem) {
    if (it.kind !== "todo") return;
    try {
      await peerApi.setCalendarTodoDone(it.id, !it.done);
      await refresh();
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    }
  }

  function openEdit(it: CalendarItem) {
    setEditor({
      id: it.id,
      title: it.title,
      body: it.body || "",
      kind: it.kind,
      day: it.day,
      time: it.time || "",
      participant_ids: [...(it.participant_ids || [])].filter((id) => id !== myId),
      done: !!it.done,
    });
  }

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Box sx={{ px: 2.5, pt: 2, pb: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.main",
              color: "primary.contrastText",
            }}
          >
            <EventIcon />
          </Box>
          <Box flex={1} minWidth={0}>
            <Typography variant="h6" fontWeight={700}>
              Calendar
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Notes, reminders, and meetings — share with people on this LAN.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            flex: { xs: "0 0 auto", md: "1 1 55%" },
            p: 2,
            borderRight: { md: "1px solid" },
            borderColor: "divider",
            overflow: "auto",
          }}
        >
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
            <IconButton
              size="small"
              aria-label="Previous month"
              onClick={() =>
                setCursor((c) => {
                  const d = new Date(c.y, c.m - 1, 1);
                  return { y: d.getFullYear(), m: d.getMonth() };
                })
              }
            >
              <ChevronLeftIcon />
            </IconButton>
            <Typography fontWeight={700}>{monthLabel(cursor.y, cursor.m)}</Typography>
            <IconButton
              size="small"
              aria-label="Next month"
              onClick={() =>
                setCursor((c) => {
                  const d = new Date(c.y, c.m + 1, 1);
                  return { y: d.getFullYear(), m: d.getMonth() };
                })
              }
            >
              <ChevronRightIcon />
            </IconButton>
          </Stack>

          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 0.5,
              mb: 0.5,
            }}
          >
            {weekdays.map((w) => (
              <Typography
                key={w}
                variant="caption"
                color="text.secondary"
                fontWeight={600}
                textAlign="center"
              >
                {w}
              </Typography>
            ))}
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0.5 }}>
            {grid.map((cell) => {
              if (cell.day == null) {
                return <Box key={cell.key} sx={{ aspectRatio: "1", minHeight: 40 }} />;
              }
              const count = byDay.get(cell.key)?.length || 0;
              const selected = cell.key === selectedDay;
              const isToday = cell.key === today;
              return (
                <Box
                  key={cell.key}
                  component="button"
                  type="button"
                  onClick={() => setSelectedDay(cell.key)}
                  sx={{
                    aspectRatio: "1",
                    minHeight: 44,
                    border: "1px solid",
                    borderColor: selected ? "primary.main" : "divider",
                    borderRadius: 2,
                    bgcolor: selected ? "action.selected" : "background.paper",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 0.25,
                    p: 0.5,
                    color: "text.primary",
                  }}
                >
                  <Typography
                    fontSize={14}
                    fontWeight={isToday || selected ? 700 : 500}
                    color={isToday ? "primary.main" : "inherit"}
                  >
                    {cell.day}
                  </Typography>
                  {count > 0 && (
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        bgcolor: "primary.main",
                      }}
                    />
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>

        <Box
          sx={{
            flex: { xs: "1 1 auto", md: "1 1 45%" },
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            p: 2,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
            <Typography fontWeight={700} flex={1}>
              {parseDay(selectedDay).toLocaleDateString(undefined, {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            </Typography>
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setEditor(emptyDraft(selectedDay))}
            >
              Add
            </Button>
          </Stack>

          <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {!dayItems.length ? (
              <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>
                Nothing on this day. Add a note, reminder, meeting, or to-do.
              </Typography>
            ) : (
              <List dense disablePadding>
                {dayItems.map((it) => (
                  <ListItemButton
                    key={it.id}
                    onClick={() => openEdit(it)}
                    sx={{ borderRadius: 2, mb: 0.5, alignItems: "flex-start" }}
                  >
                    {it.kind === "todo" && (
                      <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                        <Checkbox
                          edge="start"
                          checked={!!it.done}
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleTodo(it);
                          }}
                          size="small"
                        />
                      </ListItemIcon>
                    )}
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                          <Typography
                            fontWeight={600}
                            sx={{ textDecoration: it.done ? "line-through" : "none" }}
                          >
                            {it.time ? `${it.time} · ` : ""}
                            {it.title}
                          </Typography>
                          <Chip size="small" label={it.kind} sx={{ height: 20, fontSize: 11 }} />
                          {it.shared && (
                            <Chip
                              size="small"
                              color="primary"
                              variant="outlined"
                              label="Shared"
                              sx={{ height: 20, fontSize: 11 }}
                            />
                          )}
                        </Stack>
                      }
                      secondary={
                        it.body?.trim()
                          ? it.body
                          : it.shared
                            ? `${(it.participant_ids || []).length} people`
                            : it.created_by === myId
                              ? "Personal"
                              : "From a peer"
                      }
                      secondaryTypographyProps={{ noWrap: true }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Box>
        </Box>
      </Box>

      <Dialog open={!!editor} onClose={() => !busy && setEditor(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editor?.id ? "Edit item" : "New calendar item"}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 1 }}>
          {editor && (
            <>
              <TextField
                label="Title"
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                fullWidth
                autoFocus
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <TextField
                  select
                  label="Type"
                  value={editor.kind}
                  onChange={(e) =>
                    setEditor({ ...editor, kind: e.target.value as CalendarKind })
                  }
                  sx={{ minWidth: 140 }}
                >
                  {KINDS.map((k) => (
                    <MenuItem key={k.value} value={k.value}>
                      {k.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Date"
                  type="date"
                  value={editor.day}
                  onChange={(e) => setEditor({ ...editor, day: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Time"
                  type="time"
                  value={editor.time}
                  onChange={(e) => setEditor({ ...editor, time: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  helperText="Optional"
                  sx={{ flex: 1 }}
                />
              </Stack>
              <TextField
                label="Details"
                value={editor.body}
                onChange={(e) => setEditor({ ...editor, body: e.target.value })}
                fullWidth
                multiline
                minRows={2}
                placeholder='e.g. Meeting at conference hall, 2 PM'
              />
              <Box>
                <Typography variant="subtitle2" fontWeight={700} mb={0.5}>
                  Include people on this LAN
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                  Selected peers get this item on their calendar too ({myName} stays owner).
                </Typography>
                {!others.length ? (
                  <Typography variant="body2" color="text.secondary">
                    No online peers discovered yet.
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: 160, overflow: "auto" }}>
                    {others.map((p) => {
                      const checked = editor.participant_ids.includes(p.user_id);
                      return (
                        <FormControlLabel
                          key={p.user_id}
                          control={
                            <Checkbox
                              size="small"
                              checked={checked}
                              onChange={() => {
                                setEditor({
                                  ...editor,
                                  participant_ids: checked
                                    ? editor.participant_ids.filter((id) => id !== p.user_id)
                                    : [...editor.participant_ids, p.user_id],
                                });
                              }}
                            />
                          }
                          label={
                            <Typography fontSize={14}>
                              {p.display_name}
                              {p.online ? "" : " (offline)"}
                            </Typography>
                          }
                        />
                      );
                    })}
                  </Box>
                )}
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {editor?.id && (
            <Button
              color="error"
              startIcon={<DeleteOutlineIcon />}
              disabled={busy}
              onClick={() => editor.id && void removeItem(editor.id)}
              sx={{ mr: "auto" }}
            >
              Delete
            </Button>
          )}
          <Button disabled={busy} onClick={() => setEditor(null)}>
            Cancel
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void saveDraft()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
