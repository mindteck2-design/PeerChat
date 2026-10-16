// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Dialog, DialogActions, DialogContent, Divider, IconButton,
  Slider, Stack, Tooltip, Typography,
} from "@mui/material";
import ArrowRightAltIcon from "@mui/icons-material/ArrowRightAlt";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import BrushIcon from "@mui/icons-material/Brush";
import CropIcon from "@mui/icons-material/Crop";
import HighlightIcon from "@mui/icons-material/HighlightAlt";
import NearMeIcon from "@mui/icons-material/NearMe";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import RectangleOutlinedIcon from "@mui/icons-material/RectangleOutlined";
import RedoIcon from "@mui/icons-material/Redo";
import TextFieldsIcon from "@mui/icons-material/TextFields";
import UndoIcon from "@mui/icons-material/Undo";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { peerApi } from "../../peer";
import {
  ACCENT, COLORS, type Annotation, type Point, type Tool, newId, normalizeRect,
} from "./annotationModel";
import { exportAnnotatedPng, paintPreview } from "./exportAnnotatedPng";

function b64FromBytes(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

/** Composite icon: rectangle + text glyph. */
function RectTextIcon({ fontSize = "small" }: { fontSize?: "small" | "inherit" }) {
  const size = fontSize === "small" ? 20 : 24;
  return (
    <Box sx={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}>
      <RectangleOutlinedIcon sx={{ fontSize: size * 0.92, color: "inherit" }} />
      <Typography
        component="span"
        sx={{
          position: "absolute",
          right: -1,
          bottom: -2,
          fontSize: 9,
          fontWeight: 800,
          lineHeight: 1,
          bgcolor: "background.paper",
          px: "1px",
          color: "inherit",
        }}
      >
        T
      </Typography>
    </Box>
  );
}

/** Composite icon: arrow + text glyph. */
function ArrowTextIcon({ fontSize = "small" }: { fontSize?: "small" | "inherit" }) {
  const size = fontSize === "small" ? 20 : 24;
  return (
    <Box sx={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}>
      <ArrowRightAltIcon sx={{ fontSize: size, color: "inherit" }} />
      <Typography
        component="span"
        sx={{
          position: "absolute",
          right: -1,
          bottom: -2,
          fontSize: 9,
          fontWeight: 800,
          lineHeight: 1,
          bgcolor: "background.paper",
          px: "1px",
          color: "inherit",
        }}
      >
        T
      </Typography>
    </Box>
  );
}

type TextEditSession = {
  kind: "text" | "rect_text" | "arrow_text";
  /** Image-space placement for plain text. */
  at?: Point;
  /** Shape already drawn — committed when text is confirmed. */
  shape?: Extract<Annotation, { type: "rect_text" | "arrow_text" }>;
  value: string;
  /** Overlay position in canvas wrapper CSS pixels. */
  left: number;
  top: number;
  width: number;
};

type Props = {
  open: boolean;
  captureId: string | null;
  onCancel: () => void;
  onDone: (result: { captureId: string; path: string; name: string }) => void;
};

export function ScreenshotAnnotator({ open, captureId, onCancel, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [scale, setScale] = useState(1);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [stroke, setStroke] = useState(3);
  const [blurSize, setBlurSize] = useState(12);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!open || !captureId) return;
    let cancel = false;
    let url: string | null = null;
    (async () => {
      try {
        const prev = await peerApi.readCapturePreview(captureId);
        const bin = Uint8Array.from(atob(prev.data_b64), (c) => c.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bin], { type: prev.mime || "image/png" }));
        if (cancel) {
          URL.revokeObjectURL(url);
          return;
        }
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("preview"));
          img.src = url!;
        });
        if (cancel) return;
        imgRef.current = img;
        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        setImageUrl(url);
        setAnnotations([]);
        setRedoStack([]);
        setDraft(null);
        setTextEdit(null);
        setTool("arrow");
        setStatus(null);
      } catch (err: any) {
        setStatus(err?.message || String(err));
      }
    })();
    return () => {
      cancel = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, captureId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageUrl) return;
    const maxW = Math.min(window.innerWidth - 220, 1180);
    const maxH = Math.min(window.innerHeight - 160, 760);
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    setScale(s);
    canvas.width = Math.max(1, Math.round(img.naturalWidth * s));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    paintPreview(ctx, img, annotations, draft, s);
  }, [imageUrl, annotations, draft, natural]);

  useEffect(() => {
    if (!textEdit) return;
    const t = window.setTimeout(() => textInputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [textEdit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (textEdit) {
          cancelTextEdit();
          return;
        }
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, textEdit]);

  function toImagePoint(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * natural.w;
    const y = ((e.clientY - rect.top) / rect.height) * natural.h;
    return { x, y };
  }

  function imageToOverlay(p: Point, widthHint = 180) {
    const canvas = canvasRef.current;
    if (!canvas) return { left: 0, top: 0, width: widthHint };
    return {
      left: p.x * scale,
      top: p.y * scale,
      width: Math.max(140, Math.min(280, widthHint)),
    };
  }

  function pushAnnotation(a: Annotation) {
    setAnnotations((prev) => [...prev, a]);
    setRedoStack([]);
  }

  function cancelTextEdit() {
    setTextEdit(null);
    setDraft(null);
  }

  function commitTextEdit() {
    if (!textEdit) return;
    const value = textEdit.value.trim();
    if (!value) {
      cancelTextEdit();
      return;
    }
    if (textEdit.kind === "text" && textEdit.at) {
      pushAnnotation({
        id: newId(),
        type: "text",
        color,
        stroke,
        at: textEdit.at,
        text: value,
      });
    } else if (textEdit.shape) {
      pushAnnotation({ ...textEdit.shape, text: value });
    }
    setTextEdit(null);
    setDraft(null);
  }

  function beginTextAt(p: Point) {
    const overlay = imageToOverlay(p);
    setTextEdit({
      kind: "text",
      at: p,
      value: "",
      left: overlay.left,
      top: overlay.top - 4,
      width: overlay.width,
    });
  }

  function beginLabeledShape(
    kind: "rect_text" | "arrow_text",
    shape: Extract<Annotation, { type: "rect_text" | "arrow_text" }>
  ) {
    const { x, y, w, h } = normalizeRect(shape.from, shape.to);
    let left: number;
    let top: number;
    if (kind === "rect_text") {
      left = x * scale;
      top = (y + h) * scale + 8;
    } else {
      const mid = { x: (shape.from.x + shape.to.x) / 2, y: (shape.from.y + shape.to.y) / 2 };
      left = mid.x * scale + 8;
      top = mid.y * scale - 28;
    }
    setDraft({ ...shape, text: "" });
    setTextEdit({
      kind,
      shape,
      value: "",
      left,
      top,
      width: Math.max(160, Math.min(260, w * scale || 180)),
    });
  }

  function onPointerDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (textEdit) return;
    if (tool === "select") return;
    const p = toImagePoint(e);
    drawing.current = true;
    if (tool === "pen") {
      setDraft({
        id: newId(),
        type: "pen",
        color,
        stroke,
        points: [p],
      });
      return;
    }
    if (tool === "text") {
      drawing.current = false;
      beginTextAt(p);
      return;
    }
    const base = { id: newId(), color, stroke: tool === "blur" ? blurSize : stroke, from: p, to: p };
    if (tool === "arrow") setDraft({ ...base, type: "arrow" });
    else if (tool === "rect") setDraft({ ...base, type: "rect" });
    else if (tool === "circle") setDraft({ ...base, type: "circle" });
    else if (tool === "rect_text") setDraft({ ...base, type: "rect_text", text: "" });
    else if (tool === "arrow_text") setDraft({ ...base, type: "arrow_text", text: "" });
    else if (tool === "highlight")
      setDraft({ ...base, type: "highlight", color: color === "#FFFFFF" ? "#FFEB3B" : color });
    else if (tool === "blur") setDraft({ id: newId(), type: "blur", stroke: blurSize, from: p, to: p });
    else if (tool === "crop") setDraft({ id: newId(), type: "crop", from: p, to: p });
  }

  function onPointerMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing.current || !draft || textEdit) return;
    const p = toImagePoint(e);
    if (draft.type === "pen") {
      setDraft({ ...draft, points: [...draft.points, p] });
      return;
    }
    setDraft({ ...draft, to: p });
  }

  function onPointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    if (!draft || textEdit) return;
    if (draft.type === "crop") {
      setAnnotations((prev) => [...prev.filter((a) => a.type !== "crop"), draft]);
      setRedoStack([]);
      setDraft(null);
      return;
    }
    if (draft.type === "rect_text") {
      const { w, h } = normalizeRect(draft.from, draft.to);
      if (w < 4 || h < 4) {
        setDraft(null);
        return;
      }
      beginLabeledShape("rect_text", draft);
      return;
    }
    if (draft.type === "arrow_text") {
      const len = Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y);
      if (len < 6) {
        setDraft(null);
        return;
      }
      beginLabeledShape("arrow_text", draft);
      return;
    }
    pushAnnotation(draft);
    setDraft(null);
  }

  async function handleDone() {
    if (!captureId || !imageUrl) return;
    // Fold any open inline editor into the list synchronously before export.
    let finalList = annotations;
    if (textEdit) {
      const value = textEdit.value.trim();
      if (value) {
        if (textEdit.kind === "text" && textEdit.at) {
          finalList = [
            ...annotations,
            { id: newId(), type: "text", color, stroke, at: textEdit.at, text: value },
          ];
        } else if (textEdit.shape) {
          finalList = [...annotations, { ...textEdit.shape, text: value }];
        }
      }
      setTextEdit(null);
      setDraft(null);
      setAnnotations(finalList);
    }
    setBusy(true);
    setStatus(null);
    try {
      const bytes = await exportAnnotatedPng(imageUrl, finalList, natural.w, natural.h);
      const res = await peerApi.finalizeCapture(captureId, b64FromBytes(bytes));
      onDone({ captureId, path: res.path, name: res.name });
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const tools: { id: Tool; label: string; icon: React.ReactNode }[] = [
    { id: "select", label: "Select", icon: <NearMeIcon fontSize="small" /> },
    { id: "pen", label: "Pen", icon: <BrushIcon fontSize="small" /> },
    { id: "arrow", label: "Arrow", icon: <ArrowRightAltIcon fontSize="small" /> },
    { id: "rect", label: "Rectangle", icon: <RectangleOutlinedIcon fontSize="small" /> },
    { id: "circle", label: "Circle", icon: <RadioButtonUncheckedIcon fontSize="small" /> },
    { id: "text", label: "Text", icon: <TextFieldsIcon fontSize="small" /> },
    { id: "rect_text", label: "Rectangle with Text", icon: <RectTextIcon /> },
    { id: "arrow_text", label: "Arrow with Text", icon: <ArrowTextIcon /> },
    { id: "highlight", label: "Highlight", icon: <HighlightIcon fontSize="small" /> },
    { id: "blur", label: "Blur", icon: <BlurOnIcon fontSize="small" /> },
    { id: "crop", label: "Crop", icon: <CropIcon fontSize="small" /> },
  ];

  const toolBtnSx = (active: boolean) => ({
    width: 36,
    height: 36,
    borderRadius: 1.25,
    color: active ? "#fff" : "text.secondary",
    bgcolor: active ? ACCENT : "transparent",
    border: "1px solid",
    borderColor: active ? ACCENT : "transparent",
    "&:hover": {
      bgcolor: active ? ACCENT : "action.hover",
      color: active ? "#fff" : "text.primary",
    },
  });

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (textEdit) cancelTextEdit();
        else onCancel();
      }}
      fullScreen
      PaperProps={{
        sx: {
          bgcolor: "#F4F5F7",
          backgroundImage: "none",
        },
      }}
    >
      {/* Top icon toolbar */}
      <Box
        sx={{
          flexShrink: 0,
          px: 1.5,
          py: 0.85,
          display: "flex",
          alignItems: "center",
          gap: 0.35,
          borderBottom: "1px solid",
          borderColor: "rgba(0,0,0,0.08)",
          bgcolor: "#fff",
        }}
      >
        {tools.map((t) => (
          <Tooltip key={t.id} title={t.label} arrow>
            <IconButton
              size="small"
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => {
                if (textEdit) cancelTextEdit();
                setTool(t.id);
              }}
              sx={toolBtnSx(tool === t.id)}
            >
              {t.icon}
            </IconButton>
          </Tooltip>
        ))}
        <Divider orientation="vertical" flexItem sx={{ mx: 0.75, my: 0.5 }} />
        <Tooltip title="Undo" arrow>
          <span>
            <IconButton
              size="small"
              disabled={!annotations.length || !!textEdit}
              aria-label="Undo"
              onClick={() => {
                setAnnotations((prev) => {
                  if (!prev.length) return prev;
                  const next = prev.slice(0, -1);
                  setRedoStack((r) => [...r, prev[prev.length - 1]!]);
                  return next;
                });
              }}
              sx={toolBtnSx(false)}
            >
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Redo" arrow>
          <span>
            <IconButton
              size="small"
              disabled={!redoStack.length || !!textEdit}
              aria-label="Redo"
              onClick={() => {
                setRedoStack((r) => {
                  if (!r.length) return r;
                  const last = r[r.length - 1]!;
                  setAnnotations((a) => [...a, last]);
                  return r.slice(0, -1);
                });
              }}
              sx={toolBtnSx(false)}
            >
              <RedoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Clear all" arrow>
          <span>
            <IconButton
              size="small"
              disabled={!annotations.length || !!textEdit}
              aria-label="Clear all"
              onClick={() => {
                setRedoStack((r) => [...r, ...annotations]);
                setAnnotations([]);
              }}
              sx={toolBtnSx(false)}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <DialogContent
        sx={{
          display: "flex",
          gap: 0,
          p: 0,
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* Left property sidebar */}
        <Stack
          spacing={2}
          sx={{
            width: 148,
            flexShrink: 0,
            px: 1.5,
            py: 2,
            borderRight: "1px solid",
            borderColor: "rgba(0,0,0,0.08)",
            bgcolor: "#fff",
            overflowY: "auto",
          }}
        >
          <Box>
            <Typography
              variant="caption"
              fontWeight={700}
              color="text.secondary"
              sx={{ letterSpacing: 0.3, display: "block", mb: 1 }}
            >
              Color
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {COLORS.map((c) => (
                <Box
                  key={c}
                  component="button"
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    bgcolor: c,
                    border: color === c ? `2px solid ${ACCENT}` : "1px solid rgba(0,0,0,0.12)",
                    boxShadow: c === "#FFFFFF" ? "inset 0 0 0 1px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    p: 0,
                    outline: color === c ? `2px solid ${ACCENT}33` : "none",
                    outlineOffset: 1,
                  }}
                />
              ))}
            </Stack>
          </Box>
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                Stroke
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {stroke}px
              </Typography>
            </Stack>
            <Slider
              size="small"
              min={1}
              max={12}
              value={stroke}
              onChange={(_, v) => setStroke(v as number)}
              sx={{
                color: ACCENT,
                "& .MuiSlider-thumb": { width: 14, height: 14 },
              }}
            />
          </Box>
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" mb={0.5}>
              <Typography variant="caption" fontWeight={700} color="text.secondary">
                Blur size
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {blurSize}px
              </Typography>
            </Stack>
            <Slider
              size="small"
              min={4}
              max={24}
              value={blurSize}
              onChange={(_, v) => setBlurSize(v as number)}
              sx={{
                color: ACCENT,
                "& .MuiSlider-thumb": { width: 14, height: 14 },
              }}
            />
          </Box>
          {status && (
            <Typography variant="caption" color="error">
              {status}
            </Typography>
          )}
        </Stack>

        {/* Canvas stage */}
        <Box
          flex={1}
          minWidth={0}
          display="flex"
          justifyContent="center"
          alignItems="center"
          sx={{ overflow: "auto", p: 3, bgcolor: "#F4F5F7" }}
        >
          <Box
            ref={wrapRef}
            sx={{
              position: "relative",
              display: "inline-block",
              lineHeight: 0,
              boxShadow: "0 10px 36px rgba(20,32,28,0.14)",
              borderRadius: 1,
              bgcolor: "#fff",
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                display: "block",
                maxWidth: "100%",
                cursor: textEdit ? "default" : tool === "select" ? "default" : "crosshair",
                borderRadius: 4,
              }}
              onMouseDown={onPointerDown}
              onMouseMove={onPointerMove}
              onMouseUp={onPointerUp}
              onMouseLeave={() => {
                if (!textEdit) onPointerUp();
              }}
            />
            {textEdit && (
              <Box
                sx={{
                  position: "absolute",
                  left: textEdit.left,
                  top: textEdit.top,
                  width: textEdit.width,
                  zIndex: 5,
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Box
                  component="input"
                  ref={textInputRef}
                  value={textEdit.value}
                  placeholder="Type label…"
                  onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitTextEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelTextEdit();
                    }
                  }}
                  sx={{
                    width: "100%",
                    boxSizing: "border-box",
                    px: 1,
                    py: 0.75,
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "system-ui, sans-serif",
                    color: color === "#FFFFFF" ? "#212121" : color,
                    bgcolor: "#fff",
                    border: `2px solid ${ACCENT}`,
                    borderRadius: 1,
                    outline: "none",
                    boxShadow: `0 0 0 3px ${ACCENT}22, 0 4px 14px rgba(0,0,0,0.12)`,
                    "&::placeholder": { color: "rgba(0,0,0,0.35)", fontWeight: 500 },
                  }}
                />
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          px: 2.5,
          py: 1.5,
          bgcolor: "#fff",
          borderTop: "1px solid",
          borderColor: "rgba(0,0,0,0.08)",
          gap: 1,
        }}
      >
        <Box flex={1} />
        <Button
          onClick={onCancel}
          disabled={busy}
          sx={{
            textTransform: "none",
            fontWeight: 700,
            color: ACCENT,
            border: "1px solid",
            borderColor: "rgba(15,107,92,0.35)",
            px: 2,
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleDone()}
          disabled={busy || !imageUrl}
          sx={{
            textTransform: "none",
            fontWeight: 700,
            bgcolor: ACCENT,
            px: 2.5,
            boxShadow: "none",
            "&:hover": { bgcolor: "#0c5a4d", boxShadow: "none" },
          }}
        >
          {busy ? "Saving…" : "Done"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
