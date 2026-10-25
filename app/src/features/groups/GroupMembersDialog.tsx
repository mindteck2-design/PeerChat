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
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Switch,
  Tab,
  Tabs,
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
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import PhotoLibraryRoundedIcon from "@mui/icons-material/PhotoLibraryRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";

import {
  extractChatMediaFilesLinks,
  formatFullDateTime,
  formatTimeOnly,
  getFileThemeColor,
} from "../chat/ChatMediaUtils";
import { ViewAllCategoryView } from "../chat/ViewAllCategoryView";
import { avatarColor, formatBytes } from "../../shared/format";
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
    plain,
    profile,
    renameDraft,
    setAddPick,
    setHighlightMsgId,
    setMembersOpen,
    setRenameDraft,
    stickToBottomRef,
  } = vm;

  const [activeTab, setActiveTab] = useState<number>(0);
  const [viewAllCategory, setViewAllCategory] = useState<"media" | "files" | "links" | null>(null);
  const [addPeopleMode, setAddPeopleMode] = useState(false);

  // Rename mode
  const [isRenaming, setIsRenaming] = useState(false);

  // Member action menu
  const [memberMenuAnchor, setMemberMenuAnchor] = useState<{
    el: HTMLElement;
    member: any;
  } | null>(null);

  const isOpen = membersOpen && active?.kind === "group";

  // Media, Files, Links extraction
  const { media, files, links } = useMemo(() => {
    if (!isOpen) return { media: [], files: [], links: [] };
    return extractChatMediaFilesLinks(messages, fileNames, fileSizes, fileThumbs, plain);
  }, [isOpen, messages, fileNames, fileSizes, fileThumbs, plain]);

  if (!isOpen) return null;

  const groupTitle = active?.title || "Group";
  const memberCount = members.length;
  const createdDateStr = formatFullDateTime(active?.created_at) || "Recently";

  // Find creator name: look for an admin, or fallback to first member
  const adminMember = members.find((m) => m.role === "admin");
  const creatorName = adminMember
    ? adminMember.user_id === profile.id
      ? `${profile.display_name} (you)`
      : adminMember.display_name
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
          {/* ── HEADER TITLE BAR ── */}
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
              {groupTitle} — Group details
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
                  gap: 2,
                }}
              >
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

                <Box flex={1} minWidth={0}>
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
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography fontWeight={700} fontSize={19} color="#FFFFFF" noWrap>
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
              </Box>

              {/* ── CARD 2: MEMBERS SECTION ── */}
              <Box
                sx={{
                  bgcolor: "rgba(23, 31, 45, 0.7)",
                  borderRadius: 3,
                  p: 2.25,
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                {/* Header row: Members + Add people */}
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <GroupsRoundedIcon sx={{ fontSize: 19, color: "text.secondary" }} />
                    <Typography fontWeight={700} fontSize={14.5} color="#FFFFFF">
                      Members
                    </Typography>
                  </Stack>

                  {canAddMembers && (
                    <Button
                      size="small"
                      startIcon={<PersonAddAltRoundedIcon sx={{ fontSize: "16px !important" }} />}
                      onClick={() => {
                        setAddPick([]);
                        setAddPeopleMode((prev) => !prev);
                      }}
                      sx={{
                        borderRadius: 999,
                        px: 1.75,
                        py: 0.5,
                        textTransform: "none",
                        fontWeight: 700,
                        fontSize: 12.5,
                        bgcolor: addPeopleMode ? "action.selected" : "rgba(130, 169, 248, 0.12)",
                        color: "primary.main",
                        "&:hover": { bgcolor: "rgba(130, 169, 248, 0.2)" },
                      }}
                    >
                      {addPeopleMode ? "Done" : "Add people"}
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

                {/* Member List */}
                <Stack spacing={0.75} sx={{ maxHeight: 220, overflowY: "auto", pr: 0.5 }}>
                  {members.map((m) => {
                    const isSelf = m.user_id === profile.id;
                    const isMemberAdmin = m.role === "admin";
                    const label = isSelf ? `${m.display_name} (you)` : m.display_name;

                    return (
                      <Box
                        key={m.user_id}
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          p: 0.9,
                          borderRadius: 2,
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                      >
                        <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0} flex={1}>
                          <Avatar
                            sx={{
                              width: 38,
                              height: 38,
                              bgcolor: avatarColor(m.display_name),
                              color: "#FFFFFF",
                              fontSize: 16,
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {m.display_name.slice(0, 1).toUpperCase()}
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

                        {/* Right: Admin Pill or Action Menu */}
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {isMemberAdmin && (
                            <Chip
                              size="small"
                              label="Admin"
                              sx={{
                                height: 24,
                                fontSize: 11.5,
                                fontWeight: 700,
                                bgcolor: "rgba(130, 169, 248, 0.15)",
                                color: "primary.main",
                                borderRadius: 1.5,
                              }}
                            />
                          )}

                          {!isSelf && (
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                setMemberMenuAnchor({ el: e.currentTarget, member: m });
                              }}
                              sx={{ color: "text.secondary" }}
                            >
                              <MoreVertRoundedIcon fontSize="small" />
                            </IconButton>
                          )}
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>

              {/* ── CARD 3: MEDIA, FILES, LINKS TABS & PREVIEW ── */}
              <Box
                sx={{
                  bgcolor: "rgba(23, 31, 45, 0.7)",
                  borderRadius: 3,
                  p: 2,
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                {/* Tab Header Row */}
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                    pb: 1,
                  }}
                >
                  <Tabs
                    value={activeTab}
                    onChange={(_, v) => setActiveTab(v)}
                    sx={{
                      minHeight: 36,
                      "& .MuiTabs-indicator": { height: 2.5, borderRadius: 2 },
                    }}
                  >
                    <Tab
                      icon={<PhotoLibraryRoundedIcon sx={{ fontSize: 17 }} />}
                      iconPosition="start"
                      label={`Media ${media.length}`}
                      sx={{ minHeight: 36, py: 0.5, px: 1.5, fontSize: 13, textTransform: "none", fontWeight: 700 }}
                    />
                    <Tab
                      icon={<InsertDriveFileRoundedIcon sx={{ fontSize: 17 }} />}
                      iconPosition="start"
                      label={`Files ${files.length}`}
                      sx={{ minHeight: 36, py: 0.5, px: 1.5, fontSize: 13, textTransform: "none", fontWeight: 700 }}
                    />
                    <Tab
                      icon={<LinkRoundedIcon sx={{ fontSize: 17 }} />}
                      iconPosition="start"
                      label={`Links ${links.length}`}
                      sx={{ minHeight: 36, py: 0.5, px: 1.5, fontSize: 13, textTransform: "none", fontWeight: 700 }}
                    />
                  </Tabs>

                  <Button
                    size="small"
                    endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: "15px !important" }} />}
                    onClick={() => {
                      const cat = activeTab === 0 ? "media" : activeTab === 1 ? "files" : "links";
                      setViewAllCategory(cat);
                    }}
                    sx={{
                      textTransform: "none",
                      fontSize: 12.5,
                      fontWeight: 700,
                      color: "primary.main",
                      pr: 0.5,
                    }}
                  >
                    View all
                  </Button>
                </Box>

                {/* Preview Content */}
                <Box sx={{ pt: 1.75 }}>
                  {activeTab === 0 && (
                    <>
                      {!media.length ? (
                        <Typography color="text.secondary" variant="caption" display="block" py={2} textAlign="center">
                          No media in this group yet.
                        </Typography>
                      ) : (
                        <Box
                          sx={{
                            display: "grid",
                            gridTemplateColumns: "repeat(4, 1fr)",
                            gap: 1.25,
                          }}
                        >
                          {media.slice(0, 8).map((m) => (
                            <Box
                              key={m.key}
                              onClick={() => void openAttachment(m.fileId, m.senderId)}
                              sx={{
                                position: "relative",
                                aspectRatio: "1",
                                borderRadius: 2,
                                overflow: "hidden",
                                bgcolor: "action.hover",
                                border: "1px solid rgba(255, 255, 255, 0.08)",
                                cursor: "pointer",
                                transition: "transform 0.12s ease",
                                "&:hover": { transform: "scale(1.03)" },
                              }}
                            >
                              {m.thumb ? (
                                <Box
                                  component="img"
                                  src={m.thumb}
                                  alt={m.name}
                                  sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                              ) : (
                                <Box
                                  sx={{
                                    width: "100%",
                                    height: "100%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    bgcolor: "action.selected",
                                  }}
                                >
                                  <InsertDriveFileRoundedIcon sx={{ fontSize: 24, color: "text.secondary" }} />
                                </Box>
                              )}

                              <Box
                                sx={{
                                  position: "absolute",
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  p: 0.5,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)",
                                }}
                              >
                                <Typography sx={{ fontSize: 9, color: "#FFFFFF", fontWeight: 600 }}>
                                  {formatTimeOnly(m.at)}
                                </Typography>
                                {m.isVideo && (
                                  <Box display="flex" alignItems="center" gap={0.25}>
                                    <PlayArrowRoundedIcon sx={{ fontSize: 10, color: "#FFFFFF" }} />
                                    <Typography sx={{ fontSize: 8.5, color: "#FFFFFF", fontWeight: 700 }}>
                                      Video
                                    </Typography>
                                  </Box>
                                )}
                              </Box>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </>
                  )}

                  {activeTab === 1 && (
                    <>
                      {!files.length ? (
                        <Typography color="text.secondary" variant="caption" display="block" py={2} textAlign="center">
                          No files in this group yet.
                        </Typography>
                      ) : (
                        <Stack spacing={0.75}>
                          {files.slice(0, 4).map((f) => {
                            const iconStyle = getFileThemeColor(f.ext);
                            return (
                              <Box
                                key={f.key}
                                onClick={() => void openAttachment(f.fileId, f.senderId)}
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 1.5,
                                  p: 0.9,
                                  borderRadius: 2,
                                  bgcolor: "action.hover",
                                  cursor: "pointer",
                                  "&:hover": { bgcolor: "action.selected" },
                                }}
                              >
                                <Box
                                  sx={{
                                    width: 34,
                                    height: 34,
                                    borderRadius: 1.5,
                                    bgcolor: iconStyle.bg,
                                    color: iconStyle.color,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexShrink: 0,
                                  }}
                                >
                                  <InsertDriveFileRoundedIcon sx={{ fontSize: 18 }} />
                                </Box>
                                <Box flex={1} minWidth={0}>
                                  <Typography fontWeight={700} fontSize={13} noWrap color="#FFFFFF">
                                    {f.name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" fontSize={11}>
                                    {f.ext} · {formatBytes(f.size)}
                                  </Typography>
                                </Box>
                                <Typography variant="caption" color="text.secondary" fontSize={11}>
                                  {formatTimeOnly(f.at)}
                                </Typography>
                              </Box>
                            );
                          })}
                        </Stack>
                      )}
                    </>
                  )}

                  {activeTab === 2 && (
                    <>
                      {!links.length ? (
                        <Typography color="text.secondary" variant="caption" display="block" py={2} textAlign="center">
                          No links in this group yet.
                        </Typography>
                      ) : (
                        <Stack spacing={0.75}>
                          {links.slice(0, 3).map((l) => (
                            <Box
                              key={l.key}
                              onClick={() => void openExternalLink(l.url)}
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1.5,
                                p: 0.9,
                                borderRadius: 2,
                                bgcolor: "action.hover",
                                cursor: "pointer",
                                "&:hover": { bgcolor: "action.selected" },
                              }}
                            >
                              <Box
                                sx={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: 1.5,
                                  bgcolor: "rgba(130, 169, 248, 0.15)",
                                  color: "primary.main",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  flexShrink: 0,
                                }}
                              >
                                <LinkRoundedIcon sx={{ fontSize: 18 }} />
                              </Box>
                              <Box flex={1} minWidth={0}>
                                <Typography fontWeight={700} fontSize={13} noWrap color="#FFFFFF">
                                  {l.title}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{ color: "primary.main", display: "block" }}
                                  fontSize={11.5}
                                  noWrap
                                >
                                  {l.url}
                                </Typography>
                              </Box>
                            </Box>
                          ))}
                        </Stack>
                      )}
                    </>
                  )}
                </Box>
              </Box>
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
        <MenuItem
          onClick={() => {
            const peer = others.find((p) => p.user_id === memberMenuAnchor?.member.user_id);
            if (peer) openDm(peer);
            setMemberMenuAnchor(null);
            setMembersOpen(false);
          }}
        >
          <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: "text.secondary" }} />
          Send direct message
        </MenuItem>

        {isAdmin && memberMenuAnchor?.member.user_id !== profile.id && (
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
      </Menu>
    </Dialog>
  );
}
