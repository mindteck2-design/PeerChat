import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddRounded";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightIcon from "@mui/icons-material/ChevronRightRounded";
import EventIcon from "@mui/icons-material/EventRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActiveRounded";
import StickyNote2Icon from "@mui/icons-material/StickyNote2Rounded";
import CheckCircleIcon from "@mui/icons-material/CheckCircleRounded";
import PersonOutlineIcon from "@mui/icons-material/PersonOutlineRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import { listen } from "@tauri-apps/api/event";
import { peerApi, type CalendarItem, type Peer, type CalendarKind } from "../../peer";
import { CalendarItemEditor } from "./CalendarItemEditor";
import { CalendarItemViewDialog } from "./CalendarItemViewDialog";
import {
  dayKey,
  daysInMonth,
  formatTime12,
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
  KIND_THEMES,
  type CalendarDraft,
} from "./calendarTypes";

function itemToDraft(it: CalendarItem, _myId?: string): CalendarDraft {
  const checklist = parseChecklist(it.checklist);
  // Keep full participant_ids (including the local user when they are a sharee).
  // Filtering "me" out here made sharees see Participants (1) and "2/1 acknowledged".
  return {
    id: it.id,
    title: it.title,
    body: it.body || "",
    kind: it.kind,
    day: it.day,
    time: it.time || "",
    meeting_url: it.meeting_url || "",
    participant_ids: [...(it.participant_ids || [])],
    created_by: it.created_by,
    done: !!it.done,
    checklist:
      it.kind === "todo" && checklist.length === 0 ? [newChecklistOption("")] : checklist,
    acks: parseAcks(it.acks),
    shared: !!it.shared,
  };
}

function KindBadgeIcon({ kind, sx }: { kind: CalendarKind; sx?: any }) {
  switch (kind) {
    case "meeting":
      return <GroupsIcon sx={sx} />;
    case "todo":
      return <CheckCircleOutlineIcon sx={sx} />;
    case "reminder":
      return <NotificationsActiveIcon sx={sx} />;
    case "note":
    default:
      return <StickyNote2Icon sx={sx} />;
  }
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
  meeting_url?: string | null;
  /** When set, chat cards should show a deleted tombstone instead of the invite. */
  deleted?: boolean;
};

const timelineScrollSx = {
  scrollbarWidth: "thin" as const,
  scrollbarColor: "rgba(255,255,255,0.2) transparent",
  "&::-webkit-scrollbar": { width: 6 },
  "&::-webkit-scrollbar-track": { background: "transparent" },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 8,
  },
  "&::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "rgba(255,255,255,0.35)",
  },
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
  const [viewItem, setViewItem] = useState<CalendarDraft | null>(null);
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
      setViewItem((prev) => {
        if (!prev?.id) return prev;
        const updated = rows.find((r) => r.id === prev.id);
        return updated ? itemToDraft(updated, myId) : prev;
      });
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

  // Deep-link from chat View button — move month/day then open view dialog.
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
      setViewItem(itemToDraft(hit, myId));
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

  // Chronologically sorted items for timeline day view
  const sortedDayItems = useMemo(() => {
    return [...dayItems].sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time && !b.time) return -1;
      if (!a.time && b.time) return 1;
      return a.title.localeCompare(b.title);
    });
  }, [dayItems]);

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
        meeting_url:
          editor.kind === "meeting" && editor.meeting_url?.trim()
            ? editor.meeting_url.trim()
            : null,
        participant_ids: editor.participant_ids.filter((id) => id !== myId),
        done: editor.done,
        shared: editor.participant_ids.filter((id) => id !== myId).length > 0,
        created_by: myId,
        checklist: editor.kind === "todo" ? editor.checklist : [],
        acks: editor.acks || {},
      });
      const savedParts = (saved?.participant_ids || editor.participant_ids || []).filter(
        (id: string) => id !== myId
      );
      const notifyIds = savedParts.filter((id: string) => !prevParts.includes(id));
      if (onNotifyShare && notifyIds.length && saved?.id) {
        for (const peerId of notifyIds) {
          try {
            await onNotifyShare(peerId, {
              itemId: saved.id,
              title: saved.title || editor.title.trim(),
              kind: saved.kind || editor.kind,
              day: saved.day || editor.day,
              time: saved.time ?? (editor.time.trim() || null),
              meeting_url: saved.meeting_url ?? null,
            });
          } catch (err: any) {
            onStatus?.(err?.message || String(err));
          }
        }
      }
      setEditor(null);
      await refresh();
      onStatus?.(
        savedParts.length
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
    const existing = items.find((it) => it.id === id);
    const recipients = [...(existing?.participant_ids || [])].filter((pid) => pid && pid !== myId);
    setBusy(true);
    try {
      await peerApi.deleteCalendarItem(id);
      if (onNotifyShare && recipients.length && existing) {
        for (const peerId of recipients) {
          try {
            await onNotifyShare(peerId, {
              itemId: id,
              title: existing.title,
              kind: existing.kind,
              day: existing.day,
              time: existing.time ?? null,
              meeting_url: existing.meeting_url ?? null,
              deleted: true,
            });
          } catch (err: any) {
            onStatus?.(err?.message || String(err));
          }
        }
      }
      if (editor?.id === id) setEditor(null);
      if (viewItem?.id === id) setViewItem(null);
      await refresh();
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleOption(optionId: string, checked: boolean) {
    const targetId = viewItem?.id || editor?.id;
    if (!targetId) return;
    try {
      await peerApi.toggleCalendarChecklistOption(targetId, optionId, checked);
      await refresh();
    } catch (err: any) {
      onStatus?.(err?.message || String(err));
    }
  }

  async function ackItem() {
    const targetId = viewItem?.id || editor?.id;
    if (!targetId) return;
    try {
      await peerApi.ackCalendarItem(targetId);
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

  function jumpToToday() {
    const now = new Date();
    setCursor({ y: now.getFullYear(), m: now.getMonth() });
    setSelectedDay(today);
  }

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Top Header */}
      <Box sx={{ px: 2.5, pt: 2, pb: 1.5, borderBottom: "1px solid", borderColor: "divider" }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2.5,
              display: "grid",
              placeItems: "center",
              bgcolor: "primary.main",
              color: "primary.contrastText",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          >
            <EventIcon fontSize="medium" />
          </Box>
          <Box flex={1} minWidth={0}>
            <Typography variant="h6" fontWeight={700} lineHeight={1.2}>
              Calendar
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Notes, reminders, to-dos and meetings — share with people on this LAN.
            </Typography>
          </Box>
        </Stack>
      </Box>

      {/* Main Content Area: Left Month Grid, Right Day Timeline */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          overflow: "hidden",
        }}
      >
        {/* Section 2: Month View (Left ~40%) */}
        <Box
          sx={{
            flex: { xs: "0 0 auto", md: "0 0 40%" },
            maxWidth: { md: "40%" },
            p: { xs: 1.5, md: 2 },
            borderRight: { md: "1px solid" },
            borderColor: "divider",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {/* Month Navigation Row */}
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
            <Stack direction="row" alignItems="center" spacing={0.5}>
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
              <Typography fontWeight={700} fontSize="1.05rem" sx={{ px: 0.5, minWidth: 140 }}>
                {monthLabel(cursor.y, cursor.m)}
              </Typography>
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

            <Button
              size="small"
              variant="outlined"
              onClick={jumpToToday}
              sx={{
                borderRadius: 2,
                textTransform: "none",
                fontWeight: 600,
                fontSize: "0.8rem",
                px: 1.5,
              }}
            >
              Today
            </Button>
          </Stack>

          {/* Weekday Labels Header */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 0.5,
              mb: 0.75,
              width: "100%",
            }}
          >
            {weekdays.map((w) => (
              <Typography
                key={w}
                variant="caption"
                color="text.secondary"
                fontWeight={600}
                textAlign="center"
                sx={{ textTransform: "uppercase", fontSize: "0.72rem", letterSpacing: "0.5px" }}
              >
                {w}
              </Typography>
            ))}
          </Box>

          {/* Month Day Cells — modest size (not stretched to fill viewport) */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
              gap: 0.6,
              width: "100%",
              flex: "0 0 auto",
            }}
          >
            {grid.map((cell) => {
              if (cell.day == null) {
                return <Box key={cell.key} sx={{ height: { xs: 38, md: 44 } }} />;
              }
              const cellItems = byDay.get(cell.key) || [];
              const selected = cell.key === selectedDay;
              const isToday = cell.key === today;

              // Distinct kind types present on this day
              const kinds = Array.from(new Set(cellItems.map((i) => i.kind)));

              return (
                <Box
                  key={cell.key}
                  component="button"
                  type="button"
                  onClick={() => setSelectedDay(cell.key)}
                  sx={{
                    height: { xs: 38, md: 44 },
                    width: "100%",
                    minWidth: 0,
                    border: "1px solid",
                    borderColor: selected
                      ? "primary.main"
                      : isToday
                        ? "primary.light"
                        : "divider",
                    borderRadius: 2,
                    bgcolor: selected
                      ? "action.selected"
                      : isToday
                        ? "action.hover"
                        : "background.paper",
                    boxShadow: selected ? "0 0 0 2px rgba(99, 102, 241, 0.25)" : "none",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 0.25,
                    p: 0.25,
                    color: "text.primary",
                    transition: "all 0.15s ease",
                    "&:hover": {
                      borderColor: "primary.main",
                      bgcolor: "action.hover",
                    },
                  }}
                >
                  <Typography
                    fontSize={{ xs: 14, md: 16 }}
                    fontWeight={isToday || selected ? 700 : 600}
                    color={isToday ? "primary.main" : "inherit"}
                    lineHeight={1.1}
                  >
                    {cell.day}
                  </Typography>

                  {/* Clean Status Indicator Dots (Mockup Section 2) */}
                  <Box sx={{ height: 5, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {kinds.length > 0 && (
                      <Stack direction="row" spacing={0.35} alignItems="center" justifyContent="center">
                        {kinds.slice(0, 4).map((kind) => (
                          <Box
                            key={kind}
                            sx={{
                              width: 4.5,
                              height: 4.5,
                              borderRadius: "50%",
                              bgcolor: KIND_THEMES[kind]?.color || "primary.main",
                            }}
                          />
                        ))}
                      </Stack>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Section 3: Day View Timeline (Right ~60%) */}
        <Box
          sx={{
            flex: { xs: 1, md: "0 0 60%" },
            maxWidth: { md: "60%" },
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            p: { xs: 2, md: 2.5 },
          }}
        >
          {/* Day View Header */}
          <Stack direction="row" alignItems="center" spacing={1} mb={2}>
            <Box flex={1} minWidth={0}>
              <Typography fontWeight={700} fontSize="1.05rem" noWrap>
                {parseDay(selectedDay).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openNew}
              sx={{
                borderRadius: 2,
                textTransform: "none",
                fontWeight: 600,
                px: 1.75,
              }}
            >
              Add{pastSelected ? " note" : ""}
            </Button>
          </Stack>

          {/* Timeline Scrollable Container */}
          <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, pr: 0.5, ...timelineScrollSx }}>
            {!sortedDayItems.length ? (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  py: 6,
                  px: 2,
                  textAlign: "center",
                  bgcolor: "action.hover",
                  borderRadius: 3,
                  border: "1px dashed",
                  borderColor: "divider",
                  mt: 1,
                }}
              >
                <EventIcon sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                <Typography color="text.secondary" variant="body2" fontWeight={500}>
                  {pastSelected
                    ? "Nothing on this day. You can still add a note."
                    : "No events scheduled for this day."}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={openNew}
                  sx={{ mt: 1.5, borderRadius: 2, textTransform: "none" }}
                >
                  Create an item
                </Button>
              </Box>
            ) : (
              <Box sx={{ position: "relative", pt: 1, pb: 2 }}>
                {sortedDayItems.map((it, idx) => {
                  const theme = KIND_THEMES[it.kind] || KIND_THEMES.note;
                  const timeLabel = it.time ? formatTime12(it.time) : "All day";

                  // Details and summaries based on type
                  const checklistOpts = parseChecklist(it.checklist);
                  const doneOpts = checklistOpts.filter((o) => o.checked_by.length > 0).length;
                  const isTodo = it.kind === "todo";

                  // Acknowledgement metadata for meetings/reminders
                  const ackCount = Object.keys(it.acks || {}).length;
                  const totalExpected = Array.from(
                    new Set([it.created_by, ...(it.participant_ids || [])].filter(Boolean))
                  ).length;

                  // Creator / Shared text
                  const creatorName =
                    it.created_by === myId
                      ? "You"
                      : peers.find((p) => p.user_id === it.created_by)?.display_name || "Peer";

                  return (
                    <Box
                      key={it.id}
                      sx={{
                        display: "flex",
                        gap: 1.5,
                        position: "relative",
                        mb: 2,
                        "&:last-child": { mb: 0 },
                      }}
                    >
                      {/* Left Time Marker & Timeline Rail */}
                      <Box
                        sx={{
                          width: 72,
                          flexShrink: 0,
                          textAlign: "right",
                          pt: 0.5,
                        }}
                      >
                        <Typography
                          variant="caption"
                          fontWeight={600}
                          sx={{
                            color: it.time ? "text.primary" : "text.secondary",
                            fontSize: "0.78rem",
                            display: "block",
                          }}
                        >
                          {timeLabel}
                        </Typography>
                      </Box>

                      {/* Vertical Connector Line & Dot */}
                      <Box
                        sx={{
                          position: "relative",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          width: 14,
                          flexShrink: 0,
                        }}
                      >
                        {/* Dot Node */}
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            bgcolor: theme.color,
                            border: "2px solid",
                            borderColor: "background.paper",
                            boxShadow: `0 0 0 2px ${theme.color}`,
                            mt: 0.75,
                            zIndex: 1,
                          }}
                        />
                        {/* Vertical line connecting nodes */}
                        {idx < sortedDayItems.length - 1 && (
                          <Box
                            sx={{
                              width: 2,
                              flex: 1,
                              bgcolor: "divider",
                              my: 0.5,
                            }}
                          />
                        )}
                      </Box>

                      {/* Right Item Card (Mockup Section 3) */}
                      <Paper
                        elevation={0}
                        onClick={() => setViewItem(itemToDraft(it, myId))}
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          p: 1.75,
                          borderRadius: 2.5,
                          bgcolor: "background.paper",
                          border: "1px solid",
                          borderColor: "divider",
                          borderLeft: `4px solid ${theme.color}`,
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                          "&:hover": {
                            borderColor: theme.border,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                          },
                        }}
                      >
                        {/* Card Header Row */}
                        <Stack direction="row" alignItems="flex-start" spacing={1.25}>
                          {/* Type Icon Chip */}
                          <Box
                            sx={{
                              width: 32,
                              height: 32,
                              borderRadius: 2,
                              display: "grid",
                              placeItems: "center",
                              bgcolor: theme.bg,
                              color: theme.color,
                              flexShrink: 0,
                              mt: 0.25,
                            }}
                          >
                            <KindBadgeIcon kind={it.kind} sx={{ fontSize: 18 }} />
                          </Box>

                          {/* Titles and Subtitle */}
                          <Box flex={1} minWidth={0}>
                            <Typography fontWeight={700} fontSize="0.95rem" lineHeight={1.3} noWrap>
                              {it.title}
                            </Typography>
                            <Stack direction="row" spacing={0.75} alignItems="center" mt={0.25}>
                              <Typography
                                variant="caption"
                                fontWeight={600}
                                sx={{ color: theme.color, fontSize: "0.75rem" }}
                              >
                                {theme.label}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                •
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {it.shared ? "Shared" : "Personal"}
                              </Typography>
                            </Stack>
                          </Box>

                          {/* Open Button */}
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewItem(itemToDraft(it, myId));
                            }}
                            sx={{
                              borderRadius: 2,
                              textTransform: "none",
                              fontSize: "0.78rem",
                              py: 0.35,
                              px: 1.5,
                              flexShrink: 0,
                            }}
                          >
                            Open
                          </Button>
                        </Stack>

                        {/* Card Body & Progress Section */}
                        {isTodo && checklistOpts.length > 0 && (
                          <Box sx={{ mt: 1.5 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.5}>
                              <Typography variant="caption" color="text.secondary" fontWeight={500}>
                                Checklist
                              </Typography>
                              <Typography variant="caption" fontWeight={600} color={theme.color}>
                                {doneOpts}/{checklistOpts.length} completed
                              </Typography>
                            </Stack>
                            <LinearProgress
                              variant="determinate"
                              value={(doneOpts / checklistOpts.length) * 100}
                              sx={{
                                height: 5,
                                borderRadius: 3,
                                bgcolor: "action.hover",
                                "& .MuiLinearProgress-bar": {
                                  bgcolor: theme.color,
                                  borderRadius: 3,
                                },
                              }}
                            />
                          </Box>
                        )}

                        {it.kind === "meeting" && (
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" mt={1.25}>
                            {it.shared && totalExpected > 0 && (
                              <Chip
                                size="small"
                                icon={<CheckCircleIcon sx={{ fontSize: "14px !important" }} />}
                                label={`${ackCount}/${totalExpected} acknowledged`}
                                sx={{
                                  height: 22,
                                  fontSize: "0.75rem",
                                  bgcolor: "rgba(34, 197, 94, 0.12)",
                                  color: "#22c55e",
                                  fontWeight: 600,
                                  "& .MuiChip-icon": { color: "#22c55e" },
                                }}
                              />
                            )}
                            {it.shared && (
                              <Stack direction="row" spacing={0.5} alignItems="center">
                                <PersonOutlineIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                                <Typography variant="caption" color="text.secondary">
                                  {
                                    Array.from(
                                      new Set(
                                        [it.created_by, ...(it.participant_ids || [])].filter(Boolean)
                                      )
                                    ).length
                                  }{" "}
                                  participants
                                </Typography>
                              </Stack>
                            )}
                            {it.meeting_url && (
                              <Chip
                                size="small"
                                icon={<OpenInNewIcon sx={{ fontSize: "13px !important" }} />}
                                label="Join Link"
                                clickable
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void peerApi.openExternalUrl(it.meeting_url!);
                                }}
                                sx={{
                                  height: 22,
                                  fontSize: "0.75rem",
                                  bgcolor: "rgba(59, 130, 246, 0.12)",
                                  color: "#3b82f6",
                                  fontWeight: 600,
                                }}
                              />
                            )}
                          </Stack>
                        )}

                        {it.kind === "reminder" && it.shared && totalExpected > 0 && (
                          <Box mt={1.25}>
                            <Chip
                              size="small"
                              icon={<CheckCircleIcon sx={{ fontSize: "14px !important" }} />}
                              label={`${ackCount}/${totalExpected} acknowledged`}
                              sx={{
                                height: 22,
                                fontSize: "0.75rem",
                                bgcolor: "rgba(34, 197, 94, 0.12)",
                                color: "#22c55e",
                                fontWeight: 600,
                                "& .MuiChip-icon": { color: "#22c55e" },
                              }}
                            />
                          </Box>
                        )}

                        {it.kind === "note" && (
                          <Box mt={1}>
                            {it.body?.trim() && (
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                  fontSize: "0.82rem",
                                  display: "-webkit-box",
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: "vertical",
                                  overflow: "hidden",
                                  mb: 0.5,
                                }}
                              >
                                {it.body}
                              </Typography>
                            )}
                            {it.shared && (
                              <Typography variant="caption" color="text.secondary" fontStyle="italic">
                                {it.created_by === myId ? "Shared with peers" : `Shared by ${creatorName}`}
                              </Typography>
                            )}
                          </Box>
                        )}
                      </Paper>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Read-Only Type-Specific View Dialog (Panels 4, 5, 6, 7) */}
      <CalendarItemViewDialog
        open={!!viewItem}
        item={viewItem}
        myId={myId}
        myName={myName}
        peers={others}
        today={today}
        busy={busy}
        onClose={() => setViewItem(null)}
        onEdit={() => {
          if (!viewItem) return;
          setEditor(viewItem);
          setViewItem(null);
        }}
        onDelete={() => viewItem?.id && void removeItem(viewItem.id)}
        onToggleOption={(optionId, checked) => void toggleOption(optionId, checked)}
        onAck={() => void ackItem()}
        onOpenUrl={(url) => {
          void peerApi.openExternalUrl(url).catch((err) => {
            onStatus?.(err?.message || String(err));
          });
        }}
      />

      {/* Form Editor for Creating or Modifying Items */}
      <CalendarItemEditor
        open={!!editor}
        draft={editor}
        setDraft={setEditor}
        busy={busy}
        peers={others}
        myId={myId}
        myName={myName}
        today={today}
        startInEdit={true}
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
