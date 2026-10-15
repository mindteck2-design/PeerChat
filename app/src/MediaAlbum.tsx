import { Box, CircularProgress, Stack, Typography, useTheme } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrowRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdfRounded";
import FolderZipIcon from "@mui/icons-material/FolderZipRounded";

export function extOfName(name: string) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isImageFileName(name: string) {
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(extOfName(name));
}

export function isVideoFileName(name: string) {
  return ["mp4", "webm", "mov", "mkv"].includes(extOfName(name));
}

/** Images + videos go in the album grid; everything else is a file card. */
export function isGridMediaName(name: string) {
  return isImageFileName(name) || isVideoFileName(name);
}

export function formatBytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export type AlbumItem = {
  fileId: string;
  name: string;
  size?: number;
  thumbUrl?: string | null;
  loading?: boolean;
};

type MediaAlbumProps = {
  items: AlbumItem[];
  mine?: boolean;
  onOpenMedia: (fileId: string, indexAmongMedia: number) => void;
  onOpenFile: (fileId: string) => void;
  busyFileId?: string | null;
};

function FileTypeIcon({ name, accent }: { name: string; accent: string }) {
  const sx = { fontSize: 22, color: accent };
  const ext = extOfName(name);
  if (ext === "pdf") return <PictureAsPdfIcon sx={sx} />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return <FolderZipIcon sx={sx} />;
  return <InsertDriveFileIcon sx={sx} />;
}

function tileRadius(i: number, n: number) {
  // Use px strings — numeric borderRadius is multiplied by theme.shape.borderRadius (looks oval).
  if (n === 1) return "8px";
  if (n === 2) return i === 0 ? "8px 2px 2px 8px" : "2px 8px 8px 2px";
  if (n === 3) {
    if (i === 0) return "8px 8px 2px 2px";
    if (i === 1) return "2px 2px 2px 8px";
    return "2px 2px 8px 2px";
  }
  // 2x2
  if (i === 0) return "8px 2px 2px 2px";
  if (i === 1) return "2px 8px 2px 2px";
  if (i === 2) return "2px 2px 2px 8px";
  return "2px 2px 8px 2px";
}

function MediaTile({
  item,
  index,
  totalShown,
  overlay,
  onClick,
  isVideo,
}: {
  item: AlbumItem;
  index: number;
  totalShown: number;
  overlay?: string;
  onClick: () => void;
  isVideo: boolean;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={onClick}
      aria-label={overlay ? `${item.name}, ${overlay} more` : item.name}
      sx={{
        position: "relative",
        display: "block",
        width: "100%",
        height: "100%",
        p: 0,
        m: 0,
        border: 0,
        cursor: "pointer",
        overflow: "hidden",
        borderRadius: tileRadius(index, totalShown),
        bgcolor: "action.hover",
        minHeight: totalShown === 1 ? 180 : 96,
      }}
    >
      {item.thumbUrl ? (
        isVideo ? (
          <Box
            component="video"
            src={item.thumbUrl}
            muted
            playsInline
            preload="metadata"
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              pointerEvents: "none",
            }}
          />
        ) : (
          <Box
            component="img"
            src={item.thumbUrl}
            alt={item.name}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              pointerEvents: "none",
            }}
          />
        )
      ) : (
        <Box
          sx={{
            width: "100%",
            height: "100%",
            minHeight: totalShown === 1 ? 180 : 96,
            display: "grid",
            placeItems: "center",
            bgcolor: "action.selected",
          }}
        >
          {item.loading ? (
            <CircularProgress size={22} thickness={5} />
          ) : isVideo ? (
            <PlayArrowIcon sx={{ fontSize: 36, color: "text.secondary" }} />
          ) : (
            <InsertDriveFileIcon sx={{ fontSize: 28, color: "text.secondary" }} />
          )}
        </Box>
      )}
      {isVideo && !overlay && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            bgcolor: "rgba(0,0,0,0.18)",
            pointerEvents: "none",
          }}
        >
          <PlayArrowIcon sx={{ fontSize: 40, color: "#fff", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.4))" }} />
        </Box>
      )}
      {overlay && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            bgcolor: "rgba(0,0,0,0.55)",
          }}
        >
          <Typography sx={{ color: "#fff", fontWeight: 800, fontSize: 28, letterSpacing: 0.5 }}>
            {overlay}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export function MediaAlbum({
  items,
  mine,
  onOpenMedia,
  onOpenFile,
  busyFileId,
}: MediaAlbumProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const media = items.filter((it) => isGridMediaName(it.name));
  const docs = items.filter((it) => !isGridMediaName(it.name));
  const shown = media.slice(0, 4);
  const extra = Math.max(0, media.length - 4);

  let gridTemplate: string | undefined;
  let gridAreas: string | undefined;
  if (shown.length === 1) {
    gridTemplate = "1fr / 1fr";
  } else if (shown.length === 2) {
    gridTemplate = "1fr / 1fr 1fr";
  } else if (shown.length === 3) {
    gridTemplate = "1fr 1fr / 1fr 1fr";
    gridAreas = `"a a" "b c"`;
  } else if (shown.length >= 4) {
    gridTemplate = "1fr 1fr / 1fr 1fr";
  }

  // Light: soft mint/paper (keep). Dark: slate-blue cards — never neon green on navy.
  const cardBorder = mine
    ? dark
      ? "rgba(142, 180, 255, 0.22)"
      : "rgba(46,125,50,0.22)"
    : dark
      ? "rgba(255,255,255,0.10)"
      : "divider";
  const cardBg = mine
    ? dark
      ? "rgba(18, 32, 56, 0.92)"
      : "rgba(255,255,255,0.35)"
    : dark
      ? "rgba(255,255,255,0.05)"
      : "background.paper";
  const cardHover = mine
    ? dark
      ? "rgba(36, 54, 88, 0.95)"
      : "rgba(255,255,255,0.5)"
    : "action.hover";
  const iconBg = mine
    ? dark
      ? "rgba(76, 141, 255, 0.18)"
      : "rgba(46,125,50,0.14)"
    : dark
      ? "rgba(100, 160, 255, 0.14)"
      : "rgba(25,118,210,0.12)";
  const nameColor = mine
    ? dark
      ? "#E7EEF8"
      : "success.dark"
    : "text.primary";
  const iconAccent = mine
    ? dark
      ? "#8EB4FF"
      : theme.palette.success.dark
    : theme.palette.primary.main;

  return (
    <Stack spacing={0.75} sx={{ width: "100%", minWidth: media.length ? 220 : 180 }}>
      {shown.length > 0 && (
        <Box
          sx={{
            display: "grid",
            gridTemplate,
            gridTemplateAreas: gridAreas,
            gap: "3px",
            width: "100%",
            maxWidth: 320,
            aspectRatio: shown.length === 1 ? "4 / 3" : shown.length === 2 ? "2 / 1" : "1 / 1",
            overflow: "hidden",
            borderRadius: "8px",
          }}
        >
          {shown.map((item, i) => {
            const mediaIndex = media.findIndex((m) => m.fileId === item.fileId);
            const area =
              shown.length === 3 ? (i === 0 ? "a" : i === 1 ? "b" : "c") : undefined;
            return (
              <Box key={item.fileId} sx={{ gridArea: area, minHeight: 0, minWidth: 0 }}>
                <MediaTile
                  item={item}
                  index={i}
                  totalShown={shown.length}
                  overlay={i === 3 && extra > 0 ? `+${extra}` : undefined}
                  isVideo={isVideoFileName(item.name)}
                  onClick={() => onOpenMedia(item.fileId, mediaIndex >= 0 ? mediaIndex : i)}
                />
              </Box>
            );
          })}
        </Box>
      )}

      {docs.map((item) => {
        const busy = busyFileId === item.fileId;
        return (
          <Box
            key={item.fileId}
            component="button"
            type="button"
            onClick={() => onOpenFile(item.fileId)}
            disabled={busy}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              width: "100%",
              textAlign: "left",
              border: "1px solid",
              borderColor: cardBorder,
              bgcolor: cardBg,
              borderRadius: "8px",
              px: 1,
              py: 0.85,
              cursor: busy ? "wait" : "pointer",
              "&:hover": { bgcolor: cardHover },
            }}
          >
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: "8px",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                bgcolor: iconBg,
              }}
            >
              {busy ? (
                <CircularProgress size={18} thickness={5} />
              ) : (
                <FileTypeIcon name={item.name} accent={iconAccent} />
              )}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                noWrap
                sx={{
                  fontWeight: 700,
                  fontSize: 13,
                  color: nameColor,
                  lineHeight: 1.25,
                }}
              >
                {item.name}
              </Typography>
              {item.size != null && item.size > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                  {formatBytes(item.size)}
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
