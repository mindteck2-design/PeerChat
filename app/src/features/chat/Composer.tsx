// @ts-nocheck
import { parseCalendarShare } from "../calendar/CalendarShareCard";
import { useLayoutEffect, useState } from "react";
import {
  Box, Button, Chip, IconButton, List, ListItemButton, ListItemText, Paper,
  Stack, TextField, Typography,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFileRounded";
import CampaignIcon from "@mui/icons-material/CampaignRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditIcon from "@mui/icons-material/EditRounded";
import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotionsRounded";
import FolderZipIcon from "@mui/icons-material/FolderZipRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PersonOffIcon from "@mui/icons-material/PersonOffRounded";
import PollIcon from "@mui/icons-material/PollRounded";
import ReplyIcon from "@mui/icons-material/ReplyRounded";
import ScreenshotMonitorIcon from "@mui/icons-material/ScreenshotMonitorRounded";
import SendIcon from "@mui/icons-material/SendRounded";
import Tooltip from "@mui/material/Tooltip";
import { formatBytes, truncate } from "../../shared/format";
import { messageAttachmentIds } from "../../shared/messageMeta";
import { isImageFileName, isVideoFileName } from "../../MediaAlbum";
import { canBroadcastRole } from "../profile/roles";
import type { ChatScreenVm } from "./chatVm";

function stagedExt(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toUpperCase().slice(0, 4) : "FILE";
}

function StagedStrip({
  stagedFiles,
  removeStagedFile,
  clearStagedFiles,
}: {
  stagedFiles: ChatScreenVm["stagedFiles"];
  removeStagedFile: ChatScreenVm["removeStagedFile"];
  clearStagedFiles: ChatScreenVm["clearStagedFiles"];
}) {
  if (!stagedFiles.length) return null;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.65, px: 0.25 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary">
          {stagedFiles.length} selected
        </Typography>
        <Button
          size="small"
          onClick={() => clearStagedFiles()}
          sx={{ textTransform: "none", fontWeight: 700, minWidth: 0, px: 0.75, py: 0 }}
        >
          Clear
        </Button>
      </Stack>
      <Box
        sx={{
          display: "flex",
          gap: 0.85,
          overflowX: "auto",
          pb: 0.35,
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          "&::-webkit-scrollbar": { height: 6 },
          "&::-webkit-scrollbar-thumb": {
            bgcolor: "action.disabled",
            borderRadius: 999,
          },
        }}
      >
        {stagedFiles.map((sf) => {
          const isImg = !!sf.previewUrl || isImageFileName(sf.name);
          const isVid = isVideoFileName(sf.name);
          return (
            <Box
              key={sf.id}
              sx={{
                position: "relative",
                flex: "0 0 auto",
                width: 76,
                scrollSnapAlign: "start",
              }}
            >
              <Box
                sx={{
                  width: 76,
                  height: 76,
                  borderRadius: 2,
                  overflow: "hidden",
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: "action.hover",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {sf.previewUrl ? (
                  <Box
                    component="img"
                    src={sf.previewUrl}
                    alt=""
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : sf.isDir ? (
                  <FolderZipIcon color="primary" />
                ) : isImg || isVid ? (
                  <Typography variant="caption" fontWeight={800} color="text.secondary">
                    {stagedExt(sf.name)}
                  </Typography>
                ) : (
                  <Stack alignItems="center" spacing={0.25} px={0.5}>
                    <InsertDriveFileIcon color="primary" sx={{ fontSize: 28 }} />
                    <Typography
                      variant="caption"
                      fontWeight={800}
                      color="text.secondary"
                      sx={{ fontSize: 9, lineHeight: 1 }}
                    >
                      {stagedExt(sf.name)}
                    </Typography>
                  </Stack>
                )}
              </Box>
              <Tooltip title={sf.name}>
                <Typography
                  variant="caption"
                  noWrap
                  display="block"
                  sx={{ mt: 0.35, fontSize: 10.5, maxWidth: 76, px: 0.15 }}
                >
                  {sf.name}
                </Typography>
              </Tooltip>
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ fontSize: 9.5, px: 0.15, lineHeight: 1.1 }}
              >
                {formatBytes(sf.size)}
              </Typography>
              <IconButton
                size="small"
                aria-label={`Remove ${sf.name}`}
                onClick={() => removeStagedFile(sf.id)}
                sx={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 22,
                  height: 22,
                  bgcolor: "background.paper",
                  border: "1px solid",
                  borderColor: "divider",
                  boxShadow: 1,
                  "&:hover": { bgcolor: "background.paper" },
                }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export function Composer({ vm }: { vm: ChatScreenVm }) {
  const {
    SLASH_NAMES,
    active,
    activeDmPeer,
    announceBusy,
    announceCompose,
    canBroadcast,
    cancelEdit,
    clearStagedFiles,
    composerRef,
    dark,
    draftsRef,
    editingMessage,
    filePickRef,
    handleRemoveLeftGroup,
    inGroup,
    isAnnounceBoard,
    membersLoaded,
    myDesignation,
    notifyTyping,
    others,
    outgoingFile,
    pickAndStageFiles,
    plain,
    postAnnouncement,
    profile,
    removeStagedFile,
    replyTo,
    runSlash,
    senderLabel,
    setAnnounceCompose,
    setEmojiAnchor,
    setPollOpen,
    setReplyTo,
    setSlashIndex,
    setStatus,
    setText,
    slashIndex,
    slashSuggestions,
    slashToken,
    stageFiles,
    stagedFiles,
    startScreenshotCapture,
    submitComposer,
    text,
    toggleBlockPeer,
  } = vm;

  const [broadcastMode, setBroadcastMode] = useState<"text" | "announcement">("text");
  const canUserBroadcast = !isAnnounceBoard || (canBroadcast !== undefined ? canBroadcast : canBroadcastRole(myDesignation));

  // Single-line → horizontal pill; multi-line → softer radius + toolbar under text.
  // Hysteresis avoids layout flicker when tools moving changes textarea width/wrap.
  const [multiline, setMultiline] = useState(false);
  useLayoutEffect(() => {
    const el = composerRef?.current as HTMLTextAreaElement | null;
    if (!el) {
      setMultiline(false);
      return;
    }
    if ((text || "").includes("\n")) {
      setMultiline(true);
      return;
    }
    const style = window.getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const padY =
      (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const singleH = lineHeight + padY + 2;
    const tall = el.scrollHeight > singleH * 1.4;
    const clearlySingle = el.scrollHeight <= singleH * 1.1;
    setMultiline((prev) => {
      if (prev) return !clearlySingle;
      return tall;
    });
  }, [text, composerRef]);

  const toolButtons = (
    <Stack direction="row" spacing={0.15} alignItems="center" sx={{ flexShrink: 0 }}>
      <IconButton
        aria-label="Emoji picker"
        onClick={(e) => setEmojiAnchor(e.currentTarget)}
        size="small"
      >
        <EmojiEmotionsIcon fontSize="small" />
      </IconButton>
      <Tooltip title="Attach files">
        <span>
          <IconButton
            aria-label="Attach files"
            size="small"
            disabled={(!!outgoingFile && !outgoingFile.cancelled) || !!editingMessage}
            onClick={(e) => {
              e.currentTarget.blur();
              void pickAndStageFiles();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.blur();
                requestAnimationFrame(() => {
                  (composerRef?.current as HTMLInputElement | HTMLTextAreaElement | null)?.focus();
                });
              }
            }}
          >
            <AttachFileIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Capture screenshot · Ctrl+Shift+S">
        <span>
          <IconButton
            aria-label="Capture screenshot"
            size="small"
            disabled={
              (!!outgoingFile && !outgoingFile.cancelled) ||
              !!editingMessage ||
              typeof startScreenshotCapture !== "function"
            }
            onClick={() => void startScreenshotCapture?.()}
          >
            <ScreenshotMonitorIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );

  const sendButton = (
    <IconButton
      color="primary"
      disabled={
        (!!editingMessage && !text.trim()) ||
        (!text.trim() &&
          (!stagedFiles.length || (!!outgoingFile && !outgoingFile.cancelled)))
      }
      onClick={submitComposer}
      aria-label={editingMessage ? "Save edit" : "Send"}
      sx={{
        bgcolor: "primary.main",
        color: "primary.contrastText",
        width: 36,
        height: 36,
        flexShrink: 0,
        "&:hover": { bgcolor: "primary.dark" },
        "&.Mui-disabled": {
          bgcolor: "action.disabledBackground",
          color: "action.disabled",
        },
      }}
    >
      {editingMessage ? <EditIcon fontSize="small" /> : <SendIcon fontSize="small" />}
    </IconButton>
  );

  return (
    <>
        {active && inGroup && isAnnounceBoard && !canUserBroadcast && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              px: 2,
              py: 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            <LockOutlinedIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            <Typography variant="body2" color="text.secondary" fontSize={13}>
              Read-only channel · Only Deputy Manager and above can post
            </Typography>
          </Paper>
        )}

        {active && inGroup && isAnnounceBoard && canUserBroadcast && broadcastMode === "announcement" && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              px: 2,
              py: 1.5,
              borderTop: "1px solid",
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
              gap: 1.25,
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            {/* Mode action chips */}
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip
                label="Message"
                variant="outlined"
                size="small"
                onClick={() => setBroadcastMode("text")}
                sx={{ fontWeight: 500, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              />
              <Chip
                icon={<CampaignIcon sx={{ fontSize: 16 }} />}
                label="/announce"
                color="primary"
                size="small"
                sx={{ fontWeight: 600, px: 0.5 }}
              />
              <Chip
                icon={<PollIcon sx={{ fontSize: 16 }} />}
                label="/poll"
                variant="outlined"
                size="small"
                onClick={() => setPollOpen?.(true)}
                sx={{ fontWeight: 500, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              />
              <Chip
                icon={<AttachFileIcon sx={{ fontSize: 16 }} />}
                label="/send file"
                variant="outlined"
                size="small"
                onClick={() => void pickAndStageFiles?.()}
                sx={{ fontWeight: 500, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
              />
            </Stack>

            <StagedStrip
              stagedFiles={stagedFiles}
              removeStagedFile={removeStagedFile}
              clearStagedFiles={clearStagedFiles}
            />

            <TextField
              size="small"
              fullWidth
              placeholder="Announcement Title"
              value={announceCompose.title}
              onChange={(e) => setAnnounceCompose((c) => ({ ...c, title: e.target.value }))}
              sx={{
                "& .MuiOutlinedInput-root": {
                  fontWeight: 600,
                  bgcolor: dark ? "rgba(255, 255, 255, 0.03)" : "action.hover",
                },
              }}
            />

            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              maxRows={6}
              placeholder="Memo, circular, or update… (links are clickable)"
              value={announceCompose.body}
              onChange={(e) => setAnnounceCompose((c) => ({ ...c, body: e.target.value }))}
              sx={{
                "& .MuiOutlinedInput-root": {
                  bgcolor: dark ? "rgba(255, 255, 255, 0.03)" : "action.hover",
                },
              }}
            />

            <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
              <Button
                size="small"
                startIcon={<AttachFileIcon />}
                disabled={announceBusy || (!!outgoingFile && !outgoingFile.cancelled)}
                onClick={() => void pickAndStageFiles?.()}
                sx={{ textTransform: "none" }}
              >
                Attach file
              </Button>
              <Stack direction="row" spacing={1} alignItems="center">
                {(announceCompose.title || announceCompose.body || stagedFiles.length > 0) && (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => {
                      setAnnounceCompose({ title: "", body: "" });
                      clearStagedFiles();
                    }}
                    sx={{ textTransform: "none", color: "text.secondary" }}
                  >
                    Clear
                  </Button>
                )}
                <Button
                  variant="contained"
                  disabled={
                    announceBusy ||
                    (!!outgoingFile && !outgoingFile.cancelled) ||
                    !announceCompose.title.trim() ||
                    !announceCompose.body.trim()
                  }
                  onClick={() => void postAnnouncement()}
                  sx={{ textTransform: "none", fontWeight: 700 }}
                >
                  Post Broadcast
                </Button>
              </Stack>
            </Stack>
          </Paper>
        )}

        {active && activeDmPeer?.blocked && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              p: 2,
              borderTop: "1px solid",
              borderColor: "divider",
              textAlign: "center",
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            <Typography color="text.secondary" sx={{ mb: 1.25 }}>
              Messaging is disabled while this person is blocked.
            </Typography>
            <Button
              variant="outlined"
              startIcon={<PersonOffIcon />}
              onClick={() => toggleBlockPeer(activeDmPeer.user_id, false)}
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              Unblock
            </Button>
          </Paper>
        )}

        {active && inGroup && !activeDmPeer?.blocked && (!isAnnounceBoard || (isAnnounceBoard && canUserBroadcast && broadcastMode === "text")) && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              px: 1.5,
              py: 1.25,
              borderTop: "1px solid",
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
              gap: 0.85,
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            {isAnnounceBoard && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Chip
                  label="Message"
                  color="primary"
                  size="small"
                  sx={{ fontWeight: 600, px: 0.5 }}
                />
                <Chip
                  icon={<CampaignIcon sx={{ fontSize: 16 }} />}
                  label="/announce"
                  variant="outlined"
                  size="small"
                  onClick={() => setBroadcastMode("announcement")}
                  sx={{ fontWeight: 500, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                />
                <Chip
                  icon={<PollIcon sx={{ fontSize: 16 }} />}
                  label="/poll"
                  variant="outlined"
                  size="small"
                  onClick={() => setPollOpen?.(true)}
                  sx={{ fontWeight: 500, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                />
                <Chip
                  icon={<AttachFileIcon sx={{ fontSize: 16 }} />}
                  label="/send file"
                  variant="outlined"
                  size="small"
                  onClick={() => void pickAndStageFiles?.()}
                  sx={{ fontWeight: 500, cursor: "pointer", "&:hover": { bgcolor: "action.hover" } }}
                />
              </Stack>
            )}
            {editingMessage && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  p: 1,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  bgcolor: "action.hover",
                }}
              >
                <EditIcon fontSize="small" color="primary" />
                <Box flex={1} minWidth={0}>
                  <Typography variant="caption" fontWeight={700} color="primary" display="block">
                    Editing message
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {truncate(plain[editingMessage.id] || "…", 90)}
                  </Typography>
                </Box>
                <IconButton size="small" aria-label="Cancel edit" onClick={cancelEdit}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            )}
            {replyTo && !editingMessage && (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  p: 1,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  bgcolor: "action.hover",
                }}
              >
                <ReplyIcon fontSize="small" color="primary" />
                <Box flex={1} minWidth={0}>
                  <Typography variant="caption" fontWeight={700} color="primary" display="block">
                    Replying to {senderLabel(replyTo.sender_id)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">
                    {messageAttachmentIds(replyTo).length
                      ? [
                          plain[replyTo.id]?.trim()
                            ? truncate(plain[replyTo.id], 70)
                            : null,
                          `📎 ${messageAttachmentIds(replyTo).length}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : replyTo.kind === "calendar_share" ? (() => { const s = parseCalendarShare(plain[replyTo.id] || ""); return s ? `📅 ${s.title}` : "📅 Calendar item"; })() : replyTo.kind === "file_notice"
                        ? "📎 File"
                        : truncate(plain[replyTo.id] || "…", 90)}
                  </Typography>
                </Box>
                <IconButton size="small" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            )}
            {stagedFiles.length > 0 && !editingMessage && (
              <StagedStrip
                stagedFiles={stagedFiles}
                removeStagedFile={removeStagedFile}
                clearStagedFiles={clearStagedFiles}
              />
            )}
            {!!slashSuggestions.length && (
              <List dense sx={{ py: 0 }}>
                {slashSuggestions.map((cmd, idx) => (
                  <ListItemButton
                    key={cmd.name}
                    selected={idx === slashIndex}
                    onClick={() => runSlash(cmd.name)}
                  >
                    <ListItemText primary={cmd.name} secondary={cmd.hint} />
                  </ListItemButton>
                ))}
              </List>
            )}
            <Box
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) stageFiles(files);
              }}
              sx={{
                display: "flex",
                flexDirection: multiline ? "column" : "row",
                alignItems: multiline ? "stretch" : "center",
                gap: multiline ? 0.35 : 0.35,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: multiline ? 2 : 999,
                bgcolor: dark ? "chat.input" : "action.hover",
                px: multiline ? 1 : 0.75,
                py: multiline ? 0.75 : 0.35,
                minWidth: 0,
                transition: "border-radius 120ms ease",
              }}
            >
              {/* Fallback for browser preview when native dialog is unavailable */}
              <input
                ref={filePickRef}
                hidden
                type="file"
                multiple
                disabled={(!!outgoingFile && !outgoingFile.cancelled) || !!editingMessage}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  if (files.length) stageFiles(files);
                  e.target.value = "";
                  requestAnimationFrame(() => {
                    (composerRef?.current as HTMLInputElement | HTMLTextAreaElement | null)?.focus();
                  });
                }}
              />
              {!multiline && toolButtons}
              <TextField
                inputRef={composerRef}
                fullWidth
                size="small"
                multiline
                minRows={1}
                maxRows={5}
                placeholder={
                  outgoingFile && !outgoingFile.cancelled
                    ? `Sending ${outgoingFile.name}… you can still type`
                    : editingMessage
                      ? "Edit message… (Esc to cancel)"
                      : isAnnounceBoard
                        ? "Broadcast a message… (Shift+Enter for new line)"
                        : "Type a message…"
                }
                value={text}
                variant="standard"
                InputProps={{ disableUnderline: true }}
                onChange={(e) => {
                  const v = e.target.value;
                  setText(v);
                  if (active && !editingMessage) draftsRef.current[active.id] = v;
                  if (v.trim() && !editingMessage) notifyTyping();
                }}
                onKeyDown={(e) => {
                  if (slashSuggestions.length && e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((n) => (n + 1) % slashSuggestions.length);
                    return;
                  }
                  if (slashSuggestions.length && e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((n) => (n + slashSuggestions.length - 1) % slashSuggestions.length);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey && slashToken) {
                    e.preventDefault();
                    const exact = SLASH_NAMES.has(slashToken);
                    if (exact) runSlash(slashToken);
                    else if (slashSuggestions[slashIndex]) runSlash(slashSuggestions[slashIndex].name);
                    else setStatus("Unknown command. Type /help to see what is available. The draft was kept.");
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (outgoingFile && !outgoingFile.cancelled && !text.trim()) return;
                    submitComposer();
                  } else if (e.key === "Escape" && slashSuggestions.length) {
                    e.preventDefault();
                    setText((t) => (t.startsWith("/") ? "" : t));
                  } else if (e.key === "Escape" && editingMessage) {
                    e.preventDefault();
                    cancelEdit();
                  } else if (e.key === "Escape" && replyTo) {
                    e.preventDefault();
                    setReplyTo(null);
                  }
                }}
                sx={(theme) => ({
                  minWidth: 0,
                  flex: 1,
                  mx: multiline ? 0 : 0.35,
                  "& .MuiInputBase-root": {
                    fontSize: 14,
                    py: multiline ? 0.35 : 0.45,
                    alignItems: "flex-start",
                  },
                  "& textarea": {
                    overflowY: "auto !important",
                    scrollbarWidth: "thin",
                    scrollbarColor: `${theme.palette.action.disabled} transparent`,
                    "&::-webkit-scrollbar": { width: 6 },
                    "&::-webkit-scrollbar-track": { background: "transparent" },
                    "&::-webkit-scrollbar-thumb": {
                      backgroundColor: theme.palette.action.disabled,
                      borderRadius: 999,
                    },
                    "&::-webkit-scrollbar-thumb:hover": {
                      backgroundColor: theme.palette.action.active,
                    },
                  },
                })}
              />
              {multiline ? (
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  gap={0.5}
                  sx={{ minHeight: 36 }}
                >
                  {toolButtons}
                  {sendButton}
                </Box>
              ) : (
                sendButton
              )}
            </Box>
          </Paper>
        )}
        {active?.kind === "group" && membersLoaded && !inGroup && (
          <Paper
            square
            elevation={0}
            sx={{
              flexShrink: 0,
              p: 2,
              borderTop: "1px solid",
              borderColor: "divider",
              textAlign: "center",
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            <Typography color="text.secondary" sx={{ mb: 1.25 }}>
              You're no longer in this group.
            </Typography>
            <Button
              color="error"
              variant="outlined"
              startIcon={<DeleteOutlineIcon />}
              onClick={() => handleRemoveLeftGroup(active)}
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              Remove from chat list
            </Button>
          </Paper>
        )}

    </>
  );
}