// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import {
  Avatar, Box, Button, Chip, CircularProgress, Grow, IconButton, LinearProgress,
  Paper, Stack, Tooltip, Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/CloseRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import DoneIcon from "@mui/icons-material/DoneRounded";
import DoneAllIcon from "@mui/icons-material/DoneAllRounded";
import DownloadIcon from "@mui/icons-material/DownloadRounded";
import ForwardIcon from "@mui/icons-material/ForwardRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import MoreVertIcon from "@mui/icons-material/MoreVertRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import PauseIcon from "@mui/icons-material/PauseRounded";
import PlayArrowIcon from "@mui/icons-material/PlayArrowRounded";
import PushPinIcon from "@mui/icons-material/PushPinRounded";
import ReplyIcon from "@mui/icons-material/ReplyRounded";
import StopCircleIcon from "@mui/icons-material/StopCircleRounded";
import { MediaAlbum, isGridMediaName, type AlbumItem } from "../../MediaAlbum";
import { LinkifiedText } from "../../panels";
import { RichCard } from "./RichCard";
import { GameInviteCard, matchIdOf, parseGameMsg, resolveGameCardStatus } from "../../games/GameInviteCard";
import type { GameMsg, PendingGameInvite } from "../../games/games";
import { emojiOnlyCount, emojiOnlyFontSize } from "../../emoji";
import { FEATURE_GAMES } from "../../features";
import { messageAttachmentIds } from "../../shared/messageMeta";
import { formatClock, truncate } from "../../shared/format";
import { peerApi } from "../../peer";
import type { ChatScreenVm } from "./chatVm";

const MESSAGE_COLLAPSED_MAX_HEIGHT = 120;

/** WhatsApp-style inline expansion for long message text. */
function ExpandableMessageText({
  text,
  bigEmoji = false,
  emojiFontSize = 32,
}: {
  text: string;
  bigEmoji?: boolean;
  emojiFontSize?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const measure = () => {
      setCanExpand(content.scrollHeight > MESSAGE_COLLAPSED_MAX_HEIGHT + 2);
    };

    measure();
    // Re-check when wrapping changes because the chat pane or bubble width changes.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [text]);

  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={{
          maxHeight: !expanded && canExpand && !bigEmoji ? MESSAGE_COLLAPSED_MAX_HEIGHT : "none",
          overflow: !expanded && canExpand && !bigEmoji ? "hidden" : "visible",
        }}
      >
        <Box
          ref={contentRef}
          sx={{
            fontSize: bigEmoji ? emojiFontSize : 14,
            lineHeight: bigEmoji ? 1.15 : 1.35,
            px: 0.25,
            letterSpacing: bigEmoji ? "0.04em" : undefined,
            overflowWrap: "anywhere",
          }}
        >
          <LinkifiedText
            text={text || "…"}
            sx={{
              fontSize: "inherit",
              lineHeight: "inherit",
              letterSpacing: "inherit",
            }}
          />
        </Box>
      </Box>
      {canExpand && !bigEmoji && (
        <Typography
          component="button"
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          sx={{
            display: "inline-block",
            border: 0,
            p: 0,
            mt: 0.35,
            bgcolor: "transparent",
            color: "primary.main",
            font: "inherit",
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1.4,
            cursor: "pointer",
            textAlign: "left",
            "&:hover": { textDecoration: "underline" },
          }}
        >
          {expanded ? "See less" : "See more"}
        </Typography>
      )}
    </Box>
  );
}

export function MessageList({ vm }: { vm: ChatScreenVm }) {
  const {
    abortIncomingTransfer,
    abortOutgoingTransfer,
    active,
    bottomSentinelRef,
    dark,
    dayGroups,
    dismissIncomingTransfer,
    dismissOutgoingTransfer,
    fileNames,
    fileSizes,
    fileThumbs,
    gameInviteBusy,
    gamesOn,
    highlightMsgId,
    incomingFile,
    messages,
    openAttachment,
    outgoingFile,
    pauseIncomingTransfer,
    pauseOutgoingTransfer,
    peerApi,
    peers,
    plain,
    profile,
    reactToMessage,
    resumeOutgoingTransfer,
    retryIncomingTransfer,
    retryOutgoingTransfer,
    retrySend,
    sendEncrypted,
    sendGameMsg,
    senderLabel,
    setGameInviteBusy,
    setGamesOn,
    setMessages,
    setMsgMenu,
    setNav,
    setPendingGameInvite,
    setStatus,
    status,
    text,
    thumbInflightRef
  } = vm;

  const jumpToReferencedMessage = (messageId: string) => {
    const target = document.getElementById(`msg-${messageId}`);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    // Briefly outline the destination so the user can spot it in a busy conversation.
    target.style.outline = "2px solid var(--mui-palette-primary-main, #2563eb)";
    target.style.outlineOffset = "3px";
    target.style.transition = "outline-color 180ms ease";
    window.setTimeout(() => {
      target.style.outline = "";
      target.style.outlineOffset = "";
    }, 1600);
  };

  return (
    <>
          {dayGroups.map((group) => (
            <Box key={group.day} display="flex" flexDirection="column" gap={0.65}>
              <Box display="flex" justifyContent="center" my={0.75}>
                <Chip
                  label={group.label}
                  size="small"
                  sx={{
                    height: 22,
                    px: 0.75,
                    bgcolor: "background.paper",
                    color: "text.secondary",
                    fontWeight: 600,
                    fontSize: 11,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                />
              </Box>
              {group.items.map((m) => {
                const mine = m.sender_id === profile.id;
                const quoted = m.reply_to ? messages.find((x) => x.id === m.reply_to) : undefined;
                const label = senderLabel(m.sender_id);
                const isGroup = active?.kind === "group";
                // WhatsApp-style: 1–3 emoji-only → large, no bubble (skip if reply/attachments).
                const emojiN =
                  (m.kind === "text" || m.kind === "forwarded") &&
                  !quoted &&
                  !messageAttachmentIds(m).length
                    ? emojiOnlyCount(plain[m.id] || "")
                    : null;
                const bigEmoji = emojiN != null;
                if (m.kind === "system") {
                  return (
                    <Grow in key={m.id} timeout={180}>
                      <Box display="flex" justifyContent="center" my={0.35}>
                        <Chip
                          size="small"
                          label={plain[m.id] || "…"}
                          sx={{
                            height: "auto",
                            py: 0.55,
                            px: 0.5,
                            maxWidth: "85%",
                            bgcolor: "background.paper",
                            border: "1px solid",
                            borderColor: "divider",
                            color: "text.secondary",
                            fontWeight: 600,
                            fontSize: 12,
                            "& .MuiChip-label": {
                              whiteSpace: "normal",
                              textAlign: "center",
                              lineHeight: 1.35,
                            },
                          }}
                        />
                      </Box>
                    </Grow>
                  );
                }
                if (m.kind === "game_move") {
                  const gm = parseGameMsg(plain[m.id] || "");
                  if (!gm || gm.payload.type !== "invite") return null;
                  const mid = matchIdOf(gm);
                  const related = messages
                    .filter((x) => x.kind === "game_move" && x.id !== m.id)
                    .map((x) => ({
                      msg: parseGameMsg(plain[x.id] || ""),
                      senderId: x.sender_id,
                    }))
                    .filter((x): x is { msg: GameMsg; senderId: string } => !!x.msg);
                  const status = resolveGameCardStatus({
                    invite: gm,
                    mine,
                    myId: profile.id,
                    related,
                  });
                  const peerName =
                    active?.kind === "dm"
                      ? active.peer_name ||
                        peers.find((p) => p.user_id === active.peer_id)?.display_name ||
                        "Peer"
                      : senderLabel(m.sender_id);
                  const fromName = mine
                    ? peerName
                    : (gm.payload as { fromName?: string }).fromName || senderLabel(m.sender_id);
                  return (
                    <Grow in key={m.id} timeout={180}>
                      <Box
                        sx={{
                          alignSelf: mine ? "flex-end" : "flex-start",
                          maxWidth: "min(72%, 320px)",
                        }}
                      >
                        <Paper
                          elevation={0}
                          sx={{
                            px: 1.25,
                            py: 1,
                            bgcolor: mine
                              ? dark
                                ? "rgba(76,141,255,0.22)"
                                : "#DCEFE9"
                              : "background.paper",
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: mine ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
                          }}
                        >
                          <GameInviteCard
                            game={gm.game}
                            fromName={fromName}
                            mine={mine}
                            status={status}
                            busy={gameInviteBusy}
                            onAccept={async () => {
                              if (!FEATURE_GAMES) {
                                setStatus("Games are not available in this build.");
                                return;
                              }
                              setGameInviteBusy(true);
                              try {
                                if (!gamesOn) {
                                  setGamesOn(true);
                                  await peerApi.setAppSetting("games_enabled", "1").catch(() => {});
                                }
                                const invite: PendingGameInvite = {
                                  game: gm.game,
                                  matchId: mid,
                                  fromId: m.sender_id,
                                  fromName,
                                };
                                if (gm.game === "rps") {
                                  invite.format = (gm.payload as { format?: 1 | 3 | 5 }).format || 3;
                                }
                                if (gm.game === "dab") {
                                  invite.rows = (gm.payload as { rows?: number }).rows || 4;
                                  invite.cols = (gm.payload as { cols?: number }).cols || 4;
                                }
                                setPendingGameInvite(invite);
                                setNav("games");
                              } finally {
                                setGameInviteBusy(false);
                              }
                            }}
                            onDecline={async () => {
                              setGameInviteBusy(true);
                              try {
                                await sendGameMsg(m.sender_id, {
                                  game: gm.game,
                                  payload: { type: "decline", matchId: mid },
                                });
                                if (active) {
                                  setMessages(await peerApi.listMessages(active.id));
                                }
                              } catch (err: any) {
                                setStatus(err?.message || String(err));
                              } finally {
                                setGameInviteBusy(false);
                              }
                            }}
                            onOpenGame={() => {
                              if (!gamesOn) {
                                setGamesOn(true);
                                peerApi.setAppSetting("games_enabled", "1").catch(() => {});
                              }
                              const open: PendingGameInvite = {
                                game: gm.game,
                                matchId: mid,
                                fromId: mine ? (active?.peer_id || m.sender_id) : m.sender_id,
                                fromName,
                                openOnly: true,
                              };
                              if (gm.game === "rps") {
                                open.format = (gm.payload as { format?: 1 | 3 | 5 }).format || 3;
                              }
                              if (gm.game === "dab") {
                                open.rows = (gm.payload as { rows?: number }).rows || 4;
                                open.cols = (gm.payload as { cols?: number }).cols || 4;
                              }
                              setPendingGameInvite(open);
                              setNav("games");
                            }}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", textAlign: "right", fontSize: 10.5, mt: 0.5 }}
                          >
                            {formatClock(m.created_at)}
                          </Typography>
                        </Paper>
                      </Box>
                    </Grow>
                  );
                }
                const highlighted = highlightMsgId === m.id;
                return (
                  <Grow in key={m.id} timeout={180}>
                    <Box
                      id={`msg-${m.id}`}
                      sx={{
                        alignSelf: mine ? "flex-end" : "flex-start",
                        maxWidth: messageAttachmentIds(m).some((fid) =>
                          isGridMediaName(fileNames[fid] || "")
                        )
                          ? "min(78%, 360px)"
                          : "min(68%, 460px)",
                      }}
                    >
                        <Paper
                          elevation={0}
                          onContextMenu={(e) => {
                            if (m.kind === "deleted") return;
                            e.preventDefault();
                            setMsgMenu({ anchor: e.currentTarget as HTMLElement, message: m });
                          }}
                          sx={{
                            px: bigEmoji ? 0.5 : 1,
                            py: bigEmoji ? 0.25 : 0.4,
                            bgcolor: bigEmoji
                              ? highlighted
                                ? dark
                                  ? "rgba(76, 180, 160, 0.18)"
                                  : "rgba(196, 232, 220, 0.55)"
                                : "transparent"
                              : highlighted
                                ? dark
                                  ? "rgba(76, 180, 160, 0.32)"
                                  : "rgba(196, 232, 220, 0.95)"
                                : m.kind === "deleted"
                                  ? "action.selected"
                                  : mine
                                    ? dark
                                      ? "rgba(76,141,255,0.22)"
                                      : "#DCEFE9"
                                    : "background.paper",
                            border: bigEmoji ? "1px solid transparent" : "1px solid",
                            borderColor: bigEmoji
                              ? "transparent"
                              : highlighted
                                ? dark
                                  ? "rgba(120, 210, 190, 0.7)"
                                  : "#7FBFB0"
                                : m.kind === "deleted"
                                  ? "divider"
                                  : mine
                                    ? dark
                                      ? "rgba(76,141,255,0.35)"
                                      : "#C5DFD6"
                                    : "divider",
                            borderRadius: mine ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
                            position: "relative",
                            boxShadow: bigEmoji
                              ? "none"
                              : dark
                                ? "0 1px 2px rgba(0,0,0,0.25)"
                                : "0 1px 1px rgba(20,32,28,0.04)",
                            transition: "background-color 0.35s ease, border-color 0.35s ease",
                          }}
                        >
                          {m.pinned && (
                            <PushPinIcon
                              sx={{
                                position: "absolute",
                                top: -7,
                                left: mine ? undefined : -7,
                                right: mine ? -7 : undefined,
                                fontSize: 14,
                                color: "secondary.main",
                                bgcolor: "background.paper",
                                borderRadius: "50%",
                                p: 0.15,
                              }}
                            />
                          )}
                          {m.kind !== "deleted" && (
                            <IconButton
                              size="small"
                              aria-label="Message options"
                              onClick={(e) => setMsgMenu({ anchor: e.currentTarget, message: m })}
                              sx={{
                                position: "absolute",
                                top: 2,
                                right: 2,
                                opacity: 0.45,
                                p: 0.45,
                                zIndex: 1,
                              }}
                            >
                              <MoreVertIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          )}
                          {isGroup && m.kind !== "deleted" && (
                            <Typography
                              variant="caption"
                              color="primary"
                              fontWeight={700}
                              display="block"
                              noWrap
                              title={label}
                              sx={{
                                fontSize: 11,
                                lineHeight: 1.2,
                                mb: 0.15,
                                pr: 2,
                                maxWidth: 200,
                              }}
                            >
                              {truncate(label, 22)}
                            </Typography>
                          )}
                          {m.kind === "forwarded" && (
                            <Stack
                              direction="row"
                              alignItems="center"
                              spacing={0.35}
                              sx={{ mb: 0.35, color: "text.secondary", pr: 2 }}
                            >
                              <ForwardIcon sx={{ fontSize: 13, transform: "scaleX(-1)" }} />
                              <Typography
                                variant="caption"
                                sx={{ fontSize: 11, fontWeight: 600, fontStyle: "italic" }}
                              >
                                Forwarded
                              </Typography>
                            </Stack>
                          )}
                          {quoted && m.kind !== "deleted" && (
                            <Box
                              component="button"
                              type="button"
                              aria-label="Jump to referenced message"
                              onClick={() => jumpToReferencedMessage(quoted.id)}
                              sx={{
                                display: "block",
                                width: "100%",
                                minWidth: 0,
                                textAlign: "left",
                                cursor: "pointer",
                                border: 0,
                                borderLeft: "3px solid",
                                borderColor: "primary.main",
                                borderRadius: 0,
                                bgcolor: "action.hover",
                                color: "inherit",
                                font: "inherit",
                                pl: 0.85,
                                pr: 0.4,
                                py: 0.25,
                                mb: 0.4,
                                opacity: 0.9,
                                "&:hover": { bgcolor: "action.selected", opacity: 1 },
                                "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
                              }}
                            >
                              <Typography
                                variant="caption"
                                fontWeight={700}
                                color="primary"
                                display="block"
                                sx={{ fontSize: 11 }}
                              >
                                {senderLabel(quoted.sender_id)}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                noWrap
                                display="block"
                                sx={{ maxWidth: 200, fontSize: 11 }}
                              >
                                {quoted.kind === "deleted"
                                  ? "Deleted message"
                                  : messageAttachmentIds(quoted).length
                                    ? [
                                        plain[quoted.id]?.trim()
                                          ? truncate(plain[quoted.id], 60)
                                          : null,
                                        `📎 ${messageAttachmentIds(quoted).length} file${
                                          messageAttachmentIds(quoted).length > 1 ? "s" : ""
                                        }`,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")
                                    : quoted.kind === "file_notice"
                                      ? "📎 File"
                                      : truncate(plain[quoted.id] || "…", 80)}
                              </Typography>
                            </Box>
                          )}
                          {m.kind === "deleted" ? (
                            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pr: 0.5 }}>
                              <DeleteOutlineIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                              <Typography
                                fontStyle="italic"
                                color="text.secondary"
                                sx={{ fontSize: 13, lineHeight: 1.35 }}
                              >
                                This message was deleted
                              </Typography>
                            </Stack>
                          ) : m.kind === "announcement" || m.kind === "snippet" || m.kind === "poll" ? (
                              <RichCard
                                kind={m.kind}
                                raw={plain[m.id] || ""}
                                votes={messages.filter((v) => v.kind === "poll_vote" && v.reply_to === m.id)}
                                plain={plain}
                                onVote={(option) => sendEncrypted("poll_vote", option, m.id)}
                                fileId={m.kind === "announcement" ? m.file_id : null}
                                fileName={
                                  m.kind === "announcement" && m.file_id
                                    ? fileNames[m.file_id]
                                    : undefined
                                }
                                mine={m.sender_id === profile.id}
                                onOpenFile={(fid) => {
                                  void openAttachment(fid, m.sender_id);
                                }}
                                onDownloadFile={(fid) => {
                                  void openAttachment(fid, m.sender_id);
                                }}
                              />
                          ) : (
                            <Stack
                              spacing={bigEmoji ? 0.25 : 0.75}
                              sx={{
                                pr: bigEmoji
                                  ? 2
                                  : messageAttachmentIds(m).length
                                    ? 0.5
                                    : 1.5,
                                minWidth: messageAttachmentIds(m).length ? 200 : 0,
                              }}
                            >
                              {m.kind !== "file_notice" && (plain[m.id] || "").trim() !== "" && (
                                <ExpandableMessageText
                                  text={plain[m.id] || "…"}
                                  bigEmoji={bigEmoji}
                                  emojiFontSize={bigEmoji ? emojiOnlyFontSize(emojiN!) : 14}
                                />
                              )}
                              {messageAttachmentIds(m).length > 0 && (() => {
                                const ids = messageAttachmentIds(m);
                                const albumItems: AlbumItem[] = ids.map((fid) => ({
                                  fileId: fid,
                                  name: fileNames[fid] || "Encrypted file",
                                  size: fileSizes[fid],
                                  thumbUrl: fileThumbs[fid] || null,
                                  loading:
                                    !!fileNames[fid] &&
                                    isGridMediaName(fileNames[fid]) &&
                                    !fileThumbs[fid] &&
                                    thumbInflightRef.current.has(fid),
                                }));
                                const mediaIds = ids.filter((fid) =>
                                  isGridMediaName(fileNames[fid] || "")
                                );
                                const xferHere =
                                  !!incomingFile &&
                                  ids.includes(incomingFile.fileId) &&
                                  (!incomingFile.conversationId ||
                                    incomingFile.conversationId === active?.id);
                                const xferActive =
                                  xferHere && !incomingFile.paused && !incomingFile.cancelled;
                                const pct =
                                  xferHere && incomingFile.total
                                    ? Math.min(
                                        100,
                                        Math.round((100 * incomingFile.done) / incomingFile.total)
                                      )
                                    : 0;
                                return (
                                  <>
                                    <MediaAlbum
                                      items={albumItems}
                                      mine={mine}
                                      busyFileId={xferActive ? incomingFile.fileId : null}
                                      onOpenMedia={(fid) => {
                                        void openAttachment(fid, m.sender_id);
                                      }}
                                      onOpenFile={(fid) => {
                                        void openAttachment(fid, m.sender_id);
                                      }}
                                    />
                                    {xferHere && (
                                      <Stack spacing={0.5} sx={{ px: 0.25 }}>
                                        <Stack direction="row" alignItems="center" spacing={0.75}>
                                          <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ flex: 1 }}
                                          >
                                            {incomingFile.cancelled
                                              ? "Cancelled"
                                              : incomingFile.paused
                                                ? `Paused ${pct}%`
                                                : `${incomingFile.label || "Downloading…"} ${pct}%`}
                                          </Typography>
                                          {incomingFile.cancelled ? (
                                            <>
                                              <Button
                                                size="small"
                                                sx={{ textTransform: "none", fontWeight: 700, minWidth: 0 }}
                                                onClick={() => void retryIncomingTransfer()}
                                              >
                                                Retry
                                              </Button>
                                              <Tooltip title="Dismiss">
                                                <IconButton
                                                  size="small"
                                                  aria-label="Dismiss cancelled download"
                                                  onClick={dismissIncomingTransfer}
                                                  sx={{ p: 0.35 }}
                                                >
                                                  <CloseIcon sx={{ fontSize: 18 }} />
                                                </IconButton>
                                              </Tooltip>
                                            </>
                                          ) : (
                                            <>
                                              <Tooltip
                                                title={
                                                  incomingFile.paused ? "Resume" : "Pause"
                                                }
                                              >
                                                <IconButton
                                                  size="small"
                                                  aria-label={
                                                    incomingFile.paused
                                                      ? "Resume download"
                                                      : "Pause download"
                                                  }
                                                  onClick={() =>
                                                    incomingFile.paused
                                                      ? void openAttachment(
                                                          incomingFile.fileId,
                                                          m.sender_id
                                                        )
                                                      : pauseIncomingTransfer()
                                                  }
                                                  sx={{ p: 0.35 }}
                                                >
                                                  {incomingFile.paused ? (
                                                    <PlayArrowIcon sx={{ fontSize: 18 }} />
                                                  ) : (
                                                    <PauseIcon sx={{ fontSize: 18 }} />
                                                  )}
                                                </IconButton>
                                              </Tooltip>
                                              <Tooltip title="Stop">
                                                <IconButton
                                                  size="small"
                                                  color="error"
                                                  aria-label="Stop download"
                                                  onClick={abortIncomingTransfer}
                                                  sx={{ p: 0.35 }}
                                                >
                                                  <StopCircleIcon sx={{ fontSize: 18 }} />
                                                </IconButton>
                                              </Tooltip>
                                            </>
                                          )}
                                        </Stack>
                                        {!incomingFile.cancelled && (
                                          <LinearProgress
                                            variant="determinate"
                                            value={pct}
                                            sx={{
                                              height: 4,
                                              borderRadius: 999,
                                              opacity: incomingFile.paused ? 0.55 : 1,
                                            }}
                                          />
                                        )}
                                      </Stack>
                                    )}
                                  </>
                                );
                              })()}
                              {m.kind === "file_notice" &&
                                messageAttachmentIds(m).length === 0 && (
                                  <Typography sx={{ fontSize: 13, px: 0.5 }}>📎 File</Typography>
                                )}
                            </Stack>
                          )}
                          <Box
                            sx={{
                              mt: 0.2,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              gap: 0.35,
                              color: "text.secondary",
                            }}
                          >
                            {m.edited_at && m.kind === "text" && (
                              <Typography
                                variant="caption"
                                sx={{ fontStyle: "italic", fontSize: 10, mr: 0.25 }}
                              >
                                edited
                              </Typography>
                            )}
                            {m.failed ? (
                              <Tooltip
                                title={
                                  m.last_error ||
                                  "Could not deliver for over 2 days. Keep PeerChat open on both PCs on the same LAN, then Retry."
                                }
                              >
                                <Typography
                                  variant="caption"
                                  color="error"
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 0.5,
                                    fontSize: 11,
                                  }}
                                >
                                  Failed ·
                                  <Box
                                    component="span"
                                    sx={{ cursor: "pointer", textDecoration: "underline" }}
                                    onClick={() => retrySend(m)}
                                  >
                                    Retry
                                  </Box>
                                </Typography>
                              </Tooltip>
                            ) : m.queued || (mine && !m.delivered && m.kind !== "deleted") ? (
                              <Tooltip title="Saved on this PC — will send when their PeerChat is open on the LAN">
                                <Typography
                                  variant="caption"
                                  sx={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 0.35,
                                    fontSize: 10.5,
                                    color: "text.secondary",
                                  }}
                                >
                                  {formatClock(m.created_at)} · Queued
                                </Typography>
                              </Tooltip>
                            ) : (
                              <Typography variant="caption" sx={{ fontSize: 10.5 }}>
                                {formatClock(m.created_at)}
                              </Typography>
                            )}
                            {mine && m.kind !== "deleted" && !m.failed && (
                              m.read ? (
                                <DoneAllIcon
                                  titleAccess="Read"
                                  sx={{ fontSize: 14, color: "success.main" }}
                                />
                              ) : m.delivered ? (
                                <DoneAllIcon titleAccess="Received" sx={{ fontSize: 14 }} />
                              ) : (
                                <DoneIcon titleAccess="Queued" sx={{ fontSize: 14 }} />
                              )
                            )}
                          </Box>
                        </Paper>
                        {!!m.reactions?.length && (
                          <Stack
                            direction="row"
                            spacing={0.4}
                            sx={{
                              mt: 0.35,
                              flexWrap: "wrap",
                              justifyContent: mine ? "flex-end" : "flex-start",
                            }}
                          >
                            {m.reactions.map((r) => (
                              <Chip
                                key={r.emoji}
                                size="small"
                                label={`${r.emoji} ${r.count}`}
                                onClick={() => reactToMessage(m, r.emoji)}
                                variant={r.users.includes(profile.id) ? "filled" : "outlined"}
                                color={r.users.includes(profile.id) ? "primary" : "default"}
                                sx={{ height: 20, fontSize: 11 }}
                              />
                            ))}
                          </Stack>
                        )}
                    </Box>
                  </Grow>
                );
              })}
            </Box>
          ))}
          {outgoingFile && active?.id === outgoingFile.conversationId && (
            <Paper
              elevation={0}
              sx={{
                alignSelf: "flex-end",
                maxWidth: "70%",
                p: 1.5,
                bgcolor: "action.hover",
                border: "1px dashed",
                borderColor: "divider",
                opacity: outgoingFile.cancelled ? 0.95 : 0.85,
              }}
            >
              <Stack direction="row" spacing={1.25} alignItems="center">
                {!outgoingFile.paused && !outgoingFile.cancelled ? (
                  <CircularProgress size={18} thickness={5} />
                ) : (
                  <InsertDriveFileIcon sx={{ fontSize: 20, color: "text.secondary" }} />
                )}
                <Box minWidth={0} flex={1}>
                  <Typography noWrap fontWeight={700} color="text.secondary">
                    {outgoingFile.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {outgoingFile.cancelled
                      ? "Cancelled"
                      : outgoingFile.paused
                        ? "Paused"
                        : "Encrypting & sending…"}
                    {!outgoingFile.cancelled && outgoingFile.total
                      ? ` ${Math.min(
                          100,
                          Math.round((100 * outgoingFile.done) / outgoingFile.total)
                        )}%`
                      : ""}
                  </Typography>
                  {!outgoingFile.cancelled && (
                    <LinearProgress
                      variant="determinate"
                      value={
                        outgoingFile.total
                          ? Math.min(100, (100 * outgoingFile.done) / outgoingFile.total)
                          : 0
                      }
                      sx={{
                        mt: 0.75,
                        height: 4,
                        borderRadius: 999,
                        opacity: outgoingFile.paused ? 0.55 : 1,
                      }}
                    />
                  )}
                </Box>
                {outgoingFile.cancelled ? (
                  <>
                    {outgoingFile.sourcePath && (
                      <Button
                        size="small"
                        sx={{ textTransform: "none", fontWeight: 700 }}
                        onClick={() => void retryOutgoingTransfer()}
                      >
                        Retry
                      </Button>
                    )}
                    <Tooltip title="Dismiss">
                      <IconButton
                        size="small"
                        aria-label="Dismiss cancelled send"
                        onClick={dismissOutgoingTransfer}
                      >
                        <CloseIcon />
                      </IconButton>
                    </Tooltip>
                  </>
                ) : (
                  <>
                    <Tooltip title={outgoingFile.paused ? "Resume" : "Pause"}>
                      <IconButton
                        size="small"
                        aria-label={outgoingFile.paused ? "Resume upload" : "Pause upload"}
                        onClick={() =>
                          outgoingFile.paused
                            ? resumeOutgoingTransfer()
                            : pauseOutgoingTransfer()
                        }
                      >
                        {outgoingFile.paused ? <PlayArrowIcon /> : <PauseIcon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Stop">
                      <IconButton
                        size="small"
                        color="error"
                        aria-label="Abort file send"
                        onClick={abortOutgoingTransfer}
                      >
                        <StopCircleIcon />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" mt={0.75} textAlign="right">
                {outgoingFile.cancelled
                  ? outgoingFile.sourcePath
                    ? "Cancelled · retry or dismiss"
                    : "Cancelled · re-attach to send again"
                  : outgoingFile.paused
                    ? "Paused · resume or stop"
                    : "Sending · pause or stop"}
              </Typography>
            </Paper>
          )}
          <Box ref={bottomSentinelRef} aria-hidden sx={{ height: 1, width: "100%", flexShrink: 0 }} />
    </>
  );
}
