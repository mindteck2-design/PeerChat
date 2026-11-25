/**
 * High-performance Scribble canvas: local ink is instant; outbound strokes are batched.
 */

import { useCallback, useEffect, useRef } from "react";
import { Box } from "@mui/material";
import {
  downsamplePoints,
  quantizePoint,
  type ScribblePoint,
  type ScribbleSyncPayload,
} from "./scribble";

export type ScribbleStrokeBatch = {
  points: ScribblePoint[];
  color: string;
  width: number;
  start: boolean;
};

type Props = {
  canDraw: boolean;
  color: string;
  width: number;
  /** Bump to clear both layers. */
  clearTick: number;
  /** Bump to undo last local completed stroke (drawer only). */
  undoTick: number;
  onStrokeBatch: (batch: ScribbleStrokeBatch) => void;
  onUndo: () => void;
  onClear: () => void;
  /** Register inbound sync applicator (ephemeral channel). */
  inboundRef: React.MutableRefObject<((payload: ScribbleSyncPayload) => void) | null>;
};

const BATCH_MS = 50;
const BATCH_POINTS = 12;

function strokeLine(
  ctx: CanvasRenderingContext2D,
  points: ScribblePoint[],
  color: string,
  width: number,
  w: number,
  h: number
) {
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x * w, points[0].y * h);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * w, points[i].y * h);
  }
  if (points.length === 1) {
    ctx.lineTo(points[0].x * w + 0.01, points[0].y * h);
  }
  ctx.stroke();
}

export function ScribbleCanvas({
  canDraw,
  color,
  width,
  clearTick,
  undoTick,
  onStrokeBatch,
  onUndo,
  onClear,
  inboundRef,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const strokeStart = useRef(true);
  const pending = useRef<ScribblePoint[]>([]);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localStrokes = useRef<{ points: ScribblePoint[]; color: string; width: number }[]>([]);
  const remoteStrokes = useRef<{ points: ScribblePoint[]; color: string; width: number }[]>([]);
  const remoteOpen = useRef<{ points: ScribblePoint[]; color: string; width: number } | null>(
    null
  );
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });
  const colorRef = useRef(color);
  const widthRef = useRef(width);
  const onBatchRef = useRef(onStrokeBatch);
  colorRef.current = color;
  widthRef.current = width;
  onBatchRef.current = onStrokeBatch;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#FAFAFA";
    ctx.fillRect(0, 0, w, h);
    for (const s of remoteStrokes.current) strokeLine(ctx, s.points, s.color, s.width, w, h);
    if (remoteOpen.current) {
      const s = remoteOpen.current;
      strokeLine(ctx, s.points, s.color, s.width, w, h);
    }
    for (const s of localStrokes.current) strokeLine(ctx, s.points, s.color, s.width, w, h);
  }, []);

  const resize = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    sizeRef.current = { w, h, dpr };
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    redraw();
  }, [redraw]);

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(() => resize());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [resize]);

  const flushBatch = useCallback(() => {
    if (batchTimer.current) {
      clearTimeout(batchTimer.current);
      batchTimer.current = null;
    }
    if (pending.current.length === 0) return;
    const pts = downsamplePoints(pending.current).map(quantizePoint);
    pending.current = pts.length ? [pts[pts.length - 1]] : [];
    const start = strokeStart.current;
    strokeStart.current = false;
    if (pts.length < 1) return;
    onBatchRef.current({
      points: pts,
      color: colorRef.current,
      width: widthRef.current,
      start,
    });
  }, []);

  const scheduleBatch = useCallback(() => {
    if (batchTimer.current) return;
    batchTimer.current = setTimeout(() => {
      batchTimer.current = null;
      flushBatch();
    }, BATCH_MS);
  }, [flushBatch]);

  const normFromEvent = (e: React.PointerEvent): ScribblePoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!canDraw) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokeStart.current = true;
    const p = normFromEvent(e);
    if (!p) return;
    pending.current = [p];
    localStrokes.current.push({
      points: [p],
      color: colorRef.current,
      width: widthRef.current,
    });
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current || !canDraw) return;
    const p = normFromEvent(e);
    if (!p) return;
    const stroke = localStrokes.current[localStrokes.current.length - 1];
    if (stroke) {
      const last = stroke.points[stroke.points.length - 1];
      const dx = (p.x - last.x) * sizeRef.current.w;
      const dy = (p.y - last.y) * sizeRef.current.h;
      if (dx * dx + dy * dy < 4) return;
      stroke.points.push(p);
    }
    pending.current.push(p);
    redraw();
    if (pending.current.length >= BATCH_POINTS) flushBatch();
    else scheduleBatch();
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    flushBatch();
    pending.current = [];
  };

  useEffect(() => {
    localStrokes.current = [];
    remoteStrokes.current = [];
    remoteOpen.current = null;
    pending.current = [];
    redraw();
  }, [clearTick, redraw]);

  useEffect(() => {
    if (!undoTick) return;
    if (localStrokes.current.length === 0) return;
    localStrokes.current.pop();
    redraw();
    onUndo();
  }, [undoTick, redraw, onUndo]);

  useEffect(() => {
    inboundRef.current = (payload: ScribbleSyncPayload) => {
      if (payload.op === "clear") {
        remoteStrokes.current = [];
        remoteOpen.current = null;
        localStrokes.current = [];
        redraw();
        return;
      }
      if (payload.op === "undo") {
        if (remoteOpen.current) remoteOpen.current = null;
        else if (remoteStrokes.current.length) remoteStrokes.current.pop();
        redraw();
        return;
      }
      if (payload.op === "stroke" && payload.points && payload.points.length) {
        const color = payload.color || "#212121";
        const w = payload.width || 4;
        if (payload.start || !remoteOpen.current) {
          if (remoteOpen.current && remoteOpen.current.points.length > 1) {
            remoteStrokes.current.push(remoteOpen.current);
          }
          remoteOpen.current = { points: [...payload.points], color, width: w };
        } else {
          const open = remoteOpen.current;
          // Skip first point if it duplicates the last (overlap from batching).
          const startIdx =
            open.points.length &&
            payload.points[0].x === open.points[open.points.length - 1].x &&
            payload.points[0].y === open.points[open.points.length - 1].y
              ? 1
              : 0;
          for (let i = startIdx; i < payload.points.length; i++) {
            open.points.push(payload.points[i]);
          }
        }
        redraw();
      }
    };
    return () => {
      inboundRef.current = null;
    };
  }, [inboundRef, redraw]);

  // Silence unused onClear — parent handles authoritative clear via clearTick + game_move.
  void onClear;

  return (
    <Box
      ref={wrapRef}
      sx={{
        width: "100%",
        height: "100%",
        minHeight: 280,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        overflow: "hidden",
        bgcolor: "#FAFAFA",
        touchAction: "none",
        cursor: canDraw ? "crosshair" : "default",
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        onPointerLeave={endStroke}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </Box>
  );
}
