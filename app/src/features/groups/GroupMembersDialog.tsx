// @ts-nocheck
import { useState, useMemo } from "react";
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import PersonAddAltRoundedIcon from "@mui/icons-material/PersonAddAltRounded";
import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import PersonRemoveRoundedIcon from "@mui/icons-material/PersonRemoveRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import DeleteForeverRoundedIcon from "@mui/icons-material/DeleteForeverRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import FilterListRoundedIcon from "@mui/icons-material/FilterListRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";

import { extractChatMediaFilesLinks, formatFullDateTime } from "../chat/ChatMediaUtils";
import { SharedItemsPreviewCard } from "../chat/SharedItemsPreviewCard";
import { ViewAllCategoryView, type SharedItemsCategory } from "../chat/ViewAllCategoryView";
import { avatarColor, lastSeenLabel } from "../../shared/format";
import { openExternalLink } from "../../panels";
import type { ChatScreenVm } from "../chat/chatVm";

export function GroupMembersDialog({ vm }: { vm: ChatScreenVm }) {
  const {
    active,
    addPick,
    canAddMembers,
    fileNames,
    fileSizes,
    fileThumbs,
    handleAddMembers,
    handleDeleteGroup,
    handleLeaveGroup,
    handleRemoveLeftGroup,
    handleRemoveMember,
    handleRenameGroup,
    handleSetMemberRole,
    handleToggleMembersCanAdd,
    inGroup,
    isAdmin,
    isAnnounceBoard,
    members,
    membersOpen,
    messages,
    openAttachment,
    openDm,
    others,
    peers,
    plain,
    profile,
    renameDraft,
    setAddPick,
    setHighlightMsgId,
    setMembersOpen,
    setRenameDraft,
    stickToBottomRef,
  } = vm;

  const [viewAllCategory, setViewAllCategory] = useState<SharedItemsCategory | null>(null);
  const [addPeopleMode, setAddPeopleMode] = useState(false);

  // Rename mode
  const [isRenaming, setIsRenaming] = useState(false);

  // Group settings menu
  const [groupSettingsAnchor, setGroupSettingsAnchor] = useState<HTMLElement | null>(null);

  // Member search & role filter for scaling to 100+ members
  const [memberSearch, setMemberSearch] = useState("");
  const [memberRoleFilter, setMemberRoleFilter] = useState<"all" | "admin" | "online">("all");
  const [filterMenuAnchor, setFilterMenuAnchor] = useState<HTMLElement | null>(null);

  // Member action menu
  const [memberMenuAnchor, setMemberMenuAnchor] = useState<{
    el: HTMLElement;
    member: any;
  } | null>(null);

  const isOpen = membersOpen && active?.kind === "group";

  // Peer lookup map for fast online/last seen lookups across 100+ members
  const peerMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of others || []) map.set(p.user_id, p);
    for (const p of peers || []) map.set(p.user_id, p);
    return map;
  }, [others, peers]);

  // Media, Files, Links extraction
  const { media, files, links } = useMemo(() => {
    if (!isOpen) return { media: [], files: [], links: [] };
    return extractChatMediaFilesLinks(messages, fileNames, fileSizes, fileThumbs, plain);
  }, [isOpen, messages, fileNames, fileSizes, fileThumbs, plain]);

  // Filtered members list
  const filteredMembers = useMemo(() => {
    let list = members;
    if (memberSearch.trim()) {
      const q = memberSearch.toLowerCase();
      list = list.filter((m) => (m.display_name || "").toLowerCase().includes(q));
    }
    if (memberRoleFilter === "admin") {
      list = list.filter((m) => m.role === "admin");
    } else if (memberRoleFilter === "online") {
      list = list.filter((m) => {
        if (m.user_id === profile.id) return true;
        const p = peerMap.get(m.user_id);
        return !!p?.online;
      });
    }
    return list;
  }, [members, memberSearch, memberRoleFilter, profile.id, peerMap]);

  if (!isOpen) return null;

  const groupTitle = active?.title || "Group";
  const memberCount = members.length;
  const createdDateStr = formatFullDateTime(active?.created_at) || "Recently";

  // Find creator name
  const adminMember = members.find((m) => m.role === "admin");
  const creatorName = adminMember
    ? adminMember.user_id === profile.id
      ? `${profile.display_name || "You"}`
      : adminMember.display_name || "Admin"
    : "Admin";

  const handleJumpToMessage = (messageId: string) => {
    setMembersOpen(false);
    stickToBottomRef.current = false;
    setHighlightMsgId(messageId);
  };

  const handleSaveRename = async () => {
    if (renameDraft.trim() && renameDraft.trim() !== groupTitle) {
      await handleRenameGroup();
    }
    setIsRenaming(false);
  };

  const availableOthers = others.filter((p) => !members.some((m) => m.user_id === p.user_id));

  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        setMembersOpen(false);
        setViewAllCategory(null);
        setAddPeopleMode(false);
        setIsRenaming(false);
        setMemberSearch("");
      }}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3.5,
          bgcolor: "#141c2b",
          backgroundImage: "none",
          border: "1px solid",
          borderColor: "divider",
          overflow: "hidden",
        },
      }}
    >
      {viewAllCategory ? (
        <ViewAllCategoryView
          category={viewAllCategory}
          chatTitle={groupTitle}
          media={media}
          files={files}
          links={links}
          onBack={() => setViewAllCategory(null)}
          onClose={() => {
            setMembersOpen(false);
            setViewAllCategory(null);
          }}
          onOpenAttachment={(fileId, senderId) => {
            void openAttachment(fileId, senderId);
          }}
          onJumpToMessage={handleJumpToMessage}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
          {/* ── HEADER TITLE BAR (Industry Team ... ✕) ── */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 3,
              pt: 2.25,
              pb: 1.5,
            }}
          >
            <Typography variant="h6" fontWeight={700} fontSize={18} color="#FFFFFF">
              {groupTitle}
            </Typography>
            <IconButton
              size="small"
              onClick={() => setMembersOpen(false)}
              sx={{ color: "text.secondary" }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <DialogContent sx={{ p: 2.5, pt: 0.5, overflowY: "auto" }}>
            <Stack spacing={2}>
              {/* ── CARD 1: GROUP HEADER ── */}
              <Box
                sx={{
                  bgcolor: "rgba(23, 31, 45, 0.7)",
                  borderRadius: 3,
                  p: 2.25,
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 2,
                }}
              >
                <Stack direction="row" spacing={2} alignItems="center" minWidth={0} flex={1}>
                  <Avatar
                    sx={{
                      width: 64,
                      height: 64,
                      bgcolor: "rgba(130, 169, 248, 0.2)",
                      color: "primary.main",
                      flexShrink: 0,
                    }}
                  >
                    <GroupsRoundedIcon sx={{ fontSize: 34, color: "primary.main" }} />
                  </Avatar>

                  <Box minWidth={0} flex={1}>
                    {/* Group Title with inline edit */}
                    {isRenaming ? (
                      <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && void handleSaveRename()}
                          style={{
                            backgroundColor: "rgba(255, 255, 255, 0.08)",
                            border: "1px solid rgba(255, 255, 255, 0.2)",
                            borderRadius: 6,
                            color: "#FFFFFF",
                            fontSize: 16,
                            fontWeight: 700,
                            padding: "4px 8px",
                            outline: "none",
                            width: "100%",
                          }}
                          autoFocus
                        />
                        <IconButton size="small" onClick={() => void handleSaveRename()} sx={{ color: "primary.main" }}>
                          <CheckRoundedIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ) : (
                      <Box display="flex" alignItems="center" gap={0.75}>
                        <Typography fontWeight={700} fontSize={18.5} color="#FFFFFF" noWrap>
                          {groupTitle}
                        </Typography>
                        {isAdmin && (
                          <IconButton
                            size="small"
                            onClick={() => {
                              setRenameDraft(groupTitle);
                              setIsRenaming(true);
                            }}
                            sx={{ p: 0.3, color: "text.secondary", "&:hover": { color: "#FFFFFF" } }}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        )}
                      </Box>
                    )}

                    <Typography variant="body2" color="text.secondary" fontSize={13} mb={1}>
                      {memberCount} {memberCount === 1 ? "member" : "members"}
                    </Typography>

                    {/* Metadata chips: Created on, Created by */}
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" gap={0.5}>
                      <Box
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.75,
                          bgcolor: "rgba(255, 255, 255, 0.05)",
                          borderRadius: 2,
                          px: 1.25,
                          py: 0.4,
                        }}
                      >
                        <CalendarTodayRoundedIcon sx={{ fontSize: 13, color: "text.secondary" }} />
                        <Typography variant="caption" sx={{ fontSize: 11.5, color: "text.secondary", fontWeight: 500 }}>
                          Created on {createdDateStr}
                        </Typography>
                      </Box>

                      <Box
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.75,
                          bgcolor: "rgba(255, 255, 255, 0.05)",
                          borderRadius: 2,
                          px: 1.25,
                          py: 0.4,
                        }}
                      >
                        <PersonOutlineRoundedIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                        <Typography variant="caption" sx={{ fontSize: 11.5, color: "text.secondary", fontWeight: 500 }}>
                          Created by {creatorName}
                        </Typography>
                      </Box>
                    </Stack>
                  </Box>
                </Stack>

                {/* Right: Three-dots button for group settings */}
                {isAdmin && (
                  <IconButton
                    size="small"
                    onClick={(e) => setGroupSettingsAnchor(e.currentTarget)}
                    sx={{ color: "text.secondary", "&:hover": { color: "#FFFFFF" } }}
                  >
                    <MoreVertRoundedIcon />
                  </IconButton>
                )}
              </Box>

              {/* ── CARD 2: MEMBERS ── */}
              <Box
                sx={{
                  bgcolor: "rgba(23, 31, 45, 0.7)",
                  borderRadius: 3,
                  p: 2,
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
                  <GroupsRoundedIcon sx={{ fontSize: 18, color: "primary.main" }} />
                  <Typography fontWeight={700} fontSize={14.5} color="#FFFFFF">
                    Members {memberCount}
                  </Typography>
                </Stack>

                {/* ── MEMBERS SECTION (SCALING TO 100+ MEMBERS) ── */}
                <Box>
                    {/* Sub-toolbar: Search members input + Filter dropdown + + Add people button */}
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.25,
                        mb: 1.5,
                        flexWrap: "wrap",
                      }}
                    >
                      {/* Search Input */}
                      <TextField
                        size="small"
                        placeholder="Search members..."
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <SearchRoundedIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                            </InputAdornment>
                          ),
                        }}
                        sx={{
                          flex: 1,
                          minWidth: 160,
                          "& .MuiOutlinedInput-root": {
                            borderRadius: 2,
                            fontSize: 13,
                            bgcolor: "rgba(255, 255, 255, 0.04)",
                            "& fieldset": { borderColor: "rgba(255, 255, 255, 0.08)" },
                          },
                        }}
                      />

                      {/* Filter button (All ⌄ / Admins / Online) */}
                      <Button
                        size="small"
                        endIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: "16px !important" }} />}
                        onClick={(e) => setFilterMenuAnchor(e.currentTarget)}
                        sx={{
                          borderRadius: 2,
                          px: 1.5,
                          py: 0.75,
                          textTransform: "none",
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: "text.secondary",
                          bgcolor: "rgba(255, 255, 255, 0.05)",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      >
                        {memberRoleFilter === "all"
                          ? "All"
                          : memberRoleFilter === "admin"
                          ? "Admins"
                          : "Online"}
                      </Button>

                      <Menu
                        anchorEl={filterMenuAnchor}
                        open={!!filterMenuAnchor}
                        onClose={() => setFilterMenuAnchor(null)}
                        PaperProps={{ sx: { borderRadius: 2, minWidth: 120 } }}
                      >
                        <MenuItem
                          selected={memberRoleFilter === "all"}
                          onClick={() => {
                            setMemberRoleFilter("all");
                            setFilterMenuAnchor(null);
                          }}
                        >
                          All ({members.length})
                        </MenuItem>
                        <MenuItem
                          selected={memberRoleFilter === "admin"}
                          onClick={() => {
                            setMemberRoleFilter("admin");
                            setFilterMenuAnchor(null);
                          }}
                        >
                          Admins ({members.filter((m) => m.role === "admin").length})
                        </MenuItem>
                        <MenuItem
                          selected={memberRoleFilter === "online"}
                          onClick={() => {
                            setMemberRoleFilter("online");
                            setFilterMenuAnchor(null);
                          }}
                        >
                          Online
                        </MenuItem>
                      </Menu>

                      {/* + Add people button */}
                      {canAddMembers && (
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PersonAddAltRoundedIcon sx={{ fontSize: "16px !important" }} />}
                          onClick={() => {
                            setAddPick([]);
                            setAddPeopleMode((prev) => !prev);
                          }}
                          sx={{
                            borderRadius: 2,
                            px: 1.75,
                            py: 0.75,
                            textTransform: "none",
                            fontWeight: 700,
                            fontSize: 12.5,
                            bgcolor: "primary.main",
                            color: "#FFFFFF",
                            boxShadow: "none",
                            "&:hover": { bgcolor: "primary.dark", boxShadow: "none" },
                          }}
                        >
                          {addPeopleMode ? "Done" : "+ Add people"}
                        </Button>
                      )}
                    </Box>

                    {/* Inline Add People Panel if toggled */}
                    {addPeopleMode && (
                      <Box
                        sx={{
                          p: 1.5,
                          mb: 1.5,
                          borderRadius: 2,
                          bgcolor: "action.hover",
                          border: "1px dashed rgba(255, 255, 255, 0.15)",
                        }}
                      >
                        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                          <Typography fontSize={13} fontWeight={700} color="#FFFFFF">
                            Select people on LAN to add
                          </Typography>
                          <Button
                            size="small"
                            variant="contained"
                            disabled={!addPick.length}
                            onClick={async () => {
                              await handleAddMembers();
                              setAddPeopleMode(false);
                            }}
                            sx={{
                              textTransform: "none",
                              fontWeight: 700,
                              fontSize: 12,
                              borderRadius: 999,
                            }}
                          >
                            Add {addPick.length ? `(${addPick.length})` : ""}
                          </Button>
                        </Box>

                        {!availableOthers.length ? (
                          <Typography variant="caption" color="text.secondary">
                            No other peers discovered on the LAN.
                          </Typography>
                        ) : (
                          <List dense disablePadding sx={{ maxHeight: 160, overflowY: "auto" }}>
                            {availableOthers.map((p) => (
                              <ListItemButton
                                key={p.user_id}
                                onClick={() =>
                                  setAddPick((g) =>
                                    g.includes(p.user_id)
                                      ? g.filter((x) => x !== p.user_id)
                                      : [...g, p.user_id]
                                  )
                                }
                                sx={{ borderRadius: 2, py: 0.5, px: 1 }}
                              >
                                <ListItemAvatar sx={{ minWidth: 40 }}>
                                  <Avatar
                                    sx={{
                                      width: 32,
                                      height: 32,
                                      bgcolor: avatarColor(p.display_name),
                                      color: "#FFFFFF",
                                      fontSize: 14,
                                      fontWeight: 700,
                                    }}
                                  >
                                    {p.display_name.slice(0, 1).toUpperCase()}
                                  </Avatar>
                                </ListItemAvatar>
                                <ListItemText
                                  primary={p.display_name}
                                  secondary={p.online ? "Online" : "Offline"}
                                  primaryTypographyProps={{ fontWeight: 600, fontSize: 13 }}
                                  secondaryTypographyProps={{ fontSize: 11 }}
                                />
                                <Checkbox
                                  edge="end"
                                  size="small"
                                  checked={addPick.includes(p.user_id)}
                                  tabIndex={-1}
                                  disableRipple
                                />
                              </ListItemButton>
                            ))}
                          </List>
                        )}
                      </Box>
                    )}

                    {/* Member List (Smooth vertical scroll, handles 100+ members) */}
                    <Stack spacing={0.5} sx={{ maxHeight: 310, overflowY: "auto", pr: 0.5 }}>
                      {!filteredMembers.length ? (
                        <Typography color="text.secondary" variant="caption" align="center" py={3}>
                          No members matching filter.
                        </Typography>
                      ) : (
                        filteredMembers.map((m) => {
                          const isSelf = m.user_id === profile.id;
                          const isMemberAdmin = m.role === "admin";
                          const dName = m.display_name || "User";
                          const label = isSelf ? `${dName} (you)` : dName;

                          const peer = peerMap.get(m.user_id);
                          const isMemberOnline = isSelf ? true : !!peer?.online;
                          const lastSeen = peer?.last_seen_at ? lastSeenLabel(peer.last_seen_at) : "";

                          return (
                            <Box
                              key={m.user_id}
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                p: 0.85,
                                borderRadius: 2,
                                "&:hover": { bgcolor: "action.hover" },
                              }}
                            >
                              <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0} flex={1}>
                                <Avatar
                                  sx={{
                                    width: 38,
                                    height: 38,
                                    bgcolor: avatarColor(dName),
                                    color: "#FFFFFF",
                                    fontSize: 16,
                                    fontWeight: 700,
                                    flexShrink: 0,
                                  }}
                                >
                                  {dName.slice(0, 1).toUpperCase()}
                                </Avatar>

                                <Box minWidth={0} flex={1}>
                                  <Typography fontWeight={700} fontSize={14} color="#FFFFFF" noWrap>
                                    {label}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" fontSize={12}>
                                    {isMemberAdmin ? "Admin" : "Member"}
                                  </Typography>
                                </Box>
                              </Stack>

                              {/* Online / Offline status with indicator dot */}
                              <Stack direction="row" spacing={1.25} alignItems="center">
                                <Stack direction="row" spacing={0.65} alignItems="center">
                                  <Box
                                    sx={{
                                      width: 7,
                                      height: 7,
                                      borderRadius: "50%",
                                      bgcolor: isMemberOnline ? "success.main" : "text.secondary",
                                      flexShrink: 0,
                                    }}
                                  />
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: isMemberOnline ? "success.main" : "text.secondary",
                                      fontWeight: 500,
                                      fontSize: 12,
                                      minWidth: 55,
                                    }}
                                  >
                                    {isMemberOnline
                                      ? "Online"
                                      : lastSeen
                                      ? `Offline · ${lastSeen}`
                                      : "Offline"}
                                  </Typography>
                                </Stack>

                                {/* Action Menu */}
                                {!isSelf && (
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      setMemberMenuAnchor({ el: e.currentTarget, member: m });
                                    }}
                                    sx={{ color: "text.secondary", p: 0.5 }}
                                  >
                                    <MoreVertRoundedIcon fontSize="small" />
                                  </IconButton>
                                )}
                              </Stack>
                            </Box>
                          );
                        })
                      )}
                    </Stack>
                  </Box>
              </Box>

              {/* ── CARD 3: UNIFIED SHARED ITEMS ── */}
              <SharedItemsPreviewCard
                media={media}
                files={files}
                links={links}
                onOpenAttachment={(fileId, senderId) => {
                  void openAttachment(fileId, senderId);
                }}
                onOpenLink={(url) => void openExternalLink(url)}
                onViewAll={(tab) => setViewAllCategory(tab || "media")}
                emptyLabel="No shared media, files, or links in this group yet."
              />
            </Stack>
          </DialogContent>

          {/* ── FOOTER BAR ── */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 3,
              py: 2,
              borderTop: "1px solid",
              borderColor: "divider",
              flexWrap: "wrap",
              gap: 1.5,
            }}
          >
            {/* Delete group for everyone (Admin only) */}
            {isAdmin ? (
              <Button
                color="error"
                variant="outlined"
                startIcon={<DeleteForeverRoundedIcon />}
                onClick={() => {
                  setMembersOpen(false);
                  void handleDeleteGroup();
                }}
                sx={{
                  borderRadius: 2,
                  px: 2,
                  py: 0.75,
                  textTransform: "none",
                  fontWeight: 700,
                  fontSize: 13,
                  borderColor: "rgba(240, 120, 120, 0.4)",
                  color: "#F07878",
                  "&:hover": {
                    borderColor: "#F07878",
                    bgcolor: "rgba(240, 120, 120, 0.08)",
                  },
                }}
              >
                Delete group for everyone
              </Button>
            ) : (
              <Box />
            )}

            <Stack direction="row" spacing={1.5} alignItems="center">
              {!isAnnounceBoard && inGroup && (
                <Button
                  color="error"
                  startIcon={<LogoutRoundedIcon />}
                  onClick={() => {
                    setMembersOpen(false);
                    void handleLeaveGroup();
                  }}
                  sx={{
                    textTransform: "none",
                    fontWeight: 700,
                    fontSize: 13,
                    color: "#F07878",
                  }}
                >
                  Leave group
                </Button>
              )}

              {!isAnnounceBoard && !inGroup && (
                <Button
                  color="error"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  onClick={() => {
                    setMembersOpen(false);
                    void handleRemoveLeftGroup(active);
                  }}
                  sx={{
                    textTransform: "none",
                    fontWeight: 700,
                    fontSize: 13,
                    color: "#F07878",
                  }}
                >
                  Remove from chat list
                </Button>
              )}

              <Button
                variant="contained"
                onClick={() => setMembersOpen(false)}
                sx={{
                  borderRadius: 999,
                  px: 3,
                  py: 0.85,
                  textTransform: "none",
                  fontWeight: 700,
                  fontSize: 13.5,
                  bgcolor: "action.hover",
                  color: "#FFFFFF",
                  boxShadow: "none",
                  "&:hover": { bgcolor: "action.selected", boxShadow: "none" },
                }}
              >
                Close
              </Button>
            </Stack>
          </Box>
        </Box>
      )}

      {/* Member Action Context Menu */}
      <Menu
        anchorEl={memberMenuAnchor?.el}
        open={!!memberMenuAnchor}
        onClose={() => setMemberMenuAnchor(null)}
        PaperProps={{ sx: { borderRadius: 2, minWidth: 160 } }}
      >
        {memberMenuAnchor?.member && (
          <>
            <MenuItem
              onClick={() => {
                const peer = others.find((p) => p.user_id === memberMenuAnchor.member.user_id);
                if (peer) openDm(peer);
                setMemberMenuAnchor(null);
                setMembersOpen(false);
              }}
            >
              <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: "text.secondary" }} />
              Send direct message
            </MenuItem>

            {isAdmin && memberMenuAnchor.member.user_id !== profile.id && (
              <>
                <MenuItem
                  onClick={() => {
                    const newRole = memberMenuAnchor.member.role === "admin" ? "member" : "admin";
                    void handleSetMemberRole(memberMenuAnchor.member.user_id, newRole);
                    setMemberMenuAnchor(null);
                  }}
                >
                  <AdminPanelSettingsRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: "text.secondary" }} />
                  {memberMenuAnchor.member.role === "admin" ? "Dismiss as admin" : "Make admin"}
                </MenuItem>
                <Divider sx={{ my: 0.5 }} />
                <MenuItem
                  onClick={() => {
                    void handleRemoveMember(
                      memberMenuAnchor.member.user_id,
                      memberMenuAnchor.member.display_name
                    );
                    setMemberMenuAnchor(null);
                  }}
                  sx={{ color: "error.main" }}
                >
                  <PersonRemoveRoundedIcon sx={{ fontSize: 18, mr: 1.25 }} />
                  Remove from group
                </MenuItem>
              </>
            )}
          </>
        )}
      </Menu>

      {/* Group Settings Menu (Members can add toggle) */}
      <Menu
        anchorEl={groupSettingsAnchor}
        open={!!groupSettingsAnchor}
        onClose={() => setGroupSettingsAnchor(null)}
        PaperProps={{ sx: { borderRadius: 2, minWidth: 220, p: 1 } }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between" px={1} py={0.5}>
          <Typography fontSize={13} fontWeight={600} color="#FFFFFF">
            Members can add others
          </Typography>
          <Switch
            size="small"
            checked={active?.members_can_add !== false}
            onChange={(_, v) => handleToggleMembersCanAdd(v)}
          />
        </Box>
      </Menu>
    </Dialog>
  );
}
