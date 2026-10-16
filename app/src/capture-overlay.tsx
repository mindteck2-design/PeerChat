import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function sessionFromUrl(): string {
  const hash = (window.location.hash || "").replace(/^#/, "").trim();
  if (hash) return hash;
  const q = new URLSearchParams(window.location.search);
  return q.get("session") || "";
}

function CaptureOverlayApp() {
  const sessionId = useMemo(() => sessionFromUrl(), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragging = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!sessionId) setError("Missing capture session");
  }, [sessionId]);

  const cancel = useCallback(async () => {
    try {
      await invoke("cancel_screenshot_session", { sessionId: sessionId || null });
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  const finishRegion = useCallback(
    async (x0: number, y0: number, x1: number, y1: number) => {
      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const width = Math.abs(x1 - x0);
      const height = Math.abs(y1 - y0);
      if (width < 4 || height < 4) return;
      setBusy(true);
      setError(null);
      try {
        // Pass CSS viewport coords; Rust maps them onto the primary monitor's physical pixels.
        await invoke("complete_region_capture", {
          sessionId,
          x,
          y,
          width,
          height,
          viewWidth: window.innerWidth || 1,
          viewHeight: window.innerHeight || 1,
        });
      } catch (err: any) {
        setBusy(false);
        setError(err?.message || String(err));
      }
    },
    [sessionId]
  );

  const finishFull = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("complete_fullscreen_capture", { sessionId });
    } catch (err: any) {
      setBusy(false);
      setError(err?.message || String(err));
    }
  }, [sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  const sel = drag
    ? {
        left: Math.min(drag.x0, drag.x1),
        top: Math.min(drag.y0, drag.y1),
        width: Math.abs(drag.x1 - drag.x0),
        height: Math.abs(drag.y1 - drag.y0),
      }
    : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        cursor: busy ? "wait" : "crosshair",
        pointerEvents: busy ? "none" : "auto",
      }}
      onMouseDown={(e) => {
        if (busy || e.button !== 0) return;
        dragging.current = true;
        origin.current = { x: e.clientX, y: e.clientY };
        setDrag({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
      }}
      onMouseMove={(e) => {
        if (!dragging.current || !origin.current) return;
        setDrag({
          x0: origin.current.x,
          y0: origin.current.y,
          x1: e.clientX,
          y1: e.clientY,
        });
      }}
      onMouseUp={(e) => {
        if (!dragging.current || !origin.current) return;
        dragging.current = false;
        const ox = origin.current.x;
        const oy = origin.current.y;
        origin.current = null;
        setDrag(null);
        void finishRegion(ox, oy, e.clientX, e.clientY);
      }}
    >
      {sel && sel.width > 2 && sel.height > 2 && (
        <div
          style={{
            position: "absolute",
            left: sel.left,
            top: sel.top,
            width: sel.width,
            height: sel.height,
            border: "2px dashed #fff",
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
        />
      )}

      <div
        style={{
          position: "fixed",
          left: "50%",
          top: 24,
          transform: "translateX(-50%)",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          fontSize: 14,
          fontWeight: 600,
          textShadow: "0 1px 3px rgba(0,0,0,.6)",
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {busy ? "Capturing…" : "Drag to select an area · Esc to cancel"}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          void finishFull();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          zIndex: 11,
          border: 0,
          borderRadius: 8,
          padding: "10px 14px",
          background: busy ? "#666" : "#5b4dff",
          color: "#fff",
          fontWeight: 700,
          cursor: busy ? "wait" : "pointer",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Full screen
      </button>

      {error && (
        <div
          style={{
            position: "fixed",
            left: 20,
            bottom: 20,
            zIndex: 12,
            maxWidth: 420,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(120,20,20,0.92)",
            color: "#fff",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
          }}
        >
          {error}
          <button
            type="button"
            onClick={() => void cancel()}
            style={{
              marginLeft: 12,
              border: 0,
              background: "#fff",
              color: "#300",
              borderRadius: 6,
              padding: "4px 8px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<CaptureOverlayApp />);
}
