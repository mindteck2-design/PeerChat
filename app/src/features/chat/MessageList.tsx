// @ts-nocheck
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useIncomingTransfer, useOutgoingTransfer } from "../files/transferProgressStore";
import {
  Avatar, Box, Chip, Fade, Grow, IconButton,
  Paper, Stack, Tooltip, Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import DoneIcon from "@mui/icons-material/DoneRounded";
import DoneAllIcon from "@mui/icons-material/DoneAllRounded";
import ForwardIcon from "@mui/icons-material/ForwardRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import PushPinIcon from "@mui/icons-material/PushPinRounded";
import ReplyIcon from "@mui/icons-material/ReplyRounded";
import { MediaAlbum, isGridMediaName, isImageFileName, type AlbumItem } from "../../MediaAlbum";
import { CircularTransferControl } from "../files/CircularTransferControl";
import { LinkifiedText } from "../../panels";
import { RichCard } from "./RichCard";
import { GameInviteCard, matchIdOf, parseGameMsg, resolveGameCardStatus } from "../../games/GameInviteCard";
import type { GameMsg, PendingGameInvite } from "../../games/games";
import {
  CalendarShareCard,
  parseCalendarShare,
} from "../calendar/CalendarShareCard";
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
  trailingMeta,
}: {
  text: string;
  bigEmoji?: boolean;
  emojiFontSize?: number;
  trailingMeta?: React.ReactNode;
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
    <Box sx={{ minWidth: 0, display: "flow-root" }}>
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
          {trailingMeta && !canExpand && (
            <Box
              component="span"
              sx={{
                float: "right",
                display: "inline-flex",
                alignItems: "center",
                gap: 0.35,
                ml: 1,
                mt: "3px",
                height: 14,
                verticalAlign: "middle",
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              {trailingMeta}
            </Box>
          )}
        </Box>
      </Box>
      {canExpand && !bigEmoji && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{ mt: 0.35, px: 0.25 }}
        >
          <Typography
            component="button"
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            sx={{
              display: "inline-block",
              border: 0,
              p: 0,
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
          {trailingMeta && (
            <Box
              component="span"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.35,
                userSelect: "none",
                whiteSpace: "nowrap",
              }}
            >
              {trailingMeta}
            </Box>
          )}
        </Stack>
      )}
    </Box>
  );
}

function MessageListImpl({ vm }: { vm: ChatScreenVm }) {
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
    setPendingCalendarFocus,
    setPendingGameInvite,
    setStatus,
    status,
    text,
  } = vm;

  // Narrow subscription — progress ticks need not rebuild ChatScreen's god vm.
  const incomingFile = useIncomingTransfer() ?? vm.incomingFile;
  const outgoingFile = useOutgoingTransfer() ?? vm.outgoingFile;

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
    const hasAttachments = messageAttachmentIds(m).length > 0;

    // WhatsApp-style: 1–3 emoji-only → large, minimal bubble (skip if reply/attachments).
    const emojiN =
      (m.kind === "text" || m.kind === "forwarded") &&
      !quoted &&
      !hasAttachments
        ? emojiOnlyCount(plain[m.id] || "")
        : null;
    const bigEmoji = emojiN != null;

    if (m.kind === "system") {
      return (
        <Grow in key={m.id} timeout={180}>
          <Box display="flex" justifyContent="center" my={0.35}>
            <Chip
              size="small"
              label={plain[m.id] ?? "…"}
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

    // Parse calendar share payload if calendar_share
    let calendarSharePayload = null;
    if (m.kind === "calendar_share") {
      calendarSharePayload = parseCalendarShare(plain[m.id] || "");
      if (!calendarSharePayload) return null;
    }

    // Parse game message if game_move
    let gameMsg: GameMsg | null = null;
    let gameMid = "";
    let gameStatus = null;
    let gameFromName = "";
    if (m.kind === "game_move") {
      gameMsg = parseGameMsg(plain[m.id] || "");
      if (!gameMsg || gameMsg.payload.type !== "invite") return null;
      gameMid = matchIdOf(gameMsg);
      const related = messages
        .filter((x) => x.kind === "game_move" && x.id !== m.id)
        .map((x) => ({
          msg: parseGameMsg(plain[x.id] || ""),
          senderId: x.sender_id,
        }))
        .filter((x): x is { msg: GameMsg; senderId: string } => !!x.msg);
      gameStatus = resolveGameCardStatus({
        invite: gameMsg,
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
      gameFromName = mine
        ? peerName
        : (gameMsg.payload as { fromName?: string }).fromName || senderLabel(m.sender_id);
    }

    const isCardOrMedia =
      m.kind === "calendar_share" ||
      m.kind === "game_move" ||
      m.kind === "announcement" ||
      m.kind === "snippet" ||
      m.kind === "poll" ||
      hasAttachments ||
      m.kind === "file_notice" ||
      m.kind === "deleted" ||
      bigEmoji;

    // Integrated metadata content (time + edited + queued/error/read ticks)
    const metaContent = (
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.35,
          color: "text.secondary",
          fontSize: 10.5,
          lineHeight: 1,
          verticalAlign: "middle",
          userSelect: "none",
        }}
      >
        {m.edited_at && m.kind === "text" && (
          <Typography
            component="span"
            variant="caption"
            sx={{ fontStyle: "italic", fontSize: 10, mr: 0.25, color: "inherit", lineHeight: 1 }}
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
              component="span"
              variant="caption"
              color="error"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                fontSize: 11,
                lineHeight: 1,
              }}
            >
              Failed ·
              <Box
                component="span"
                sx={{ cursor: "pointer", textDecoration: "underline" }}
                onClick={(e) => {
                  e.stopPropagation();
                  retrySend(m);
                }}
              >
                Retry
              </Box>
            </Typography>
          </Tooltip>
        ) : m.queued || (mine && !m.delivered && m.kind !== "deleted") ? (
          <Tooltip title="Saved on this PC — will send when their PeerChat is open on the LAN">
            <Typography
              component="span"
              variant="caption"
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.35,
                fontSize: 10.5,
                color: "inherit",
                lineHeight: 1,
              }}
            >
              {formatClock(m.created_at)}
            </Typography>
          </Tooltip>
        ) : (
          <Typography
            component="span"
            variant="caption"
            sx={{ fontSize: 10.5, color: "inherit", lineHeight: 1 }}
          >
            {formatClock(m.created_at)}
          </Typography>
        )}
        {mine && m.kind !== "deleted" && !m.failed && (
          m.read ? (
            <DoneAllIcon
              titleAccess="Read"
              sx={{ fontSize: 13, color: "#53bdeb", verticalAlign: "middle" }}
            />
          ) : m.delivered ? (
            <DoneAllIcon
              titleAccess="Delivered"
              sx={{ fontSize: 13, color: "inherit", verticalAlign: "middle" }}
            />
          ) : (
            <DoneIcon
              titleAccess="Sent"
              sx={{ fontSize: 13, color: "inherit", verticalAlign: "middle" }}
            />
          )
        )}
      </Box>
    );

    const highlighted = highlightMsgId === m.id;
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
              : "min(72%, 460px)",
            display: "flex",
            flexDirection: "column",
            alignItems: mine ? "flex-end" : "flex-start",
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
              width: "fit-content",
              minWidth: 0,
              maxWidth: "100%",
              display: "flow-root",
              pl: bigEmoji ? 0.5 : 1,
              pr: bigEmoji ? 0.5 : 1.75,
              py: bigEmoji ? 0.25 : 0.45,
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
              transition: "background-color 0.25s ease, border-color 0.25s ease",
              "&:hover .msg-action-chevron": {
                opacity: 0.65,
                pointerEvents: "auto",
              },
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
                className="msg-action-chevron"
                size="small"
                aria-label="Message options"
                onClick={(e) => {
                  e.stopPropagation();
                  setMsgMenu({ anchor: e.currentTarget, message: m });
                }}
                sx={{
                  position: "absolute",
                  top: 1,
                  right: 1,
                  width: 18,
                  height: 18,
                  minWidth: 18,
                  p: 0,
                  zIndex: 3,
                  opacity: 0,
                  pointerEvents: "none",
                  transition: "opacity 0.15s ease-in-out, background-color 0.15s ease-in-out",
                  color: "text.secondary",
                  bgcolor: mine
                    ? dark
                      ? "rgba(32, 43, 64, 0.85)"
                      : "rgba(220, 239, 233, 0.85)"
                    : dark
                      ? "rgba(25, 35, 51, 0.85)"
                      : "rgba(255, 255, 255, 0.85)",
                  borderRadius: 1,
                  "&:hover": {
                    opacity: 1,
                    color: "text.primary",
                    bgcolor: mine
                      ? dark
                        ? "rgba(38, 52, 74, 0.95)"
                        : "rgba(200, 225, 218, 0.95)"
                      : dark
                        ? "rgba(38, 52, 74, 0.95)"
                        : "rgba(240, 240, 240, 0.95)",
                  },
                }}
              >
                <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}

            {isGroup && m.kind !== "deleted" && !mine && (
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
                  mb: 0.25,
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
                sx={{ mb: 0.25, color: "text.secondary", pr: 2 }}
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
                  mb: 0.35,
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
                      : quoted.kind === "calendar_share" ? (() => { const s = parseCalendarShare(plain[quoted.id] || ""); return s ? `📅 ${s.title}` : "📅 Calendar item"; })() : quoted.kind === "file_notice"
                        ? "📎 File"
                        : truncate(plain[quoted.id] ?? "…", 80)}
                </Typography>
              </Box>
            )}

            {m.kind === "deleted" ? (
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pr: 0.5, py: 0.2 }}>
                <DeleteOutlineIcon sx={{ fontSize: 15, color: "text.secondary" }} />
                <Typography
                  fontStyle="italic"
                  color="text.secondary"
                  sx={{ fontSize: 13, lineHeight: 1.35 }}
                >
                  This message was deleted
                </Typography>
              </Stack>
            ) : m.kind === "calendar_share" ? (
              <Box>
                <CalendarShareCard
                  payload={calendarSharePayload!}
                  mine={mine}
                  myId={profile.id}
                  peerName={
                    active?.kind === "dm"
                      ? active.peer_name ||
                        peers.find((p) => p.user_id === active.peer_id)?.display_name ||
                        "Peer"
                      : senderLabel(m.sender_id)
                  }
                  onOpen={() => {
                    if (typeof setPendingCalendarFocus === "function") {
                      setPendingCalendarFocus({
                        itemId: calendarSharePayload!.itemId,
                        day: calendarSharePayload!.day,
                      });
                    }
                    setNav("calendar");
                  }}
                />
                <Box sx={{ mt: 0.35, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {metaContent}
                </Box>
              </Box>
            ) : m.kind === "game_move" ? (
              <Box>
                <GameInviteCard
                  game={gameMsg!.game}
                  fromName={gameFromName}
                  mine={mine}
                  status={gameStatus!}
                  busy={gameInviteBusy}
                  onAccept={async () => {
                    if (!FEATURE_GAMES) {
                      setStatus("Games are not available in this build.");
                      return;
                    }
                    setGameInviteBusy(true);
                    try {
                      // Persist Accepted across chat switch / restart via game_move sync.
                      await sendGameMsg(m.sender_id, {
                        game: gameMsg!.game,
                        payload: { type: "accept", matchId: gameMid },
                      });
                      if (!gamesOn) {
                        setGamesOn(true);
                        await peerApi.setAppSetting("games_enabled", "1").catch(() => {});
                      }
                      const invite: PendingGameInvite = {
                        game: gameMsg!.game,
                        matchId: gameMid,
                        fromId: m.sender_id,
                        fromName: gameFromName,
                      };
                      if (gameMsg!.game === "rps") {
                        invite.format = (gameMsg!.payload as { format?: 1 | 3 | 5 }).format || 3;
                      }
                      if (gameMsg!.game === "dab") {
                        invite.rows = (gameMsg!.payload as { rows?: number }).rows || 4;
                        invite.cols = (gameMsg!.payload as { cols?: number }).cols || 4;
                      }
                      setPendingGameInvite(invite);
                      setNav("games");
                    } catch (err: any) {
                      setStatus(err?.message || String(err));
                    } finally {
                      setGameInviteBusy(false);
                    }
                  }}
                  onDecline={async () => {
                    setGameInviteBusy(true);
                    try {
                      await sendGameMsg(m.sender_id, {
                        game: gameMsg!.game,
                        payload: { type: "decline", matchId: gameMid },
                      });
                      if (active) {
                        const page = await peerApi.listMessages(active.id, { limit: 80 });
                        setMessages((prev) => {
                          const byId = new Map(prev.map((x) => [x.id, x]));
                          for (const row of page.messages) byId.set(row.id, row);
                          return prev.map((row) => byId.get(row.id) || row);
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
                      setGamesOn(true);
                      peerApi.setAppSetting("games_enabled", "1").catch(() => {});
                    }
                    const open: PendingGameInvite = {
                      game: gameMsg!.game,
                      matchId: gameMid,
                      fromId: mine ? (active?.peer_id || m.sender_id) : m.sender_id,
                      fromName: gameFromName,
                      openOnly: true,
                    };
                    if (gameMsg!.game === "rps") {
                      open.format = (gameMsg!.payload as { format?: 1 | 3 | 5 }).format || 3;
                    }
                    if (gameMsg!.game === "dab") {
                      open.rows = (gameMsg!.payload as { rows?: number }).rows || 4;
                      open.cols = (gameMsg!.payload as { cols?: number }).cols || 4;
                    }
                    setPendingGameInvite(open);
                    setNav("games");
                  }}
                />
                <Box sx={{ mt: 0.35, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {metaContent}
                </Box>
              </Box>
            ) : m.kind === "announcement" || m.kind === "snippet" || m.kind === "poll" ? (
              <Box>
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
                <Box sx={{ mt: 0.35, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {metaContent}
                </Box>
              </Box>
            ) : hasAttachments || m.kind === "file_notice" ? (
              <Box sx={{ minWidth: hasAttachments ? 200 : 0 }}>
                {m.kind !== "file_notice" && (plain[m.id] || "").trim() !== "" && (
                  <Box sx={{ mb: 0.5 }}>
                    <ExpandableMessageText
                      text={plain[m.id] ?? "…"}
                    />
                  </Box>
                )}
                {hasAttachments && (() => {
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
                {m.kind === "file_notice" && !hasAttachments && (
                  <Typography sx={{ fontSize: 13, px: 0.5 }}>📎 File</Typography>
                )}
                <Box sx={{ mt: 0.35, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {metaContent}
                </Box>
              </Box>
            ) : bigEmoji ? (
              <Box>
                <ExpandableMessageText
                  text={plain[m.id] ?? "…"}
                  bigEmoji={true}
                  emojiFontSize={emojiOnlyFontSize(emojiN!)}
                />
                <Box sx={{ mt: 0.15, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  {metaContent}
                </Box>
              </Box>
            ) : (
              <ExpandableMessageText
                text={plain[m.id] ?? "…"}
                trailingMeta={metaContent}
              />
            )}
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

export const MessageList = memo(
  MessageListImpl,
  (prev, next) => {
    return (
      prev.vm.messages === next.vm.messages &&
      prev.vm.active?.id === next.vm.active?.id &&
      prev.vm.profile.id === next.vm.profile.id &&
      prev.vm.highlightMsgId === next.vm.highlightMsgId &&
      prev.vm.editingMessage?.id === next.vm.editingMessage?.id &&
      prev.vm.status === next.vm.status &&
      prev.vm.dark === next.vm.dark &&
      prev.vm.hasMoreOlder === next.vm.hasMoreOlder &&
      prev.vm.chatPaintReady === next.vm.chatPaintReady &&
      prev.vm.peers === next.vm.peers &&
      prev.vm.fileNames === next.vm.fileNames &&
      prev.vm.fileSizes === next.vm.fileSizes &&
      prev.vm.fileThumbs === next.vm.fileThumbs &&
      prev.vm.fileLocalPaths === next.vm.fileLocalPaths &&
      prev.vm.fileMetaReady === next.vm.fileMetaReady
    );
  }
);
