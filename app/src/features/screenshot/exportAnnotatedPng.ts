import type { Annotation, Point } from "./annotationModel";
import { normalizeRect } from "./annotationModel";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load capture preview"));
    img.src = url;
  });
}

function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, color: string, stroke: number) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.max(10, stroke * 3.5);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = stroke;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - ux * head - uy * head * 0.45, to.y - uy * head + ux * head * 0.45);
  ctx.lineTo(to.x - ux * head + uy * head * 0.45, to.y - uy * head - ux * head * 0.45);
  ctx.closePath();
  ctx.fill();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  stroke: number
) {
  const label = (text || "").trim() || "Text";
  const fontSize = Math.max(14, stroke * 4);
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  const metrics = ctx.measureText(label);
  const padX = 8;
  const padY = 5;
  const tw = metrics.width + padX * 2;
  const th = fontSize + padY * 2;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, stroke * 0.6);
  const rx = 4;
  ctx.beginPath();
  ctx.moveTo(x + rx, y);
  ctx.arcTo(x + tw, y, x + tw, y + th, rx);
  ctx.arcTo(x + tw, y + th, x, y + th, rx);
  ctx.arcTo(x, y + th, x, y, rx);
  ctx.arcTo(x, y, x + tw, y, rx);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(label, x + padX, y + padY + fontSize * 0.8);
}

function pixelateRegion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  block: number
) {
  if (w < 2 || h < 2) return;
  const sw = Math.max(1, Math.floor(w / block));
  const sh = Math.max(1, Math.floor(h / block));
  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  const tctx = tmp.getContext("2d");
  if (!tctx) return;
  tctx.imageSmoothingEnabled = false;
  tctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
  ctx.imageSmoothingEnabled = true;
}

function paintAnnotation(ctx: CanvasRenderingContext2D, a: Annotation) {
  if (a.type === "pen") {
    if (a.points.length < 2) return;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = a.stroke;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.points[0]!.x, a.points[0]!.y);
    for (let i = 1; i < a.points.length; i++) ctx.lineTo(a.points[i]!.x, a.points[i]!.y);
    ctx.stroke();
    return;
  }
  if (a.type === "arrow" || a.type === "arrow_text") {
    drawArrow(ctx, a.from, a.to, a.color, a.stroke);
    if (a.type === "arrow_text" && a.text.trim()) {
      const midX = (a.from.x + a.to.x) / 2;
      const midY = (a.from.y + a.to.y) / 2;
      drawLabel(ctx, a.text, midX + 8, midY - 18, a.color, a.stroke);
    }
    return;
  }
  if (a.type === "rect" || a.type === "rect_text" || a.type === "highlight") {
    const { x, y, w, h } = normalizeRect(a.from, a.to);
    if (a.type === "highlight") {
      ctx.fillStyle = a.color.length === 7 ? `${a.color}55` : a.color;
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.stroke;
      ctx.strokeRect(x, y, w, h);
      if (a.type === "rect_text" && a.text.trim()) {
        drawLabel(ctx, a.text, x, y + h + 6, a.color, a.stroke);
      }
    }
    return;
  }
  if (a.type === "circle") {
    const { x, y, w, h } = normalizeRect(a.from, a.to);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = a.stroke;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (a.type === "text") {
    ctx.fillStyle = a.color;
    ctx.font = `700 ${Math.max(14, a.stroke * 4)}px system-ui, sans-serif`;
    ctx.fillText(a.text || "Text", a.at.x, a.at.y);
    return;
  }
  if (a.type === "blur") {
    const { x, y, w, h } = normalizeRect(a.from, a.to);
    pixelateRegion(ctx, x, y, w, h, Math.max(4, a.stroke * 2));
  }
}

/** Flatten base image + annotations to PNG bytes (image-space coordinates). */
export async function exportAnnotatedPng(
  imageUrl: string,
  annotations: Annotation[],
  naturalW: number,
  naturalH: number
): Promise<Uint8Array> {
  const img = await loadImage(imageUrl);
  let crop = annotations.filter((a) => a.type === "crop").pop() as
    | Extract<Annotation, { type: "crop" }>
    | undefined;
  const drawList = annotations.filter((a) => a.type !== "crop");

  const canvas = document.createElement("canvas");
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, naturalW, naturalH);
  for (const a of drawList) paintAnnotation(ctx, a);

  let out: HTMLCanvasElement = canvas;
  if (crop) {
    const { x, y, w, h } = normalizeRect(crop.from, crop.to);
    const cw = Math.max(1, Math.round(w));
    const ch = Math.max(1, Math.round(h));
    const cx = Math.max(0, Math.round(x));
    const cy = Math.max(0, Math.round(y));
    const cropped = document.createElement("canvas");
    cropped.width = Math.min(cw, naturalW - cx);
    cropped.height = Math.min(ch, naturalH - cy);
    const cctx = cropped.getContext("2d");
    if (!cctx) throw new Error("Canvas unavailable");
    cctx.drawImage(canvas, cx, cy, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    out = cropped;
  }

  const blob: Blob = await new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png");
  });
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

export function paintPreview(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  annotations: Annotation[],
  draft: Annotation | null,
  scale: number
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  // Annotations stored in natural image coords; canvas is scaled.
  ctx.scale(scale, scale);
  for (const a of annotations) {
    if (a.type === "crop") continue;
    paintAnnotation(ctx, a);
  }
  if (draft && draft.type !== "crop") paintAnnotation(ctx, draft);
  if (draft?.type === "crop" || annotations.some((a) => a.type === "crop")) {
    const c = draft?.type === "crop" ? draft : annotations.filter((a) => a.type === "crop").pop();
    if (c && c.type === "crop") {
      const { x, y, w, h } = normalizeRect(c.from, c.to);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
      ctx.clearRect(x, y, w, h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / scale;
      ctx.setLineDash([6 / scale, 4 / scale]);
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }
  ctx.restore();
}
