import { useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFileRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import PeopleAltIcon from "@mui/icons-material/PeopleAltRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import type { Peer } from "../../peer";
import { avatarColor } from "../../shared/format";
import { PeerAvatar } from "../../shared/PeerAvatar";

export function SharePeersDialog(props: {
  open: boolean;
  paths: string[];
  peers: Peer[];
  busy?: boolean;
  onClose: () => void;
  onSend: (peerIds: string[]) => void | Promise<void>;
}) {
  const [pick, setPick] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (props.open) {
      setPick([]);
      setQuery("");
    }
  }, [props.open, props.paths]);

  const filtered = props.peers.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${p.display_name || ""} ${p.team || ""} ${p.last_ip || ""}`
      .toLowerCase()
      .includes(q);
  });

  return (
    <Dialog
      open={props.open}
      onClose={() => {
        if (props.busy) return;
        props.onClose();
      }}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          bgcolor: "background.paper",
          backgroundImage: "none",
          border: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(620px, calc(100% - 48px))",
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5, pb: 1, pr: 6 }}>
        <Avatar
          sx={{
            width: 44,
            height: 44,
            bgcolor: "primary.main",
            color: "primary.contrastText",
          }}
        >
          <AttachFileIcon />
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" sx={{ fontWeight: 700, fontSize: 18, lineHeight: 1.25 }}>
            Share in PeerChat
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {props.paths.length === 1
              ? props.paths[0].split(/[/\\]/).pop()
              : `${props.paths.length} files`}
            {pick.length > 0 ? ` · ${pick.length} selected` : ""}
          </Typography>
        </Box>
        <IconButton
          aria-label="Close"
          disabled={props.busy}
          onClick={props.onClose}
          sx={{ position: "absolute", right: 10, top: 10 }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 1.25,
          overflow: "hidden",
          flex: "1 1 auto",
          minHeight: 0,
          pt: "4px !important",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexShrink: 0,
            minWidth: 0,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
            <PeopleAltIcon sx={{ fontSize: 22, color: "primary.main" }} />
            <Typography sx={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>
              Select people
            </Typography>
          </Box>
          <TextField
            size="small"
            placeholder="Search contacts..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={props.busy}
            sx={{ flex: "1 1 160px", minWidth: 0, ml: "auto", maxWidth: 240 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        </Box>
        <List
          dense
          disablePadding
          sx={{
            overflowY: "auto",
            flex: "1 1 auto",
            minHeight: props.peers.length ? 0 : 72,
            maxHeight: 360,
          }}
        >
          {filtered.map((p) => {
            const on = pick.includes(p.user_id);
            const label = p.team?.trim()
              ? `${p.display_name} · ${p.team.trim()}`
              : p.display_name;
            return (
              <ListItemButton
                key={p.user_id}
                selected={on}
                disabled={props.busy}
                onClick={() =>
                  setPick((ids) =>
                    ids.includes(p.user_id)
                      ? ids.filter((x) => x !== p.user_id)
                      : [...ids, p.user_id]
                  )
                }
                sx={{
                  borderRadius: 1.5,
                  mb: 0.25,
                  py: 0.6,
                  "&.Mui-selected": { bgcolor: "action.selected" },
                }}
              >
                <Checkbox
                  edge="start"
                  checked={on}
                  tabIndex={-1}
                  disableRipple
                  inputProps={{ "aria-label": `Select ${p.display_name || "person"}` }}
                  sx={{ pointerEvents: "none", mr: 0.25 }}
                />
                <ListItemAvatar sx={{ minWidth: 44 }}>
                  <PeerAvatar
                    name={p.display_name || "?"}
                    avatarId={p.avatar_id}
                    size={36}
                    sx={{
                      bgcolor: p.avatar_id ? undefined : avatarColor(p.display_name || "?"),
                    }}
                  />
                </ListItemAvatar>
                <ListItemText
                  primary={label}
                  secondary={p.last_ip?.trim() || (p.online ? "Online" : "Offline")}
                  primaryTypographyProps={{ fontWeight: 600, fontSize: 14, noWrap: true }}
                  secondaryTypographyProps={{
                    fontSize: 12,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    noWrap: true,
                  }}
                />
              </ListItemButton>
            );
          })}
          {!props.peers.length && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 2 }}>
              No peers on this network yet
            </Typography>
          )}
          {!!props.peers.length && !filtered.length && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 2 }}>
              No people match
            </Typography>
          )}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, flexShrink: 0 }}>
        <Button disabled={props.busy} onClick={props.onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={!pick.length || props.busy}
          onClick={() => void props.onSend(pick)}
          startIcon={props.busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {props.busy ? "Sending…" : pick.length ? `Send (${pick.length})` : "Send"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
