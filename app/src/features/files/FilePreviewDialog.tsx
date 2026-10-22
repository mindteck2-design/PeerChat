// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import {
  Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightIcon from "@mui/icons-material/ChevronRightRounded";
import CloseIcon from "@mui/icons-material/CloseRounded";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFileRounded";
import OpenInNewIcon from "@mui/icons-material/OpenInNewRounded";
import ZoomInIcon from "@mui/icons-material/ZoomInRounded";
import ZoomOutIcon from "@mui/icons-material/ZoomOutRounded";
import RestartAltIcon from "@mui/icons-material/RestartAltRounded";

import type { ChatScreenVm } from "../chat/chatVm";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.12;

function clampZoom(n: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
}

/** Wheel-zoom + drag-pan for image (and similar) previews. */
function ZoomableStage({
  resetKey,
  children,
}: {
  resetKey: string;
  children: React.ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    panningRef.current = false;
    setPanning(false);
  }, [resetKey]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setScale((s) => {
        const next = clampZoom(s + dir);
        if (next <= 1.01) setOffset({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (delta: number) => {
    setScale((s) => {
      const next = clampZoom(s + delta);
      if (next <= 1.01) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <Box
      ref={stageRef}
      sx={{
        position: "relative",
        width: "100%",
        height: "72vh",
        overflow: "hidden",
        display: "grid",
        placeItems: "center",
        cursor: scale > 1.01 ? (panning ? "grabbing" : "grab") : "zoom-in",
        userSelect: "none",
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        if (scale <= 1.01 || e.button !== 0) return;
        panningRef.current = true;
        setPanning(true);
        lastPos.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!panningRef.current) return;
        const dx = e.clientX - lastPos.current.x;
        const dy = e.clientY - lastPos.current.y;
        lastPos.current = { x: e.clientX, y: e.clientY };
        setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
      }}
      onPointerUp={(e) => {
        panningRef.current = false;
        setPanning(false);
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }}
      onPointerCancel={() => {
        panningRef.current = false;
        setPanning(false);
      }}
      onDoubleClick={() => reset()}
    >
      <Box
        sx={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: panning ? "none" : "transform 80ms ease-out",
          maxWidth: "100%",
          maxHeight: "100%",
          display: "grid",
          placeItems: "center",
          willChange: "transform",
        }}
      >
        {children}
      </Box>

      <Stack
        direction="row"
        spacing={0.5}
        alignItems="center"
        sx={{
          position: "absolute",
          left: 12,
          bottom: 12,
          zIndex: 3,
          bgcolor: "rgba(0,0,0,0.55)",
          borderRadius: 999,
          px: 0.75,
          py: 0.35,
          backdropFilter: "blur(6px)",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <IconButton
          size="small"
          aria-label="Zoom out"
          onClick={() => zoomBy(-ZOOM_STEP * 2)}
          disabled={scale <= ZOOM_MIN}
          sx={{ color: "#fff" }}
        >
          <ZoomOutIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" sx={{ color: "#fff", minWidth: 40, textAlign: "center", fontWeight: 700 }}>
          {Math.round(scale * 100)}%
        </Typography>
        <IconButton
          size="small"
          aria-label="Zoom in"
          onClick={() => zoomBy(ZOOM_STEP * 2)}
          disabled={scale >= ZOOM_MAX}
          sx={{ color: "#fff" }}
        >
          <ZoomInIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Reset zoom"
          onClick={reset}
          disabled={scale === 1 && offset.x === 0 && offset.y === 0}
          sx={{ color: "#fff" }}
        >
          <RestartAltIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Typography
        variant="caption"
        sx={{
          position: "absolute",
          right: 12,
          bottom: 14,
          zIndex: 3,
          color: "rgba(255,255,255,0.45)",
          pointerEvents: "none",
        }}
      >
        Scroll to zoom · drag to pan · double-click reset
      </Typography>
    </Box>
  );
}

export function FilePreviewDialog({ vm }: { vm: ChatScreenVm }) {
  const {
    closeFilePreview,
    filePreview,
    openPreviewedFile,
    previewBusy,
    previewGalleryStep,
  } = vm;

  const isMedia =
    !!filePreview &&
    (filePreview.mime.startsWith("image/") || filePreview.mime.startsWith("video/"));
  const isImage = !!filePreview?.mime.startsWith("image/");
  const isPdf = filePreview?.mime === "application/pdf";

  return (
    <>
      <Dialog
        open={!!filePreview}
        onClose={closeFilePreview}
        fullWidth
        maxWidth={isMedia || isPdf ? "lg" : "md"}
        PaperProps={{
          sx: {
            bgcolor: isMedia ? "#0d0d0d" : undefined,
            backgroundImage: "none",
          },
        }}
      >
        <DialogTitle sx={{ pr: 6, color: isMedia ? "#eee" : undefined }}>
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
              color: isMedia ? "#fff" : undefined,
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
            bgcolor: isMedia ? "#111" : "action.hover",
            p: isImage ? 0 : 2,
            position: "relative",
            overflow: "hidden",
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
          {isImage ? (
            <ZoomableStage resetKey={filePreview.url || filePreview.name}>
              <Box
                component="img"
                src={filePreview.url}
                alt={filePreview.name}
                draggable={false}
                sx={{
                  maxWidth: "100%",
                  maxHeight: "72vh",
                  objectFit: "contain",
                  display: "block",
                  pointerEvents: "none",
                }}
              />
            </ZoomableStage>
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
          ) : isPdf ? (
            <Box sx={{ width: "100%", position: "relative" }}>
              <Box
                component="iframe"
                src={filePreview.url}
                title={filePreview.name}
                sx={{ width: "100%", height: "65vh", border: 0, bgcolor: "background.paper" }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1, textAlign: "center" }}
              >
                Use Ctrl + scroll in the PDF viewer to zoom
              </Typography>
            </Box>
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
            bgcolor: isMedia ? "#0d0d0d" : undefined,
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              mr: "auto",
              color: isMedia ? "rgba(255,255,255,0.55)" : undefined,
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
