import { useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMoreRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import type { Peer } from "../../peer";

const scrollSx = {
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

export function PeerPicker({
  peers,
  selectedIds,
  onChange,
  disabled,
}: {
  peers: Peer[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  ownerName?: string;
}) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = peers.filter((p) => {
      if (!needle) return true;
      return (
        p.display_name.toLowerCase().includes(needle) ||
        p.user_id.toLowerCase().includes(needle)
      );
    });
    return list.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.display_name.localeCompare(b.display_name);
    });
  }, [peers, q]);

  const summary =
    selectedIds.length > 0
      ? `Include other people… (${selectedIds.length})`
      : "Include other people…";

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_, next) => setExpanded(next)}
      sx={{
        bgcolor: "transparent",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "10px !important",
        "&:before": { display: "none" },
        overflow: "hidden",
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon sx={{ color: "action.active" }} />}
        sx={{
          minHeight: 40,
          px: 1.25,
          "& .MuiAccordionSummary-content": { my: 0.75, alignItems: "center", gap: 1 },
        }}
      >
        <Typography variant="body2" color="text.secondary" fontWeight={600}>
          {summary}
        </Typography>
        {selectedIds.length > 0 && (
          <Chip size="small" label={`${selectedIds.length}`} color="primary" sx={{ height: 20 }} />
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1.25, pt: 0, pb: 1.25 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search people…"
          value={q}
          disabled={disabled}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{
            startAdornment: <SearchIcon sx={{ mr: 1, color: "action.active", fontSize: 18 }} />,
          }}
          sx={{ mb: 1 }}
        />
        {!peers.length ? (
          <Typography variant="caption" color="text.secondary">
            No peers discovered yet.
          </Typography>
        ) : !sorted.length ? (
          <Typography variant="caption" color="text.secondary">
            No matches.
          </Typography>
        ) : (
          <Box
            sx={{
              maxHeight: 148,
              overflow: "auto",
              ...scrollSx,
            }}
          >
            {sorted.map((p) => {
              const checked = selectedIds.includes(p.user_id);
              return (
                <FormControlLabel
                  key={p.user_id}
                  sx={{ display: "flex", mr: 0, width: "100%", ml: 0 }}
                  control={
                    <Checkbox
                      size="small"
                      disabled={disabled}
                      checked={checked}
                      onChange={() => {
                        onChange(
                          checked
                            ? selectedIds.filter((id) => id !== p.user_id)
                            : [...selectedIds, p.user_id]
                        );
                      }}
                    />
                  }
                  label={
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography fontSize={13}>{p.display_name}</Typography>
                      <Chip
                        size="small"
                        label={p.online ? "online" : "offline"}
                        sx={{ height: 18, fontSize: 10 }}
                        color={p.online ? "success" : "default"}
                        variant="outlined"
                      />
                    </Stack>
                  }
                />
              );
            })}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}
