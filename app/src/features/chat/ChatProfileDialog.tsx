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
import ArrowBackIosNewRoundedIcon from "@mui/icons-material/ArrowBackIosNewRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";
import NotificationsOffRoundedIcon from "@mui/icons-material/NotificationsOffRounded";
import ComputerRoundedIcon from "@mui/icons-material/ComputerRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import PhotoLibraryRoundedIcon from "@mui/icons-material/PhotoLibraryRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";

import {
  extractChatMediaFilesLinks,
  formatTimeOnly,
  getFileThemeColor,
} from "./ChatMediaUtils";
import { ViewAllCategoryView } from "./ViewAllCategoryView";
import { avatarColor, formatBytes } from "../../shared/format";
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
  const rawTeam = activeDmPeer?.team?.trim();
  const teamLabel = rawTeam ? (rawTeam.toLowerCase().endsWith("team") ? rawTeam : `${rawTeam} Team`) : "General Team";
  const peerId = activeDmPeer?.user_id || active?.peer_id || "";
  const aboutText =
    localStorage.getItem(`peerchat_about_${peerId}`) || "Hey, I'm using PeerChat 😊";
  const isMuted = !!active?.muted;
  const isPinned = !!active?.pinned_at;

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

  const handleTogglePin = async () => {
    if (!active) return;
    try {
      await peerApi.setConversationPinned(active.id, !isPinned);
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
          {/* ── HEADER TITLE BAR (< Natraj ... ✕) ── */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 2.75,
              pt: 2.25,
              pb: 1.5,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton
                size="small"
                onClick={() => setChatInfoOpen(false)}
                sx={{ color: "#FFFFFF", p: 0.5, mr: 0.25 }}
              >
                <ArrowBackIosNewRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <Typography variant="h6" fontWeight={700} fontSize={18} color="#FFFFFF">
                {displayName}
              </Typography>
            </Stack>
            <IconButton
              size="small"
              onClick={() => setChatInfoOpen(false)}
              sx={{ color: "text.secondary" }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <DialogContent sx={{ p: 2.5, pt: 0.5, overflowY: "auto" }}>
            <Stack spacing={1.75}>
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
                  gap: 1.5,
                }}
              >
                {/* Left: Avatar with Online badge + Name + Team + IP */}
                <Stack direction="row" spacing={2} alignItems="center" minWidth={0} flex={1}>
                  <Box sx={{ position: "relative", flexShrink: 0 }}>
                    <Avatar
                      sx={{
                        width: 62,
                        height: 62,
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
                    <Typography fontWeight={700} fontSize={18.5} color="#FFFFFF" noWrap>
                      {displayName}
                    </Typography>

                    {/* Team Subtitle with status dot */}
                    <Stack direction="row" spacing={0.75} alignItems="center" mt={0.35}>
                      <Box
                        sx={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          bgcolor: isOnline ? "success.main" : "text.secondary",
                          flexShrink: 0,
                        }}
                      />
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          fontWeight: 500,
                          fontSize: 12.5,
                        }}
                        noWrap
                      >
                        {teamLabel}
                      </Typography>
                    </Stack>

                    {/* LAN IP Subtitle with Copy Button */}
                    <Stack direction="row" spacing={0.75} alignItems="center" mt={0.5}>
                      <ComputerRoundedIcon sx={{ fontSize: 15, color: "text.secondary", flexShrink: 0 }} />
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: 12,
                          color: "#FFFFFF",
                          fontWeight: 600,
                          fontFamily: "monospace",
                        }}
                      >
                        {ipAddress}
                      </Typography>
                      <Tooltip title={copiedIp ? "Copied!" : "Copy IP"}>
                        <IconButton
                          size="small"
                          onClick={handleCopyIp}
                          sx={{ p: 0.3, color: "text.secondary", "&:hover": { color: "#FFFFFF" } }}
                        >
                          {copiedIp ? (
                            <CheckRoundedIcon sx={{ fontSize: 13, color: "success.main" }} />
                          ) : (
                            <ContentCopyRoundedIcon sx={{ fontSize: 13 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </Box>
                </Stack>

                {/* Right: 4 Round Action Buttons (Message, Search, Pin, Mute) */}
                <Stack direction="row" spacing={1.25} alignItems="center" flexShrink={0}>
                  {/* Message */}
                  <Stack alignItems="center" spacing={0.4}>
                    <IconButton
                      onClick={() => setChatInfoOpen(false)}
                      sx={{
                        width: 42,
                        height: 42,
                        bgcolor: "rgba(255, 255, 255, 0.06)",
                        color: "#FFFFFF",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 19 }} />
                    </IconButton>
                    <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
                      Message
                    </Typography>
                  </Stack>

                  {/* Search */}
                  <Stack alignItems="center" spacing={0.4}>
                    <IconButton
                      onClick={() => {
                        setChatInfoOpen(false);
                        setInChatSearchOpen(true);
                      }}
                      sx={{
                        width: 42,
                        height: 42,
                        bgcolor: "rgba(255, 255, 255, 0.06)",
                        color: "#FFFFFF",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <SearchRoundedIcon sx={{ fontSize: 20 }} />
                    </IconButton>
                    <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
                      Search
                    </Typography>
                  </Stack>

                  {/* Pin */}
                  <Stack alignItems="center" spacing={0.4}>
                    <IconButton
                      onClick={handleTogglePin}
                      sx={{
                        width: 42,
                        height: 42,
                        bgcolor: isPinned ? "rgba(130, 169, 248, 0.18)" : "rgba(255, 255, 255, 0.06)",
                        color: isPinned ? "primary.main" : "#FFFFFF",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      {isPinned ? (
                        <PushPinRoundedIcon sx={{ fontSize: 19 }} />
                      ) : (
                        <PushPinOutlinedIcon sx={{ fontSize: 19 }} />
                      )}
                    </IconButton>
                    <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
                      {isPinned ? "Unpin" : "Pin"}
                    </Typography>
                  </Stack>

                  {/* Mute */}
                  <Stack alignItems="center" spacing={0.4}>
                    <IconButton
                      onClick={handleToggleMute}
                      sx={{
                        width: 42,
                        height: 42,
                        bgcolor: isMuted ? "rgba(240, 120, 120, 0.15)" : "rgba(255, 255, 255, 0.06)",
                        color: isMuted ? "error.main" : "#FFFFFF",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      {isMuted ? (
                        <NotificationsOffRoundedIcon sx={{ fontSize: 19 }} />
                      ) : (
                        <NotificationsNoneRoundedIcon sx={{ fontSize: 19 }} />
                      )}
                    </IconButton>
                    <Typography variant="caption" sx={{ fontSize: 11, color: "text.secondary" }}>
                      {isMuted ? "Unmute" : "Mute"}
                    </Typography>
                  </Stack>
                </Stack>
              </Box>

              {/* ── CARD 2: ABOUT SECTION ── */}
              <Box
                sx={{
                  bgcolor: "rgba(23, 31, 45, 0.7)",
                  borderRadius: 3,
                  p: 2,
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={600} fontSize={11.5} display="block" mb={0.5}>
                  About
                </Typography>
                <Typography fontSize={14} fontWeight={500} color="#FFFFFF">
                  {aboutText}
                </Typography>
              </Box>

              {/* ── CARD 3: MEDIA, FILES, LINKS TABS & PREVIEW (Starts immediately below About) ── */}
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

                {/* Preview Content: 2 rows */}
                <Box sx={{ pt: 1.75 }}>
                  {/* Media Tab Preview: 4 cols x 2 rows (8 items) */}
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

                  {/* Files Tab Preview: Compact recent files */}
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

                  {/* Links Tab Preview */}
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
