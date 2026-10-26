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

import { extractChatMediaFilesLinks } from "./ChatMediaUtils";
import { SharedItemsPreviewCard } from "./SharedItemsPreviewCard";
import { ViewAllCategoryView, type SharedItemsCategory } from "./ViewAllCategoryView";
import { avatarColor } from "../../shared/format";
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

  const [viewAllCategory, setViewAllCategory] = useState<SharedItemsCategory | null>(null);
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
                emptyLabel="No shared media, files, or links in this chat yet."
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
