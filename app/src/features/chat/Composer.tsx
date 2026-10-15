// @ts-nocheck
import {
  Box, Button, Chip, IconButton, List, ListItemButton, ListItemText, Paper,
  Stack, TextField, Typography,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFileRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditIcon from "@mui/icons-material/EditRounded";
import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotionsRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import PersonOffIcon from "@mui/icons-material/PersonOffRounded";
import ReplyIcon from "@mui/icons-material/ReplyRounded";
import SendIcon from "@mui/icons-material/SendRounded";
import { formatBytes, truncate } from "../../shared/format";
import { messageAttachmentIds } from "../../shared/messageMeta";
import type { ChatScreenVm } from "./chatVm";

export function Composer({ vm }: { vm: ChatScreenVm }) {
  const {
    SLASH_NAMES,
    active,
    activeDmPeer,
    announceBusy,
    announceCompose,
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
    notifyTyping,
    others,
    outgoingFile,
    pickAndStageFiles,
    plain,
    postAnnouncement,
    removeStagedFile,
    replyTo,
    runSlash,
    senderLabel,
    setAnnounceCompose,
    setEmojiAnchor,
    setReplyTo,
    setSlashIndex,
    setStatus,
    setText,
    slashIndex,
    slashSuggestions,
    slashToken,
    stageFiles,
    stagedFiles,
    submitComposer,
    text,
    toggleBlockPeer,
  } = vm;
  return (
    <>
        {active && inGroup && isAnnounceBoard && (
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
              gap: 1,
              bgcolor: "background.paper",
              zIndex: 2,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              One-way posts — others can react. Use the message menu to reply privately to the author.
            </Typography>
            {stagedFiles.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {stagedFiles.map((sf) => (
                  <Chip
                    key={sf.id}
                    label={sf.name}
                    onDelete={() => removeStagedFile(sf.id)}
                    size="small"
                  />
                ))}
              </Stack>
            )}
            <TextField
              size="small"
              fullWidth
              placeholder="Title"
              value={announceCompose.title}
              onChange={(e) => setAnnounceCompose((c) => ({ ...c, title: e.target.value }))}
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
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
              <Button
                component="label"
                size="small"
                startIcon={<AttachFileIcon />}
                disabled={announceBusy || (!!outgoingFile && !outgoingFile.cancelled)}
                sx={{ textTransform: "none", mr: "auto" }}
              >
                Attach file
                <input
                  hidden
                  type="file"
                  disabled={announceBusy || (!!outgoingFile && !outgoingFile.cancelled)}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) {
                      // One attachment per announcement post.
                      clearStagedFiles();
                      stageFiles(files.slice(0, 1));
                    }
                    e.target.value = "";
                  }}
                />
              </Button>
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
                Post
              </Button>
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

        {active && inGroup && !isAnnounceBoard && !activeDmPeer?.blocked && (
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
                      : replyTo.kind === "file_notice"
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
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {stagedFiles.map((sf) => (
                  <Box
                    key={sf.id}
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
                    {sf.previewUrl ? (
                      <Box
                        component="img"
                        src={sf.previewUrl}
                        alt=""
                        sx={{ width: 40, height: 40, objectFit: "cover", borderRadius: 1 }}
                      />
                    ) : (
                      <InsertDriveFileIcon color="primary" />
                    )}
                    <Box minWidth={0}>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 160 }}>
                        {sf.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatBytes(sf.size)}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      aria-label={`Remove ${sf.name}`}
                      onClick={() => removeStagedFile(sf.id)}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
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
              display="flex"
              gap={0.5}
              alignItems="flex-end"
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) stageFiles(files);
              }}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 999,
                bgcolor: "action.hover",
                px: 0.75,
                py: 0.35,
              }}
            >
              <IconButton
                aria-label="Emoji picker"
                onClick={(e) => setEmojiAnchor(e.currentTarget)}
                size="small"
              >
                <EmojiEmotionsIcon fontSize="small" />
              </IconButton>
              <IconButton
                aria-label="Attach files"
                disabled={(!!outgoingFile && !outgoingFile.cancelled) || !!editingMessage}
                size="small"
                onClick={() => void pickAndStageFiles()}
              >
                <AttachFileIcon fontSize="small" />
              </IconButton>
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
                }}
              />
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
                    // While a file is staging, only allow text (no new attachments).
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
                sx={{
                  mx: 0.5,
                  "& .MuiInputBase-root": { fontSize: 14, py: 0.6 },
                }}
              />
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
                  "&:hover": { bgcolor: "primary.dark" },
                  "&.Mui-disabled": {
                    bgcolor: "action.disabledBackground",
                    color: "action.disabled",
                  },
                }}
              >
                {editingMessage ? <EditIcon fontSize="small" /> : <SendIcon fontSize="small" />}
              </IconButton>
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
