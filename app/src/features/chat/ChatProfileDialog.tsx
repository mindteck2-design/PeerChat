// @ts-nocheck
import { useState, useMemo } from "react";
import {
  Avatar,
  Box,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";
import NotificationsOffRoundedIcon from "@mui/icons-material/NotificationsOffRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import LanRoundedIcon from "@mui/icons-material/LanRounded";
import RadioButtonCheckedRoundedIcon from "@mui/icons-material/RadioButtonCheckedRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import PhotoLibraryRoundedIcon from "@mui/icons-material/PhotoLibraryRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";

import {
  extractChatMediaFilesLinks,
  formatFullDateTime,
  formatTimeOnly,
  getFileThemeColor,
} from "./ChatMediaUtils";
import { ViewAllCategoryView } from "./ViewAllCategoryView";
import { avatarColor, formatBytes, lastSeenLabel } from "../../shared/format";
import { openExternalLink } from "../../panels";
import type { ChatScreenVm } from "./chatVm";

export function ChatProfileDialog({ vm }: { vm: ChatScreenVm }) {
  const {
    active,
    activeDmPeer,
    chatInfoOpen,
    fileNames,
    fileSizes,
    fileThumbs,
    handleDeleteDmChat,
    messages,
    openAttachment,
    peerApi,
    plain,
    refresh,
    setChatInfoOpen,
    setHighlightMsgId,
    setInChatSearchOpen,
    stickToBottomRef,
  } = vm;

  const [activeTab, setActiveTab] = useState<number>(0);
  const [viewAllCategory, setViewAllCategory] = useState<"media" | "files" | "links" | null>(null);
  const [copiedIp, setCopiedIp] = useState(false);

  // Status quote editing state
  const peerId = activeDmPeer?.user_id || active?.peer_id || "";
  const [statusQuote, setStatusQuote] = useState<string>(() => {
    return (
      localStorage.getItem(`peerchat_status_${peerId}`) ||
      (activeDmPeer?.team ? `Working on ${activeDmPeer.team} project` : "Available on LAN")
    );
  });
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState("");

  const isOpen = chatInfoOpen && active?.kind === "dm";

  // Media, Files, Links extraction
  const { media, files, links } = useMemo(() => {
    if (!isOpen) return { media: [], files: [], links: [] };
    return extractChatMediaFilesLinks(messages, fileNames, fileSizes, fileThumbs, plain);
  }, [isOpen, messages, fileNames, fileSizes, fileThumbs, plain]);

  if (!isOpen) return null;

  const displayName = activeDmPeer?.display_name || active?.peer_name || "Peer";
  const isOnline = !!activeDmPeer?.online;
  const ipAddress = activeDmPeer?.last_ip || "192.168.1.24";
  const teamName = activeDmPeer?.team?.trim() || "HMIS";
  const aboutText =
    localStorage.getItem(`peerchat_about_${peerId}`) || "Building cool things 😊";
  const isMuted = !!active?.muted;

  const handleCopyIp = () => {
    navigator.clipboard.writeText(ipAddress);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  const handleToggleMute = async () => {
    if (!active) return;
    try {
      await peerApi.setConversationMuted(active.id, !isMuted);
      await refresh();
    } catch (e) {
      console.error(e);
    }
  };

  const handleJumpToMessage = (messageId: string) => {
    setChatInfoOpen(false);
    stickToBottomRef.current = false;
    setHighlightMsgId(messageId);
  };

  const handleSaveStatus = () => {
    if (statusDraft.trim()) {
      setStatusQuote(statusDraft.trim());
      localStorage.setItem(`peerchat_status_${peerId}`, statusDraft.trim());
    }
    setEditingStatus(false);
  };

  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        setChatInfoOpen(false);
        setViewAllCategory(null);
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
          chatTitle={displayName}
          media={media}
          files={files}
          links={links}
          onBack={() => setViewAllCategory(null)}
          onClose={() => {
            setChatInfoOpen(false);
            setViewAllCategory(null);
          }}
          onOpenAttachment={(fileId, senderId) => {
            void openAttachment(fileId, senderId);
          }}
          onJumpToMessage={handleJumpToMessage}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
          {/* ── DIALOG TITLE BAR ── */}
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
              {displayName} — Profile
            </Typography>
            <IconButton
              size="small"
              onClick={() => setChatInfoOpen(false)}
              sx={{ color: "text.secondary" }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <DialogContent sx={{ p: 2.5, pt: 0.5, overflowY: "auto" }}>
            <Stack spacing={2}>
              {/* ── CARD 1: TOP PROFILE HEADER ── */}
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
                {/* Left: Avatar & Names */}
                <Stack direction="row" spacing={2} alignItems="center" minWidth={0} flex={1}>
                  <Box sx={{ position: "relative", flexShrink: 0 }}>
                    <Avatar
                      sx={{
                        width: 64,
                        height: 64,
                        bgcolor: avatarColor(displayName),
                        color: "#FFFFFF",
                        fontSize: 26,
                        fontWeight: 800,
                      }}
                    >
                      {displayName.slice(0, 1).toUpperCase()}
                    </Avatar>
                    <Box
                      sx={{
                        position: "absolute",
                        bottom: 2,
                        right: 2,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        border: "2.5px solid #141c2b",
                        bgcolor: isOnline ? "success.main" : "grey.500",
                      }}
                    />
                  </Box>

                  <Box minWidth={0} flex={1}>
                    <Typography fontWeight={700} fontSize={19} color="#FFFFFF" noWrap>
                      {displayName}
                    </Typography>

                    <Stack direction="row" spacing={0.75} alignItems="center" mt={0.25}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          bgcolor: isOnline ? "success.main" : "text.secondary",
                        }}
                      />
                      <Typography
                        variant="caption"
                        sx={{
                          color: isOnline ? "success.main" : "text.secondary",
                          fontWeight: 600,
                          fontSize: 12.5,
                        }}
                      >
                        {isOnline ? "Online" : lastSeenLabel(activeDmPeer?.last_seen_at)}
                      </Typography>
                    </Stack>

                    {/* Status Quote */}
                    <Box display="flex" alignItems="center" gap={0.75} mt={0.5}>
                      {editingStatus ? (
                        <Box display="flex" alignItems="center" gap={0.5} width="100%">
                          <input
                            type="text"
                            value={statusDraft}
                            onChange={(e) => setStatusDraft(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveStatus()}
                            style={{
                              backgroundColor: "rgba(255, 255, 255, 0.08)",
                              border: "1px solid rgba(255, 255, 255, 0.2)",
                              borderRadius: 4,
                              color: "#FFFFFF",
                              fontSize: 12,
                              padding: "2px 6px",
                              outline: "none",
                              width: "100%",
                            }}
                            autoFocus
                          />
                          <IconButton size="small" onClick={handleSaveStatus} sx={{ p: 0.3, color: "primary.main" }}>
                            <CheckRoundedIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ) : (
                        <>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            sx={{ fontSize: 12.5 }}
                          >
                            {statusQuote}
                          </Typography>
                          <IconButton
                            size="small"
                            onClick={() => {
                              setStatusDraft(statusQuote);
                              setEditingStatus(true);
                            }}
                            sx={{ p: 0.2, color: "text.secondary", opacity: 0.7, "&:hover": { opacity: 1 } }}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </>
                      )}
                    </Box>
                  </Box>
                </Stack>

                {/* Right: Round Action Buttons (Message, Search, Mute) */}
                <Stack direction="row" spacing={1.5} alignItems="center" flexShrink={0}>
                  {/* Message */}
                  <Stack alignItems="center" spacing={0.5}>
                    <IconButton
                      onClick={() => setChatInfoOpen(false)}
                      sx={{
                        width: 44,
                        height: 44,
                        bgcolor: "rgba(255, 255, 255, 0.06)",
                        color: "#FFFFFF",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                    <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
                      Message
                    </Typography>
                  </Stack>

                  {/* Search */}
                  <Stack alignItems="center" spacing={0.5}>
                    <IconButton
                      onClick={() => {
                        setChatInfoOpen(false);
                        setInChatSearchOpen(true);
                      }}
                      sx={{
                        width: 44,
                        height: 44,
                        bgcolor: "rgba(255, 255, 255, 0.06)",
                        color: "#FFFFFF",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <SearchRoundedIcon sx={{ fontSize: 21 }} />
                    </IconButton>
                    <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
                      Search
                    </Typography>
                  </Stack>

                  {/* Mute */}
                  <Stack alignItems="center" spacing={0.5}>
                    <IconButton
                      onClick={handleToggleMute}
                      sx={{
                        width: 44,
                        height: 44,
                        bgcolor: isMuted ? "rgba(240, 120, 120, 0.15)" : "rgba(255, 255, 255, 0.06)",
                        color: isMuted ? "error.main" : "#FFFFFF",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      {isMuted ? (
                        <NotificationsOffRoundedIcon sx={{ fontSize: 20 }} />
                      ) : (
                        <NotificationsNoneRoundedIcon sx={{ fontSize: 20 }} />
                      )}
                    </IconButton>
                    <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
                      {isMuted ? "Unmute" : "Mute"}
                    </Typography>
                  </Stack>
                </Stack>
              </Box>

              {/* ── CARD 2: USER DETAILS ── */}
              <Box
                sx={{
                  bgcolor: "rgba(23, 31, 45, 0.7)",
                  borderRadius: 3,
                  p: 2.25,
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" mb={1.75}>
                  <PersonOutlineRoundedIcon sx={{ fontSize: 19, color: "text.secondary" }} />
                  <Typography fontWeight={700} fontSize={14.5} color="#FFFFFF">
                    User details
                  </Typography>
                </Stack>

                <Stack spacing={1.5}>
                  {/* Row 1: Display name */}
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <PersonOutlineRoundedIcon sx={{ fontSize: 17, color: "text.secondary" }} />
                      <Typography fontSize={13.5} color="text.secondary">
                        Display name
                      </Typography>
                    </Stack>
                    <Typography fontSize={13.5} fontWeight={600} color="#FFFFFF">
                      {displayName}
                    </Typography>
                  </Box>

                  {/* Row 2: IP address (LAN) */}
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <LanRoundedIcon sx={{ fontSize: 17, color: "text.secondary" }} />
                      <Typography fontSize={13.5} color="text.secondary">
                        IP address (LAN)
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography fontSize={13.5} fontWeight={600} color="#FFFFFF" fontFamily="monospace">
                        {ipAddress}
                      </Typography>
                      <Tooltip title={copiedIp ? "Copied!" : "Copy IP"}>
                        <IconButton size="small" onClick={handleCopyIp} sx={{ color: "text.secondary", p: 0.5 }}>
                          {copiedIp ? (
                            <CheckRoundedIcon sx={{ fontSize: 15, color: "success.main" }} />
                          ) : (
                            <ContentCopyRoundedIcon sx={{ fontSize: 15 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>

                  {/* Row 3: Status */}
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <RadioButtonCheckedRoundedIcon sx={{ fontSize: 17, color: "text.secondary" }} />
                      <Typography fontSize={13.5} color="text.secondary">
                        Status
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          bgcolor: isOnline ? "success.main" : "text.secondary",
                        }}
                      />
                      <Typography
                        fontSize={13.5}
                        fontWeight={600}
                        color={isOnline ? "success.main" : "text.secondary"}
                      >
                        {isOnline ? "Online" : "Offline"}
                      </Typography>
                    </Stack>
                  </Box>

                  {/* Row 4: Team */}
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <GroupsRoundedIcon sx={{ fontSize: 17, color: "text.secondary" }} />
                      <Typography fontSize={13.5} color="text.secondary">
                        Team
                      </Typography>
                    </Stack>
                    <Typography fontSize={13.5} fontWeight={600} color="#FFFFFF">
                      {teamName}
                    </Typography>
                  </Box>

                  {/* Row 5: About */}
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <InfoOutlinedIcon sx={{ fontSize: 17, color: "text.secondary" }} />
                      <Typography fontSize={13.5} color="text.secondary">
                        About
                      </Typography>
                    </Stack>
                    <Typography fontSize={13.5} fontWeight={600} color="#FFFFFF">
                      {aboutText}
                    </Typography>
                  </Box>
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
                  {/* Media Tab Preview: 4 cols x 2 rows grid */}
                  {activeTab === 0 && (
                    <>
                      {!media.length ? (
                        <Typography color="text.secondary" variant="caption" display="block" py={2} textAlign="center">
                          No media in this chat yet.
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

                              {/* Time / duration badge */}
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
                                  background:
                                    "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)",
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

                  {/* Files Tab Preview: Compact 3-4 files */}
                  {activeTab === 1 && (
                    <>
                      {!files.length ? (
                        <Typography color="text.secondary" variant="caption" display="block" py={2} textAlign="center">
                          No files in this chat yet.
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

                  {/* Links Tab Preview: Compact 3-4 links */}
                  {activeTab === 2 && (
                    <>
                      {!links.length ? (
                        <Typography color="text.secondary" variant="caption" display="block" py={2} textAlign="center">
                          No links in this chat yet.
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
            }}
          >
            <Button
              color="error"
              startIcon={<DeleteOutlineRoundedIcon />}
              onClick={() => {
                setChatInfoOpen(false);
                void handleDeleteDmChat(active);
              }}
              sx={{
                textTransform: "none",
                fontWeight: 700,
                fontSize: 13.5,
                color: "#F07878",
                "&:hover": { bgcolor: "rgba(240, 120, 120, 0.1)" },
              }}
            >
              Clear chat
            </Button>

            <Button
              variant="contained"
              onClick={() => setChatInfoOpen(false)}
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
          </Box>
        </Box>
      )}
    </Dialog>
  );
}
