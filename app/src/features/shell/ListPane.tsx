// @ts-nocheck
import {
  Avatar, Box, Chip, Divider, IconButton, InputAdornment, List, ListItemAvatar,
  ListItemButton, ListItemIcon, ListItemText, TextField, Tooltip, Typography,
} from "@mui/material";
import CampaignIcon from "@mui/icons-material/CampaignRounded";
import GroupAddIcon from "@mui/icons-material/GroupAddRounded";
import GroupIcon from "@mui/icons-material/GroupRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import PushPinIcon from "@mui/icons-material/PushPinRounded";
import RefreshIcon from "@mui/icons-material/RefreshRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import MoreVertIcon from "@mui/icons-material/MoreVertRounded";
import VolumeOffIcon from "@mui/icons-material/VolumeOffRounded";
import { peerApi } from "../../peer";
import { avatarColor, formatPreviewTime, lastSeenLabel, conversationPreviewLine } from "../../shared/format";
import type { ChatScreenVm } from "../chat/chatVm";

export function ListPane({ vm }: { vm: ChatScreenVm }) {
  const {
    active,
    announceBoards,
    chatSearch,
    chatSearchRef,
    ensureAnnounceBoards,
    filteredConvs,
    lanHosts,
    lastPreviews,
    messages,
    nav,
    openDm,
    others,
    peers,
    profile,
    refresh,
    scanning,
    selectConversation,
    setChatSearch,
    setConvMenu,
    setGroupOpen,
    tab,
    text,
    transfers,
    version
  } = vm;
  return (
    <Box
        sx={{
          width: 300,
          flexShrink: 0,
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          display: nav === "transfers" || nav === "games" || nav === "saved" ? "none" : "flex",
        }}
      >
        <Box sx={{ px: 2, pt: 1.75, pb: 1, display: "flex", alignItems: "center", gap: 1 }}>
          <Box flex={1} minWidth={0}>
            <Typography variant="subtitle1" fontWeight={700} lineHeight={1.2}>
              {nav === "announcements" ? "Announcements" : "PeerChat"}{" "}
              {nav !== "announcements" && (
                <Typography component="span" variant="caption" color="text.secondary" fontWeight={500}>
                  v{version}
                </Typography>
              )}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {nav === "announcements"
                ? profile.team?.trim()
                  ? `${profile.team.trim()} · team board + org updates`
                  : "Org updates — set a Team in Settings for a team board"
                : scanning
                  ? "Scanning LAN…"
                  : profile.team?.trim()
                    ? `${profile.display_name} · ${profile.team.trim()}`
                    : profile.display_name}
            </Typography>
          </Box>
          <IconButton
            size="small"
            aria-label="Refresh peers"
            onClick={() => {
              if (nav === "announcements") void ensureAnnounceBoards();
              else void refresh({ manual: true });
            }}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Box>
        {nav !== "announcements" && (
        <Box sx={{ px: 1.5, pb: 1 }}>
          <TextField
            inputRef={chatSearchRef}
            size="small"
            fullWidth
            placeholder={
              tab === 1
                ? "Search chats & messages… (Ctrl/Cmd+K)"
                : "Search people…"
            }
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment:
                tab === 1 ? (
                  <InputAdornment position="end">
                    <Tooltip title="New group">
                      <IconButton
                        size="small"
                        edge="end"
                        aria-label="New group"
                        onClick={() => setGroupOpen(true)}
                      >
                        <GroupAddIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ) : undefined,
              sx: { borderRadius: 999, bgcolor: "action.hover" },
            }}
          />
        </Box>
        )}
        <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, pb: 1 }}>
          {nav === "announcements" && (
            <List dense disablePadding>
              {announceBoards.map((b) => (
                <ListItemButton
                  key={b.id}
                  selected={active?.id === b.id}
                  onClick={() => selectConversation(b)}
                  sx={{ py: 1.1, px: 2 }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <CampaignIcon fontSize="small" color={active?.id === b.id ? "primary" : "action"} />
                  </ListItemIcon>
                  <ListItemText
                    primary={b.title || (b.id === "board:org" ? "Org updates" : "Team board")}
                    secondary={
                      b.id === "board:org"
                        ? "Everyone · builds, circulars"
                        : "Your team only"
                    }
                    primaryTypographyProps={{ fontWeight: 700, fontSize: 14 }}
                    secondaryTypographyProps={{ fontSize: 12 }}
                  />
                </ListItemButton>
              ))}
              {!announceBoards.length && (
                <Typography sx={{ p: 2 }} color="text.secondary" variant="body2">
                  Opening announcement boards…
                </Typography>
              )}
            </List>
          )}
          {nav !== "announcements" && tab === 0 && (
            <List dense disablePadding>
              {others
                .filter((p) => {
                  const q = chatSearch.trim().toLowerCase();
                  if (!q) return true;
                  return p.display_name.toLowerCase().includes(q);
                })
                .map((p) => (
                  <ListItemButton key={p.user_id} onClick={() => openDm(p)} sx={{ py: 0.85 }}>
                    <Avatar
                      sx={{
                        width: 32,
                        height: 32,
                        mr: 1.1,
                        bgcolor: avatarColor(p.display_name),
                        fontSize: 14,
                        fontWeight: 800,
                      }}
                    >
                      {p.display_name.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <ListItemText
                      primary={p.display_name}
                      secondary={p.last_ip?.trim() || "No IP yet"}
                      primaryTypographyProps={{ fontWeight: 600, fontSize: 14, noWrap: true }}
                      secondaryTypographyProps={{ fontSize: 12, fontFamily: "ui-monospace, monospace" }}
                    />
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: p.online ? "success.main" : "grey.400",
                      }}
                    />
                  </ListItemButton>
                ))}
              {!others.length && (
                <Typography sx={{ p: 2 }} color="text.secondary" variant="body2">
                  No peers yet. Start PeerChat on another PC on this LAN and hit refresh.
                </Typography>
              )}
              {lanHosts.length > 0 && (
                <>
                  <Divider sx={{ my: 1, mx: 2 }} />
                  <Typography variant="overline" color="text.secondary" sx={{ px: 2.5 }}>
                    Other devices on this network
                  </Typography>
                  {lanHosts.map((h) => (
                    <Box
                      key={h.ip}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.25,
                        px: 2.5,
                        py: 0.85,
                        opacity: 0.55,
                      }}
                    >
                      <Avatar
                        sx={{
                          width: 32,
                          height: 32,
                          bgcolor: "grey.300",
                          color: "grey.600",
                          fontSize: 14,
                          fontWeight: 800,
                        }}
                      >
                        {h.label.slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box flex={1} minWidth={0}>
                        <Typography noWrap fontSize={14} fontWeight={600}>
                          {h.label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {h.ip} · No PeerChat
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </>
              )}
            </List>
          )}
          {nav !== "announcements" && tab === 1 && (
            <List dense disablePadding>
              {filteredConvs.map((c) => {
                const title = c.kind === "dm" ? c.peer_name || "Direct" : c.title || "Group";
                const dmPeer =
                  c.kind === "dm" && c.peer_id
                    ? peers.find((p) => p.user_id === c.peer_id)
                    : undefined;
                const peerOnline = !!dmPeer?.online;
                const needsTrust = !!dmPeer && !dmPeer.pinned && !dmPeer.blocked;
                const isBlocked = !!dmPeer?.blocked;
                const preview = lastPreviews[c.id] || "";
                const timeLabel = formatPreviewTime(c.last_message_at || c.created_at);
                const unread = !!c.unread_count && active?.id !== c.id;
                return (
                  <ListItemButton
                    key={c.id}
                    selected={active?.id === c.id}
                    onClick={() => selectConversation(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setConvMenu({ anchor: e.currentTarget as HTMLElement, conv: c });
                    }}
                    sx={{
                      py: 1.1,
                      px: 2,
                      alignItems: "center",
                      gap: 1.5,
                      "& .chat-row-actions": {
                        opacity: 0,
                        pointerEvents: "none",
                        transition: "opacity 0.12s ease",
                      },
                      "&:hover .chat-row-actions, &:focus-within .chat-row-actions": {
                        opacity: 1,
                        pointerEvents: "auto",
                      },
                    }}
                  >
                    <Box sx={{ position: "relative", flexShrink: 0 }}>
                      <Avatar
                        sx={{
                          width: 36,
                          height: 36,
                          bgcolor: avatarColor(title),
                          fontSize: c.kind === "group" ? 18 : 15,
                          fontWeight: 800,
                        }}
                      >
                        {c.kind === "group" ? (
                          <GroupsIcon sx={{ fontSize: 18 }} />
                        ) : (
                          title.slice(0, 1).toUpperCase()
                        )}
                      </Avatar>
                      {c.kind === "dm" && (
                        <Box
                          sx={{
                            position: "absolute",
                            bottom: 0,
                            right: 0,
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            border: "2px solid",
                            borderColor: "background.paper",
                            bgcolor: peerOnline ? "success.main" : "grey.400",
                          }}
                        />
                      )}
                    </Box>
                    <Box flex={1} minWidth={0}>
                      <Box display="flex" alignItems="baseline" gap={1}>
                        <Typography
                          component="span"
                          fontWeight={unread ? 700 : 600}
                          fontSize={15}
                          noWrap
                          flex={1}
                        >
                          {title}
                        </Typography>
                        <Typography
                          component="span"
                          variant="caption"
                          color={unread ? "primary.main" : "text.secondary"}
                          sx={{ flexShrink: 0, fontSize: 11.5, fontWeight: unread ? 600 : 400 }}
                        >
                          {timeLabel}
                        </Typography>
                      </Box>
                      <Box display="flex" alignItems="center" gap={0.5} mt={0.15}>
                        {isBlocked && (
                          <Chip
                            size="small"
                            label="Blocked"
                            sx={{ height: 18, fontSize: 10, fontWeight: 700, flexShrink: 0 }}
                          />
                        )}
                        {needsTrust && (
                          <Chip
                            size="small"
                            label="New"
                            color="warning"
                            sx={{ height: 18, fontSize: 10, fontWeight: 700, flexShrink: 0 }}
                          />
                        )}
                        {c.muted && (
                          <VolumeOffIcon sx={{ fontSize: 14, color: "text.disabled", flexShrink: 0 }} />
                        )}
                        {c.pinned_at && (
                          <PushPinIcon sx={{ fontSize: 13, color: "text.disabled", flexShrink: 0 }} />
                        )}
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                          flex={1}
                          sx={{ fontSize: 13, lineHeight: 1.35 }}
                        >
                          {preview || (needsTrust ? "First message — tap to open" : "\u00a0")}
                        </Typography>
                        {unread && (
                          <Box
                            sx={{
                              flexShrink: 0,
                              minWidth: 20,
                              height: 20,
                              px: 0.5,
                              borderRadius: 10,
                              bgcolor: "primary.main",
                              color: "primary.contrastText",
                              fontSize: 11,
                              fontWeight: 700,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {c.unread_count! > 99 ? "99+" : c.unread_count}
                          </Box>
                        )}
                      </Box>
                    </Box>
                    <IconButton
                      size="small"
                      className="chat-row-actions"
                      aria-label="Chat options"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConvMenu({ anchor: e.currentTarget, conv: c });
                      }}
                      sx={{ ml: -0.5 }}
                    >
                      <MoreVertIcon sx={{ fontSize: 18, opacity: 0.5 }} />
                    </IconButton>
                  </ListItemButton>
                );
              })}
              {!filteredConvs.length && (
                <Typography sx={{ p: 2 }} color="text.secondary" variant="body2">
                  {chatSearch
                    ? "No chats match your search."
                    : "No chats yet. When someone messages you, their chat appears here — or start one from People."}
                </Typography>
              )}
            </List>
          )}
        </Box>
      </Box>


  );
}
