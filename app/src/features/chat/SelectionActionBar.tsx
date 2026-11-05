import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorderRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import DownloadIcon from "@mui/icons-material/DownloadRounded";
import ForwardIcon from "@mui/icons-material/ForwardRounded";

export type SelectionActionBarProps = {
  count: number;
  busy?: boolean;
  showCopy?: boolean;
  showDownload?: boolean;
  showForward?: boolean;
  showSave?: boolean;
  showDelete?: boolean;
  onCopy?: () => void;
  onDownload?: () => void;
  onForward?: () => void;
  onSave?: () => void;
  onDelete?: () => void;
  onCancel: () => void;
};

/** Bottom bar that replaces the composer while multi-selecting messages. */
export function SelectionActionBar({
  count,
  busy = false,
  showCopy = false,
  showDownload = false,
  showForward = false,
  showSave = false,
  showDelete = false,
  onCopy,
  onDownload,
  onForward,
  onSave,
  onDelete,
  onCancel,
}: SelectionActionBarProps) {
  return (
    <Box
      sx={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        px: 1.25,
        py: 0.85,
        minHeight: 56,
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      <Typography
        variant="subtitle2"
        fontWeight={700}
        color="text.secondary"
        sx={{ flex: 1, pl: 0.75, minWidth: 0 }}
        noWrap
      >
        {count} selected
      </Typography>
      {showCopy && (
        <Tooltip title="Copy">
          <span>
            <IconButton
              aria-label="Copy selected"
              disabled={busy}
              onClick={onCopy}
              size="small"
            >
              <ContentCopyIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {showDownload && (
        <Tooltip title="Download">
          <span>
            <IconButton
              aria-label="Download selected"
              disabled={busy}
              onClick={onDownload}
              size="small"
            >
              <DownloadIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {showForward && (
        <Tooltip title="Forward">
          <span>
            <IconButton
              aria-label="Forward selected"
              disabled={busy}
              onClick={onForward}
              size="small"
            >
              <ForwardIcon sx={{ transform: "scaleX(-1)" }} />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {showSave && (
        <Tooltip title="Save">
          <span>
            <IconButton
              aria-label="Save selected"
              disabled={busy}
              onClick={onSave}
              size="small"
            >
              <BookmarkBorderIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {showDelete && (
        <Tooltip title="Delete">
          <span>
            <IconButton
              aria-label="Delete selected"
              color="error"
              disabled={busy || count === 0}
              onClick={onDelete}
              size="small"
            >
              <DeleteOutlineIcon />
            </IconButton>
          </span>
        </Tooltip>
      )}
      <Tooltip title="Cancel">
        <span>
          <IconButton
            aria-label="Cancel selection"
            disabled={busy}
            onClick={onCancel}
            size="small"
          >
            <CloseIcon />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}
