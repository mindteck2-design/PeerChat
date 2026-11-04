import { useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import AccessTimeRoundedIcon from "@mui/icons-material/AccessTimeRounded";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import CheckBoxOutlineBlankRoundedIcon from "@mui/icons-material/CheckBoxOutlineBlankRounded";
import CheckBoxRoundedIcon from "@mui/icons-material/CheckBoxRounded";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import DownloadIcon from "@mui/icons-material/DownloadRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import RadioButtonCheckedRoundedIcon from "@mui/icons-material/RadioButtonCheckedRounded";
import RadioButtonUncheckedRoundedIcon from "@mui/icons-material/RadioButtonUncheckedRounded";
import type { Message } from "../../peer";
import { avatarColor, formatClock } from "../../shared/format";
import { LinkifiedText } from "../../panels";

const MAX_VISIBLE_VOTERS = 5;
/** ~8–10 monospace lines before “See more”. */
const SNIPPET_COLLAPSED_MAX_HEIGHT = 160;

function durationToMs(duration: string | undefined): number | null {
  switch (duration) {
    case "1 hour":
      return 60 * 60 * 1000;
    case "6 hours":
      return 6 * 60 * 60 * 1000;
    case "24 hours":
      return 24 * 60 * 60 * 1000;
    case "3 days":
      return 3 * 24 * 60 * 60 * 1000;
    case "1 week":
      return 7 * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

function formatPollEndsLabel(createdAt: string | undefined, duration: string | undefined): string | null {
  if (!duration || duration === "No end date") return null;
  const ms = durationToMs(duration);
  if (!ms || !createdAt) return duration;
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return duration;
  const end = new Date(start.getTime() + ms);
  const now = new Date();
  if (end.getTime() <= now.getTime()) return "Ended";

  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const dayDiff = Math.round((endDay - startDay) / 86400000);
  const time = formatClock(end.toISOString());
  if (dayDiff === 0) return `Ends today, ${time}`;
  if (dayDiff === 1) return `Ends tomorrow, ${time}`;
  return `Ends ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function PollCard({
  parsed,
  votes,
  plain,
  onVote,
  myId,
  resolveName,
  createdAt,
}: {
  parsed: {
    question: string;
    options: string[];
    voting_type?: string;
    duration?: string;
    show_voter_names?: boolean;
    allow_vote_change?: boolean;
  };
  votes: Message[];
  plain: Record<string, string>;
  onVote: (option: string) => void;
  myId?: string;
  resolveName?: (id: string) => string;
  createdAt?: string;
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const [expandedOptions, setExpandedOptions] = useState<Record<string, boolean>>({});

  const isMultiple = parsed.voting_type === "multiple";
  const showVoterNames = parsed.show_voter_names !== false;
  const allowVoteChange = parsed.allow_vote_change !== false;
  const endsLabel = formatPollEndsLabel(createdAt, parsed.duration);
  const ended = endsLabel === "Ended";

  const { tally, votersByOption, myChoices, totalVotes, uniqueVoterCount } = useMemo(() => {
    type Entry = { senderId: string; choice: string; at: string };
    const entries: Entry[] = [];
    for (const vote of votes) {
      const choice = plain[vote.id];
      if (!choice || !vote.sender_id) continue;
      entries.push({
        senderId: vote.sender_id,
        choice,
        at: vote.created_at || vote.sort_at || "",
      });
    }
    entries.sort((a, b) => a.at.localeCompare(b.at));

    const tallyMap = new Map<string, number>();
    const votersMap = new Map<string, string[]>();
    const mine = new Set<string>();

    const pushVoter = (option: string, senderId: string) => {
      const list = votersMap.get(option) || [];
      if (!list.includes(senderId)) list.push(senderId);
      votersMap.set(option, list);
      tallyMap.set(option, list.length);
    };

    if (isMultiple) {
      const seen = new Set<string>();
      for (const entry of entries) {
        const key = `${entry.senderId}:${entry.choice}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pushVoter(entry.choice, entry.senderId);
        if (myId && entry.senderId === myId) mine.add(entry.choice);
      }
    } else {
      // Latest vote per sender wins so "allow vote change" updates the tally.
      const latest = new Map<string, string>();
      for (const entry of entries) {
        latest.set(entry.senderId, entry.choice);
      }
      for (const [senderId, choice] of latest) {
        pushVoter(choice, senderId);
        if (myId && senderId === myId) mine.add(choice);
      }
    }

    let voteTotal = 0;
    for (const n of tallyMap.values()) voteTotal += n;
    const unique = new Set<string>();
    for (const list of votersMap.values()) {
      for (const id of list) unique.add(id);
    }

    return {
      tally: tallyMap,
      votersByOption: votersMap,
      myChoices: mine,
      totalVotes: voteTotal,
      uniqueVoterCount: unique.size,
    };
  }, [votes, plain, isMultiple, myId]);

  const hasVoted = myChoices.size > 0;
  const locked = ended || (hasVoted && !allowVoteChange);
  const showResults = hasVoted || ended || totalVotes > 0;

  const metaParts = [
    isMultiple ? "Multiple choice" : "Single choice",
    endsLabel,
  ].filter(Boolean);

  const handleVote = (option: string) => {
    if (ended) return;
    if (locked && !myChoices.has(option)) return;
    if (!allowVoteChange && hasVoted) return;
    if (isMultiple && myChoices.has(option)) return; // no unvote protocol yet
    if (!isMultiple && myChoices.has(option)) return;
    onVote(option);
  };

  const toggleExpanded = (option: string) => {
    setExpandedOptions((prev) => ({ ...prev, [option]: !prev[option] }));
  };

  const optionBorder = dark ? "rgba(130, 169, 248, 0.22)" : "rgba(15, 107, 92, 0.2)";
  const optionBorderSelected = dark ? "rgba(130, 169, 248, 0.55)" : "rgba(15, 107, 92, 0.45)";
  const optionBgSelected = dark ? "rgba(130, 169, 248, 0.14)" : "rgba(15, 107, 92, 0.1)";
  const barTrack = dark ? "rgba(255, 255, 255, 0.08)" : "rgba(15, 107, 92, 0.1)";

  return (
    <Box sx={{ pr: 0.5, minWidth: 220, maxWidth: 340 }}>
      <Stack direction="row" spacing={0.75} alignItems="flex-start" sx={{ mb: 0.65 }}>
        <BarChartRoundedIcon
          sx={{ color: "primary.main", fontSize: 18, mt: "2px", flexShrink: 0 }}
        />
        <Typography
          fontWeight={700}
          sx={{
            fontSize: 14.5,
            lineHeight: 1.35,
            color: "text.primary",
            wordBreak: "break-word",
          }}
        >
          {parsed.question}
        </Typography>
      </Stack>

      <Stack
        direction="row"
        spacing={0.6}
        alignItems="center"
        sx={{ mb: 1.1, color: "text.secondary", flexWrap: "wrap", rowGap: 0.35 }}
      >
        <AccessTimeRoundedIcon sx={{ fontSize: 14 }} />
        <Typography variant="caption" sx={{ fontSize: 11.5, fontWeight: 600, color: "inherit" }}>
          {metaParts.join(" · ")}
        </Typography>
      </Stack>

      <Stack spacing={0.75}>
        {parsed.options.map((option: string) => {
          const count = tally.get(option) || 0;
          const pct = totalVotes > 0 ? Math.round((100 * count) / totalVotes) : 0;
          const selected = myChoices.has(option);
          const voters = votersByOption.get(option) || [];
          // Default open so "show voter names" is visible without an extra click.
          const expanded = expandedOptions[option] ?? true;
          const canExpandVoters = showVoterNames && voters.length > 0;

          return (
            <Box key={option}>
              <Box
                component="button"
                type="button"
                disabled={ended || (locked && !selected)}
                onClick={() => handleVote(option)}
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 0.85,
                  width: "100%",
                  m: 0,
                  px: 1,
                  py: 0.85,
                  textAlign: "left",
                  borderRadius: 2,
                  border: "1.5px solid",
                  borderColor: selected ? optionBorderSelected : optionBorder,
                  bgcolor: selected ? optionBgSelected : "transparent",
                  cursor: ended || (locked && !selected) ? "default" : "pointer",
                  transition: "border-color 0.15s ease, background-color 0.15s ease",
                  "&:hover": {
                    borderColor:
                      ended || (locked && !selected)
                        ? selected
                          ? optionBorderSelected
                          : optionBorder
                        : "primary.main",
                    bgcolor:
                      ended || (locked && !selected)
                        ? selected
                          ? optionBgSelected
                          : "transparent"
                        : dark
                          ? "rgba(130, 169, 248, 0.1)"
                          : "rgba(15, 107, 92, 0.07)",
                  },
                }}
              >
                <Box sx={{ mt: "1px", color: selected ? "primary.main" : "text.secondary", lineHeight: 0 }}>
                  {isMultiple ? (
                    selected ? (
                      <CheckBoxRoundedIcon sx={{ fontSize: 18 }} />
                    ) : (
                      <CheckBoxOutlineBlankRoundedIcon sx={{ fontSize: 18 }} />
                    )
                  ) : selected ? (
                    <RadioButtonCheckedRoundedIcon sx={{ fontSize: 18 }} />
                  ) : (
                    <RadioButtonUncheckedRoundedIcon sx={{ fontSize: 18 }} />
                  )}
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <Typography
                      sx={{
                        flex: 1,
                        fontSize: 13.5,
                        fontWeight: selected ? 700 : 600,
                        color: "text.primary",
                        lineHeight: 1.3,
                        wordBreak: "break-word",
                      }}
                    >
                      {option}
                    </Typography>
                    {showResults && (
                      <Typography
                        sx={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: "text.secondary",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {count}
                        {totalVotes > 0 ? ` (${pct}%)` : ""}
                      </Typography>
                    )}
                    {canExpandVoters && (
                      <Box
                        component="span"
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(option);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleExpanded(option);
                          }
                        }}
                        sx={{
                          display: "inline-flex",
                          color: "text.secondary",
                          borderRadius: 1,
                          p: 0.15,
                          "&:hover": { color: "primary.main", bgcolor: "action.hover" },
                        }}
                      >
                        <KeyboardArrowDownRoundedIcon
                          sx={{
                            fontSize: 18,
                            transform: expanded ? "rotate(180deg)" : "none",
                            transition: "transform 0.15s ease",
                          }}
                        />
                      </Box>
                    )}
                  </Stack>

                  {showResults && (
                    <Box
                      sx={{
                        mt: 0.65,
                        height: 5,
                        borderRadius: 99,
                        bgcolor: barTrack,
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        sx={{
                          width: `${pct}%`,
                          height: "100%",
                          borderRadius: 99,
                          bgcolor: "primary.main",
                          transition: "width 0.25s ease",
                        }}
                      />
                    </Box>
                  )}

                  {canExpandVoters && expanded && (
                    <Stack
                      direction="row"
                      alignItems="center"
                      spacing={0.75}
                      sx={{ mt: 0.85, flexWrap: "wrap", rowGap: 0.5 }}
                    >
                      <Box sx={{ display: "flex", alignItems: "center" }}>
                        {voters.slice(0, MAX_VISIBLE_VOTERS).map((uid, idx) => {
                          const name =
                            uid === myId
                              ? "You"
                              : resolveName?.(uid) || uid.slice(0, 6);
                          return (
                            <Avatar
                              key={uid}
                              title={name}
                              sx={{
                                width: 22,
                                height: 22,
                                fontSize: 10,
                                fontWeight: 700,
                                bgcolor: avatarColor(name),
                                border: "1.5px solid",
                                borderColor: dark ? "#192333" : "#ffffff",
                                ml: idx === 0 ? 0 : -0.6,
                                zIndex: MAX_VISIBLE_VOTERS - idx,
                              }}
                            >
                              {(name[0] || "?").toUpperCase()}
                            </Avatar>
                          );
                        })}
                      </Box>
                      {voters.length > MAX_VISIBLE_VOTERS && (
                        <Box
                          sx={{
                            px: 0.7,
                            py: 0.15,
                            borderRadius: 99,
                            bgcolor: dark ? "rgba(130,169,248,0.16)" : "rgba(15,107,92,0.12)",
                            color: "primary.main",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          +{voters.length - MAX_VISIBLE_VOTERS}
                        </Box>
                      )}
                      <Typography
                        sx={{
                          fontSize: 11,
                          color: "text.secondary",
                          fontWeight: 600,
                          lineHeight: 1.3,
                        }}
                      >
                        {voters
                          .slice(0, 3)
                          .map((uid) =>
                            uid === myId ? "You" : resolveName?.(uid) || "Someone"
                          )
                          .join(", ")}
                        {voters.length > 3 ? ` +${voters.length - 3}` : ""}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{ mt: 1.15 }}
      >
        <Stack direction="row" alignItems="center" spacing={0.6} sx={{ minWidth: 0 }}>
          {locked && hasVoted && !ended ? (
            <>
              <LockOutlinedIcon sx={{ fontSize: 14, color: "text.secondary" }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, fontWeight: 600 }}>
                You cannot change your vote
              </Typography>
            </>
          ) : (
            <>
              <PeopleAltOutlinedIcon sx={{ fontSize: 15, color: "text.secondary" }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11.5, fontWeight: 600 }}>
                {totalVotes === 0
                  ? "No votes yet"
                  : `${totalVotes} vote${totalVotes === 1 ? "" : "s"}${
                      uniqueVoterCount !== totalVotes
                        ? ` · ${uniqueVoterCount} voter${uniqueVoterCount === 1 ? "" : "s"}`
                        : ""
                    }`}
              </Typography>
            </>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

function SnippetCard({ title, body }: { title: string; body: string }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLPreElement | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => {
      setCanExpand(content.scrollHeight > SNIPPET_COLLAPSED_MAX_HEIGHT + 2);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(content);
    return () => observer?.disconnect();
  }, [body]);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <Box sx={{ pr: 1, minWidth: 0 }}>
      <Typography variant="overline" color="primary">
        {title}
      </Typography>
      <Box
        sx={{
          position: "relative",
          mt: 0.25,
          borderRadius: 1.25,
          bgcolor: (t) =>
            t.palette.mode === "dark" ? "rgba(0, 0, 0, 0.28)" : "rgba(15, 107, 92, 0.06)",
          border: "1px solid",
          borderColor: "divider",
          "&:hover .snippet-copy-btn": {
            opacity: 1,
            pointerEvents: "auto",
          },
        }}
      >
        <Tooltip title={copied ? "Copied!" : "Copy"} placement="left">
          <IconButton
            className="snippet-copy-btn"
            size="small"
            aria-label="Copy code"
            onClick={(e) => {
              e.stopPropagation();
              void copyCode();
            }}
            sx={{
              position: "absolute",
              top: 4,
              right: 4,
              zIndex: 1,
              opacity: 0,
              pointerEvents: "none",
              transition: "opacity 0.15s ease, background-color 0.15s ease",
              bgcolor: (t) =>
                t.palette.mode === "dark" ? "rgba(23, 31, 45, 0.92)" : "rgba(255, 255, 255, 0.95)",
              border: "1px solid",
              borderColor: "divider",
              boxShadow: (t) =>
                t.palette.mode === "dark"
                  ? "0 2px 8px rgba(0,0,0,0.4)"
                  : "0 1px 4px rgba(20,32,28,0.12)",
              "&:hover": {
                bgcolor: (t) =>
                  t.palette.mode === "dark" ? "rgba(35, 45, 62, 0.98)" : "rgba(255, 255, 255, 1)",
              },
            }}
          >
            <ContentCopyIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Box
          sx={{
            maxHeight: !expanded && canExpand ? SNIPPET_COLLAPSED_MAX_HEIGHT : "none",
            overflow: !expanded && canExpand ? "hidden" : "visible",
            px: 1.1,
            pt: 0.85,
            pb: canExpand ? 0.35 : 0.85,
          }}
        >
          <Typography
            ref={contentRef}
            component="pre"
            sx={{
              m: 0,
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "text.primary",
            }}
          >
            <LinkifiedText text={body} sx={{ fontFamily: "inherit", fontSize: "inherit" }} />
          </Typography>
        </Box>
        {canExpand && (
          <Box sx={{ px: 1.1, pb: 0.75, pt: 0.15 }}>
            <Typography
              component="button"
              type="button"
              onClick={() => setExpanded((v) => !v)}
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
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function RichCard({
  kind,
  raw,
  votes,
  plain,
  onVote,
  fileId,
  fileName,
  mine,
  onOpenFile,
  onDownloadFile,
  myId,
  resolveName,
  createdAt,
}: {
  kind: string;
  raw: string;
  votes: Message[];
  plain: Record<string, string>;
  onVote: (option: string) => void;
  fileId?: string | null;
  fileName?: string;
  mine?: boolean;
  onOpenFile?: (fileId: string) => void;
  onDownloadFile?: (fileId: string) => void;
  myId?: string;
  resolveName?: (id: string) => string;
  createdAt?: string;
}) {
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (kind === "poll" && parsed?.question && Array.isArray(parsed.options)) {
    return (
      <PollCard
        parsed={parsed}
        votes={votes}
        plain={plain}
        onVote={onVote}
        myId={myId}
        resolveName={resolveName}
        createdAt={createdAt}
      />
    );
  }
  if (kind === "snippet") {
    const title = parsed?.title || "Snippet";
    const body = parsed?.body || raw;
    return <SnippetCard title={title} body={body} />;
  }
  const title = parsed?.title || "Announcement";
  const body = parsed?.body || raw;
  const attachedName =
    fileName ||
    (typeof parsed?.filename === "string" ? parsed.filename : "") ||
    "Attachment";
  return (
    <Box sx={{ pr: 1 }}>
      <Typography variant="overline" color="primary">Announcement</Typography>
      <Typography fontWeight={700}>{title}</Typography>
      <LinkifiedText text={body} sx={{ display: "block", fontSize: 14 }} />
      {fileId && (
        <Button
          size="small"
          startIcon={
            mine ? (
              <InsertDriveFileIcon sx={{ fontSize: 16 }} />
            ) : (
              <DownloadIcon sx={{ fontSize: 16 }} />
            )
          }
          onClick={() => {
            if (mine) onOpenFile?.(fileId);
            else onDownloadFile?.(fileId);
          }}
          sx={{
            mt: 1,
            textTransform: "none",
            fontWeight: 700,
            fontSize: 13,
            px: 0,
            justifyContent: "flex-start",
          }}
        >
          {attachedName}
        </Button>
      )}
    </Box>
  );
}
