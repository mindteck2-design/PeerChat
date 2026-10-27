import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/DownloadRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import type { Message } from "../../peer";
import { LinkifiedText } from "../../panels";

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
}) {
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (kind === "poll" && parsed?.question && Array.isArray(parsed.options)) {
    const tally = new Map<string, number>();
    const seen = new Set<string>();
    const isMultiple = parsed.voting_type === "multiple";
    for (const vote of votes) {
      const choice = plain[vote.id];
      if (!choice) continue;
      const key = isMultiple ? `${vote.sender_id}:${choice}` : vote.sender_id;
      if (seen.has(key)) continue;
      seen.add(key);
      tally.set(choice, (tally.get(choice) || 0) + 1);
    }
    const uniqueVoters = new Set(votes.map((v) => v.sender_id).filter(Boolean));
    return (
      <Box sx={{ pr: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <Typography variant="overline" color="primary">Poll</Typography>
          {parsed.voting_type && (
            <Chip
              size="small"
              label={parsed.voting_type === "multiple" ? "Multiple choice" : "Single choice"}
              sx={{ height: 18, fontSize: "0.68rem", bgcolor: "rgba(59, 130, 246, 0.12)", color: "#60a5fa" }}
            />
          )}
          {parsed.duration && parsed.duration !== "No end date" && (
            <Chip
              size="small"
              label={parsed.duration}
              sx={{ height: 18, fontSize: "0.68rem", bgcolor: "rgba(255, 255, 255, 0.06)", color: "text.secondary" }}
            />
          )}
        </Stack>
        <Typography fontWeight={700} sx={{ mb: 0.5 }}>{parsed.question}</Typography>
        <Stack spacing={0.5}>
          {parsed.options.map((option: string) => (
            <Button key={option} size="small" variant="outlined" onClick={() => onVote(option)} sx={{ justifyContent: "space-between" }}>
              <span>{option}</span>
              <span>{tally.get(option) || 0}</span>
            </Button>
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {uniqueVoters.size} voter{uniqueVoters.size === 1 ? "" : "s"} ({seen.size} vote{seen.size === 1 ? "" : "s"}) received on this computer
        </Typography>
      </Box>
    );
  }
  if (kind === "snippet") {
    const title = parsed?.title || "Snippet";
    const body = parsed?.body || raw;
    return (
      <Box sx={{ pr: 1 }}>
        <Typography variant="overline" color="primary">{title}</Typography>
        <Typography component="pre" sx={{ m: 0, fontFamily: "ui-monospace, monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
          <LinkifiedText text={body} sx={{ fontFamily: "inherit", fontSize: "inherit" }} />
        </Typography>
      </Box>
    );
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
