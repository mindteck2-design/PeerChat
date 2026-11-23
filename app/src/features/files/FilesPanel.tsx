import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  MenuList,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import DownloadIcon from "@mui/icons-material/DownloadRounded";
import FolderOpenIcon from "@mui/icons-material/FolderOpenRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import MoreVertIcon from "@mui/icons-material/MoreVertRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import SearchIcon from "@mui/icons-material/SearchRounded";
import ShareIcon from "@mui/icons-material/ShareRounded";
import StorageIcon from "@mui/icons-material/StorageRounded";
import ChatIcon from "@mui/icons-material/ForumRounded";
import VisibilityIcon from "@mui/icons-material/VisibilityRounded";
import { isImageFileName, isVideoFileName } from "../../MediaAlbum";
import { peerApi, peerHasLanIp, type Conversation, type Peer, type Profile } from "../../peer";
import {
  canPreviewFileName,
  formatBytes,
  formatClock,
  formatDay,
} from "../../shared/format";
import { SharePeersDialog } from "./SharePeersDialog";

export type LibraryFile = {
  id: string;
  conversation_id: string;
  uploader_id: string;
  enc_filename?: string;
  filename_nonce?: string;
  size_bytes: number;
  local_path?: string | null;
  local_path_present: boolean;
  local_cleared: boolean;
  created_at: string;
  name: string;
};

type SortKey = "date" | "size";
type DirFilter = "all" | "sent" | "received";
type TypeFilter = "all" | "media" | "other";
type PresenceFilter = "all" | "on_disk" | "not_on_disk";

function basenamePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function stampLabel(iso: string) {
  const day = formatDay(iso);
  const clock = formatClock(iso);
  if (day === "Today") return clock;
  if (day === "Yesterday") return `Yesterday, ${clock}`;
  return day && clock ? `${day}, ${clock}` : day || clock || "";
}

function presenceOf(f: LibraryFile): "on_disk" | "removed" | "not_downloaded" {
  if (f.local_path_present) return "on_disk";
  if (f.local_cleared) return "removed";
  return "not_downloaded";
}

/** Sent rows often point at original source folders (.m2, node_modules) — never delete those. */
function canDeleteLocal(f: LibraryFile, myId: string): boolean {
  return f.local_path_present && !!myId && f.uploader_id !== myId;
}

export function FilesPanel(props: {
  peers: Peer[];
  profile: Profile;
  convs: Conversation[];
  fileNames?: Record<string, string>;
  openAttachment: (fileId: string, uploaderId: string) => void | Promise<void>;
  resolveFileName?: (file: {
    id: string;
    conversation_id?: string;
    uploader_id?: string;
    enc_filename?: string;
    filename_nonce?: string;
    wrapped_keys?: unknown;
    local_path?: string | null;
  }) => Promise<string | null | undefined>;
  onJumpToChat: (conversationId: string) => void;
  onSharePaths: (paths: string[], peerIds: string[]) => void | Promise<void>;
  shareBusy?: boolean;
}) {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [storage, setStorage] = useState({
    file_count: 0,
    on_disk_count: 0,
    bytes_on_disk: 0,
  });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [dirFilter, setDirFilter] = useState<DirFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>("all");
  const [peerFilter, setPeerFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ anchor: HTMLElement; file: LibraryFile } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharePaths, setSharePaths] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const peerName = useCallback(
    (userId: string) => {
      if (userId === props.profile.id) return "You";
      return props.peers.find((p) => p.user_id === userId)?.display_name || userId.slice(0, 8);
    },
    [props.peers, props.profile.id]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await peerApi.listFiles();
      const rows: LibraryFile[] = [];
      for (const f of res.files) {
        const path = (f.local_path || "").trim();
        let name =
          props.fileNames?.[f.id] ||
          (path ? basenamePath(path) : "") ||
          "";
        if (!name && props.resolveFileName) {
          try {
            name = (await props.resolveFileName(f)) || "";
          } catch {
            /* ignore */
          }
        }
        if (!name) name = "File";
        rows.push({
          id: f.id,
          conversation_id: f.conversation_id || "",
          uploader_id: f.uploader_id || "",
          enc_filename: f.enc_filename,
          filename_nonce: f.filename_nonce,
          size_bytes: Number(f.size_bytes) || 0,
          local_path: f.local_path,
          local_path_present: !!f.local_path_present,
          local_cleared: !!f.local_cleared,
          created_at: f.created_at || "",
          name,
        });
      }
      setFiles(rows);
      setStorage(res.storage);
      setSelected((prev) => {
        const ids = new Set(rows.map((r) => r.id));
        const next = new Set<string>();
        for (const id of prev) if (ids.has(id)) next.add(id);
        return next;
      });
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [props.fileNames, props.resolveFileName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const media = files.filter(
        (f) => f.local_path_present && (isImageFileName(f.name) || isVideoFileName(f.name))
      );
      for (const f of media.slice(0, 40)) {
        if (thumbs[f.id]) continue;
        try {
          const t = await peerApi.ensureFileThumbnail(f.id);
          if (cancelled || !t?.data_b64) continue;
          const url = `data:${t.mime || "image/jpeg"};base64,${t.data_b64}`;
          setThumbs((s) => (s[f.id] ? s : { ...s, [f.id]: url }));
        } catch {
          /* no thumb */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files, thumbs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = files.filter((f) => {
      if (q && !f.name.toLowerCase().includes(q) && !peerName(f.uploader_id).toLowerCase().includes(q)) {
        return false;
      }
      if (dirFilter === "sent" && f.uploader_id !== props.profile.id) return false;
      if (dirFilter === "received" && f.uploader_id === props.profile.id) return false;
      if (peerFilter !== "all" && f.uploader_id !== peerFilter) return false;
      const media = isImageFileName(f.name) || isVideoFileName(f.name) || canPreviewFileName(f.name);
      if (typeFilter === "media" && !media) return false;
      if (typeFilter === "other" && media) return false;
      const presence = presenceOf(f);
      if (presenceFilter === "on_disk" && presence !== "on_disk") return false;
      if (presenceFilter === "not_on_disk" && presence === "on_disk") return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "size") cmp = a.size_bytes - b.size_bytes;
      else cmp = String(a.created_at).localeCompare(String(b.created_at));
      return sortAsc ? cmp : -cmp;
    });
    return rows;
  }, [
    files,
    query,
    dirFilter,
    peerFilter,
    typeFilter,
    presenceFilter,
    sortKey,
    sortAsc,
    props.profile.id,
    peerName,
  ]);

  const selectableIds = useMemo(
    () => filtered.filter((f) => f.local_path_present).map((f) => f.id),
    [filtered]
  );

  const selectedFiles = useMemo(
    () => files.filter((f) => selected.has(f.id)),
    [files, selected]
  );

  const selectedBytes = useMemo(
    () =>
      selectedFiles
        .filter((f) => f.local_path_present)
        .reduce((sum, f) => sum + Math.max(0, f.size_bytes), 0),
    [selectedFiles]
  );

  const deletableSelectedIds = useMemo(
    () => selectedFiles.filter((f) => canDeleteLocal(f, props.profile.id)).map((f) => f.id),
    [selectedFiles, props.profile.id]
  );

  const receivedOnDisk = useMemo(
    () => files.filter((f) => canDeleteLocal(f, props.profile.id)),
    [files, props.profile.id]
  );

  const receivedOnDiskBytes = useMemo(
    () => receivedOnDisk.reduce((sum, f) => sum + Math.max(0, f.size_bytes), 0),
    [receivedOnDisk]
  );

  const uploaderOptions = useMemo(() => {
    const ids = new Set(files.map((f) => f.uploader_id).filter(Boolean));
    return [...ids].sort((a, b) => peerName(a).localeCompare(peerName(b)));
  }, [files, peerName]);

  const allSelectableChecked =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelectableChecked = selectableIds.some((id) => selected.has(id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectableChecked) {
        for (const id of selectableIds) next.delete(id);
      } else {
        for (const id of selectableIds) next.add(id);
      }
      return next;
    });
  }

  async function deleteIds(ids: string[]) {
    const allowed = files
      .filter((f) => ids.includes(f.id) && canDeleteLocal(f, props.profile.id))
      .map((f) => f.id);
    const skipped = ids.length - allowed.length;
    if (!allowed.length) {
      setStatus(
        skipped
          ? "Sent files are never deleted here — they may be your original folders (e.g. .m2)."
          : "Nothing to delete on disk"
      );
      return;
    }
    setBusy(true);
    try {
      const res = await peerApi.deleteLocalFiles(allowed);
      const n = res.deleted + res.cleared_only;
      const parts: string[] = [];
      if (n) parts.push(`Removed ${n} received download${n === 1 ? "" : "s"}`);
      if (skipped || res.skipped_sent)
        parts.push("sent originals left untouched");
      setStatus(parts.join(" · ") || "Nothing to delete on disk");
      setSelected(new Set());
      await refresh();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function clearStorage() {
    setBusy(true);
    setClearOpen(false);
    try {
      const res = await peerApi.clearLocalFiles();
      const n = res.deleted + res.cleared_only;
      setStatus(
        n
          ? `Cleared ${n} received download${n === 1 ? "" : "s"} (sent originals kept)`
          : res.skipped_sent
            ? "No received downloads to clear — sent originals are never removed"
            : "No on-disk received files to clear"
      );
      setSelected(new Set());
      await refresh();
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function openShare(paths: string[]) {
    if (!paths.length) {
      setStatus("No on-disk files to share");
      return;
    }
    setSharePaths(paths);
  }

  function presenceChip(f: LibraryFile) {
    const p = presenceOf(f);
    if (p === "on_disk") {
      return (
        <Chip size="small" label="On disk" color="success" variant={dark ? "filled" : "outlined"} />
      );
    }
    if (p === "removed") {
      return <Chip size="small" label="Removed locally" variant="outlined" color="warning" />;
    }
    return <Chip size="small" label="Not downloaded" variant="outlined" />;
  }

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: { xs: 2, md: 3 },
          pt: 2.5,
          pb: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          alignItems={{ sm: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h5" fontWeight={700} color="text.primary">
              Files
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75 }} flexWrap="wrap">
              <StorageIcon sx={{ fontSize: 18, color: "primary.main" }} />
              <Typography sx={{ fontWeight: 700, color: "text.primary", fontSize: "0.95rem" }}>
                {formatBytes(storage.bytes_on_disk)} used
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: "0.8125rem" }}>
                · {storage.on_disk_count} on disk
                {storage.file_count > storage.on_disk_count
                  ? ` · ${storage.file_count - storage.on_disk_count} not on this PC`
                  : ""}
                {storage.file_count ? ` · ${storage.file_count} in library` : ""}
              </Typography>
            </Stack>
            {selected.size > 0 && (
              <Typography color="text.secondary" sx={{ fontSize: "0.8125rem", mt: 0.5 }}>
                Selected: {selected.size} · ~{formatBytes(selectedBytes)}
              </Typography>
            )}
          </Box>
          <Button
            variant="outlined"
            color="warning"
            disabled={busy || receivedOnDisk.length === 0}
            onClick={() => setClearOpen(true)}
            startIcon={<DeleteOutlineIcon />}
            sx={{ textTransform: "none", fontWeight: 600, alignSelf: { xs: "stretch", sm: "center" } }}
          >
            Clear storage
          </Button>
        </Stack>

        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1}
          sx={{ mt: 2 }}
          alignItems={{ md: "center" }}
        >
          <TextField
            size="small"
            placeholder="Search files or people…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            sx={{ flex: 1, minWidth: 180 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select
              value={`${sortKey}:${sortAsc ? "asc" : "desc"}`}
              onChange={(e) => {
                const [k, d] = String(e.target.value).split(":");
                setSortKey(k as SortKey);
                setSortAsc(d === "asc");
              }}
            >
              <MenuItem value="date:desc">Newest</MenuItem>
              <MenuItem value="date:asc">Oldest</MenuItem>
              <MenuItem value="size:desc">Largest</MenuItem>
              <MenuItem value="size:asc">Smallest</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select value={dirFilter} onChange={(e) => setDirFilter(e.target.value as DirFilter)}>
              <MenuItem value="all">All directions</MenuItem>
              <MenuItem value="sent">Sent</MenuItem>
              <MenuItem value="received">Received</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}>
              <MenuItem value="all">All types</MenuItem>
              <MenuItem value="media">Media</MenuItem>
              <MenuItem value="other">Other</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <Select
              value={presenceFilter}
              onChange={(e) => setPresenceFilter(e.target.value as PresenceFilter)}
            >
              <MenuItem value="all">Any presence</MenuItem>
              <MenuItem value="on_disk">On disk</MenuItem>
              <MenuItem value="not_on_disk">Not on disk</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <Select value={peerFilter} onChange={(e) => setPeerFilter(String(e.target.value))}>
              <MenuItem value="all">All people</MenuItem>
              {uploaderOptions.map((id) => (
                <MenuItem key={id} value={id}>
                  {peerName(id)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Box>

      {selected.size > 0 && (
        <Box
          sx={{
            px: { xs: 2, md: 3 },
            py: 1,
            display: "flex",
            gap: 1,
            alignItems: "center",
            bgcolor: alpha(theme.palette.primary.main, dark ? 0.12 : 0.08),
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography sx={{ fontWeight: 600, fontSize: "0.875rem", mr: 1 }}>
            {selected.size} selected
          </Typography>
          <Button
            size="small"
            startIcon={<ShareIcon />}
            disabled={busy}
            onClick={() => {
              const paths = selectedFiles
                .filter((f) => f.local_path_present && f.local_path)
                .map((f) => String(f.local_path));
              const skipped = selected.size - paths.length;
              if (skipped > 0) setStatus(`${skipped} file(s) skipped (not on disk)`);
              openShare(paths);
            }}
            sx={{ textTransform: "none" }}
          >
            Share
          </Button>
          <Tooltip
            title={
              deletableSelectedIds.length
                ? "Delete received downloads only — sent originals are never removed"
                : "Only received downloads can be deleted. Sent items (your originals) stay safe."
            }
          >
            <span>
              <Button
                size="small"
                color="warning"
                startIcon={<DeleteOutlineIcon />}
                disabled={busy || !deletableSelectedIds.length}
                onClick={() => void deleteIds(deletableSelectedIds)}
                sx={{ textTransform: "none" }}
              >
                Delete local
                {deletableSelectedIds.length
                  ? ` (${deletableSelectedIds.length})`
                  : ""}
              </Button>
            </span>
          </Tooltip>
          <Button size="small" onClick={() => setSelected(new Set())} sx={{ textTransform: "none" }}>
            Clear selection
          </Button>
        </Box>
      )}

      {status && (
        <Typography
          sx={{
            px: { xs: 2, md: 3 },
            py: 0.75,
            fontSize: "0.8125rem",
            color: "text.secondary",
            bgcolor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          {status}
        </Typography>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: { xs: 1, md: 2 }, py: 1 }}>
        {loading && (
          <Typography color="text.secondary" sx={{ p: 3 }}>
            Loading files…
          </Typography>
        )}
        {!loading && !filtered.length && (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <FolderOpenIcon sx={{ fontSize: 40, color: "text.secondary", mb: 1 }} />
            <Typography color="text.secondary">
              {files.length ? "No files match these filters" : "No transferred files yet"}
            </Typography>
          </Box>
        )}

        {!!filtered.length && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1,
              py: 0.75,
              color: "text.secondary",
            }}
          >
            <Checkbox
              size="small"
              checked={allSelectableChecked}
              indeterminate={!allSelectableChecked && someSelectableChecked}
              disabled={!selectableIds.length}
              onChange={toggleSelectAll}
              inputProps={{ "aria-label": "Select all on-disk files" }}
            />
            <Typography variant="caption" fontWeight={600}>
              Select on-disk files in this list
            </Typography>
          </Box>
        )}

        <Stack spacing={0.5}>
          {filtered.map((f) => {
            const onDisk = f.local_path_present;
            const sent = f.uploader_id === props.profile.id;
            return (
              <Box
                key={f.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  px: 1,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: "background.paper",
                  border: 1,
                  borderColor: "divider",
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Checkbox
                  size="small"
                  checked={selected.has(f.id)}
                  disabled={!onDisk}
                  onChange={() => toggleSelect(f.id)}
                  inputProps={{ "aria-label": `Select ${f.name}` }}
                />
                {thumbs[f.id] ? (
                  <Box
                    component="img"
                    src={thumbs[f.id]}
                    alt=""
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 1.25,
                      objectFit: "cover",
                      flexShrink: 0,
                      bgcolor: "action.hover",
                    }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 1.25,
                      flexShrink: 0,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: alpha(theme.palette.primary.main, dark ? 0.16 : 0.1),
                      color: "primary.main",
                    }}
                  >
                    <InsertDriveFileIcon sx={{ fontSize: 22 }} />
                  </Box>
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography fontWeight={700} noWrap color="text.primary" fontSize="0.9rem">
                    {f.name}
                  </Typography>
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="caption" color="text.secondary">
                      {peerName(f.uploader_id)} · {sent ? "Sent" : "Received"} ·{" "}
                      {formatBytes(f.size_bytes)} · {stampLabel(f.created_at)}
                    </Typography>
                    {presenceChip(f)}
                  </Stack>
                </Box>
                <Tooltip title="More">
                  <IconButton
                    size="small"
                    onClick={(e) => setMenu({ anchor: e.currentTarget, file: f })}
                    sx={{ color: "text.secondary" }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Stack>
      </Box>

      <Menu
        open={!!menu}
        anchorEl={menu?.anchor}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuList dense>
          {menu?.file.local_path_present && canPreviewFileName(menu.file.name) && (
            <MenuItem
              onClick={() => {
                const f = menu.file;
                setMenu(null);
                void props.openAttachment(f.id, f.uploader_id);
              }}
            >
              <ListItemIcon>
                <VisibilityIcon fontSize="small" />
              </ListItemIcon>
              Preview
            </MenuItem>
          )}
          {menu?.file.local_path_present && (
            <MenuItem
              onClick={async () => {
                const f = menu.file;
                setMenu(null);
                try {
                  await peerApi.openLocalFile(f.id);
                } catch (err: any) {
                  setStatus(err?.message || String(err));
                  await refresh();
                }
              }}
            >
              <ListItemIcon>
                <OpenInNewIcon fontSize="small" />
              </ListItemIcon>
              Open / Reveal
            </MenuItem>
          )}
          {menu?.file.local_path_present && (
            <MenuItem
              onClick={() => {
                const f = menu.file;
                setMenu(null);
                if (f.local_path) openShare([f.local_path]);
              }}
            >
              <ListItemIcon>
                <ShareIcon fontSize="small" />
              </ListItemIcon>
              Share
            </MenuItem>
          )}
          {menu && !menu.file.local_path_present && (
            <MenuItem
              onClick={() => {
                const f = menu.file;
                setMenu(null);
                void Promise.resolve(props.openAttachment(f.id, f.uploader_id)).then(() =>
                  refresh()
                );
              }}
            >
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              Download again
            </MenuItem>
          )}
          {menu && canDeleteLocal(menu.file, props.profile.id) && (
            <MenuItem
              onClick={() => {
                const f = menu.file;
                setMenu(null);
                void deleteIds([f.id]);
              }}
            >
              <ListItemIcon>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              Delete local
            </MenuItem>
          )}
          {menu &&
            menu.file.local_path_present &&
            menu.file.uploader_id === props.profile.id && (
              <MenuItem disabled>
                <ListItemIcon>
                  <DeleteOutlineIcon fontSize="small" />
                </ListItemIcon>
                Sent original — not deletable
              </MenuItem>
            )}
          <MenuItem
            onClick={() => {
              const f = menu?.file;
              setMenu(null);
              if (f?.conversation_id) props.onJumpToChat(f.conversation_id);
              else setStatus("No chat linked to this file");
            }}
          >
            <ListItemIcon>
              <ChatIcon fontSize="small" />
            </ListItemIcon>
            Jump to chat
          </MenuItem>
        </MenuList>
      </Menu>

      <Dialog open={clearOpen} onClose={() => !busy && setClearOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Clear received downloads?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This removes only files you <strong>received</strong> that are still on disk (
            {formatBytes(receivedOnDiskBytes)} · {receivedOnDisk.length} file
            {receivedOnDisk.length === 1 ? "" : "s"}). Chat history stays so you can download again.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Files you <strong>sent</strong> are never deleted here — their paths may point at your
            real project folders (for example <code>.m2</code> or <code>node_modules</code>).
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setClearOpen(false)}>
            Cancel
          </Button>
          <Button color="warning" variant="contained" disabled={busy} onClick={() => void clearStorage()}>
            Clear received
          </Button>
        </DialogActions>
      </Dialog>

      <SharePeersDialog
        open={sharePaths.length > 0}
        paths={sharePaths}
        peers={props.peers.filter(
          (p) => p.user_id !== props.profile.id && peerHasLanIp(p)
        )}
        busy={props.shareBusy || busy}
        onClose={() => setSharePaths([])}
        onSend={async (peerIds) => {
          const paths = [...sharePaths];
          setSharePaths([]);
          await props.onSharePaths(paths, peerIds);
        }}
      />
    </Box>
  );
}
