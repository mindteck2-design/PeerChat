import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditIcon from "@mui/icons-material/EditRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActiveRounded";
import StickyNote2Icon from "@mui/icons-material/StickyNote2Rounded";
import CheckCircleIcon from "@mui/icons-material/CheckCircleRounded";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import CalendarTodayIcon from "@mui/icons-material/CalendarTodayRounded";
import AccessTimeIcon from "@mui/icons-material/AccessTimeRounded";
import type { Peer } from "../../peer";
import {
  canEditItem,
  canMutateLiveState,
  formatTime12,
  isOwner,
  isPastDay,
  parseDay,
} from "./calendarRules";
import { KIND_THEMES, type CalendarDraft } from "./calendarTypes";
import { TodoChecklist } from "./TodoChecklist";

const dialogScrollSx = {
  scrollbarWidth: "thin" as const,
  scrollbarColor: "var(--pc-scrollbar-thumb) transparent",
  "&::-webkit-scrollbar": { width: 7 },
  "&::-webkit-scrollbar-button": { display: "none" },
  "&::-webkit-scrollbar-track": { background: "transparent" },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: "var(--pc-scrollbar-thumb)",
    borderRadius: 999,
  },
  "&::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "var(--pc-scrollbar-thumb-hover)",
  },
};

function KindIcon({ kind, sx }: { kind: string; sx?: any }) {
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

function avatarColor(name: string): string {
  const colors = [
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#6366f1",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}

export function CalendarItemViewDialog({
  open,
  item,
  myId,
  myName,
  peers,
  today,
  busy,
  onClose,
  onEdit,
  onDelete,
  onToggleOption,
  onAck,
  onOpenUrl,
}: {
  open: boolean;
  item: (CalendarDraft & { meeting_url?: string | null }) | null;
  myId: string;
  myName: string;
  peers: Peer[];
  today: string;
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleOption: (optionId: string, checked: boolean) => void;
  onAck: () => void;
  onOpenUrl?: (url: string) => void;
}) {
  if (!item) return null;

  const past = isPastDay(item.day, today);
  const owner = isOwner(item.created_by ?? myId, myId);
  const mayEdit = canEditItem(item.kind, item.day, item.created_by ?? myId, myId, today);
  const liveOk = canMutateLiveState(item.day, today);
  const theme = KIND_THEMES[item.kind] || KIND_THEMES.note;

  const shared =
    !!item.shared ||
    item.participant_ids.length > 0 ||
    (!!item.created_by && item.created_by !== myId);

  // Participants resolution
  const allParticipantIds = Array.from(
    new Set([item.created_by, ...(item.participant_ids || [])].filter(Boolean) as string[])
  );

  const participantList = allParticipantIds.map((id) => {
    if (id === myId) {
      return { id, name: myName ? `${myName} (You)` : "You", isMe: true };
    }
    const peer = peers.find((p) => p.user_id === id);
    return { id, name: peer?.display_name || "Peer", isMe: false };
  });

  // Acknowledgement tracking
  const myAckRaw = item.acks?.[myId];
  const hasAcked =
    !!myAckRaw && !myAckRaw.startsWith("rejected|") && myAckRaw !== "rejected";
  const ackCount = Object.keys(item.acks || {}).filter((uid) => {
    const v = item.acks?.[uid] || "";
    return v && !v.startsWith("rejected|") && v !== "rejected";
  }).length;
  const totalExpected = allParticipantIds.length;
  const allAcked = totalExpected > 0 && ackCount >= totalExpected;

  // Checklist calculations
  const checklistOpts = item.checklist || [];
  const doneOpts = checklistOpts.filter((o) => o.checked_by.length > 0).length;

  const formattedDate = parseDay(item.day).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const formattedTime = item.time ? formatTime12(item.time) : null;

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          display: "flex",
          flexDirection: "column",
          maxHeight: "88vh",
          borderRadius: 2,
          bgcolor: "background.paper",
          ...dialogScrollSx,
        },
      }}
    >
      {/* Header */}
      <DialogTitle sx={{ p: 2.5, pb: 1.5 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1.5}>
          <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0} flex={1}>
            <Box
              sx={{
                width: 42,
                height: 42,
                borderRadius: 1,
                display: "grid",
                placeItems: "center",
                bgcolor: theme.bg,
                color: theme.color,
                flexShrink: 0,
              }}
            >
              <KindIcon kind={item.kind} sx={{ fontSize: 24 }} />
            </Box>
            <Box minWidth={0} flex={1}>
              <Typography variant="h6" fontWeight={700} lineHeight={1.25} noWrap>
                {item.title}
              </Typography>
              <Stack direction="row" spacing={0.75} alignItems="center" mt={0.25}>
                <Typography variant="caption" fontWeight={600} sx={{ color: theme.color }}>
                  {theme.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  •
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {shared ? "Shared" : "Personal"}
                </Typography>
                {past && (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      •
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Past Day
                    </Typography>
                  </>
                )}
              </Stack>
            </Box>
          </Stack>

          <IconButton size="small" onClick={onClose} disabled={busy} sx={{ color: "text.secondary" }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <Divider />

      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2.5,
          p: 2.5,
          overflow: "auto",
          flex: 1,
          minHeight: 0,
          ...dialogScrollSx,
        }}
      >
        {/* Date and Time Chips */}
        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap">
          <Chip
            size="medium"
            icon={<CalendarTodayIcon sx={{ fontSize: "16px !important" }} />}
            label={formattedDate}
            variant="outlined"
            sx={{ borderRadius: 2, fontWeight: 500, fontSize: "0.85rem" }}
          />
          {formattedTime && (
            <Chip
              size="medium"
              icon={<AccessTimeIcon sx={{ fontSize: "16px !important" }} />}
              label={formattedTime}
              variant="outlined"
              sx={{ borderRadius: 2, fontWeight: 500, fontSize: "0.85rem" }}
            />
          )}
        </Stack>

        {/* Meeting Link Section (if meeting_url present) */}
        {item.kind === "meeting" && item.meeting_url && item.meeting_url.trim() && (
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              borderRadius: 1.25,
              bgcolor: "rgba(59, 130, 246, 0.08)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
              <Box minWidth={0} flex={1}>
                <Typography variant="caption" color="primary.main" fontWeight={600} display="block">
                  Meeting Link
                </Typography>
                <Typography
                  variant="body2"
                  fontWeight={500}
                  noWrap
                  sx={{ color: "text.primary", mt: 0.25 }}
                >
                  {item.meeting_url}
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="small"
                startIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                onClick={() => onOpenUrl?.(item.meeting_url!)}
                sx={{
                  borderRadius: 1.25,
                  textTransform: "none",
                  fontWeight: 600,
                  px: 2,
                  flexShrink: 0,
                }}
              >
                Join Meeting
              </Button>
            </Stack>
          </Paper>
        )}

        {/* Panel 5: To-Do Interactive Checklist & Progress */}
        {item.kind === "todo" && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="subtitle2" fontWeight={700}>
                Checklist
              </Typography>
              {checklistOpts.length > 0 && (
                <Typography variant="caption" fontWeight={600} color={theme.color}>
                  {doneOpts}/{checklistOpts.length} completed
                </Typography>
              )}
            </Stack>

            {checklistOpts.length > 0 && (
              <LinearProgress
                variant="determinate"
                value={(doneOpts / checklistOpts.length) * 100}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  mb: 2,
                  bgcolor: "action.hover",
                  "& .MuiLinearProgress-bar": {
                    bgcolor: theme.color,
                    borderRadius: 3,
                  },
                }}
              />
            )}

            <TodoChecklist
              options={item.checklist}
              authoring={false}
              structureEditable={false}
              checkEnabled={liveOk}
              peers={peers}
              myId={myId}
              myName={myName}
              onToggle={liveOk ? (optionId) => onToggleOption(optionId, true) : undefined}
            />
          </Box>
        )}

        {/* Panel 4 & 6: Meeting & Reminder Participants & Acknowledgements */}
        {(item.kind === "meeting" || item.kind === "reminder") && shared && (
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.25}>
              <Typography variant="subtitle2" fontWeight={700}>
                Participants ({totalExpected})
              </Typography>
              {totalExpected > 0 && (
                <Chip
                  size="small"
                  icon={<CheckCircleIcon sx={{ fontSize: "14px !important" }} />}
                  label={`${ackCount}/${totalExpected} acknowledged`}
                  sx={{
                    height: 24,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    bgcolor: allAcked ? "rgba(34, 197, 94, 0.15)" : "rgba(34, 197, 94, 0.08)",
                    color: "#22c55e",
                    "& .MuiChip-icon": { color: "#22c55e" },
                  }}
                />
              )}
            </Stack>

            <Stack spacing={1}>
              {participantList.map((p) => {
                const ackStamp = item.acks?.[p.id];
                const isAcked =
                  !!ackStamp &&
                  !ackStamp.startsWith("rejected|") &&
                  ackStamp !== "rejected";
                return (
                  <Paper
                    key={p.id}
                    elevation={0}
                    sx={{
                      p: 1.25,
                      px: 1.5,
                      borderRadius: 2,
                      bgcolor: "action.hover",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <Avatar
                        sx={{
                          width: 28,
                          height: 28,
                          fontSize: 12,
                          fontWeight: 700,
                          bgcolor: avatarColor(p.name),
                        }}
                      >
                        {p.name.charAt(0).toUpperCase()}
                      </Avatar>
                      <Typography variant="body2" fontWeight={p.isMe ? 700 : 500}>
                        {p.name}
                      </Typography>
                    </Stack>

                    {isAcked ? (
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <CheckCircleIcon sx={{ fontSize: 16, color: "#22c55e" }} />
                        <Typography variant="caption" fontWeight={600} color="#22c55e">
                          Acknowledged
                        </Typography>
                      </Stack>
                    ) : (
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                        <Typography variant="caption" color="text.secondary">
                          Pending
                        </Typography>
                      </Stack>
                    )}
                  </Paper>
                );
              })}
            </Stack>
          </Box>
        )}

        {/* Details / Notes Content (Panel 4, 6, 7) */}
        {item.body?.trim() && (
          <Box>
            <Typography variant="subtitle2" fontWeight={700} mb={0.75}>
              {item.kind === "note" ? "Content" : "Details"}
            </Typography>
            <Paper
              elevation={0}
              sx={{
                p: 2,
                borderRadius: 1.25,
                bgcolor: "action.hover",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              <Typography variant="body2" lineHeight={1.6}>
                {item.body}
              </Typography>
            </Paper>
          </Box>
        )}

        {/* Note Participants / Shared With List (Panel 7) */}
        {item.kind === "note" && shared && participantList.length > 0 && (
          <Box>
            <Typography variant="subtitle2" fontWeight={700} mb={1}>
              Shared with
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {participantList.map((p) => (
                <Chip
                  key={p.id}
                  size="small"
                  avatar={
                    <Avatar sx={{ bgcolor: avatarColor(p.name), fontSize: 11, fontWeight: 700 }}>
                      {p.name.charAt(0).toUpperCase()}
                    </Avatar>
                  }
                  label={p.name}
                  variant="outlined"
                  sx={{ borderRadius: 1 }}
                />
              ))}
            </Stack>
          </Box>
        )}
      </DialogContent>

      <Divider />

      {/* Footer Actions */}
      <DialogActions sx={{ px: 2.5, py: 1.5, justifyContent: "space-between" }}>
        {/* Left Actions: Delete (owner) */}
        <Box>
          {mayEdit && (
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              disabled={busy}
              onClick={onDelete}
              sx={{ textTransform: "none", fontWeight: 600, borderRadius: 1.25 }}
            >
              Delete
            </Button>
          )}
        </Box>

        {/* Right Actions: Acknowledge, Edit, Close */}
        <Stack direction="row" spacing={1} alignItems="center">
          {/* Sharees only — owners don't need to acknowledge their own item */}
          {!owner &&
            (item.kind === "meeting" || item.kind === "reminder") &&
            shared &&
            liveOk &&
            !hasAcked && (
            <Button
              size="small"
              variant="contained"
              color="success"
              startIcon={<CheckCircleIcon />}
              disabled={busy}
              onClick={onAck}
              sx={{ textTransform: "none", fontWeight: 600, borderRadius: 1.25 }}
            >
              Acknowledge
            </Button>
          )}

          {mayEdit && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<EditIcon />}
              disabled={busy}
              onClick={onEdit}
              sx={{ textTransform: "none", fontWeight: 600, borderRadius: 1.25 }}
            >
              Edit
            </Button>
          )}

          <Button
            size="small"
            variant="text"
            onClick={onClose}
            disabled={busy}
            sx={{ textTransform: "none", fontWeight: 600, borderRadius: 1.25 }}
          >
            Close
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
