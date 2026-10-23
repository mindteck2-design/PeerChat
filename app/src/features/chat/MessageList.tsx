// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from "react";
import { useIncomingTransfer } from "../files/transferProgressStore";
import {
  Avatar, Box, Chip, Fade, Grow, IconButton,
  Paper, Stack, Tooltip, Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import DoneIcon from "@mui/icons-material/DoneRounded";
import DoneAllIcon from "@mui/icons-material/DoneAllRounded";
import ForwardIcon from "@mui/icons-material/ForwardRounded";
import MoreVertIcon from "@mui/icons-material/MoreVertRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import PushPinIcon from "@mui/icons-material/PushPinRounded";
import ReplyIcon from "@mui/icons-material/ReplyRounded";
import { MediaAlbum, isGridMediaName, isImageFileName, type AlbumItem } from "../../MediaAlbum";
import { CircularTransferControl } from "../files/CircularTransferControl";
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
    fileLocalPaths,
    fileMetaReady,
    gameInviteBusy,
    gamesOn,
    highlightMsgId,
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
    setHighlightMsgId,
    setMsgMenu,
    setNav,
    setPendingGameInvite,
    setStatus,
    status,
    text,
  } = vm;

  // Narrow subscription — progress ticks need not rebuild ChatScreen's god vm.
  const incomingFile = useIncomingTransfer() ?? vm.incomingFile;

  const jumpToReferencedMessage = (messageId: string) => {
    if (vm.stickToBottomRef) vm.stickToBottomRef.current = false;
    // ChatScreen centers via highlightMsgId (with layout-settle retries).
    if (typeof setHighlightMsgId === "function") {
      setHighlightMsgId(messageId);
    }
  };

  const msgById = useMemo(() => {
    const map = new Map();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const renderMessage = (m) => {
                const mine = m.sender_id === profile.id;
                const quoted = m.reply_to ? msgById.get(m.reply_to) : undefined;
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
                            bgcolor: mine ? "chat.sent" : "chat.received",
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
                              if (!gamesOn) {
                                setStatus("Turn on Games in Settings first.");
                                return;
                              }
                              setGameInviteBusy(true);
                              try {
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
                                  const page = await peerApi.listMessages(active.id, { limit: 80 });
                                  setMessages((prev) => {
                                    const byId = new Map(prev.map((x) => [x.id, x]));
                                    for (const m of page.messages) byId.set(m.id, m);
                                    return prev.map((m) => byId.get(m.id) || m);
                                  });
                                }
                              } catch (err: any) {
                                setStatus(err?.message || String(err));
                              } finally {
                                setGameInviteBusy(false);
                              }
                            }}
                            onOpenGame={() => {
                              if (!gamesOn) {
                                setStatus("Turn on Games in Settings first.");
                                return;
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
                const hasAttachments = messageAttachmentIds(m).length > 0;
                // Soft fade for albums — Grow scales large grids and feels jumpy.
                const MsgEnter = hasAttachments ? Fade : Grow;
                return (
                  <MsgEnter in key={m.id} timeout={hasAttachments ? 160 : 180}>
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
                            // Keep media clear of the ⋮ control.
                            pt: !bigEmoji && m.kind !== "deleted" ? 2.25 : undefined,
                            bgcolor: bigEmoji
                              ? highlighted
                                ? dark
                                  ? "rgba(130, 169, 248, 0.14)"
                                  : "rgba(196, 232, 220, 0.55)"
                                : "transparent"
                              : highlighted
                                ? dark
                                  ? "rgba(130, 169, 248, 0.18)"
                                  : "rgba(196, 232, 220, 0.95)"
                                : m.kind === "deleted"
                                  ? "action.selected"
                                  : mine
                                    ? "chat.sent"
                                    : "chat.received",
                            border: bigEmoji ? "1px solid transparent" : "1px solid",
                            borderColor: bigEmoji
                              ? "transparent"
                              : highlighted
                                ? dark
                                  ? "rgba(130, 169, 248, 0.45)"
                                  : "#7FBFB0"
                                : m.kind === "deleted"
                                  ? "divider"
                                  : mine
                                    ? dark
                                      ? "rgba(42, 53, 70, 0.95)"
                                      : "#C5DFD6"
                                    : "divider",
                            borderRadius: mine ? "10px 10px 3px 10px" : "10px 10px 10px 3px",
                            position: "relative",
                            overflow: "visible",
                            boxShadow: bigEmoji
                              ? "none"
                              : dark
                                ? "0 1px 2px rgba(0,0,0,0.22)"
                                : "0 1px 1px rgba(20,32,28,0.04)",
                            transition: "background-color 0.35s ease, border-color 0.35s ease",
                          }}
                        >
                          {m.pinned && (
                            <Tooltip title="Pinned">
                              <PushPinIcon
                                sx={{
                                  position: "absolute",
                                  top: -10,
                                  left: mine ? undefined : -10,
                                  right: mine ? -10 : undefined,
                                  fontSize: 18,
                                  color: "warning.main",
                                  bgcolor: dark ? "chat.input" : "background.paper",
                                  borderRadius: "50%",
                                  p: 0.35,
                                  border: "1px solid",
                                  borderColor: "warning.main",
                                  boxShadow: dark
                                    ? "0 1px 4px rgba(0,0,0,0.45)"
                                    : "0 1px 3px rgba(20,32,28,0.18)",
                                  zIndex: 2,
                                }}
                              />
                            </Tooltip>
                          )}
                          {m.kind !== "deleted" && (
                            <IconButton
                              size="small"
                              aria-label="Message options"
                              onClick={(e) => setMsgMenu({ anchor: e.currentTarget, message: m })}
                              sx={{
                                position: "absolute",
                                top: 4,
                                right: 4,
                                opacity: 0.55,
                                p: 0.35,
                                zIndex: 2,
                                bgcolor: dark ? "rgba(26, 35, 51, 0.88)" : "rgba(255,255,255,0.88)",
                                border: "1px solid",
                                borderColor: dark ? "divider" : "rgba(0,0,0,0.08)",
                                boxShadow: dark
                                  ? "0 1px 2px rgba(0,0,0,0.28)"
                                  : "0 1px 2px rgba(20,32,28,0.08)",
                                "&:hover": {
                                  opacity: 1,
                                  bgcolor: dark ? "action.selected" : "rgba(255,255,255,1)",
                                },
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
                                const albumItems: AlbumItem[] = ids.map((fid) => {
                                  const knownName = fileNames[fid];
                                  const name = knownName || "Encrypted file";
                                  const hasThumb = !!fileThumbs[fid];
                                  const hasLocal = !!(fileThumbs[fid] || fileLocalPaths?.[fid]);
                                  const metaReady = !!fileMetaReady?.[fid];
                                  const isMedia = !!knownName && isGridMediaName(name);
                                  // Own messages are almost always local — keep spinner until meta resolves.
                                  const loading =
                                    !metaReady ||
                                    !knownName ||
                                    (mine && !hasLocal && !metaReady) ||
                                    (hasLocal && isMedia && isImageFileName(name) && !hasThumb);
                                  return {
                                    fileId: fid,
                                    name,
                                    size: fileSizes[fid],
                                    thumbUrl: fileThumbs[fid] || null,
                                    downloaded: hasLocal,
                                    metaReady,
                                    loading,
                                  };
                                });
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
                                  <MediaAlbum
                                    items={albumItems}
                                    mine={mine}
                                    busyFileId={xferActive ? incomingFile.fileId : null}
                                    transfer={
                                      xferHere
                                        ? {
                                            fileId: incomingFile.fileId,
                                            pct,
                                            paused: incomingFile.paused,
                                            cancelled: incomingFile.cancelled,
                                            label: incomingFile.label,
                                          }
                                        : null
                                    }
                                    onPauseTransfer={pauseIncomingTransfer}
                                    onResumeTransfer={() =>
                                      void openAttachment(incomingFile.fileId, m.sender_id)
                                    }
                                    onAbortTransfer={abortIncomingTransfer}
                                    onRetryTransfer={() => void retryIncomingTransfer()}
                                    onDismissTransfer={dismissIncomingTransfer}
                                    onOpenMedia={(fid) => {
                                      void openAttachment(fid, m.sender_id);
                                    }}
                                    onOpenFile={(fid) => {
                                      void openAttachment(fid, m.sender_id);
                                    }}
                                  />
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
                            spacing={0.5}
                            sx={{
                              mt: 0.5,
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
                                sx={{
                                  height: 28,
                                  fontSize: 14,
                                  fontWeight: 700,
                                  px: 0.35,
                                  bgcolor: r.users.includes(profile.id)
                                    ? undefined
                                    : dark
                                      ? "chat.input"
                                      : "background.paper",
                                  borderWidth: 1.5,
                                  boxShadow: dark
                                    ? "0 1px 3px rgba(0,0,0,0.28)"
                                    : "0 1px 2px rgba(20,32,28,0.1)",
                                  "& .MuiChip-label": { px: 0.85 },
                                }}
                              />
                            ))}
                          </Stack>
                        )}
                    </Box>
                  </MsgEnter>
                );
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
          {group.items.map((m) => renderMessage(m))}
        </Box>
      ))}
      {outgoingFile && active?.id === outgoingFile.conversationId && (
            <Fade in timeout={160}>
              <Paper
                elevation={0}
                sx={{
                  alignSelf: "flex-end",
                  maxWidth: "70%",
                  p: 1.25,
                  bgcolor: "action.hover",
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  opacity: outgoingFile.cancelled ? 0.95 : 1,
                }}
              >
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <CircularTransferControl
                    value={
                      outgoingFile.total
                        ? Math.min(100, Math.round((100 * outgoingFile.done) / outgoingFile.total))
                        : 0
                    }
                    paused={outgoingFile.paused}
                    cancelled={outgoingFile.cancelled}
                    tone="onLight"
                    size={48}
                    onPause={pauseOutgoingTransfer}
                    onResume={resumeOutgoingTransfer}
                    onStop={abortOutgoingTransfer}
                    onRetry={
                      outgoingFile.sourcePath
                        ? () => void retryOutgoingTransfer()
                        : undefined
                    }
                    onDismiss={dismissOutgoingTransfer}
                  />
                  <Box minWidth={0} flex={1}>
                    <Typography noWrap fontWeight={700} sx={{ fontSize: 13 }}>
                      {outgoingFile.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {outgoingFile.batchTotal && outgoingFile.batchTotal > 1
                        ? `File ${outgoingFile.batchIndex || 1} of ${outgoingFile.batchTotal} · `
                        : ""}
                      {outgoingFile.cancelled
                        ? "Cancelled"
                        : outgoingFile.paused
                          ? "Paused"
                          : "Sending…"}
                      {!outgoingFile.cancelled && outgoingFile.total
                        ? ` ${Math.min(
                            100,
                            Math.round((100 * outgoingFile.done) / outgoingFile.total)
                          )}%`
                        : ""}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            </Fade>
          )}
          <Box ref={bottomSentinelRef} aria-hidden sx={{ height: 1, width: "100%", flexShrink: 0 }} />
    </>
  );
}
