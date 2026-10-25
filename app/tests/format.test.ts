import test from "node:test";
import assert from "node:assert";
import {
  formatDay,
  avatarColor,
  formatClock,
  formatPreviewTime,
  truncate,
  conversationPreviewLine,
} from "../src/shared/format.ts";

test("truncate shortens strings correctly with ellipsis", () => {
  assert.strictEqual(truncate("hello world", 5), "hello…");
  assert.strictEqual(truncate("short", 10), "short");
  assert.strictEqual(truncate("", 5), "");
});

test("avatarColor generates deterministic color for names", () => {
  const c1 = avatarColor("Alice");
  const c2 = avatarColor("Alice");
  const c3 = avatarColor("Bob");

  assert.strictEqual(c1, c2);
  assert.match(c1, /^#[0-9A-Fa-f]{6}$/);
  assert.match(c3, /^#[0-9A-Fa-f]{6}$/);
});

test("formatDay labels today and yesterday", () => {
  const now = new Date();
  assert.strictEqual(formatDay(now.toISOString()), "Today");

  const yesterday = new Date(now.getTime() - 86400000);
  assert.strictEqual(formatDay(yesterday.toISOString()), "Yesterday");

  assert.strictEqual(formatDay("invalid-date"), "");
});

test("conversationPreviewLine formats file, system, and text messages", () => {
  assert.strictEqual(
    conversationPreviewLine("file_notice", "", "u1", "u2", "Bob", false),
    "📎 File"
  );
  assert.strictEqual(
    conversationPreviewLine("system", "Alice joined", "u1", "u2", "Alice", true),
    "Alice joined"
  );
  assert.strictEqual(
    conversationPreviewLine("text", "Hello!", "u1", "u1", "Me", false),
    "You: Hello!"
  );
  assert.strictEqual(
    conversationPreviewLine("text", "Hello!", "u1", "u2", "Bob", true),
    "Bob: Hello!"
  );
  assert.strictEqual(
    conversationPreviewLine("calendar_share", JSON.stringify({ title: "Team Sync" }), "u1", "u2", "Bob", false),
    "Calendar: Team Sync"
  );
});
