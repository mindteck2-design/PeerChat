import { useEffect, useState, useCallback } from "react";
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActiveRounded";
import StickyNote2Icon from "@mui/icons-material/StickyNote2Rounded";
import CheckCircleIcon from "@mui/icons-material/CheckCircleRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import ArrowForwardIcon from "@mui/icons-material/ArrowForwardRounded";
import { listen } from "@tauri-apps/api/event";
import { peerApi, type CalendarItem, type CalendarKind } from "../../peer";
import { formatTime12 } from "./calendarRules";
import { KIND_THEMES, parseChecklist } from "./calendarTypes";

export type CalendarSharePayload = {
  type: "invite";
  itemId: string;
  title: string;
  kind: CalendarKind;
  day: string;
  time?: string | null;
  meeting_url?: string | null;
  fromName?: string;
};

export function parseCalendarShare(raw: string): CalendarSharePayload | null {
  try {
    const o = JSON.parse(raw);
    if (
      o &&
      o.type === "invite" &&
      typeof o.itemId === "string" &&
      o.itemId &&
      typeof o.title === "string" &&
      typeof o.kind === "string" &&
      typeof o.day === "string"
    ) {
      return o as CalendarSharePayload;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function KindIcon({ kind, sx }: { kind: CalendarKind; sx?: any }) {
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

function formatWhen(day: string, time?: string | null) {
  try {
    const [y, m, d] = day.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    const datePart = dt.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (time && time.trim()) return `${datePart} · ${formatTime12(time)}`;
    return datePart;
  } catch {
    return time ? `${day} · ${formatTime12(time)}` : day;
  }
}

export function CalendarShareCard(props: {
  payload: CalendarSharePayload;
  mine: boolean;
  peerName: string;
  onOpen: () => void;
}) {
  const { payload, mine, peerName, onOpen } = props;
  const [liveItem, setLiveItem] = useState<CalendarItem | null>(null);
  const [busy, setBusy] = useState(false);

  const kind = (liveItem?.kind || payload.kind) as CalendarKind;
  const theme = KIND_THEMES[kind] || KIND_THEMES.note;

  // Refresh live item from SQLite
  const fetchLive = useCallback(async () => {
    try {
      const hit = await peerApi.getCalendarItem(payload.itemId);
      if (hit) {
        setLiveItem(hit);
      } else {
        const items = await peerApi.listCalendarItems(payload.day, payload.day);
        const dayHit = items.find((i) => i.id === payload.itemId);
        if (dayHit) setLiveItem(dayHit);
      }
    } catch {
      /* ignore offline or not yet delivered */
    }
  }, [payload.day, payload.itemId]);

  useEffect(() => {
    void fetchLive();
  }, [fetchLive]);

  // Listen for real-time calendar updates
  useEffect(() => {
    let un: (() => void) | undefined;
    void listen<{ kind?: string }>("inbox-updated", (ev) => {
      if (ev.payload?.kind === "calendar_share") void fetchLive();
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, [fetchLive]);

  // Acknowledgement tracking
  const acks = liveItem?.acks || {};
  const ackCount = Object.keys(acks).length;
  const totalExpected = Array.from(
    new Set([liveItem?.created_by, ...(liveItem?.participant_ids || [])].filter(Boolean))
  ).length;

  // Checklist calculations
  const checklist = parseChecklist(liveItem?.checklist);
  const doneCount = checklist.filter((o) => o.checked_by.length > 0).length;

  const meetingUrl = liveItem?.meeting_url || payload.meeting_url;

  async function handleAck() {
    setBusy(true);
    try {
      await peerApi.ackCalendarItem(payload.itemId);
      await fetchLive();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        minWidth: 240,
        maxWidth: 320,
        pl: 1.25,
        pr: 0.5,
        py: 0.25,
        borderLeft: `3.5px solid ${theme.color}`,
        color: "text.primary",
      }}
    >
      {/* Header with Type Icon, Label and Author */}
      <Stack direction="row" alignItems="center" spacing={1} mb={0.75}>
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: 1.5,
            display: "grid",
            placeItems: "center",
            bgcolor: theme.bg,
            color: theme.color,
            flexShrink: 0,
          }}
        >
          <KindIcon kind={kind} sx={{ fontSize: 14 }} />
        </Box>
        <Box flex={1} minWidth={0}>
          <Typography
            variant="caption"
            fontWeight={700}
            sx={{
              color: theme.color,
              textTransform: "uppercase",
              fontSize: "0.7rem",
              letterSpacing: "0.5px",
            }}
          >
            {theme.label}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" fontSize="0.72rem" sx={{ opacity: 0.85 }}>
          {mine ? "Sent" : `From ${payload.fromName || peerName}`}
        </Typography>
      </Stack>

      {/* Title */}
      <Typography fontWeight={700} fontSize="0.9rem" lineHeight={1.25} mb={0.35} noWrap>
        {liveItem?.title || payload.title}
      </Typography>

      {/* Date & Time */}
      <Typography variant="caption" color="text.secondary" display="block" mb={0.75} fontSize="0.75rem">
        {formatWhen(liveItem?.day || payload.day, liveItem?.time || payload.time)}
      </Typography>

      {/* Meeting URL Join Banner (if present) */}
      {kind === "meeting" && meetingUrl && meetingUrl.trim() && (
        <Box
          sx={{
            p: 0.85,
            px: 1,
            mb: 1,
            borderRadius: 2,
            bgcolor: "rgba(59, 130, 246, 0.12)",
            border: "1px solid rgba(59, 130, 246, 0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <Typography variant="caption" color="primary.main" fontWeight={600} noWrap sx={{ maxWidth: 160 }}>
            {meetingUrl}
          </Typography>
          <Button
            size="small"
            variant="contained"
            startIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
            onClick={() => void peerApi.openExternalUrl(meetingUrl)}
            sx={{
              borderRadius: 1.5,
              textTransform: "none",
              fontSize: "0.7rem",
              py: 0.2,
              px: 1,
            }}
          >
            Join
          </Button>
        </Box>
      )}

      {/* To-Do Checklist Progress */}
      {kind === "todo" && checklist.length > 0 && (
        <Box mb={1}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={0.35}>
            <Typography variant="caption" color="text.secondary" fontSize="0.72rem">
              Progress
            </Typography>
            <Typography variant="caption" fontWeight={600} color={theme.color} fontSize="0.72rem">
              {doneCount}/{checklist.length} completed
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={(doneCount / checklist.length) * 100}
            sx={{
              height: 4,
              borderRadius: 2,
              bgcolor: "action.hover",
              "& .MuiLinearProgress-bar": {
                bgcolor: theme.color,
                borderRadius: 2,
              },
            }}
          />
        </Box>
      )}

      {/* Meeting & Reminder Acknowledgement Status */}
      {(kind === "meeting" || kind === "reminder") && totalExpected > 0 && (
        <Box mb={1}>
          <Chip
            size="small"
            icon={<CheckCircleIcon sx={{ fontSize: "12px !important" }} />}
            label={`${ackCount}/${totalExpected} acknowledged`}
            sx={{
              height: 20,
              fontSize: "0.7rem",
              bgcolor: "rgba(34, 197, 94, 0.12)",
              color: "#22c55e",
              fontWeight: 600,
              "& .MuiChip-icon": { color: "#22c55e" },
            }}
          />
        </Box>
      )}

      {/* Note Preview Body */}
      {kind === "note" && (liveItem?.body?.trim() || "") && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            fontSize: "0.78rem",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            mb: 1,
            lineHeight: 1.35,
          }}
        >
          {liveItem?.body}
        </Typography>
      )}

      {/* Action Buttons Row */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        mt={0.75}
        pt={0.5}
        borderTop="1px solid"
        borderColor="divider"
      >
        {/* Contextual Action (Accept / Acknowledge) */}
        <Box>
          {(kind === "meeting" || kind === "reminder") && !mine && (
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled={busy}
              onClick={handleAck}
              sx={{
                borderRadius: 1.5,
                textTransform: "none",
                fontSize: "0.72rem",
                py: 0.2,
                px: 1,
                fontWeight: 600,
              }}
            >
              {kind === "meeting" ? "Accept" : "Acknowledge"}
            </Button>
          )}
        </Box>

        {/* View in Calendar Link */}
        <Button
          size="small"
          variant="text"
          endIcon={<ArrowForwardIcon sx={{ fontSize: 13 }} />}
          onClick={onOpen}
          sx={{
            borderRadius: 1.5,
            textTransform: "none",
            fontSize: "0.75rem",
            fontWeight: 600,
            py: 0.2,
            px: 0.75,
            color: "primary.main",
          }}
        >
          View in Calendar
        </Button>
      </Stack>
    </Box>
  );
}
