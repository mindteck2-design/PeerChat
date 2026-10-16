// @ts-nocheck
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightIcon from "@mui/icons-material/ChevronRightRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import { formatBytes } from "../../shared/format";

import type { ChatScreenVm } from "../chat/chatVm";

export function FilePreviewDialog({ vm }: { vm: ChatScreenVm }) {
  const {
    closeFilePreview,
    filePreview,
    openPreviewedFile,
    previewBusy,
    previewGalleryStep,
    text
  } = vm;
  return (
    <>
      <Dialog
        open={!!filePreview}
        onClose={closeFilePreview}
        fullWidth
        maxWidth={filePreview?.mime.startsWith("image/") || filePreview?.mime.startsWith("video/") ? "lg" : "md"}
        PaperProps={{
          sx: {
            bgcolor: filePreview?.mime.startsWith("image/") || filePreview?.mime.startsWith("video/")
              ? "#0d0d0d"
              : undefined,
            backgroundImage: "none",
          },
        }}
      >
        <DialogTitle sx={{ pr: 6, color: filePreview?.mime.startsWith("image/") || filePreview?.mime.startsWith("video/") ? "#eee" : undefined }}>
          <Typography fontWeight={700} noWrap>
            {filePreview?.name}
            {filePreview?.gallery && filePreview.gallery.fileIds.length > 1
              ? `  ·  ${filePreview.gallery.index + 1}/${filePreview.gallery.fileIds.length}`
              : ""}
          </Typography>
          <IconButton
            aria-label="Close preview"
            onClick={closeFilePreview}
            sx={{
              position: "absolute",
              right: 12,
              top: 12,
              color: filePreview?.mime.startsWith("image/") || filePreview?.mime.startsWith("video/") ? "#fff" : undefined,
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            minHeight: 240,
            display: "grid",
            placeItems: "center",
            bgcolor:
              filePreview?.mime.startsWith("image/") || filePreview?.mime.startsWith("video/")
                ? "#111"
                : "action.hover",
            p: 2,
            position: "relative",
          }}
          onKeyDown={(e) => {
            if (!filePreview?.gallery || filePreview.gallery.fileIds.length < 2) return;
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              previewGalleryStep(-1);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              previewGalleryStep(1);
            }
          }}
        >
          {filePreview?.gallery && filePreview.gallery.fileIds.length > 1 && (
            <>
              <IconButton
                aria-label="Previous"
                onClick={() => previewGalleryStep(-1)}
                disabled={previewBusy}
                sx={{
                  position: "absolute",
                  left: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  bgcolor: "rgba(255,255,255,0.12)",
                  color: "#fff",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.22)" },
                  zIndex: 2,
                }}
              >
                <ChevronLeftIcon />
              </IconButton>
              <IconButton
                aria-label="Next"
                onClick={() => previewGalleryStep(1)}
                disabled={previewBusy}
                sx={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  bgcolor: "rgba(255,255,255,0.12)",
                  color: "#fff",
                  "&:hover": { bgcolor: "rgba(255,255,255,0.22)" },
                  zIndex: 2,
                }}
              >
                <ChevronRightIcon />
              </IconButton>
            </>
          )}
          {previewBusy && (
            <CircularProgress
              size={36}
              sx={{ position: "absolute", top: 16, right: 56, color: "#fff", zIndex: 2 }}
            />
          )}
          {filePreview?.mime.startsWith("image/") ? (
            <Box
              component="img"
              src={filePreview.url}
              alt={filePreview.name}
              sx={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain" }}
            />
          ) : filePreview?.mime.startsWith("video/") ? (
            <Box
              component="video"
              src={filePreview.url}
              controls
              autoPlay
              sx={{ maxWidth: "100%", maxHeight: "72vh" }}
            />
          ) : filePreview?.mime.startsWith("audio/") ? (
            <Box component="audio" src={filePreview.url} controls sx={{ width: "min(520px, 100%)" }} />
          ) : filePreview?.mime === "application/pdf" ? (
            <Box
              component="iframe"
              src={filePreview.url}
              title={filePreview.name}
              sx={{ width: "100%", height: "65vh", border: 0, bgcolor: "background.paper" }}
            />
          ) : filePreview?.mime.startsWith("text/") ||
            filePreview?.mime === "application/json" ? (
            <Box
              component="pre"
              sx={{
                width: "100%",
                maxHeight: "65vh",
                overflow: "auto",
                m: 0,
                p: 2,
                bgcolor: "background.paper",
                borderRadius: 1,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {new TextDecoder().decode(filePreview.data)}
            </Box>
          ) : (
            <Stack alignItems="center" spacing={1}>
              <InsertDriveFileIcon color="primary" sx={{ fontSize: 64 }} />
              <Typography>{filePreview?.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                Preview is not supported for this file type.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            py: 2,
            bgcolor:
              filePreview?.mime.startsWith("image/") || filePreview?.mime.startsWith("video/")
                ? "#0d0d0d"
                : undefined,
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              mr: "auto",
              color:
                filePreview?.mime.startsWith("image/") || filePreview?.mime.startsWith("video/")
                  ? "rgba(255,255,255,0.55)"
                  : undefined,
            }}
          >
            {filePreview?.localPath ? `Saved · ${filePreview.localPath}` : "Available on this computer"}
          </Typography>
          <Button variant="contained" startIcon={<OpenInNewIcon />} onClick={openPreviewedFile}>
            Open in app
          </Button>
        </DialogActions>
      </Dialog>

    </>
  );
}
