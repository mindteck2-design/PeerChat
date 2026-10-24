import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditIcon from "@mui/icons-material/EditRounded";
import type { Peer } from "../../peer";
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
import { TodoChecklist } from "./TodoChecklist";
import { newChecklistOption } from "./calendarTypes";

const labelSx = { color: "text.secondary" };

const dialogScrollSx = {
  scrollbarWidth: "thin" as const,
  scrollbarColor: "rgba(255,255,255,0.22) transparent",
  "&::-webkit-scrollbar": { width: 6, height: 6 },
  "&::-webkit-scrollbar-track": { background: "transparent" },
  "&::-webkit-scrollbar-thumb": {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 8,
  },
  "&::-webkit-scrollbar-thumb:hover": {
    backgroundColor: "rgba(255,255,255,0.35)",
  },
};

export function CalendarItemEditor({
  open,
  draft,
  setDraft,
  busy,
  peers,
  myId,
  myName,
  today,
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
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  /** Restore draft after canceling edit mode. */
  onCancelEdit?: () => void;
  onToggleOption: (optionId: string, checked: boolean) => void;
  onAck: () => void;
}) {
  const [editing, setEditing] = useState(false);

  // Existing items always open in view mode; new items start in edit.
  useEffect(() => {
    if (!open || !draft) {
      setEditing(false);
      return;
    }
    setEditing(!draft.id);
  }, [open, draft?.id]);

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
  const showDetails = draft.kind !== "todo";
  const showChecklist = draft.kind === "todo";

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

  const titleText = isNew
    ? "New calendar item"
    : inEdit
      ? "Edit item"
      : owner
        ? "View item"
        : "Shared with you";

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
          ...dialogScrollSx,
        },
      }}
    >
      <DialogTitle sx={{ pb: 0.5, pt: 2, px: 2.5, fontSize: "1.1rem", fontWeight: 700 }}>
        {titleText}
        {past && draft.kind !== "note" && (
          <Typography variant="caption" color="text.secondary" display="block" fontWeight={400}>
            Past day — view only
          </Typography>
        )}
        {!isNew && !owner && (
          <Typography variant="caption" color="text.secondary" display="block" fontWeight={400}>
            You can acknowledge or check items — only the owner can edit.
          </Typography>
        )}
      </DialogTitle>
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 2.5,
          px: 2.5,
          pt: "20px !important",
          pb: 2,
          overflow: "auto",
          flex: 1,
          minHeight: 0,
          ...dialogScrollSx,
        }}
      >
        <TextField
          size="small"
          label="Title"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          fullWidth
          autoFocus={inEdit && isNew}
          disabled={fieldsLocked}
          InputLabelProps={{ shrink: true, sx: labelSx }}
        />

        <Stack direction="row" spacing={1.5} alignItems="flex-start">
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
            sx={{ width: 118, flexShrink: 0 }}
          >
            {kindChoices.map((k) => (
              <MenuItem key={k.value} value={k.value} dense>
                {k.label}
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
          <TimeSelect
            value={draft.time}
            disabled={fieldsLocked}
            onChange={(time) => setDraft({ ...draft, time })}
          />
        </Stack>

        {showDetails && (
          <TextField
            size="small"
            label="Details"
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
            disabled={fieldsLocked}
            placeholder="Optional notes"
            InputLabelProps={{ shrink: true, sx: labelSx }}
            sx={{
              "& .MuiInputBase-root": {
                maxHeight: 140,
                overflow: "auto",
                ...dialogScrollSx,
              },
            }}
          />
        )}

        {showChecklist && (
          <Box sx={{ maxHeight: 200, overflow: "auto", ...dialogScrollSx }}>
            <TodoChecklist
              options={draft.checklist}
              authoring={isNew && inEdit}
              structureEditable={inEdit && mayEditContent}
              checkEnabled={!isNew && !inEdit && liveOk}
              peers={peers}
              myId={myId}
              myName={myName}
              onChange={
                inEdit && mayEditContent
                  ? (checklist) => setDraft({ ...draft, checklist })
                  : undefined
              }
              onToggle={
                !isNew && !inEdit && liveOk
                  ? (optionId) => onToggleOption(optionId, true)
                  : undefined
              }
            />
          </Box>
        )}

        <PeerPicker
          peers={peers}
          selectedIds={draft.participant_ids}
          disabled={fieldsLocked}
          onChange={(participant_ids) => setDraft({ ...draft, participant_ids })}
        />

        {showAck && !inEdit && (
          <AckBar
            acks={draft.acks}
            participantIds={expectedAckIds}
            myId={myId}
            myName={myName}
            peers={peers}
            disabled={busy || !liveOk}
            readOnly={!liveOk}
            onAck={onAck}
          />
        )}
      </DialogContent>
      <DialogActions
        sx={{
          px: 2.5,
          py: 1.5,
          borderTop: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
          bgcolor: "background.paper",
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
        {inEdit && !isNew ? (
          <Button
            size="small"
            disabled={busy}
            onClick={() => {
              onCancelEdit?.();
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        ) : (
          <Button size="small" disabled={busy} onClick={onClose}>
            {inEdit ? "Cancel" : "Close"}
          </Button>
        )}
        {inEdit && (
          <Button size="small" variant="contained" disabled={busy} onClick={onSave}>
            Save
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
