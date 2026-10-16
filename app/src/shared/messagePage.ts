import type { Message } from "../peer";

export const MESSAGE_PAGE_SIZE = 80;

function sortKey(m: Message): string {
  return (m.sort_at || m.created_at || "").trim();
}

/** True if `a` is strictly older than `b` in chat order. */
export function isOlderMessage(a: Message, b: Message): boolean {
  const ak = sortKey(a);
  const bk = sortKey(b);
  if (ak !== bk) return ak < bk;
  return a.id < b.id;
}

/** Keep older-than-window messages; replace/append the newest page by id. */
export function mergeNewestPage(prev: Message[], newest: Message[]): Message[] {
  if (!newest.length) return prev;
  const newestIds = new Set(newest.map((m) => m.id));
  const oldestNew = newest[0];
  const older = prev.filter(
    (m) => !newestIds.has(m.id) && isOlderMessage(m, oldestNew)
  );
  return [...older, ...newest];
}

/** Prepend an older page; dedupe by id. */
export function prependOlderPage(prev: Message[], older: Message[]): Message[] {
  if (!older.length) return prev;
  const existing = new Set(prev.map((m) => m.id));
  const fresh = older.filter((m) => !existing.has(m.id));
  return [...fresh, ...prev];
}

/** Replace a single message in-place (edit / delete / delivery). */
export function upsertMessage(prev: Message[], msg: Message): Message[] {
  const i = prev.findIndex((m) => m.id === msg.id);
  if (i < 0) {
    // New message at end if newer than last, else mergeNewest-style append.
    if (!prev.length || !isOlderMessage(msg, prev[prev.length - 1]!)) {
      return [...prev, msg];
    }
    return mergeNewestPage(prev, [msg]);
  }
  const next = prev.slice();
  next[i] = msg;
  return next;
}
