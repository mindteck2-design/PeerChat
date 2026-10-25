// @ts-nocheck
import { useState, useMemo } from "react";
import {
  Box,
  Button,
  Chip,
  Fade,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import GridViewRoundedIcon from "@mui/icons-material/GridViewRounded";
import ViewListRoundedIcon from "@mui/icons-material/ViewListRounded";
import SortRoundedIcon from "@mui/icons-material/SortRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import InsertDriveFileRoundedIcon from "@mui/icons-material/InsertDriveFileRounded";
import PictureAsPdfRoundedIcon from "@mui/icons-material/PictureAsPdfRounded";
import TableChartRoundedIcon from "@mui/icons-material/TableChartRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import ChatBubbleOutlineRoundedIcon from "@mui/icons-material/ChatBubbleOutlineRounded";
import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";

import {
  type MediaItem,
  type FileItem,
  type LinkItem,
  formatFullDateTime,
  formatTimeOnly,
  getFileThemeColor,
} from "./ChatMediaUtils";
import { formatBytes } from "../../shared/format";
import { openExternalLink } from "../../panels";

interface ViewAllCategoryViewProps {
  category: "media" | "files" | "links";
  chatTitle: string;
  media: MediaItem[];
  files: FileItem[];
  links: LinkItem[];
  onBack: () => void;
  onClose: () => void;
  onOpenAttachment: (fileId: string, senderId: string) => void;
  onJumpToMessage: (messageId: string) => void;
}

export function ViewAllCategoryView({
  category,
  chatTitle,
  media,
  files,
  links,
  onBack,
  onClose,
  onOpenAttachment,
  onJumpToMessage,
}: ViewAllCategoryViewProps) {
  // Filter state
  const [mediaFilter, setMediaFilter] = useState<"all" | "images" | "videos">("all");
  const [fileFilter, setFileFilter] = useState<"all" | "documents" | "spreadsheets" | "others">("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name" | "size">("newest");
  const [viewMode, setViewMode] = useState<"grid" | "list">(category === "media" ? "grid" : "list");

  // Sort menu anchor
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);

  // Row action menu
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; item: any; type: string } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Filtered & sorted media
  const filteredMedia = useMemo(() => {
    let list = media;
    if (mediaFilter === "images") list = list.filter((m) => !m.isVideo);
    if (mediaFilter === "videos") list = list.filter((m) => m.isVideo);

    return [...list].sort((a, b) => {
      if (sortOrder === "newest") return new Date(b.at).getTime() - new Date(a.at).getTime();
      if (sortOrder === "oldest") return new Date(a.at).getTime() - new Date(b.at).getTime();
      if (sortOrder === "name") return a.name.localeCompare(b.name);
      if (sortOrder === "size") return b.size - a.size;
      return 0;
    });
  }, [media, mediaFilter, sortOrder]);

  // Filtered & sorted files
  const filteredFiles = useMemo(() => {
    let list = files;
    if (fileFilter === "documents") list = list.filter((f) => f.category === "documents");
    if (fileFilter === "spreadsheets") list = list.filter((f) => f.category === "spreadsheets");
    if (fileFilter === "others") list = list.filter((f) => f.category === "others");

    return [...list].sort((a, b) => {
      if (sortOrder === "newest") return new Date(b.at).getTime() - new Date(a.at).getTime();
      if (sortOrder === "oldest") return new Date(a.at).getTime() - new Date(b.at).getTime();
      if (sortOrder === "name") return a.name.localeCompare(b.name);
      if (sortOrder === "size") return b.size - a.size;
      return 0;
    });
  }, [files, fileFilter, sortOrder]);

  // Sorted links
  const filteredLinks = useMemo(() => {
    return [...links].sort((a, b) => {
      if (sortOrder === "newest") return new Date(b.at).getTime() - new Date(a.at).getTime();
      if (sortOrder === "oldest") return new Date(a.at).getTime() - new Date(b.at).getTime();
      if (sortOrder === "name") return a.title.localeCompare(b.title);
      return 0;
    });
  }, [links, sortOrder]);

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
    setMenuAnchor(null);
  };

  const categoryTitle =
    category === "media"
      ? `Media (${filteredMedia.length})`
      : category === "files"
      ? `Files (${filteredFiles.length})`
      : `Links (${filteredLinks.length})`;

  const sortLabel =
    sortOrder === "newest"
      ? "Newest first"
      : sortOrder === "oldest"
      ? "Oldest first"
      : sortOrder === "name"
      ? "Name A–Z"
      : "Largest size";

  // File icon renderer
  const renderFileIcon = (ext: string) => {
    const e = ext.toLowerCase();
    const style = getFileThemeColor(e);
    let IconComp = InsertDriveFileRoundedIcon;
    if (e === "pdf") IconComp = PictureAsPdfRoundedIcon;
    else if (["xlsx", "xls", "csv", "ods"].includes(e)) IconComp = TableChartRoundedIcon;
    else if (["docx", "doc", "txt", "md"].includes(e)) IconComp = DescriptionRoundedIcon;

    return (
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 2,
          bgcolor: style.bg,
          color: style.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <IconComp sx={{ fontSize: 22 }} />
      </Box>
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", maxHeight: "82vh" }}>
      {/* ── HEADER ── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          py: 1.75,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <IconButton
            size="small"
            onClick={onBack}
            sx={{
              color: "text.primary",
              bgcolor: "action.hover",
              "&:hover": { bgcolor: "action.selected" },
            }}
          >
            <ArrowBackRoundedIcon fontSize="small" />
          </IconButton>
          <Typography variant="h6" fontWeight={700} fontSize={17} noWrap>
            {chatTitle} — {categoryTitle}
          </Typography>
        </Stack>
        <IconButton size="small" onClick={onClose} sx={{ color: "text.secondary" }}>
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* ── FILTERS & CONTROLS ROW ── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          py: 1.5,
          borderBottom: "1px solid",
          borderColor: "rgba(255, 255, 255, 0.05)",
          flexWrap: "wrap",
          gap: 1.5,
        }}
      >
        {/* Filter Pills */}
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          {category === "media" && (
            <>
              <Chip
                label={`All ${media.length}`}
                size="small"
                onClick={() => setMediaFilter("all")}
                sx={{
                  fontWeight: 600,
                  fontSize: 12.5,
                  borderRadius: 2,
                  bgcolor: mediaFilter === "all" ? "primary.main" : "action.hover",
                  color: mediaFilter === "all" ? "#FFFFFF" : "text.secondary",
                  cursor: "pointer",
                }}
              />
              <Chip
                label={`Images ${media.filter((m) => !m.isVideo).length}`}
                size="small"
                onClick={() => setMediaFilter("images")}
                sx={{
                  fontWeight: 600,
                  fontSize: 12.5,
                  borderRadius: 2,
                  bgcolor: mediaFilter === "images" ? "primary.main" : "action.hover",
                  color: mediaFilter === "images" ? "#FFFFFF" : "text.secondary",
                  cursor: "pointer",
                }}
              />
              <Chip
                label={`Videos ${media.filter((m) => m.isVideo).length}`}
                size="small"
                onClick={() => setMediaFilter("videos")}
                sx={{
                  fontWeight: 600,
                  fontSize: 12.5,
                  borderRadius: 2,
                  bgcolor: mediaFilter === "videos" ? "primary.main" : "action.hover",
                  color: mediaFilter === "videos" ? "#FFFFFF" : "text.secondary",
                  cursor: "pointer",
                }}
              />
            </>
          )}

          {category === "files" && (
            <>
              <Chip
                label={`All ${files.length}`}
                size="small"
                onClick={() => setFileFilter("all")}
                sx={{
                  fontWeight: 600,
                  fontSize: 12.5,
                  borderRadius: 2,
                  bgcolor: fileFilter === "all" ? "primary.main" : "action.hover",
                  color: fileFilter === "all" ? "#FFFFFF" : "text.secondary",
                  cursor: "pointer",
                }}
              />
              <Chip
                label={`Documents ${files.filter((f) => f.category === "documents").length}`}
                size="small"
                onClick={() => setFileFilter("documents")}
                sx={{
                  fontWeight: 600,
                  fontSize: 12.5,
                  borderRadius: 2,
                  bgcolor: fileFilter === "documents" ? "primary.main" : "action.hover",
                  color: fileFilter === "documents" ? "#FFFFFF" : "text.secondary",
                  cursor: "pointer",
                }}
              />
              <Chip
                label={`Spreadsheets ${files.filter((f) => f.category === "spreadsheets").length}`}
                size="small"
                onClick={() => setFileFilter("spreadsheets")}
                sx={{
                  fontWeight: 600,
                  fontSize: 12.5,
                  borderRadius: 2,
                  bgcolor: fileFilter === "spreadsheets" ? "primary.main" : "action.hover",
                  color: fileFilter === "spreadsheets" ? "#FFFFFF" : "text.secondary",
                  cursor: "pointer",
                }}
              />
              <Chip
                label={`Others ${files.filter((f) => f.category === "others").length}`}
                size="small"
                onClick={() => setFileFilter("others")}
                sx={{
                  fontWeight: 600,
                  fontSize: 12.5,
                  borderRadius: 2,
                  bgcolor: fileFilter === "others" ? "primary.main" : "action.hover",
                  color: fileFilter === "others" ? "#FFFFFF" : "text.secondary",
                  cursor: "pointer",
                }}
              />
            </>
          )}

          {category === "links" && (
            <Chip
              label={`All ${links.length}`}
              size="small"
              sx={{
                fontWeight: 600,
                fontSize: 12.5,
                borderRadius: 2,
                bgcolor: "primary.main",
                color: "#FFFFFF",
              }}
            />
          )}
        </Stack>

        {/* Right Sort & View Controls */}
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            size="small"
            endIcon={<SortRoundedIcon sx={{ fontSize: "16px !important" }} />}
            onClick={(e) => setSortAnchor(e.currentTarget)}
            sx={{
              textTransform: "none",
              color: "text.secondary",
              bgcolor: "action.hover",
              borderRadius: 2,
              px: 1.5,
              fontSize: 12.5,
              fontWeight: 600,
              "&:hover": { bgcolor: "action.selected" },
            }}
          >
            {sortLabel}
          </Button>

          <Menu
            anchorEl={sortAnchor}
            open={!!sortAnchor}
            onClose={() => setSortAnchor(null)}
            PaperProps={{ sx: { borderRadius: 2, minWidth: 150 } }}
          >
            <MenuItem
              selected={sortOrder === "newest"}
              onClick={() => {
                setSortOrder("newest");
                setSortAnchor(null);
              }}
            >
              Newest first
            </MenuItem>
            <MenuItem
              selected={sortOrder === "oldest"}
              onClick={() => {
                setSortOrder("oldest");
                setSortAnchor(null);
              }}
            >
              Oldest first
            </MenuItem>
            <MenuItem
              selected={sortOrder === "name"}
              onClick={() => {
                setSortOrder("name");
                setSortAnchor(null);
              }}
            >
              Name A–Z
            </MenuItem>
            {category !== "links" && (
              <MenuItem
                selected={sortOrder === "size"}
                onClick={() => {
                  setSortOrder("size");
                  setSortAnchor(null);
                }}
              >
                Largest size
              </MenuItem>
            )}
          </Menu>

          {/* Grid vs List toggle */}
          <Stack
            direction="row"
            sx={{
              bgcolor: "action.hover",
              borderRadius: 2,
              p: 0.25,
            }}
          >
            <IconButton
              size="small"
              onClick={() => setViewMode("grid")}
              sx={{
                borderRadius: 1.5,
                p: 0.6,
                color: viewMode === "grid" ? "#FFFFFF" : "text.secondary",
                bgcolor: viewMode === "grid" ? "primary.main" : "transparent",
                "&:hover": { bgcolor: viewMode === "grid" ? "primary.main" : "action.selected" },
              }}
            >
              <GridViewRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => setViewMode("list")}
              sx={{
                borderRadius: 1.5,
                p: 0.6,
                color: viewMode === "list" ? "#FFFFFF" : "text.secondary",
                bgcolor: viewMode === "list" ? "primary.main" : "transparent",
                "&:hover": { bgcolor: viewMode === "list" ? "primary.main" : "action.selected" },
              }}
            >
              <ViewListRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
        </Stack>
      </Box>

      {/* ── CONTENT BODY ── */}
      <Box sx={{ flex: 1, overflowY: "auto", p: 2.5 }}>
        {/* ── MEDIA TAB ── */}
        {category === "media" && (
          <>
            {!filteredMedia.length ? (
              <Typography color="text.secondary" align="center" sx={{ py: 6, fontSize: 14 }}>
                No media in this chat yet.
              </Typography>
            ) : viewMode === "grid" ? (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                  gap: 1.5,
                }}
              >
                {filteredMedia.map((m) => (
                  <Box
                    key={m.key}
                    onClick={() => onOpenAttachment(m.fileId, m.senderId)}
                    sx={{
                      position: "relative",
                      aspectRatio: "1",
                      borderRadius: 2.5,
                      overflow: "hidden",
                      bgcolor: "action.hover",
                      cursor: "pointer",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      transition: "transform 0.15s ease, border-color 0.15s ease",
                      "&:hover": {
                        transform: "scale(1.02)",
                        borderColor: "primary.main",
                      },
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
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          bgcolor: "action.selected",
                        }}
                      >
                        <InsertDriveFileRoundedIcon sx={{ fontSize: 32, color: "text.secondary" }} />
                      </Box>
                    )}

                    {/* Gradient Overlay for labels */}
                    <Box
                      sx={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        p: 0.75,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background:
                          "linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.3) 60%, transparent 100%)",
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontSize: 10, color: "#FFFFFF", fontWeight: 600, lineHeight: 1 }}
                      >
                        {formatTimeOnly(m.at)}
                      </Typography>
                      {m.isVideo && (
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.25,
                            bgcolor: "rgba(0,0,0,0.6)",
                            borderRadius: 1,
                            px: 0.5,
                            py: 0.2,
                          }}
                        >
                          <PlayArrowRoundedIcon sx={{ fontSize: 12, color: "#FFFFFF" }} />
                          <Typography sx={{ fontSize: 9.5, color: "#FFFFFF", fontWeight: 700 }}>
                            Video
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Stack spacing={1}>
                {filteredMedia.map((m) => (
                  <Box
                    key={m.key}
                    onClick={() => onOpenAttachment(m.fileId, m.senderId)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      p: 1.25,
                      borderRadius: 2,
                      bgcolor: "action.hover",
                      cursor: "pointer",
                      "&:hover": { bgcolor: "action.selected" },
                    }}
                  >
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: 2,
                        overflow: "hidden",
                        bgcolor: "background.default",
                        flexShrink: 0,
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
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <InsertDriveFileRoundedIcon sx={{ color: "text.secondary" }} />
                        </Box>
                      )}
                    </Box>
                    <Box flex={1} minWidth={0}>
                      <Typography fontWeight={700} fontSize={14} noWrap color="#FFFFFF">
                        {m.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatBytes(m.size)} · {formatFullDateTime(m.at)}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuAnchor({ el: e.currentTarget, item: m, type: "media" });
                      }}
                      sx={{ color: "text.secondary" }}
                    >
                      <MoreVertRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            )}
          </>
        )}

        {/* ── FILES TAB ── */}
        {category === "files" && (
          <>
            {!filteredFiles.length ? (
              <Typography color="text.secondary" align="center" sx={{ py: 6, fontSize: 14 }}>
                No files in this chat yet.
              </Typography>
            ) : viewMode === "list" ? (
              <Stack spacing={1}>
                {filteredFiles.map((f) => (
                  <Box
                    key={f.key}
                    onClick={() => onOpenAttachment(f.fileId, f.senderId)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      p: 1.25,
                      borderRadius: 2.5,
                      bgcolor: "action.hover",
                      cursor: "pointer",
                      transition: "background-color 0.12s ease",
                      "&:hover": { bgcolor: "action.selected" },
                    }}
                  >
                    {renderFileIcon(f.ext)}
                    <Box flex={1} minWidth={0}>
                      <Typography fontWeight={700} fontSize={14} noWrap color="#FFFFFF">
                        {f.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {f.ext} {formatBytes(f.size)}
                      </Typography>
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mr: 1, whiteSpace: "nowrap" }}
                    >
                      {formatFullDateTime(f.at)}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuAnchor({ el: e.currentTarget, item: f, type: "file" });
                      }}
                      sx={{ color: "text.secondary" }}
                    >
                      <MoreVertRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 1.5,
                }}
              >
                {filteredFiles.map((f) => (
                  <Box
                    key={f.key}
                    onClick={() => onOpenAttachment(f.fileId, f.senderId)}
                    sx={{
                      p: 2,
                      borderRadius: 2.5,
                      bgcolor: "action.hover",
                      border: "1px solid rgba(255, 255, 255, 0.06)",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: 1.5,
                      "&:hover": { bgcolor: "action.selected", borderColor: "primary.main" },
                    }}
                  >
                    <Box display="flex" alignItems="center" justifyContent="space-between">
                      {renderFileIcon(f.ext)}
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuAnchor({ el: e.currentTarget, item: f, type: "file" });
                        }}
                        sx={{ color: "text.secondary" }}
                      >
                        <MoreVertRoundedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Box minWidth={0}>
                      <Typography fontWeight={700} fontSize={13.5} noWrap color="#FFFFFF">
                        {f.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {f.ext} · {formatBytes(f.size)}
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" fontSize={11}>
                      {formatFullDateTime(f.at)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}

        {/* ── LINKS TAB ── */}
        {category === "links" && (
          <>
            {!filteredLinks.length ? (
              <Typography color="text.secondary" align="center" sx={{ py: 6, fontSize: 14 }}>
                No links in this chat yet.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {filteredLinks.map((l) => (
                  <Box
                    key={l.key}
                    onClick={() => void openExternalLink(l.url)}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      p: 1.25,
                      borderRadius: 2.5,
                      bgcolor: "action.hover",
                      cursor: "pointer",
                      transition: "background-color 0.12s ease",
                      "&:hover": { bgcolor: "action.selected" },
                    }}
                  >
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 2,
                        bgcolor: "rgba(130, 169, 248, 0.15)",
                        color: "primary.main",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <LinkRoundedIcon sx={{ fontSize: 22 }} />
                    </Box>
                    <Box flex={1} minWidth={0}>
                      <Typography fontWeight={700} fontSize={14} noWrap color="#FFFFFF">
                        {l.title}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "primary.main",
                          display: "block",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {l.url}
                      </Typography>
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ mr: 1, whiteSpace: "nowrap" }}
                    >
                      {formatFullDateTime(l.at)}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuAnchor({ el: e.currentTarget, item: l, type: "link" });
                      }}
                      sx={{ color: "text.secondary" }}
                    >
                      <MoreVertRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            )}
          </>
        )}
      </Box>

      {/* Item Context Menu */}
      <Menu
        anchorEl={menuAnchor?.el}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        PaperProps={{ sx: { borderRadius: 2, minWidth: 160 } }}
      >
        {menuAnchor?.type === "link" ? (
          <>
            <MenuItem
              onClick={() => {
                void openExternalLink(menuAnchor.item.url);
                setMenuAnchor(null);
              }}
            >
              <OpenInNewRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: "text.secondary" }} />
              Open in browser
            </MenuItem>
            <MenuItem onClick={() => handleCopyLink(menuAnchor.item.url)}>
              <ContentCopyRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: "text.secondary" }} />
              Copy link
            </MenuItem>
          </>
        ) : (
          <MenuItem
            onClick={() => {
              onOpenAttachment(menuAnchor.item.fileId, menuAnchor.item.senderId);
              setMenuAnchor(null);
            }}
          >
            <OpenInNewRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: "text.secondary" }} />
            Open file
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            onJumpToMessage(menuAnchor?.item.messageId);
            setMenuAnchor(null);
            onClose();
          }}
        >
          <ChatBubbleOutlineRoundedIcon sx={{ fontSize: 18, mr: 1.25, color: "text.secondary" }} />
          Jump to message
        </MenuItem>
      </Menu>
    </Box>
  );
}
