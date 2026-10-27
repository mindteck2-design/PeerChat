// @ts-nocheck
import { useState, useMemo } from "react";
import {
  Avatar,
  Box,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import ArrowBackIosNewRoundedIcon from "@mui/icons-material/ArrowBackIosNewRounded";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import PushPinRoundedIcon from "@mui/icons-material/PushPinRounded";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";
import NotificationsOffRoundedIcon from "@mui/icons-material/NotificationsOffRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

import { extractChatMediaFilesLinks } from "./ChatMediaUtils";
import { SharedItemsPreviewCard } from "./SharedItemsPreviewCard";
import { ViewAllCategoryView, type SharedItemsCategory } from "./ViewAllCategoryView";
import type { ChatScreenVm } from "./chatVm";

export function BroadcastChannelInfoDialog({ vm }: { vm: ChatScreenVm }) {
  const {
    active,
    broadcastInfoOpen,
    fileNames,
    fileSizes,
    fileThumbs,
    isAnnounceBoard,
    messages,
    openAttachment,
    peerApi,
    peers,
    plain,
    profile,
    refresh,
    setBroadcastInfoOpen,
    setHighlightMsgId,
    setInChatSearchOpen,
    stickToBottomRef,
  } = vm;

  const [viewAllCategory, setViewAllCategory] = useState<SharedItemsCategory | null>(null);

  const isOpen = !!broadcastInfoOpen && !!active && !!isAnnounceBoard;

  const { media, files, links } = useMemo(() => {
    if (!isOpen) return { media: [], files: [], links: [] };
    return extractChatMediaFilesLinks(messages, fileNames, fileSizes, fileThumbs, plain);
  }, [isOpen, messages, fileNames, fileSizes, fileThumbs, plain]);

  if (!isOpen) return null;

  const isOrg = active.id === "board:org";
  const myTeam = (profile?.team || "").trim().toLowerCase();
  const channelTitle = active.title || (isOrg ? "Org updates" : "Team Announcements");
  const isMuted = !!active?.muted;
  const isPinned = !!active?.pinned_at;

  const audienceLabel = isOrg
    ? "All Organization Peers"
    : `${profile?.team ? profile.team.trim() : "Team"} Department`;

  const subscriberCount = isOrg
    ? (peers?.length || 0) + 1
    : (peers?.filter((p) => (p.team || "").trim().toLowerCase() === myTeam).length || 0) + 1;

  const channelPurpose = isOrg
    ? "Official company-wide memos, circulars, executive notices, and organization updates broadcasted across the enterprise LAN."
    : `Official department circulars, release notes, sprint milestones, and operational memos for the ${profile?.team || "Team"} team.`;

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
    setBroadcastInfoOpen(false);
    stickToBottomRef.current = false;
    setHighlightMsgId(messageId);
  };

  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";

  return (
    <Dialog
      open={isOpen}
      onClose={() => {
        setBroadcastInfoOpen(false);
        setViewAllCategory(null);
      }}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          bgcolor: "background.paper",
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
          chatTitle={channelTitle}
          media={media}
          files={files}
          links={links}
          onBack={() => setViewAllCategory(null)}
          onClose={() => {
            setBroadcastInfoOpen(false);
            setViewAllCategory(null);
          }}
          onOpenAttachment={(fileId, senderId) => {
            void openAttachment(fileId, senderId);
          }}
          onJumpToMessage={handleJumpToMessage}
        />
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", maxHeight: "88vh" }}>
          {/* Header Title Bar */}
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
                onClick={() => setBroadcastInfoOpen(false)}
                sx={{ color: "text.primary", p: 0.5, mr: 0.25, "&:hover": { bgcolor: "action.hover" } }}
              >
                <ArrowBackIosNewRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <Typography variant="h6" fontWeight={700} fontSize={18} color="text.primary">
                Channel Info
              </Typography>
            </Stack>
            <IconButton
              size="small"
              onClick={() => setBroadcastInfoOpen(false)}
              sx={{ color: "text.secondary", "&:hover": { color: "text.primary" } }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Box>

          <DialogContent sx={{ p: 2.5, pt: 0.5, overflowY: "auto" }}>
            <Stack spacing={1.75}>
              {/* CARD 1: Identity & Action Bar */}
              <Box
                sx={{
                  bgcolor: isDark ? "rgba(23, 31, 45, 0.7)" : "action.hover",
                  borderRadius: 1.5,
                  p: 2.25,
                  border: "1px solid",
                  borderColor: "divider",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1.5,
                }}
              >
                {/* Left: Avatar + Title + Subtitle */}
                <Stack direction="row" spacing={2} alignItems="center" minWidth={0} flex={1}>
                  <Avatar
                    sx={{
                      width: 60,
                      height: 60,
                      bgcolor: "primary.main",
                      color: "#FFFFFF",
                      boxShadow: "0 4px 16px rgba(15, 107, 92, 0.35)",
                      flexShrink: 0,
                    }}
                  >
                    <CampaignRoundedIcon sx={{ fontSize: 32, color: "#FFFFFF" }} />
                  </Avatar>

                  <Box minWidth={0} flex={1}>
                    <Typography fontWeight={700} fontSize={18} color="text.primary" noWrap>
                      {channelTitle}
                    </Typography>

                    <Stack direction="row" spacing={0.75} alignItems="center" mt={0.35}>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "primary.main",
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                        noWrap
                      >
                        Official Broadcast Channel
                      </Typography>
                    </Stack>

                    <Stack direction="row" spacing={0.5} alignItems="center" mt={0.35}>
                      <LockOutlinedIcon sx={{ fontSize: 13, color: "text.secondary" }} />
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          fontSize: 11.5,
                        }}
                      >
                        Posting: Deputy Manager & above
                      </Typography>
                    </Stack>
                  </Box>
                </Stack>

                {/* Right: Actions (Search, Pin, Mute) */}
                <Stack direction="row" spacing={1.25} alignItems="center" flexShrink={0}>
                  {/* Search */}
                  <Stack alignItems="center" spacing={0.4}>
                    <IconButton
                      onClick={() => {
                        setBroadcastInfoOpen(false);
                        setInChatSearchOpen(true);
                      }}
                      sx={{
                        width: 42,
                        height: 42,
                        bgcolor: isDark ? "rgba(255, 255, 255, 0.06)" : "action.selected",
                        color: "text.primary",
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
                        bgcolor: isPinned
                          ? isDark ? "rgba(130, 169, 248, 0.18)" : "rgba(37, 99, 235, 0.12)"
                          : isDark ? "rgba(255, 255, 255, 0.06)" : "action.selected",
                        color: isPinned ? "primary.main" : "text.primary",
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
                        bgcolor: isMuted
                          ? isDark ? "rgba(240, 120, 120, 0.15)" : "rgba(239, 68, 68, 0.12)"
                          : isDark ? "rgba(255, 255, 255, 0.06)" : "action.selected",
                        color: isMuted ? "error.main" : "text.primary",
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

              {/* CARD 2: Channel Purpose & Scope */}
              <Box
                sx={{
                  bgcolor: isDark ? "rgba(23, 31, 45, 0.7)" : "action.hover",
                  borderRadius: 1.5,
                  p: 2,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" mb={0.75}>
                  <InfoOutlinedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={600} fontSize={11.5}>
                    About Channel
                  </Typography>
                </Stack>
                <Typography fontSize={13.5} fontWeight={400} color="text.primary" lineHeight={1.5}>
                  {channelPurpose}
                </Typography>
              </Box>

              {/* CARD 3: Audience & Policy Summary */}
              <Box
                sx={{
                  bgcolor: isDark ? "rgba(23, 31, 45, 0.7)" : "action.hover",
                  borderRadius: 1.5,
                  p: 2,
                  border: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Stack direction="row" spacing={0.75} alignItems="center" mb={1.25}>
                  <GroupsRoundedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
                  <Typography variant="caption" color="text.secondary" fontWeight={600} fontSize={11.5}>
                    Audience & Governance
                  </Typography>
                </Stack>

                <Stack spacing={1}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="caption" color="text.secondary" fontSize={12}>
                      Audience Scope
                    </Typography>
                    <Typography variant="caption" color="text.primary" fontWeight={600} fontSize={12}>
                      {audienceLabel}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="caption" color="text.secondary" fontSize={12}>
                      Subscribers
                    </Typography>
                    <Typography variant="caption" color="text.primary" fontWeight={600} fontSize={12}>
                      {subscriberCount} member{subscriberCount === 1 ? "" : "s"} on LAN
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Typography variant="caption" color="text.secondary" fontSize={12}>
                      Broadcasting Authority
                    </Typography>
                    <Typography variant="caption" color="primary.main" fontWeight={600} fontSize={12}>
                      Deputy Manager and above
                    </Typography>
                  </Box>
                </Stack>
              </Box>

              {/* CARD 4: Shared Circulars, Files & Media */}
              <SharedItemsPreviewCard
                media={media}
                files={files}
                links={links}
                onSelectCategory={(cat) => setViewAllCategory(cat)}
                onOpenAttachment={(fileId, senderId) => {
                  void openAttachment(fileId, senderId);
                }}
              />
            </Stack>
          </DialogContent>
        </Box>
      )}
    </Dialog>
  );
}
