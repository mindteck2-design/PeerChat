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
  meeting_url?: string | null;
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
    meeting_url: "",
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

export type KindTheme = {
  label: string;
  color: string;
  bg: string;
  border: string;
  accent: string;
};

export const KIND_THEMES: Record<CalendarKind, KindTheme> = {
  meeting: {
    label: "Meeting",
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.12)",
    border: "rgba(59, 130, 246, 0.35)",
    accent: "#60a5fa",
  },
  todo: {
    label: "To-Do",
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.12)",
    border: "rgba(6, 182, 212, 0.35)",
    accent: "#22d3ee",
  },
  reminder: {
    label: "Reminder",
    color: "#a855f7",
    bg: "rgba(168, 85, 247, 0.12)",
    border: "rgba(168, 85, 247, 0.35)",
    accent: "#c084fc",
  },
  note: {
    label: "Note",
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.12)",
    border: "rgba(245, 158, 11, 0.35)",
    accent: "#fbbf24",
  },
};
