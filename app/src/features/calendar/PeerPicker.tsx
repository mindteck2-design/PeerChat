import { useMemo, useState } from "react";
import {
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/SearchRounded";
import type { Peer } from "../../peer";

export function PeerPicker({
  peers,
  selectedIds,
  onChange,
  disabled,
  ownerName,
}: {
  peers: Peer[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  ownerName: string;
}) {
  const [q, setQ] = useState("");

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

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
        <Typography variant="subtitle2" fontWeight={700} flex={1}>
          Include people on this LAN
        </Typography>
        {selectedIds.length > 0 && (
          <Chip size="small" label={`${selectedIds.length} selected`} color="primary" variant="outlined" />
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
        Selected peers get this item on their calendar too ({ownerName} stays owner). Offline peers
        receive it when they come online.
      </Typography>
      <TextField
        size="small"
        fullWidth
        placeholder="Search people…"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        InputProps={{
          startAdornment: <SearchIcon sx={{ mr: 1, color: "action.active", fontSize: 20 }} />,
        }}
        InputLabelProps={{ shrink: true }}
        sx={{ mb: 1 }}
      />
      {!peers.length ? (
        <Typography variant="body2" color="text.secondary">
          No peers discovered yet.
        </Typography>
      ) : !sorted.length ? (
        <Typography variant="body2" color="text.secondary">
          No matches.
        </Typography>
      ) : (
        <Box
          sx={{
            maxHeight: 160,
            overflow: "auto",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1.5,
            px: 1,
            py: 0.5,
          }}
        >
          {sorted.map((p) => {
            const checked = selectedIds.includes(p.user_id);
            return (
              <FormControlLabel
                key={p.user_id}
                sx={{ display: "flex", mr: 0, width: "100%" }}
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
                    <Typography fontSize={14}>{p.display_name}</Typography>
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
    </Box>
  );
}
