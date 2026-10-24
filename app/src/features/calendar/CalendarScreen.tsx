import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddRounded";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightIcon from "@mui/icons-material/ChevronRightRounded";
import EventIcon from "@mui/icons-material/EventRounded";
import { listen } from "@tauri-apps/api/event";
import { peerApi, type CalendarItem, type Peer } from "../../peer";
import { CalendarItemEditor } from "./CalendarItemEditor";
import {
  dayKey,
  daysInMonth,
  isPastDay,
  monthLabel,
  parseDay,
  pad2,
} from "./calendarRules";
import {
  emptyDraft,
  newChecklistOption,
  parseAcks,
  parseChecklist,
  type CalendarDraft,
} from "./calendarTypes";

function itemToDraft(it: CalendarItem, myId: string): CalendarDraft {
  const checklist = parseChecklist(it.checklist);
  return {
    id: it.id,
    title: it.title,
    body: it.body || "",
    kind: it.kind,
    day: it.day,
    time: it.time || "",
    participant_ids: [...(it.participant_ids || [])].filter((id) => id !== myId),
    created_by: it.created_by,
    done: !!it.done,
    checklist:
      it.kind === "todo" && checklist.length === 0 ? [newChecklistOption("")] : checklist,
    acks: parseAcks(it.acks),
    shared: !!it.shared,
  };
}

function checklistSummary(it: CalendarItem): string {
  const opts = parseChecklist(it.checklist);
  if (!opts.length) return it.done ? "Done" : "To-do";
  const done = opts.filter((o) => o.checked_by.length > 0).length;
  return `${done}/${opts.length} checked`;
}

export type CalendarFocusRequest = {
  itemId: string;
  day?: string;
};

export type CalendarShareNotify = {
  itemId: string;
  title: string;
  kind: CalendarItem["kind"];
  day: string;
  time?: string | null;
};

export function CalendarScreen({
  peers,
  myId,
  myName,
  onStatus,
  focusRequest,
  onFocusConsumed,
  onNotifyShare,
}: {
  peers: Peer[];
  myId: string;
  myName: string;
  onStatus?: (s: string) => void;
  /** Deep-link from chat "View" — jump to day and open the item. */
  focusRequest?: CalendarFocusRequest | null;
  onFocusConsumed?: () => void;
  /** Send a chat card to newly added participants (games-invite style). */
  onNotifyShare?: (peerId: string, share: CalendarShareNotify) => Promise<void>;
}) {
  const today = useMemo(() => dayKey(new Date()), []);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(today);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [editor, setEditor] = useState<CalendarDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const focusTries = useRef(0);

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
      setEditor((prev) => {
        if (!prev?.id) return prev;
        const updated = rows.find((r) => r.id === prev.id);
        return updated ? itemToDraft(updated, myId) : prev;
      });
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    }
  }, [myId, onStatus, range.from, range.to]);

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

  // Deep-link from chat View button — move month/day then open detail.
  useEffect(() => {
    if (!focusRequest?.itemId) {
      focusTries.current = 0;
      return;
    }
    if (focusRequest.day && /^\d{4}-\d{2}-\d{2}$/.test(focusRequest.day)) {
      const [y, m] = focusRequest.day.split("-").map(Number);
      setCursor({ y, m: m - 1 });
      setSelectedDay(focusRequest.day);
    }
  }, [focusRequest?.itemId, focusRequest?.day]);

  useEffect(() => {
    if (!focusRequest?.itemId) return;
    const hit = items.find((it) => it.id === focusRequest.itemId);
    if (hit) {
      setSelectedDay(hit.day);
      setEditor(itemToDraft(hit, myId));
      focusTries.current = 0;
      onFocusConsumed?.();
      return;
    }
    if (focusTries.current >= 8) {
      onStatus?.("Calendar item not available yet — try again in a moment.");
      focusTries.current = 0;
      onFocusConsumed?.();
      return;
    }
    focusTries.current += 1;
    const t = window.setTimeout(() => {
      void refresh();
    }, 400);
    return () => window.clearTimeout(t);
  }, [focusRequest, items, myId, onFocusConsumed, onStatus, refresh]);

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
  const pastSelected = isPastDay(selectedDay, today);

  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startPad = first.getDay();
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
    if (editor.kind === "todo") {
      const opts = editor.checklist.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
      if (!opts.length) {
        onStatus?.("Add at least one option");
        return;
      }
      editor.checklist = opts;
    }
    const wasNew = !editor.id;
    const prevParts = wasNew
      ? []
      : [...(items.find((it) => it.id === editor.id)?.participant_ids || [])];
    setBusy(true);
    try {
      const saved = await peerApi.upsertCalendarItem({
        id: editor.id,
        title: editor.title.trim(),
        body: editor.kind === "todo" ? "" : editor.body.trim(),
        kind: editor.kind,
        day: editor.day,
        time: editor.time.trim() || null,
        participant_ids: editor.participant_ids,
        done: editor.done,
        shared: editor.participant_ids.length > 0,
        created_by: myId,
        checklist: editor.kind === "todo" ? editor.checklist : [],
        acks: editor.acks || {},
      });
      const notifyIds = editor.participant_ids.filter((id) => !prevParts.includes(id));
      if (onNotifyShare && notifyIds.length && saved?.id) {
        for (const peerId of notifyIds) {
          try {
            await onNotifyShare(peerId, {
              itemId: saved.id,
              title: saved.title || editor.title.trim(),
              kind: saved.kind || editor.kind,
              day: saved.day || editor.day,
              time: saved.time ?? (editor.time.trim() || null),
            });
          } catch (err: any) {
            onStatus?.(err?.message || String(err));
          }
        }
      }
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

  async function toggleOption(optionId: string, checked: boolean) {
    if (!editor?.id) return;
    try {
      await peerApi.toggleCalendarChecklistOption(editor.id, optionId, checked);
      await refresh();
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    }
  }

  async function ackItem() {
    if (!editor?.id) return;
    try {
      await peerApi.ackCalendarItem(editor.id);
      await refresh();
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    }
  }

  function openNew() {
    const d = emptyDraft(selectedDay);
    if (pastSelected) {
      d.kind = "note";
    }
    if (d.kind === "todo") d.checklist = [newChecklistOption("")];
    setEditor(d);
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
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openNew}>
              Add{pastSelected ? " note" : ""}
            </Button>
          </Stack>

          <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {!dayItems.length ? (
              <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>
                {pastSelected
                  ? "Nothing on this day. You can still add a note."
                  : "Nothing on this day. Add a note, reminder, meeting, or to-do."}
              </Typography>
            ) : (
              <List dense disablePadding>
                {dayItems.map((it) => (
                  <ListItemButton
                    key={it.id}
                    onClick={() => setEditor(itemToDraft(it, myId))}
                    sx={{ borderRadius: 2, mb: 0.5, alignItems: "flex-start" }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                          <Typography fontWeight={600}>
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
                        it.kind === "todo"
                          ? checklistSummary(it)
                          : it.body?.trim()
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

      <CalendarItemEditor
        open={!!editor}
        draft={editor}
        setDraft={setEditor}
        busy={busy}
        peers={others}
        myId={myId}
        myName={myName}
        today={today}
        onClose={() => setEditor(null)}
        onSave={() => void saveDraft()}
        onDelete={() => editor?.id && void removeItem(editor.id)}
        onCancelEdit={() => {
          if (!editor?.id) return;
          const it = items.find((r) => r.id === editor.id);
          if (it) setEditor(itemToDraft(it, myId));
        }}
        onToggleOption={(optionId, checked) => void toggleOption(optionId, checked)}
        onAck={() => void ackItem()}
      />
    </Box>
  );
}
