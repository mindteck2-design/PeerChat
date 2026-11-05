import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { avatarColor } from "../../shared/format";
import type { Peer } from "../../peer";
import type { ChatScreenVm } from "../chat/chatVm";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function memberTitle(peer: Peer) {
  const name = peer.display_name?.trim() || "Unknown";
  const team = peer.team?.trim();
  return team ? `${name} · ${team}` : name;
}

export function GroupCreateDialog({ vm }: { vm: ChatScreenVm }) {
  const {
    createGroup,
    groupOpen,
    groupPick,
    groupTitle,
    others,
    setGroupOpen,
    setGroupPick,
    setGroupTitle,
  } = vm;
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!groupOpen) setQuery("");
  }, [groupOpen]);

  const members = (others || []) as Peer[];
  const picked = (groupPick || []) as string[];
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return members;
    return members.filter((p) =>
      `${p.display_name || ""} ${p.team || ""} ${p.last_ip || ""}`.toLowerCase().includes(q)
    );
  }, [members, q]);

  const toggle = (id: string) => {
    setGroupPick((current: string[]) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    );
  };

  const nameOk = !!String(groupTitle || "").trim();
  const canCreate = nameOk && picked.length > 0;
  const selectedBg = alpha(theme.palette.primary.main, dark ? 0.2 : 0.12);
  const selectedHover = alpha(theme.palette.primary.main, dark ? 0.28 : 0.18);

  return (
    <Dialog
      open={!!groupOpen}
      onClose={() => setGroupOpen(false)}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          bgcolor: "background.paper",
          backgroundImage: "none",
          border: "1px solid",
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(620px, calc(100% - 48px))",
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5, pb: 1, flexShrink: 0 }}>
        <Avatar
          sx={{
            width: 44,
            height: 44,
            bgcolor: "primary.main",
            color: "primary.contrastText",
          }}
        >
          <GroupsRoundedIcon />
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="div" sx={{ fontWeight: 700, fontSize: 18, lineHeight: 1.25 }}>
            Create group
          </Typography>
          {picked.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {picked.length} selected
            </Typography>
          )}
        </Box>
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
        <TextField
          autoFocus
          required
          fullWidth
          label="Group name"
          sx={{ flexShrink: 0 }}
          placeholder="Group name"
          value={groupTitle}
          onChange={(e) => setGroupTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) createGroup();
          }}
        />
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
            <GroupsRoundedIcon sx={{ fontSize: 22, color: "primary.main" }} />
            <Typography sx={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>
              Select Members
            </Typography>
          </Box>
          <TextField
            size="small"
            placeholder="Search contacts..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: "1 1 160px", minWidth: 0, ml: "auto", maxWidth: 240 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
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
            minHeight: members.length ? 0 : 72,
            maxHeight: 360,
          }}
        >
          {visible.map((p) => {
            const on = picked.includes(p.user_id);
            return (
              <ListItemButton
                key={p.user_id}
                selected={on}
                onClick={() => toggle(p.user_id)}
                sx={{
                  borderRadius: 1.5,
                  mb: 0.25,
                  py: 0.6,
                  marginInline: 0,
                  "&.Mui-selected": {
                    bgcolor: selectedBg,
                    "&:hover": { bgcolor: selectedHover },
                  },
                }}
              >
                <Checkbox
                  edge="start"
                  checked={on}
                  tabIndex={-1}
                  disableRipple
                  inputProps={{ "aria-label": `Select ${p.display_name || "member"}` }}
                  sx={{ pointerEvents: "none", mr: 0.25 }}
                />
                <ListItemAvatar sx={{ minWidth: 44 }}>
                  <Avatar
                    sx={{
                      width: 36,
                      height: 36,
                      bgcolor: avatarColor(p.display_name || "?"),
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {initials(p.display_name || "?")}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={memberTitle(p)}
                  secondary={p.last_ip?.trim() || "No IP yet"}
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
          {!visible.length && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 0.5, py: 2 }}>
              {members.length ? "No members match" : "No peers on this network yet"}
            </Typography>
          )}
        </List>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, flexShrink: 0 }}>
        <Button onClick={() => setGroupOpen(false)}>Cancel</Button>
        <Button variant="contained" disabled={!canCreate} onClick={createGroup}>
          Create Group
        </Button>
      </DialogActions>
    </Dialog>
  );
}
