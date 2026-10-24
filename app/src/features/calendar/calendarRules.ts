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

/** Past days: only notes may be created. Today and future: all kinds. */
export function canCreateKind(kind: CalendarKind, day: string, today = todayKey()) {
  if (!isPastDay(day, today)) return true;
  return kind === "note";
}

/**
 * Past reminder/todo/meeting are frozen (view-only).
 * Notes on past days remain editable. Today+future always editable by owner/participants for content.
 */
export function canEditItem(kind: CalendarKind, day: string, today = todayKey()) {
  if (!isPastDay(day, today)) return true;
  return kind === "note";
}

/** Ack / checklist toggles only on today and future. */
export function canMutateLiveState(day: string, today = todayKey()) {
  return !isPastDay(day, today);
}

export function monthLabel(y: number, m: number) {
  return new Date(y, m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

export function daysInMonth(y: number, m: number) {
  return new Date(y, m + 1, 0).getDate();
}
