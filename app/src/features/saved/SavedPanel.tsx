import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Box,
  Chip,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  MenuList,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorderRounded";
import CalendarTodayIcon from "@mui/icons-material/CalendarTodayRounded";
import CampaignIcon from "@mui/icons-material/CampaignRounded";
import ChatIcon from "@mui/icons-material/ForumRounded";
import CodeIcon from "@mui/icons-material/CodeRounded";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import FilterListIcon from "@mui/icons-material/FilterListRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import MoreVertIcon from "@mui/icons-material/MoreVertRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdfRounded";
import PollIcon from "@mui/icons-material/PollRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import TextSnippetIcon from "@mui/icons-material/TextSnippetRounded";
import { formatBytes, isImageFileName, isVideoFileName } from "../../MediaAlbum";
import {
  peerApi,
  type Conversation,
  type Message,
  type Peer,
  type Profile,
  type SavedItem,
} from "../../peer";
import { avatarColor, dayKey, formatClock, formatDay } from "../../shared/format";
import { messageAttachmentIds } from "../../shared/messageMeta";

export type SavedFilter =
  | "all"
  | "text"
  | "image"
  | "file"
  | "poll"
  | "snippet"
  | "announcement"
  | "calendar";

type EnrichedSaved = SavedItem & {
  senderId?: string | null;
  senderName: string;
  chatLabel: string;
  chatKind: "dm" | "group" | "unknown";
  title: string;
  subtitle: string;
  filterKey: SavedFilter;
  fileId?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  thumbUrl?: string | null;
};

const FILTERS: { id: SavedFilter; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "text", label: "Text" },
  { id: "image", label: "Images" },
  { id: "file", label: "Files" },
  { id: "poll", label: "Polls" },
  { id: "snippet", label: "Snippets" },
  { id: "announcement", label: "Announcements" },
  { id: "calendar", label: "Calendar" },
];

function parseStructuredPreview(kind: string, preview: string): { title: string; detail?: string } {
  if (kind === "announcement" || kind === "snippet" || kind === "poll" || kind === "calendar_share") {
    try {
      const parsed = JSON.parse(preview);
      if (kind === "poll") {
        const q = String(parsed.question || parsed.title || preview).trim();
        const n = Array.isArray(parsed.options) ? parsed.options.length : 0;
        return { title: q || "Poll", detail: n ? `${n} options` : undefined };
      }
      if (kind === "announcement") {
        const title = String(parsed.title || "").trim();
        const body = String(parsed.body || "").trim();
        return { title: title || body || "Announcement", detail: title && body ? body : undefined };
      }
      if (kind === "snippet") {
        const title = String(parsed.title || parsed.filename || "Snippet").trim();
        const body = String(parsed.body || "").trim();
        return { title, detail: body ? body.slice(0, 120) : undefined };
      }
      if (kind === "calendar_share") {
        const title = String(parsed.title || "Calendar item").trim();
        return { title, detail: parsed.kind ? String(parsed.kind) : undefined };
      }
    } catch {
      /* raw preview */
    }
  }
  return { title: preview?.trim() || kind || "Saved item" };
}

function classifyKind(kind: string, fileName?: string | null): SavedFilter {
  if (kind === "poll") return "poll";
  if (kind === "snippet") return "snippet";
  if (kind === "announcement") return "announcement";
  if (kind === "calendar_share") return "calendar";
  if (kind === "file_notice" || fileName) {
    if (fileName && (isImageFileName(fileName) || isVideoFileName(fileName))) return "image";
    return "file";
  }
  return "text";
}

function typeLabel(filterKey: SavedFilter, fileName?: string | null): string {
  switch (filterKey) {
    case "image":
      return isVideoFileName(fileName || "") ? "Video" : "Image";
    case "file":
      return "File";
    case "poll":
      return "Poll";
    case "snippet":
      return "Snippet";
    case "announcement":
      return "Announcement";
    case "calendar":
      return "Calendar";
    default:
      return "Text message";
  }
}

function TypeGlyph({
  filterKey,
  fileName,
  thumbUrl,
}: {
  filterKey: SavedFilter;
  fileName?: string | null;
  thumbUrl?: string | null;
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  if (thumbUrl) {
    return (
      <Box
        component="img"
        src={thumbUrl}
        alt=""
        sx={{
          width: 48,
          height: 48,
          borderRadius: 1.5,
          objectFit: "cover",
          flexShrink: 0,
          bgcolor: "action.hover",
        }}
      />
    );
  }

  let icon = <TextSnippetIcon sx={{ fontSize: 22 }} />;
  let bg = dark ? alpha(theme.palette.primary.main, 0.16) : alpha(theme.palette.primary.main, 0.1);
  let color = theme.palette.primary.main;

  if (filterKey === "image") {
    icon = <ImageOutlinedIcon sx={{ fontSize: 22 }} />;
  } else if (filterKey === "file") {
    const lower = (fileName || "").toLowerCase();
    icon = lower.endsWith(".pdf") ? (
      <PictureAsPdfIcon sx={{ fontSize: 22 }} />
    ) : (
      <InsertDriveFileIcon sx={{ fontSize: 22 }} />
    );
    bg = dark ? "rgba(240,120,120,0.14)" : "rgba(198,40,40,0.08)";
    color = dark ? "#F07878" : "#C62828";
  } else if (filterKey === "poll") {
    icon = <PollIcon sx={{ fontSize: 22 }} />;
    bg = dark ? "rgba(101,201,154,0.14)" : "rgba(15,107,92,0.1)";
    color = dark ? "#65C99A" : "#0F6B5C";
  } else if (filterKey === "snippet") {
    icon = <CodeIcon sx={{ fontSize: 22 }} />;
  } else if (filterKey === "announcement") {
    icon = <CampaignIcon sx={{ fontSize: 22 }} />;
  } else if (filterKey === "calendar") {
    icon = <CalendarTodayIcon sx={{ fontSize: 20 }} />;
  }

  return (
    <Box
      sx={{
        width: 48,
        height: 48,
        borderRadius: 1.5,
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        bgcolor: bg,
        color,
      }}
    >
      {icon}
    </Box>
  );
}

function savedStamp(iso: string) {
  const day = formatDay(iso);
  const clock = formatClock(iso);
  if (day === "Today") return clock;
  if (day === "Yesterday") return `Yesterday, ${clock}`;
  return day && clock ? `${day}, ${clock}` : day || clock || "";
}

export function SavedPanel({
  items,
  convs,
  peers,
  profile,
  fileNames = {},
  onOpen,
  onRemove,
}: {
  items: SavedItem[];
  convs: Conversation[];
  peers: Peer[];
  profile: Profile;
  fileNames?: Record<string, string>;
  onOpen: (conversationId: string, messageId?: string | null) => void;
  onRemove: (id: string) => void | Promise<void>;
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SavedFilter>("all");
  const [filterAnchor, setFilterAnchor] = useState<null | HTMLElement>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; item: EnrichedSaved } | null>(null);
  const [enriched, setEnriched] = useState<EnrichedSaved[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const convById = useMemo(() => {
    const m = new Map<string, Conversation>();
    for (const c of convs) m.set(c.id, c);
    return m;
  }, [convs]);

  const peerName = (userId: string | null | undefined) => {
    if (!userId) return "Unknown";
    if (userId === profile.id) return "You";
    return peers.find((p) => p.user_id === userId)?.display_name || userId.slice(0, 8);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows: EnrichedSaved[] = [];
      for (const item of items) {
        const conv = convById.get(item.conversation_id);
        const chatLabel = conv
          ? conv.kind === "dm"
            ? conv.peer_name || "Direct"
            : conv.title || "Group"
          : "Chat";
        const chatKind = conv?.kind === "group" ? "group" : conv?.kind === "dm" ? "dm" : "unknown";

        let msg: Message | null = null;
        if (item.message_id) {
          try {
            msg = await peerApi.getMessage(item.message_id);
          } catch {
            msg = null;
          }
        }

        const attachmentIds = msg ? messageAttachmentIds(msg) : [];
        const fileId = attachmentIds[0] || msg?.file_id || null;
        let fileName: string | null = null;
        let fileSize: number | null = null;
        let thumbUrl: string | null = null;
        if (fileId) {
          fileName = fileNames[fileId] || null;
          try {
            const file = await peerApi.getFile(fileId);
            fileSize = typeof file?.size_bytes === "number" ? file.size_bytes : null;
            if (!fileName && (file?.original_name || file?.name)) {
              fileName = file.original_name || file.name;
            }
            const lookLikeImage = fileName
              ? isImageFileName(fileName)
              : true; // try thumb when name unknown
            if (lookLikeImage) {
              try {
                const thumb = await peerApi.ensureFileThumbnail(fileId);
                if (thumb?.data_b64) {
                  thumbUrl = `data:${thumb.mime || "image/jpeg"};base64,${thumb.data_b64}`;
                  if (!fileName) fileName = "Image";
                }
              } catch {
                /* no thumb */
              }
            }
          } catch {
            /* missing file meta */
          }
        }

        const structured = parseStructuredPreview(item.kind, item.preview || "");
        let filterKey = classifyKind(item.kind, fileName);
        if (thumbUrl && (filterKey === "file" || filterKey === "text")) filterKey = "image";
        let title = structured.title;
        let subtitle = typeLabel(filterKey, fileName);
        if (filterKey === "image" || filterKey === "file") {
          title = fileName || title;
          const sizeBit = fileSize != null ? formatBytes(fileSize) : "";
          subtitle = sizeBit ? `${typeLabel(filterKey, fileName)} · ${sizeBit}` : typeLabel(filterKey, fileName);
        } else if (structured.detail) {
          if (filterKey === "poll") subtitle = `Poll · ${structured.detail}`;
          else if (filterKey === "snippet") subtitle = structured.detail;
          else if (filterKey === "announcement") subtitle = "Announcement";
          else if (filterKey === "calendar") subtitle = "Calendar";
        }

        const senderId = msg?.sender_id || null;
        rows.push({
          ...item,
          senderId,
          senderName: peerName(senderId),
          chatLabel,
          chatKind,
          title,
          subtitle,
          filterKey,
          fileId,
          fileName,
          fileSize,
          thumbUrl,
        });
      }
      if (!cancelled) setEnriched(rows);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, convById, peers, profile.id, fileNames]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter((item) => {
      if (filter !== "all" && item.filterKey !== filter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.senderName.toLowerCase().includes(q) ||
        item.chatLabel.toLowerCase().includes(q) ||
        (item.preview || "").toLowerCase().includes(q) ||
        item.kind.toLowerCase().includes(q)
      );
    });
  }, [enriched, filter, query]);

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: EnrichedSaved[] }>();
    for (const item of filtered) {
      const key = dayKey(item.created_at);
      const label = formatDay(item.created_at) || key;
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(item);
    }
    return Array.from(map.entries()).map(([key, g]) => ({ key, ...g }));
  }, [filtered]);

  async function copyPreview(item: EnrichedSaved) {
    try {
      await navigator.clipboard.writeText(item.preview || item.title);
      setStatus("Copied");
    } catch {
      setStatus("Could not copy");
    }
    setMenu(null);
  }

  const filterLabel = FILTERS.find((f) => f.id === filter)?.label || "All types";

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        minHeight: 0,
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          px: { xs: 2, md: 3 },
          pt: 2.5,
          pb: 1.75,
          display: "flex",
          alignItems: "flex-start",
          gap: 2,
          flexWrap: "wrap",
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: dark ? "background.paper" : "background.default",
        }}
      >
        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              display: "grid",
              placeItems: "center",
              bgcolor: dark ? alpha(theme.palette.primary.main, 0.18) : alpha(theme.palette.primary.main, 0.12),
              color: "primary.main",
              flexShrink: 0,
            }}
          >
            <BookmarkBorderIcon />
          </Box>
          <Box minWidth={0}>
            <Typography variant="h6" fontWeight={800} lineHeight={1.2}>
              Saved
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              Messages, files and other items you’ve saved.
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <TextField
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved…"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
            sx={{
              width: { xs: 180, sm: 240 },
              "& .MuiOutlinedInput-root": {
                borderRadius: 999,
                bgcolor: dark ? "chat.input" : "action.hover",
              },
            }}
          />
          <Chip
            icon={<FilterListIcon sx={{ fontSize: 18 }} />}
            label={filterLabel}
            onClick={(e) => setFilterAnchor(e.currentTarget)}
            variant="outlined"
            sx={{
              height: 36,
              borderRadius: 999,
              fontWeight: 600,
              bgcolor: dark ? "chat.input" : "background.paper",
            }}
          />
        </Stack>
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", px: { xs: 1.5, md: 2.5 }, py: 2 }}>
        {!items.length ? (
          <Paper
            elevation={0}
            sx={{
              p: 3,
              borderRadius: 2.5,
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper",
              textAlign: "center",
            }}
          >
            <Typography fontWeight={700} gutterBottom>
              Nothing saved yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Use Save on a message to keep it here.
            </Typography>
          </Paper>
        ) : !filtered.length ? (
          <Typography color="text.secondary" sx={{ px: 1, py: 2 }}>
            No saved items match your search or filter.
          </Typography>
        ) : (
          <Stack spacing={2.25}>
            {groups.map((group) => (
              <Box key={group.key}>
                <Typography
                  variant="overline"
                  sx={{
                    display: "block",
                    px: 0.5,
                    mb: 1,
                    color: "text.secondary",
                    fontWeight: 800,
                    letterSpacing: 0.6,
                  }}
                >
                  {group.label}
                </Typography>
                <Stack spacing={1}>
                  {group.items.map((item) => (
                    <Paper
                      key={item.id}
                      elevation={0}
                      onClick={() => onOpen(item.conversation_id, item.message_id)}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1.5,
                        px: 1.5,
                        py: 1.15,
                        borderRadius: 2.5,
                        border: "1px solid",
                        borderColor: "divider",
                        bgcolor: "background.paper",
                        cursor: "pointer",
                        transition: "background-color 120ms ease, border-color 120ms ease",
                        "&:hover": {
                          bgcolor: dark ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.primary.main, 0.04),
                          borderColor: dark
                            ? alpha(theme.palette.primary.main, 0.28)
                            : alpha(theme.palette.primary.main, 0.22),
                          "& .saved-actions": { opacity: 1 },
                        },
                      }}
                    >
                      <TypeGlyph
                        filterKey={item.filterKey}
                        fileName={item.fileName}
                        thumbUrl={item.thumbUrl}
                      />

                      <Box sx={{ flex: 1.4, minWidth: 0 }}>
                        <Typography
                          fontWeight={700}
                          fontSize={14}
                          noWrap
                          title={item.title}
                        >
                          {item.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                          {item.subtitle}
                        </Typography>
                      </Box>

                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ flex: 1, minWidth: 0, display: { xs: "none", sm: "flex" } }}
                      >
                        <Avatar
                          sx={{
                            width: 28,
                            height: 28,
                            fontSize: 12,
                            fontWeight: 700,
                            bgcolor: avatarColor(item.senderName),
                            color: "#fff",
                            flexShrink: 0,
                          }}
                        >
                          {item.senderName.slice(0, 1).toUpperCase()}
                        </Avatar>
                        <Box minWidth={0}>
                          <Typography fontSize={13} fontWeight={700} noWrap>
                            From {item.senderName}
                          </Typography>
                          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                            {item.chatKind === "group" ? (
                              <GroupsIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                            ) : (
                              <ChatIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                            )}
                            <Typography variant="caption" color="text.secondary" noWrap>
                              in {item.chatLabel}
                            </Typography>
                          </Stack>
                        </Box>
                      </Stack>

                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          flexShrink: 0,
                          width: { xs: 72, md: 110 },
                          textAlign: "right",
                          fontWeight: 600,
                          display: { xs: "none", md: "block" },
                        }}
                      >
                        {savedStamp(item.created_at)}
                      </Typography>

                      <Stack
                        className="saved-actions"
                        direction="row"
                        spacing={0.25}
                        onClick={(e) => e.stopPropagation()}
                        sx={{
                          flexShrink: 0,
                          opacity: { xs: 1, md: 0.55 },
                          transition: "opacity 120ms ease",
                        }}
                      >
                        <Tooltip title="Open in chat">
                          <IconButton
                            size="small"
                            aria-label="Open in chat"
                            onClick={() => onOpen(item.conversation_id, item.message_id)}
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove from saved">
                          <IconButton
                            size="small"
                            aria-label="Remove from saved"
                            onClick={() => void onRemove(item.id)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="More">
                          <IconButton
                            size="small"
                            aria-label="More options"
                            onClick={(e) => setMenu({ anchor: e.currentTarget, item })}
                          >
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <Menu
        anchorEl={filterAnchor}
        open={Boolean(filterAnchor)}
        onClose={() => setFilterAnchor(null)}
        PaperProps={{ sx: { borderRadius: 2, minWidth: 180 } }}
      >
        <MenuList dense disablePadding>
          {FILTERS.map((f) => (
            <MenuItem
              key={f.id}
              selected={filter === f.id}
              onClick={() => {
                setFilter(f.id);
                setFilterAnchor(null);
              }}
            >
              {f.label}
            </MenuItem>
          ))}
        </MenuList>
      </Menu>

      <Menu
        anchorEl={menu?.anchor}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        PaperProps={{ sx: { borderRadius: 2, minWidth: 200 } }}
      >
        <MenuItem
          onClick={() => {
            if (!menu) return;
            onOpen(menu.item.conversation_id, menu.item.message_id);
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <OpenInNewIcon fontSize="small" />
          </ListItemIcon>
          Open in chat
        </MenuItem>
        <MenuItem onClick={() => menu && void copyPreview(menu.item)}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          Copy preview
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!menu) return;
            void onRemove(menu.item.id);
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" color="error" />
          </ListItemIcon>
          <Typography color="error.main">Remove from saved</Typography>
        </MenuItem>
      </Menu>

      {status && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 2.5, pb: 1.25, flexShrink: 0 }}
        >
          {status}
        </Typography>
      )}
    </Box>
  );
}
