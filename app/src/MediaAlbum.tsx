import { Box, CircularProgress, Stack, Typography, useTheme } from "@mui/material";
import DownloadIcon from "@mui/icons-material/DownloadRounded";
import PlayArrowIcon from "@mui/icons-material/PlayArrowRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdfRounded";
import FolderZipIcon from "@mui/icons-material/FolderZipRounded";
import { CircularTransferControl } from "./features/files/CircularTransferControl";

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
  /** Blob URL — present only after the file has been downloaded and decrypted. */
  thumbUrl?: string | null;
  /** True while the thumb is being generated in the background. */
  loading?: boolean;
  /** True if the file is already saved on this computer. */
  downloaded?: boolean;
  /** True once getFiles has resolved local_path presence for this id. */
  metaReady?: boolean;
};

export type AlbumTransferState = {
  fileId: string;
  pct: number;
  paused?: boolean;
  cancelled?: boolean;
  label?: string;
};

type MediaAlbumProps = {
  items: AlbumItem[];
  mine?: boolean;
  onOpenMedia: (fileId: string, indexAmongMedia: number) => void;
  onOpenFile: (fileId: string) => void;
  busyFileId?: string | null;
  transfer?: AlbumTransferState | null;
  onPauseTransfer?: () => void;
  onResumeTransfer?: () => void;
  onAbortTransfer?: () => void;
  onRetryTransfer?: () => void;
  onDismissTransfer?: () => void;
};

function FileTypeIcon({ name, accent }: { name: string; accent: string }) {
  const sx = { fontSize: 22, color: accent };
  const ext = extOfName(name);
  if (ext === "pdf") return <PictureAsPdfIcon sx={sx} />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return <FolderZipIcon sx={sx} />;
  return <InsertDriveFileIcon sx={sx} />;
}

function tileRadius(i: number, n: number) {
  if (n === 1) return "8px";
  if (n === 2) return i === 0 ? "8px 2px 2px 8px" : "2px 8px 8px 2px";
  if (n === 3) {
    if (i === 0) return "8px 8px 2px 2px";
    if (i === 1) return "2px 2px 2px 8px";
    return "2px 2px 8px 2px";
  }
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
  showDownloadHint,
  transfer,
  onPauseTransfer,
  onResumeTransfer,
  onAbortTransfer,
  onRetryTransfer,
  onDismissTransfer,
}: {
  item: AlbumItem;
  index: number;
  totalShown: number;
  overlay?: string;
  onClick: () => void;
  isVideo: boolean;
  /** Show blurred state + download cue (first tile in an undownloaded grid). */
  showDownloadHint?: boolean;
  transfer?: AlbumTransferState | null;
  onPauseTransfer?: () => void;
  onResumeTransfer?: () => void;
  onAbortTransfer?: () => void;
  onRetryTransfer?: () => void;
  onDismissTransfer?: () => void;
}) {
  const minH = totalShown === 1 ? 180 : 96;
  const hasThumb = !!item.thumbUrl;
  const isLocal = !!(item.downloaded || hasThumb);
  const metaReady = item.metaReady !== false;
  // Download only when we know the file is remote; otherwise spinner/placeholder.
  const showSpinner =
    !!item.loading || !metaReady || (isLocal && !hasThumb && !isVideo);
  const allowDownload = metaReady && !isLocal && !item.loading && !!showDownloadHint;

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
        minHeight: minH,
      }}
    >
      {hasThumb ? (
        /* ── HAS THUMB: show the actual image/video ── */
        isVideo ? (
          <Box
            component="video"
            src={item.thumbUrl!}
            muted
            playsInline
            preload="metadata"
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
          />
        ) : (
          <Box
            component="img"
            src={item.thumbUrl!}
            alt={item.name}
            sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", pointerEvents: "none" }}
          />
        )
      ) : (
        /* ── NO THUMB YET: frosted placeholder (spinner / download / idle) ── */
        <Box
          sx={{
            width: "100%",
            height: "100%",
            minHeight: minH,
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg, rgba(180,200,220,0.45) 0%, rgba(140,160,180,0.35) 50%, rgba(160,185,205,0.45) 100%)",
            backdropFilter: "blur(12px)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <Box sx={{
            position: "absolute", inset: 0, overflow: "hidden",
            "&::before": {
              content: '""', position: "absolute",
              width: "60%", height: "60%", top: "10%", left: "5%",
              borderRadius: "40%",
              background: "rgba(200,215,230,0.5)",
              filter: "blur(8px)",
            },
            "&::after": {
              content: '""', position: "absolute",
              width: "45%", height: "45%", bottom: "8%", right: "8%",
              borderRadius: "35%",
              background: "rgba(170,190,210,0.4)",
              filter: "blur(10px)",
            },
          }} />

          {showSpinner ? (
            <CircularProgress size={22} thickness={5} sx={{ color: "rgba(255,255,255,0.8)", zIndex: 1 }} />
          ) : allowDownload ? (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, zIndex: 1 }}>
              <Box sx={{
                width: 44, height: 44, borderRadius: "50%",
                bgcolor: "rgba(30,30,30,0.72)",
                display: "grid", placeItems: "center",
              }}>
                <DownloadIcon sx={{ fontSize: 22, color: "#fff" }} />
              </Box>
              <Typography sx={{ color: "#fff", fontWeight: 700, fontSize: 12, textShadow: "0 1px 3px rgba(0,0,0,.55)" }}>
                Download
              </Typography>
            </Box>
          ) : (
            <Box sx={{
              width: 32, height: 32, borderRadius: "50%",
              bgcolor: "rgba(255,255,255,0.25)",
              display: "grid", placeItems: "center", zIndex: 1,
            }}>
              {isVideo
                ? <PlayArrowIcon sx={{ fontSize: 18, color: "rgba(255,255,255,0.7)" }} />
                : <InsertDriveFileIcon sx={{ fontSize: 16, color: "rgba(255,255,255,0.7)" }} />}
            </Box>
          )}
        </Box>
      )}

      {isVideo && hasThumb && !overlay && (
        <Box sx={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          bgcolor: "rgba(0,0,0,0.18)", pointerEvents: "none",
        }}>
          <PlayArrowIcon sx={{ fontSize: 40, color: "#fff", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.4))" }} />
        </Box>
      )}

      {overlay && !transfer && (
        <Box sx={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          bgcolor: hasThumb ? "rgba(0,0,0,0.55)" : "rgba(30,30,30,0.45)",
        }}>
          <Typography sx={{ color: "#fff", fontWeight: 800, fontSize: 28, letterSpacing: 0.5 }}>
            {overlay}
          </Typography>
        </Box>
      )}

      {transfer && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            bgcolor: "rgba(0,0,0,0.42)",
            zIndex: 3,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <CircularTransferControl
            value={transfer.pct}
            paused={transfer.paused}
            cancelled={transfer.cancelled}
            tone="onDark"
            size={totalShown === 1 ? 56 : 48}
            onPause={onPauseTransfer}
            onResume={onResumeTransfer}
            onStop={onAbortTransfer}
            onRetry={onRetryTransfer}
            onDismiss={onDismissTransfer}
          />
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
  transfer,
  onPauseTransfer,
  onResumeTransfer,
  onAbortTransfer,
  onRetryTransfer,
  onDismissTransfer,
}: MediaAlbumProps) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const media = items.filter((it) => isGridMediaName(it.name));
  const docs = items.filter((it) => !isGridMediaName(it.name));
  const shown = media.slice(0, 4);
  const extra = Math.max(0, media.length - 4);

  // Only treat as remote when meta says so — unknown/loading must not flash Download.
  const anyLocal = shown.some((it) => !!it.thumbUrl || !!it.downloaded);
  const anyLoading = shown.some(
    (it) => !!it.loading || it.metaReady === false || (!!mine && !it.downloaded && !it.thumbUrl && it.metaReady !== true)
  );

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

  // Download-hint tile index: centre of grid (index 1 for 2-tile, index 1 for 3-tile row, index 1 for 4-tile)
  const downloadHintIndex = shown.length >= 3 ? 1 : shown.length === 2 ? 0 : 0;

  const cardBorder = mine
    ? dark ? "rgba(142, 180, 255, 0.22)" : "rgba(46,125,50,0.22)"
    : dark ? "rgba(255,255,255,0.10)" : "divider";
  const cardBg = mine
    ? dark ? "rgba(18, 32, 56, 0.92)" : "rgba(255,255,255,0.35)"
    : dark ? "rgba(255,255,255,0.05)" : "background.paper";
  const cardHover = mine
    ? dark ? "rgba(36, 54, 88, 0.95)" : "rgba(255,255,255,0.5)"
    : "action.hover";
  const iconBg = mine
    ? dark ? "rgba(76, 141, 255, 0.18)" : "rgba(46,125,50,0.14)"
    : dark ? "rgba(100, 160, 255, 0.14)" : "rgba(25,118,210,0.12)";
  const nameColor = mine
    ? dark ? "#E7EEF8" : "success.dark"
    : "text.primary";
  const iconAccent = mine
    ? dark ? "#8EB4FF" : theme.palette.success.dark
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
            const area = shown.length === 3 ? (i === 0 ? "a" : i === 1 ? "b" : "c") : undefined;
            const showHint =
              !anyLocal &&
              !anyLoading &&
              i === downloadHintIndex &&
              item.metaReady === true &&
              !item.downloaded &&
              !item.loading &&
              !(transfer && transfer.fileId === item.fileId);
            const tileTransfer =
              transfer && transfer.fileId === item.fileId ? transfer : null;
            return (
              <Box key={item.fileId} sx={{ gridArea: area, minHeight: 0, minWidth: 0 }}>
                <MediaTile
                  item={item}
                  index={i}
                  totalShown={shown.length}
                  overlay={i === 3 && extra > 0 ? `+${extra}` : undefined}
                  isVideo={isVideoFileName(item.name)}
                  showDownloadHint={showHint}
                  transfer={tileTransfer}
                  onPauseTransfer={onPauseTransfer}
                  onResumeTransfer={onResumeTransfer}
                  onAbortTransfer={onAbortTransfer}
                  onRetryTransfer={onRetryTransfer}
                  onDismissTransfer={onDismissTransfer}
                  onClick={() => onOpenMedia(item.fileId, mediaIndex >= 0 ? mediaIndex : i)}
                />
              </Box>
            );
          })}
        </Box>
      )}

      {transfer &&
        !shown.some((it) => it.fileId === transfer.fileId) &&
        !docs.some((it) => it.fileId === transfer.fileId) && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.5 }}>
            <CircularTransferControl
              value={transfer.pct}
              paused={transfer.paused}
              cancelled={transfer.cancelled}
              tone="onLight"
              size={44}
              onPause={onPauseTransfer}
              onResume={onResumeTransfer}
              onStop={onAbortTransfer}
              onRetry={onRetryTransfer}
              onDismiss={onDismissTransfer}
            />
            <Typography variant="caption" color="text.secondary">
              {transfer.cancelled
                ? "Cancelled"
                : transfer.paused
                  ? `Paused ${transfer.pct}%`
                  : `${transfer.label || "Downloading…"} ${transfer.pct}%`}
            </Typography>
          </Stack>
        )}

      {docs.map((item) => {
        const busy = busyFileId === item.fileId;
        const docTransfer = transfer && transfer.fileId === item.fileId ? transfer : null;
        const isDownloaded = !!item.downloaded;
        const metaReady = item.metaReady === true;
        const pending =
          !busy &&
          !docTransfer &&
          (!!item.loading || !metaReady || (!!mine && !isDownloaded && !metaReady));
        const showDownload = metaReady && !isDownloaded && !item.loading && !busy && !docTransfer;
        return (
          <Box
            key={item.fileId}
            component="button"
            type="button"
            onClick={() => {
              if (docTransfer) return;
              onOpenFile(item.fileId);
            }}
            disabled={(busy || pending) && !docTransfer}
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
              cursor: docTransfer ? "default" : busy || pending ? "wait" : "pointer",
              "&:hover": { bgcolor: cardHover },
            }}
          >
            <Box sx={{
              width: 44, height: 44, borderRadius: "50%",
              display: "grid", placeItems: "center", flexShrink: 0, bgcolor: iconBg,
              position: "relative",
            }}>
              {docTransfer ? (
                <CircularTransferControl
                  value={docTransfer.pct}
                  paused={docTransfer.paused}
                  cancelled={docTransfer.cancelled}
                  tone="onLight"
                  size={44}
                  onPause={onPauseTransfer}
                  onResume={onResumeTransfer}
                  onStop={onAbortTransfer}
                  onRetry={onRetryTransfer}
                  onDismiss={onDismissTransfer}
                />
              ) : busy || pending ? (
                <CircularProgress size={20} thickness={5} />
              ) : isDownloaded ? (
                <FileTypeIcon name={item.name} accent={iconAccent} />
              ) : showDownload ? (
                <Box sx={{ position: "relative", width: 40, height: 40, display: "grid", placeItems: "center" }}>
                  <CircularProgress
                    variant="determinate"
                    value={100}
                    size={40}
                    thickness={2.5}
                    sx={{ color: "rgba(0,0,0,0.08)", position: "absolute" }}
                  />
                  <DownloadIcon sx={{ fontSize: 20, color: iconAccent, zIndex: 1 }} />
                </Box>
              ) : (
                <CircularProgress size={18} thickness={5} />
              )}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontWeight: 700, fontSize: 13, color: nameColor, lineHeight: 1.25 }}>
                {item.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                {docTransfer
                  ? docTransfer.cancelled
                    ? "Cancelled"
                    : docTransfer.paused
                      ? `Paused ${docTransfer.pct}%`
                      : `${docTransfer.label || "Downloading…"} ${docTransfer.pct}%`
                  : busy
                    ? "Downloading…"
                    : pending
                      ? "…"
                      : isDownloaded
                        ? "Saved"
                        : item.size != null && item.size > 0
                          ? formatBytes(item.size)
                          : "Tap to download"}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}
