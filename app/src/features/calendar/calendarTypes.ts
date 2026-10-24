import type { CalendarKind } from "../../peer";

export type ChecklistOption = {
  id: string;
  label: string;
  /** User ids who currently have this option checked. */
  checked_by: string[];
  /** Per-user last toggle time (ISO) for last-write-wins sync. */
  check_at?: Record<string, string>;
};

export type AcksMap = Record<string, string>;

export type CalendarDraft = {
  id?: string;
  title: string;
  body: string;
  kind: CalendarKind;
  day: string;
  time: string;
  participant_ids: string[];
  created_by?: string;
  done: boolean;
  checklist: ChecklistOption[];
  acks: AcksMap;
  shared?: boolean;
};

export function emptyDraft(day: string): CalendarDraft {
  return {
    title: "",
    body: "",
    kind: "note",
    day,
    time: "",
    participant_ids: [],
    done: false,
    checklist: [],
    acks: {},
    shared: false,
  };
}

export function newChecklistOption(label = ""): ChecklistOption {
  return {
    id: crypto.randomUUID(),
    label,
    checked_by: [],
    check_at: {},
  };
}

export function parseChecklist(raw: unknown): ChecklistOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ChecklistOption[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const label = typeof o.label === "string" ? o.label : "";
    if (!id) continue;
    const checked_by = Array.isArray(o.checked_by)
      ? o.checked_by.filter((x): x is string => typeof x === "string")
      : [];
    const check_at =
      o.check_at && typeof o.check_at === "object" && !Array.isArray(o.check_at)
        ? (o.check_at as Record<string, string>)
        : {};
    out.push({ id, label, checked_by, check_at });
  }
  return out;
}

export function parseAcks(raw: unknown): AcksMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AcksMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

export const CALENDAR_KINDS: { value: CalendarKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "reminder", label: "Reminder" },
  { value: "meeting", label: "Meeting" },
  { value: "todo", label: "To-do" },
];
