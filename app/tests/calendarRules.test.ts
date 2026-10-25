import test from "node:test";
import assert from "node:assert";
import {
  canCreateKind,
  canEditItem,
  canMutateLiveState,
  dayKey,
  daysInMonth,
  isOwner,
  isPastDay,
  monthLabel,
  pad2,
  parseDay,
} from "../src/features/calendar/calendarRules.ts";

test("pad2 pads single digit", () => {
  assert.strictEqual(pad2(5), "05");
  assert.strictEqual(pad2(12), "12");
});

test("dayKey formats YYYY-MM-DD", () => {
  const d = new Date(2026, 9, 24); // Month is 0-indexed: 9 = October
  assert.strictEqual(dayKey(d), "2026-10-24");
});

test("daysInMonth handles leap years and different month lengths", () => {
  assert.strictEqual(daysInMonth(2024, 1), 29); // Feb 2024 (leap year)
  assert.strictEqual(daysInMonth(2025, 1), 28); // Feb 2025
  assert.strictEqual(daysInMonth(2026, 0), 31); // Jan
  assert.strictEqual(daysInMonth(2026, 3), 30); // Apr
});

test("isPastDay correctly compares days", () => {
  const today = "2026-10-24";
  assert.strictEqual(isPastDay("2026-10-23", today), true);
  assert.strictEqual(isPastDay("2026-10-24", today), false);
  assert.strictEqual(isPastDay("2026-10-25", today), false);
});

test("canCreateKind rules", () => {
  const today = "2026-10-24";
  // Future/today: all kinds allowed
  assert.strictEqual(canCreateKind("note", "2026-10-25", today), true);
  assert.strictEqual(canCreateKind("reminder", "2026-10-25", today), true);
  assert.strictEqual(canCreateKind("meeting", "2026-10-25", today), true);
  assert.strictEqual(canCreateKind("todo", "2026-10-25", today), true);

  // Past day: only note allowed
  assert.strictEqual(canCreateKind("note", "2026-10-20", today), true);
  assert.strictEqual(canCreateKind("reminder", "2026-10-20", today), false);
  assert.strictEqual(canCreateKind("meeting", "2026-10-20", today), false);
  assert.strictEqual(canCreateKind("todo", "2026-10-20", today), false);
});

test("canEditItem enforces owner and past-day freeze", () => {
  const today = "2026-10-24";
  const myId = "alice";
  const otherId = "bob";

  // Non-owner can never edit
  assert.strictEqual(canEditItem("note", "2026-10-25", otherId, myId, today), false);
  assert.strictEqual(canEditItem("reminder", "2026-10-25", otherId, myId, today), false);

  // Owner on today/future can edit
  assert.strictEqual(canEditItem("note", "2026-10-25", myId, myId, today), true);
  assert.strictEqual(canEditItem("reminder", "2026-10-25", myId, myId, today), true);
  assert.strictEqual(canEditItem("todo", "2026-10-25", myId, myId, today), true);

  // Owner on past day: only notes can be edited
  assert.strictEqual(canEditItem("note", "2026-10-20", myId, myId, today), true);
  assert.strictEqual(canEditItem("reminder", "2026-10-20", myId, myId, today), false);
  assert.strictEqual(canEditItem("meeting", "2026-10-20", myId, myId, today), false);
  assert.strictEqual(canEditItem("todo", "2026-10-20", myId, myId, today), false);
});

test("canMutateLiveState allows today and future only", () => {
  const today = "2026-10-24";
  assert.strictEqual(canMutateLiveState("2026-10-24", today), true);
  assert.strictEqual(canMutateLiveState("2026-10-25", today), true);
  assert.strictEqual(canMutateLiveState("2026-10-23", today), false);
});
