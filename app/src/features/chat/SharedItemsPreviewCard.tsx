// @ts-nocheck
import { Box, Button, Stack, Typography } from "@mui/material";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import PhotoLibraryRoundedIcon from "@mui/icons-material/PhotoLibraryRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";

import {
  type FileItem,
  type LinkItem,
  type MediaItem,
  formatTimeOnly,
  getFileThemeColor,
} from "./ChatMediaUtils";
import { formatBytes } from "../../shared/format";

const PREVIEW_SLOTS = 9; // 1–2 compact rows; last slot may be +N

type PreviewKind = "media" | "file" | "link";

type PreviewTile =
  | { kind: "media"; item: MediaItem }
  | { kind: "file"; item: FileItem }
  | { kind: "link"; item: LinkItem };

function buildMixedPreview(
  media: MediaItem[],
  files: FileItem[],
  links: LinkItem[],
  maxVisible: number
): { tiles: PreviewTile[]; overflow: number } {
  // Prefer a mixed strip: media first, then files, then links (chronology within each bucket is already newest-first from extract).
  const pooled: PreviewTile[] = [
    ...media.map((item) => ({ kind: "media" as const, item })),
    ...files.map((item) => ({ kind: "file" as const, item })),
    ...links.map((item) => ({ kind: "link" as const, item })),
  ].sort(
    (a, b) => new Date(b.item.at).getTime() - new Date(a.item.at).getTime()
  );

  const total = pooled.length;
  if (total <= maxVisible) {
    return { tiles: pooled, overflow: 0 };
  }
  // Reserve last cell for +N
  const visible = pooled.slice(0, maxVisible - 1);
  return { tiles: visible, overflow: total - visible.length };
}

function FileGlyph({ ext }: { ext: string }) {
  const e = ext.toLowerCase();
  const style = getFileThemeColor(e);
  let Icon = InsertDriveFileRoundedIcon;
  if (e === "pdf") Icon = PictureAsPdfRoundedIcon;
  else if (["xlsx", "xls", "csv", "ods"].includes(e)) Icon = TableChartRoundedIcon;
  else if (["docx", "doc", "txt", "md"].includes(e)) Icon = DescriptionRoundedIcon;
  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 0.35,
        bgcolor: style.bg,
        color: style.color,
        px: 0.5,
      }}
    >
      <Icon sx={{ fontSize: 22 }} />
      <Typography
        sx={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: 0.2,
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {ext || "FILE"}
      </Typography>
    </Box>
  );
}

export function SharedItemsPreviewCard({
  media,
  files,
  links,
  onOpenAttachment,
  onOpenLink,
  onViewAll,
  emptyLabel = "No shared media, files, or links yet.",
  showFooterHint = true,
}: {
  media: MediaItem[];
  files: FileItem[];
  links: LinkItem[];
  onOpenAttachment: (fileId: string, senderId: string) => void;
  onOpenLink: (url: string) => void;
  onViewAll: (initialTab?: PreviewKind) => void;
  emptyLabel?: string;
  showFooterHint?: boolean;
}) {
  const total = media.length + files.length + links.length;
  const { tiles, overflow } = buildMixedPreview(media, files, links, PREVIEW_SLOTS);
  const summary = `${media.length} media · ${files.length} files · ${links.length} links`;

  return (
    <Box
      sx={{
        bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(23, 31, 45, 0.7)" : "action.hover",
        borderRadius: 1.5,
        p: 2,
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} mb={1.25}>
        <Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1.25,
              bgcolor: "rgba(130, 169, 248, 0.14)",
              color: "primary.main",
              display: "grid",
              placeItems: "center",
              flexShrink: 0,
            }}
          >
            <PhotoLibraryRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Box minWidth={0}>
            <Typography fontWeight={700} fontSize={14.5} color="text.primary" noWrap>
              Media, files and links
            </Typography>
            <Typography variant="caption" color="text.secondary" fontSize={12} display="block">
              {total === 0 ? "Nothing shared yet" : summary}
            </Typography>
          </Box>
        </Stack>
        <Button
          size="small"
          endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: "15px !important" }} />}
          disabled={total === 0}
          onClick={() => onViewAll(media.length ? "media" : files.length ? "files" : "links")}
          sx={{
            textTransform: "none",
            fontSize: 12.5,
            fontWeight: 700,
            color: "primary.main",
            pr: 0.5,
            flexShrink: 0,
            "&.Mui-disabled": { color: "text.disabled" },
          }}
        >
          View all
        </Button>
      </Stack>

      {!total ? (
        <Typography color="text.secondary" variant="caption" display="block" py={2} textAlign="center">
          {emptyLabel}
        </Typography>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: 1,
          }}
        >
          {tiles.map((tile) => {
            if (tile.kind === "media") {
              const m = tile.item;
              return (
                <Box
                  key={m.key}
                  onClick={() => onOpenAttachment(m.fileId, m.senderId)}
                  sx={{
                    position: "relative",
                    aspectRatio: "1",
                    borderRadius: 1,
                    overflow: "hidden",
                    bgcolor: "action.hover",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    cursor: "pointer",
                    transition: "transform 0.12s ease",
                    "&:hover": { transform: "scale(1.03)" },
                  }}
                >
                  {m.thumb ? (
                    <Box
                      component="img"
                      src={m.thumb}
                      alt={m.name}
                      sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: "100%",
                        height: "100%",
                        display: "grid",
                        placeItems: "center",
                        bgcolor: "action.selected",
                      }}
                    >
                      {m.isVideo ? (
                        <PlayArrowRoundedIcon sx={{ fontSize: 26, color: "text.secondary" }} />
                      ) : (
                        <PhotoLibraryRoundedIcon sx={{ fontSize: 22, color: "text.secondary" }} />
                      )}
                    </Box>
                  )}
                  <Box
                    sx={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      p: 0.45,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)",
                    }}
                  >
                    <Typography sx={{ fontSize: 9, color: "#FFFFFF", fontWeight: 600 }}>
                      {formatTimeOnly(m.at)}
                    </Typography>
                    {m.isVideo && (
                      <PlayArrowRoundedIcon sx={{ fontSize: 11, color: "#FFFFFF" }} />
                    )}
                  </Box>
                </Box>
              );
            }

            if (tile.kind === "file") {
              const f = tile.item;
              return (
                <Box
                  key={f.key}
                  onClick={() => onOpenAttachment(f.fileId, f.senderId)}
                  sx={{
                    position: "relative",
                    aspectRatio: "1",
                    borderRadius: 1,
                    overflow: "hidden",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    cursor: "pointer",
                    transition: "transform 0.12s ease",
                    "&:hover": { transform: "scale(1.03)" },
                  }}
                >
                  <FileGlyph ext={f.ext} />
                  <Box
                    sx={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      px: 0.45,
                      py: 0.35,
                      background: "linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 100%)",
                    }}
                  >
                    <Typography
                      sx={{
                        fontSize: 8.5,
                        color: "#FFFFFF",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {f.name}
                    </Typography>
                    <Typography sx={{ fontSize: 8, color: "rgba(255,255,255,0.75)" }}>
                      {formatBytes(f.size)}
                    </Typography>
                  </Box>
                </Box>
              );
            }

            const l = tile.item;
            return (
              <Box
                key={l.key}
                onClick={() => onOpenLink(l.url)}
                sx={{
                  position: "relative",
                  aspectRatio: "1",
                  borderRadius: 1,
                  overflow: "hidden",
                  bgcolor: (theme) => theme.palette.mode === "dark" ? "rgba(130, 169, 248, 0.12)" : "rgba(37, 99, 235, 0.08)",
                  border: "1px solid",
                  borderColor: (theme) => theme.palette.mode === "dark" ? "rgba(130, 169, 248, 0.25)" : "rgba(37, 99, 235, 0.2)",
                  cursor: "pointer",
                  transition: "transform 0.12s ease",
                  "&:hover": { transform: "scale(1.03)" },
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 0.4,
                  px: 0.6,
                }}
              >
                <LinkRoundedIcon sx={{ fontSize: 22, color: "primary.main" }} />
                <Typography
                  sx={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: "text.primary",
                    textAlign: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {l.title}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 8,
                    color: "primary.main",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}
                >
                  {l.domain}
                </Typography>
              </Box>
            );
          })}

          {overflow > 0 && (
            <Box
              onClick={() => onViewAll("media")}
              sx={{
                aspectRatio: "1",
                borderRadius: 1,
                overflow: "hidden",
                border: "1px solid",
                borderColor: "divider",
                cursor: "pointer",
                position: "relative",
                bgcolor: "action.hover",
                display: "grid",
                placeItems: "center",
                transition: "transform 0.12s ease, background 0.12s ease",
                "&:hover": { transform: "scale(1.03)", bgcolor: "action.selected" },
              }}
            >
              {/* Soft collage from leftover thumbs if any */}
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  opacity: 0.35,
                  background:
                    media.find((m) => m.thumb)?.thumb
                      ? `center / cover url(${media.find((m) => m.thumb)?.thumb})`
                      : "linear-gradient(135deg, rgba(130,169,248,0.35), rgba(23,31,45,0.9))",
                  filter: "blur(2px)",
                }}
              />
              <Typography
                sx={{
                  position: "relative",
                  fontSize: 18,
                  fontWeight: 800,
                  color: "text.primary",
                  letterSpacing: 0.3,
                }}
              >
                +{overflow}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {showFooterHint && total > 0 && (
        <Stack direction="row" spacing={0.75} alignItems="center" mt={1.5}>
          <InfoOutlinedIcon sx={{ fontSize: 14, color: "text.secondary" }} />
          <Typography variant="caption" color="text.secondary" fontSize={11.5}>
            Click View all to browse media, files, and links in one place.
          </Typography>
        </Stack>
      )}
    </Box>
  );
}
