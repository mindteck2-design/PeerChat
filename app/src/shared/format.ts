import type { GameMsg } from "../games/games";

export function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatDay(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const colors = ["#0F6B5C", "#C45C26", "#2F6FED", "#7B5EA7", "#B45309", "#0E7490", "#BE185D"];
  return colors[h % colors.length];
}

export function formatClock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${m} ${ap}`;
}

/** WhatsApp-style relative time for conversation list rows. */
export function formatPreviewTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function truncate(s: string, n: number) {
  if (!s) return s;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function conversationPreviewLine(
  kind: string | null | undefined,
  decrypted: string,
  myId: string,
  senderId: string | null | undefined,
  senderLabel: string,
  isGroup: boolean
): string {
  if (!kind) return "";
  let body = decrypted;
  if (kind === "file_notice") return "📎 File";
  if (kind === "system") return body.trim() || "Group update";
  if (kind === "game_move") {
    try {
      const j = JSON.parse(decrypted) as GameMsg;
      const t = j?.payload?.type;
      const g =
        j?.game === "ttt"
          ? "Tic-Tac-Toe"
          : j?.game === "rps"
            ? "Rock Paper Scissors"
            : j?.game === "dab"
              ? "Dots & Boxes"
              : "Game";
      if (t === "invite") {
        body = senderId === myId ? `Game invite: ${g}` : `Invited you to ${g}`;
      } else if (t === "accept") body = `Accepted ${g}`;
      else if (t === "decline") body = `Declined ${g}`;
      else if (t === "result") body = `${g} finished`;
      else body = g;
    } catch {
      body = "Game";
    }
    const prefix =
      senderId === myId ? "You: " : isGroup && senderLabel ? `${senderLabel}: ` : "";
    return truncate(prefix + body, 80);
  }
  if (kind === "calendar_share") {
    try {
      const j = JSON.parse(decrypted) as { title?: string; kind?: string; type?: string };
      const title = (j.title || "Calendar item").trim();
      if (j.type === "deleted") {
        body =
          senderId === myId
            ? `Deleted calendar: ${title}`
            : `Calendar deleted: ${title}`;
      } else {
        body = senderId === myId ? `Shared: ${title}` : `Calendar: ${title}`;
      }
    } catch {
      body = "Calendar share";
    }
    const prefix =
      senderId === myId ? "You: " : isGroup && senderLabel ? `${senderLabel}: ` : "";
    return truncate(prefix + body, 80);
  }
  if (kind === "announcement" || kind === "poll" || kind === "snippet") {
    try {
      const j = JSON.parse(decrypted);
      if (kind === "poll") body = j.question || "Poll";
      else if (kind === "announcement") body = j.title || j.body || decrypted;
      else body = j.title || decrypted;
    } catch {
      body = decrypted;
    }
  }
  body = body.replace(/\s+/g, " ").trim();
  if (!body) body = kind === "forwarded" ? "Forwarded message" : "Message";
  const prefix =
    senderId === myId ? "You: " : isGroup && senderLabel ? `${senderLabel}: ` : "";
  return truncate(prefix + body, 80);
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function extOfName(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

export function mimeForName(name: string) {
  const ext = extOfName(name);
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    md: "text/markdown",
    log: "text/plain",
    html: "text/html",
    htm: "text/html",
    xml: "text/xml",
  };
  return (ext && types[ext]) || "application/octet-stream";
}

/** True when we can show an in-app preview (not zip/exe/archives/etc.). */
export function canPreviewFileName(name: string) {
  const ext = extOfName(name);
  if (!ext) return false;
  const previewable = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
    "pdf",
    "mp4", "webm", "mov", "mkv",
    "mp3", "wav", "ogg", "m4a",
    "txt", "csv", "json", "md", "log", "html", "htm", "xml",
  ]);
  return previewable.has(ext);
}

export function lastSeenLabel(iso?: string | null) {
  if (!iso) return "Offline";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Offline";
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return "Offline";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Offline · last seen just now";
  if (mins < 60) return `Offline · last seen ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Offline · last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Offline · last seen ${days}d ago`;
}

export function canMutateMessageToday(createdAt: string | null | undefined) {
  if (!createdAt) return false;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
