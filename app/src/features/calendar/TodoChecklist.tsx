import {
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import type { Peer } from "../../peer";
import type { ChecklistOption } from "./calendarTypes";
import { newChecklistOption } from "./calendarTypes";

function nameFor(id: string, peers: Peer[], myId: string, myName: string) {
  if (id === myId) return myName || "You";
  return peers.find((p) => p.user_id === id)?.display_name || id.slice(0, 8);
}

export function TodoChecklist({
  options,
  onChange,
  onToggle,
  authoring,
  readOnly,
  peers,
  myId,
  myName,
}: {
  options: ChecklistOption[];
  onChange?: (next: ChecklistOption[]) => void;
  onToggle?: (optionId: string, checked: boolean) => void;
  /** New item: edit option labels only (no checks yet). */
  authoring: boolean;
  readOnly?: boolean;
  peers: Peer[];
  myId: string;
  myName: string;
}) {
  if (authoring && onChange) {
    return (
      <Box sx={{ maxHeight: 220, overflow: "auto", pr: 0.5 }}>
        <Typography variant="subtitle2" fontWeight={700} mb={1}>
          Checklist options
        </Typography>
        <Stack spacing={1}>
          {options.map((opt, idx) => (
            <Stack key={opt.id} direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                fullWidth
                placeholder={`Option ${idx + 1}`}
                value={opt.label}
                disabled={readOnly}
                onChange={(e) => {
                  const next = options.map((o) =>
                    o.id === opt.id ? { ...o, label: e.target.value } : o
                  );
                  onChange(next);
                }}
              />
              <IconButton
                size="small"
                aria-label="Remove option"
                disabled={readOnly || options.length <= 1}
                onClick={() => onChange(options.filter((o) => o.id !== opt.id))}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
        </Stack>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={readOnly}
          onClick={() => onChange([...options, newChecklistOption("")])}
          sx={{ mt: 1 }}
        >
          Add option
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxHeight: 240, overflow: "auto", pr: 0.5 }}>
      <Stack direction="row" alignItems="center" mb={1} spacing={1}>
        <Typography variant="subtitle2" fontWeight={700} flex={1}>
          Checklist
        </Typography>
        {onChange && !readOnly && (
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => onChange([...options, newChecklistOption("")])}
          >
            Add
          </Button>
        )}
      </Stack>
      {!options.length ? (
        <Typography variant="body2" color="text.secondary">
          No options.
        </Typography>
      ) : (
        <Stack spacing={0.75}>
          {options.map((opt) => {
            const mine = opt.checked_by.includes(myId);
            return (
              <Box key={opt.id}>
                <Stack direction="row" alignItems="flex-start" spacing={0.5}>
                  <Checkbox
                    size="small"
                    checked={mine}
                    disabled={readOnly || !onToggle}
                    onChange={(_, checked) => onToggle?.(opt.id, checked)}
                    sx={{ pt: 0.25 }}
                  />
                  <Box flex={1} minWidth={0}>
                    {onChange && !readOnly ? (
                      <TextField
                        size="small"
                        fullWidth
                        value={opt.label}
                        onChange={(e) => {
                          onChange(
                            options.map((o) =>
                              o.id === opt.id ? { ...o, label: e.target.value } : o
                            )
                          );
                        }}
                        InputLabelProps={{ shrink: true }}
                      />
                    ) : (
                      <Typography fontSize={14}>{opt.label || "(untitled)"}</Typography>
                    )}
                    {opt.checked_by.length > 0 && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap mt={0.5}>
                        {opt.checked_by.map((uid) => (
                          <Chip
                            key={uid}
                            size="small"
                            label={nameFor(uid, peers, myId, myName)}
                            sx={{ height: 20, fontSize: 11 }}
                          />
                        ))}
                      </Stack>
                    )}
                  </Box>
                  {onChange && !readOnly && (
                    <IconButton
                      size="small"
                      aria-label="Remove option"
                      disabled={options.length <= 1}
                      onClick={() => onChange(options.filter((o) => o.id !== opt.id))}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
