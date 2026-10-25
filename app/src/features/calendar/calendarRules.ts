import type { CalendarKind } from "../../peer";

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey() {
  return dayKey(new Date());
}

export function parseDay(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isPastDay(day: string, today = todayKey()) {
  return day < today;
}

export function isOwner(createdBy: string | undefined, myId: string) {
  return !!createdBy && createdBy === myId;
}

/** Past days: only notes may be created. Today and future: all kinds. */
export function canCreateKind(kind: CalendarKind, day: string, today = todayKey()) {
  if (!isPastDay(day, today)) return true;
  return kind === "note";
}

/**
 * Content edit/delete: owner only.
 * Past reminder/todo/meeting stay frozen even for owner; notes on past days remain editable by owner.
 */
export function canEditItem(
  kind: CalendarKind,
  day: string,
  createdBy: string | undefined,
  myId: string,
  today = todayKey()
) {
  if (!isOwner(createdBy, myId)) return false;
  if (!isPastDay(day, today)) return true;
  return kind === "note";
}

/** Audience (and owner) may ack / check on today and future only. */
export function canMutateLiveState(day: string, today = todayKey()) {
  return !isPastDay(day, today);
}

export function monthLabel(y: number, m: number) {
  return new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

export function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}

/** Format HH:mm (24-hour) to hh:mm AM/PM (12-hour). */
export function formatTime12(time?: string | null): string {
  if (!time || !time.trim()) return "";
  const parts = time.trim().split(":");
  if (parts.length < 2) return time.trim();
  const hour = parseInt(parts[0], 10);
  const min = parts[1];
  if (isNaN(hour)) return time.trim();
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${pad2(h12)}:${min} ${ampm}`;
}
