import { messageAttachmentIds } from "../../shared/messageMeta";
import { extOfName, formatBytes } from "../../shared/format";

export const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i;
export const VIDEO_RE = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;
export const DOC_RE = /\.(pdf|docx?|txt|rtf|odt|md|log|ini|cfg|json)$/i;
export const SPREADSHEET_RE = /\.(xlsx?|csv|ods|tsv)$/i;
export const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

export type MediaItem = {
  key: string;
  messageId: string;
  fileId: string;
  name: string;
  size: number;
  at: string;
  thumb?: string;
  isVideo: boolean;
  senderId: string;
  duration?: string;
};

export type FileItem = {
  key: string;
  messageId: string;
  fileId: string;
  name: string;
  ext: string;
  size: number;
  at: string;
  senderId: string;
  category: "documents" | "spreadsheets" | "others";
};

export type LinkItem = {
  key: string;
  messageId: string;
  url: string;
  title: string;
  domain: string;
  at: string;
  senderId: string;
};

export function formatFullDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.getDate();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${day} ${month} ${year}, ${String(h).padStart(2, "0")}:${m} ${ap}`;
}

export function formatTimeOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${m} ${ap}`;
}

export function getFileCategory(name: string): "documents" | "spreadsheets" | "others" {
  if (SPREADSHEET_RE.test(name)) return "spreadsheets";
  if (DOC_RE.test(name)) return "documents";
  return "others";
}

export function getFileThemeColor(ext: string): { bg: string; color: string } {
  const e = ext.toLowerCase();
  if (e === "pdf") return { bg: "rgba(239, 68, 68, 0.15)", color: "#EF4444" };
  if (["xlsx", "xls", "csv", "ods"].includes(e)) return { bg: "rgba(16, 185, 129, 0.15)", color: "#10B981" };
  if (["docx", "doc", "rtf"].includes(e)) return { bg: "rgba(59, 130, 246, 0.15)", color: "#3B82F6" };
  if (["txt", "md", "log", "json", "ini", "cfg"].includes(e)) return { bg: "rgba(148, 163, 184, 0.15)", color: "#94A3B8" };
  if (["zip", "rar", "7z", "tar", "gz"].includes(e)) return { bg: "rgba(245, 158, 11, 0.15)", color: "#F59E0B" };
  return { bg: "rgba(130, 169, 248, 0.15)", color: "#82A9F8" };
}

export function extractDomain(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return urlStr.split("/")[2] || urlStr;
  }
}

export function titleFromUrl(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) {
      return host.charAt(0).toUpperCase() + host.slice(1);
    }
    const last = parts[parts.length - 1].replace(/[-_]/g, " ").replace(/\.[a-z0-9]+$/i, "");
    const titleCased = last.charAt(0).toUpperCase() + last.slice(1);
    return `${titleCased} (${host})`;
  } catch {
    return urlStr;
  }
}

export function extractChatMediaFilesLinks(
  messages: any[],
  fileNames: Record<string, string>,
  fileSizes: Record<string, number>,
  fileThumbs: Record<string, string>,
  plain: Record<string, string>
): {
  media: MediaItem[];
  files: FileItem[];
  links: LinkItem[];
} {
  const media: MediaItem[] = [];
  const files: FileItem[] = [];
  const links: LinkItem[] = [];

  for (const m of messages) {
    if (m.kind === "deleted" || m.kind === "poll_vote") continue;

    // Attachments
    const fids = messageAttachmentIds(m);
    for (const fid of fids) {
      const name = fileNames[fid] || "File";
      const size = fileSizes[fid] || 0;
      const thumb = fileThumbs[fid];
      const isImg = IMAGE_RE.test(name);
      const isVid = VIDEO_RE.test(name);

      if (isImg || isVid) {
        media.push({
          key: `${m.id}:${fid}`,
          messageId: m.id,
          fileId: fid,
          name,
          size,
          at: m.created_at,
          thumb,
          isVideo: isVid,
          senderId: m.sender_id,
        });
      } else {
        files.push({
          key: `${m.id}:${fid}`,
          messageId: m.id,
          fileId: fid,
          name,
          ext: extOfName(name).toUpperCase() || "FILE",
          size,
          at: m.created_at,
          senderId: m.sender_id,
          category: getFileCategory(name),
        });
      }
    }

    // Links from plaintext
    if (m.kind !== "file_notice") {
      const body = plain[m.id] || "";
      const matches = body.match(URL_RE);
      if (matches) {
        for (let i = 0; i < matches.length; i++) {
          const url = matches[i];
          links.push({
            key: `${m.id}:link:${i}`,
            messageId: m.id,
            url,
            title: titleFromUrl(url),
            domain: extractDomain(url),
            at: m.created_at,
            senderId: m.sender_id,
          });
        }
      }
    }
  }

  return { media, files, links };
}
