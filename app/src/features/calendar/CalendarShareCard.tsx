import { Box, Button, Stack, Typography } from "@mui/material";
import EventIcon from "@mui/icons-material/EventRounded";
import type { CalendarKind } from "../../peer";

export type CalendarSharePayload = {
  type: "invite";
  itemId: string;
  title: string;
  kind: CalendarKind;
  day: string;
  time?: string | null;
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

function kindLabel(kind: string) {
  if (kind === "todo") return "To-do";
  if (kind === "meeting") return "Meeting";
  if (kind === "reminder") return "Reminder";
  return "Note";
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
    if (time && time.trim()) return `${datePart} · ${time}`;
    return datePart;
  } catch {
    return time ? `${day} · ${time}` : day;
  }
}

export function CalendarShareCard(props: {
  payload: CalendarSharePayload;
  mine: boolean;
  peerName: string;
  onOpen: () => void;
}) {
  const { payload, mine, peerName, onOpen } = props;
  const headline = mine
    ? `You shared a ${kindLabel(payload.kind).toLowerCase()} with ${peerName}`
    : `${payload.fromName || peerName} shared a ${kindLabel(payload.kind).toLowerCase()}`;

  return (
    <Box sx={{ minWidth: 220, maxWidth: 300, pr: 1.5, py: 0.25 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 0.75 }}>
        <EventIcon sx={{ fontSize: 20, mt: 0.15, color: "primary.main" }} />
        <Box minWidth={0}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>
            {headline}
          </Typography>
          <Typography sx={{ fontSize: 13, mt: 0.35, fontWeight: 600 }} noWrap>
            {payload.title}
          </Typography>
          <Typography sx={{ fontSize: 12, mt: 0.25, color: "text.secondary" }}>
            {formatWhen(payload.day, payload.time)}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" justifyContent="flex-end">
        <Button size="small" variant="contained" onClick={onOpen}>
          View
        </Button>
      </Stack>
    </Box>
  );
}
