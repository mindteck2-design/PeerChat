import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditIcon from "@mui/icons-material/EditRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import NotificationsActiveRoundedIcon from "@mui/icons-material/NotificationsActiveRounded";
import StickyNote2RoundedIcon from "@mui/icons-material/StickyNote2Rounded";
import type { Peer, CalendarKind } from "../../peer";
import { AckBar } from "./AckBar";
import { CALENDAR_KINDS, type CalendarDraft } from "./calendarTypes";
import {
  canCreateKind,
  canEditItem,
  canMutateLiveState,
  isOwner,
  isPastDay,
} from "./calendarRules";
import { PeerPicker } from "./PeerPicker";
import { TimeSelect } from "./TimeSelect";
import { newChecklistOption } from "./calendarTypes";

const labelSx = { color: "text.secondary" };

const dialogScrollSx = {
  scrollbarWidth: "thin" as const,
  scrollbarColor: "var(--pc-scrollbar-thumb) transparent",
  "&::-webkit-scrollbar": { width: 7, height: 7 },
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

function HeaderKindIcon({ kind }: { kind: CalendarKind }) {
  switch (kind) {
    case "meeting":
      return <GroupsIcon sx={{ color: "#3b82f6", fontSize: 24 }} />;
    case "todo":
      return <CheckCircleRoundedIcon sx={{ color: "#8b5cf6", fontSize: 24 }} />;
    case "reminder":
      return <NotificationsActiveRoundedIcon sx={{ color: "#f59e0b", fontSize: 24 }} />;
    case "note":
    default:
      return <StickyNote2RoundedIcon sx={{ color: "#10b981", fontSize: 24 }} />;
  }
}

function KindOptionIcon({ kind }: { kind: CalendarKind }) {
  switch (kind) {
    case "meeting":
      return <GroupsIcon sx={{ color: "#3b82f6", fontSize: 18 }} />;
    case "todo":
      return <CheckCircleRoundedIcon sx={{ color: "#8b5cf6", fontSize: 18 }} />;
    case "reminder":
      return <NotificationsActiveRoundedIcon sx={{ color: "#f59e0b", fontSize: 18 }} />;
    case "note":
    default:
      return <StickyNote2RoundedIcon sx={{ color: "#10b981", fontSize: 18 }} />;
  }
}

function getTitlePlaceholder(kind: CalendarKind): string {
  switch (kind) {
    case "meeting":
      return "e.g. Team sync meeting";
    case "todo":
      return "e.g. Prepare presentation";
    case "reminder":
      return "e.g. Submit report";
    case "note":
    default:
      return "e.g. Project ideas";
  }
}

function getDetailsPlaceholder(kind: CalendarKind): string {
  return kind === "note" ? "Write your notes here..." : "Optional notes";
}

export function CalendarItemEditor({
  open,
  draft,
  setDraft,
  busy,
  peers,
  myId,
  myName,
  today,
  startInEdit = true,
  onClose,
  onSave,
  onDelete,
  onCancelEdit,
  onToggleOption,
  onAck,
}: {
  open: boolean;
  draft: CalendarDraft | null;
  setDraft: (d: CalendarDraft) => void;
  busy: boolean;
  peers: Peer[];
  myId: string;
  myName: string;
  today: string;
  startInEdit?: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  /** Restore draft after canceling edit mode. */
  onCancelEdit?: () => void;
  onToggleOption: (optionId: string, checked: boolean) => void;
  onAck: () => void;
}) {
  const [editing, setEditing] = useState(startInEdit);
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    if (!open || !draft) {
      setEditing(false);
      return;
    }
    setEditing(startInEdit || !draft.id);
  }, [open, draft?.id, startInEdit]);

  if (!draft) return null;

  const isNew = !draft.id;
  const past = isPastDay(draft.day, today);
  const owner = isNew || isOwner(draft.created_by ?? myId, myId);
  const mayEditContent =
    isNew || canEditItem(draft.kind, draft.day, draft.created_by ?? myId, myId, today);
  const liveOk = canMutateLiveState(draft.day, today);
  const inEdit = isNew || (editing && mayEditContent);
  const fieldsLocked = !inEdit || busy;
  const shared =
    !!draft.shared ||
    draft.participant_ids.length > 0 ||
    (!!draft.created_by && draft.created_by !== myId);
  const showAck =
    shared &&
    (draft.kind === "meeting" || draft.kind === "reminder" || draft.kind === "note") &&
    !!draft.id;

  const kindChoices = CALENDAR_KINDS.filter((k) =>
    isNew ? canCreateKind(k.value, draft.day, today) : true
  );

  const expectedAckIds = Array.from(
    new Set(
      [draft.created_by, myId, ...draft.participant_ids].filter(
        (id): id is string => !!id
      )
    )
  );

  const titleText = isNew ? "New calendar item" : inEdit ? "Edit calendar item" : owner ? "View item" : "Shared with you";

  const checklistDoneCount = draft.checklist.filter((o) => o.checked_by.length > 0).length;

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
          maxHeight: "90vh",
          borderRadius: 2,
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          ...dialogScrollSx,
        },
      }}
    >
      {/* Header */}
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          pt: 2.25,
          pb: 1,
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center">
          <HeaderKindIcon kind={draft.kind} />
          <Typography fontSize="1.15rem" fontWeight={700}>
            {titleText}
          </Typography>
        </Stack>
        <IconButton
          size="small"
          aria-label="Close dialog"
          onClick={() => !busy && onClose()}
          disabled={busy}
          sx={{ color: "text.secondary" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          px: 2.5,
          pt: "12px !important",
          pb: 2,
          overflow: "auto",
          flex: 1,
          minHeight: 0,
          ...dialogScrollSx,
        }}
      >
        {past && draft.kind !== "note" && (
          <Typography variant="caption" color="text.secondary" display="block">
            Past day — view only
          </Typography>
        )}
        {!isNew && !owner && (
          <Typography variant="caption" color="text.secondary" display="block">
            You can acknowledge or check items — only the owner can edit.
          </Typography>
        )}

        {/* Title */}
        <TextField
          size="small"
          label="Title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          fullWidth
          autoFocus={inEdit && isNew}
          disabled={fieldsLocked}
          placeholder={getTitlePlaceholder(draft.kind)}
          InputLabelProps={{ shrink: true, sx: labelSx }}
        />

        {/* Type, Date, Time Row */}
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TextField
            size="small"
            select
            label="Type"
            value={draft.kind}
            disabled={fieldsLocked || !isNew}
            onChange={(e) => {
              const kind = e.target.value as CalendarDraft["kind"];
              setDraft({
                ...draft,
                kind,
                checklist:
                  kind === "todo" && draft.checklist.length === 0
                    ? [newChecklistOption("")]
                    : draft.checklist,
              });
            }}
            InputLabelProps={{ shrink: true, sx: labelSx }}
            sx={{ width: 140, flexShrink: 0 }}
          >
            {kindChoices.map((k) => (
              <MenuItem key={k.value} value={k.value} dense sx={{ gap: 1 }}>
                <KindOptionIcon kind={k.value} />
                <span>{k.label}</span>
              </MenuItem>
            ))}
          </TextField>

          <TextField
            size="small"
            label="Date"
            type="date"
            value={draft.day}
            disabled={fieldsLocked}
            onChange={(e) => setDraft({ ...draft, day: e.target.value })}
            InputLabelProps={{ shrink: true, sx: labelSx }}
            sx={{
              flex: 1,
              minWidth: 0,
              "& input::-webkit-calendar-picker-indicator": {
                cursor: "pointer",
                opacity: 0.7,
                filter: "invert(0.85)",
              },
            }}
          />

          {draft.kind !== "note" && (
            <TimeSelect
              value={draft.time}
              disabled={fieldsLocked}
              onChange={(time) => setDraft({ ...draft, time })}
              label="Time"
            />
          )}
        </Stack>

        {/* Meeting Link / URL (Meeting Only) */}
        {draft.kind === "meeting" && (
          <TextField
            size="small"
            label="Meeting Link / URL (Optional)"
            value={draft.meeting_url || ""}
            onChange={(e) => setDraft({ ...draft, meeting_url: e.target.value })}
            fullWidth
            disabled={fieldsLocked}
            placeholder="https://meet.google.com/... or Teams / Zoom link"
            InputLabelProps={{ shrink: true, sx: labelSx }}
          />
        )}

        {/* To-Do Checklist (To-Do Only) */}
        {draft.kind === "todo" && (
          <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, p: 1.5, bgcolor: "action.hover" }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" fontWeight={700}>
                  Checklist
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={500}>
                  {checklistDoneCount}/{draft.checklist.length} completed
                </Typography>
              </Stack>
              {inEdit && mayEditContent && (
                <Button
                  size="small"
                  startIcon={<AddIcon sx={{ fontSize: 16 }} />}
                  onClick={() => setDraft({ ...draft, checklist: [...draft.checklist, newChecklistOption("")] })}
                  disabled={fieldsLocked}
                  sx={{
                    textTransform: "none",
                    fontWeight: 600,
                    fontSize: "0.8rem",
                    p: 0,
                    minWidth: 0,
                    "&:hover": { bgcolor: "transparent", textDecoration: "underline" },
                  }}
                >
                  Add item
                </Button>
              )}
            </Stack>

            <Stack spacing={0.5} sx={{ maxHeight: 200, overflow: "auto", ...dialogScrollSx }}>
              {draft.checklist.map((item) => {
                const isChecked = item.checked_by.length > 0;
                return (
                  <Stack
                    key={item.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                      py: 0.25,
                      px: 0.5,
                      borderRadius: 1.5,
                      "&:hover .item-del-btn": { opacity: 1 },
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={isChecked}
                      disabled={fieldsLocked && !liveOk}
                      onChange={(e) => {
                        if (inEdit) {
                          const next = draft.checklist.map((opt) =>
                            opt.id === item.id
                              ? {
                                  ...opt,
                                  checked_by: e.target.checked
                                    ? Array.from(new Set([...opt.checked_by, myId]))
                                    : opt.checked_by.filter((id) => id !== myId),
                                }
                              : opt
                          );
                          setDraft({ ...draft, checklist: next });
                        } else if (liveOk) {
                          onToggleOption(item.id, e.target.checked);
                        }
                      }}
                      sx={{ p: 0.25 }}
                    />
                    <TextField
                      size="small"
                      variant="standard"
                      fullWidth
                      placeholder="Item description..."
                      value={item.label}
                      disabled={fieldsLocked}
                      onChange={(e) => {
                        const next = draft.checklist.map((opt) =>
                          opt.id === item.id ? { ...opt, label: e.target.value } : opt
                        );
                        setDraft({ ...draft, checklist: next });
                      }}
                      InputProps={{
                        disableUnderline: true,
                        sx: {
                          fontSize: "0.88rem",
                          textDecoration: isChecked ? "line-through" : "none",
                          color: isChecked ? "text.secondary" : "text.primary",
                        },
                      }}
                    />
                    {inEdit && mayEditContent && draft.checklist.length > 1 && (
                      <IconButton
                        size="small"
                        className="item-del-btn"
                        aria-label="Remove checklist item"
                        onClick={() => {
                          const next = draft.checklist.filter((opt) => opt.id !== item.id);
                          setDraft({ ...draft, checklist: next });
                        }}
                        sx={{
                          opacity: 0.5,
                          p: 0.25,
                          "&:hover": { opacity: 1, color: "error.main" },
                        }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          </Box>
        )}

        {/* Show Notification Switch (Reminder Only) */}
        {draft.kind === "reminder" && (
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              borderRadius: 1.5,
              bgcolor: "action.hover",
              border: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              gap: 1.5,
            }}
          >
            <Switch
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              disabled={fieldsLocked}
              color="primary"
            />
            <Box minWidth={0} flex={1}>
              <Typography variant="body2" fontWeight={600} lineHeight={1.2}>
                Show notification
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" mt={0.25}>
                Get a reminder at the specified time
              </Typography>
            </Box>
          </Paper>
        )}

        {/* Details Textarea */}
        <TextField
          size="small"
          label="Details"
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          fullWidth
          multiline
          minRows={draft.kind === "note" ? 4 : 2}
          maxRows={6}
          disabled={fieldsLocked}
          placeholder={getDetailsPlaceholder(draft.kind)}
          InputLabelProps={{ shrink: true, sx: labelSx }}
          sx={{
            "& .MuiInputBase-root": {
              maxHeight: 180,
              overflow: "auto",
              ...dialogScrollSx,
            },
          }}
        />

        {/* Share with people */}
        <PeerPicker
          peers={peers}
          selectedIds={draft.participant_ids.filter((id) => id !== myId)}
          disabled={fieldsLocked}
          onChange={(participant_ids) =>
            setDraft({ ...draft, participant_ids: participant_ids.filter((id) => id !== myId) })
          }
        />

        {showAck && !inEdit && (
          <AckBar
            acks={draft.acks}
            participantIds={expectedAckIds}
            myId={myId}
            myName={myName}
            peers={peers}
            disabled={busy || !liveOk}
            readOnly={!liveOk || owner}
            onAck={onAck}
          />
        )}
      </DialogContent>

      {/* Footer Actions */}
      <DialogActions
        sx={{
          px: 2.5,
          py: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 1.5,
          borderTop: "1px solid",
          borderColor: "divider",
        }}
      >
        {draft.id && inEdit && mayEditContent && (
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            disabled={busy}
            onClick={onDelete}
            sx={{ mr: "auto" }}
          >
            Delete
          </Button>
        )}
        {!isNew && !inEdit && mayEditContent && (
          <Button
            size="small"
            startIcon={<EditIcon />}
            disabled={busy}
            onClick={() => setEditing(true)}
            sx={{ mr: "auto" }}
          >
            Edit
          </Button>
        )}
        <Button
          size="small"
          disabled={busy}
          onClick={inEdit && !isNew ? () => { onCancelEdit?.(); setEditing(false); } : onClose}
          sx={{ textTransform: "none", fontWeight: 600, color: "text.secondary", px: 2 }}
        >
          Cancel
        </Button>
        {inEdit && (
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={onSave}
            sx={{
              borderRadius: 1.25,
              textTransform: "none",
              fontWeight: 600,
              px: 3,
            }}
          >
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
