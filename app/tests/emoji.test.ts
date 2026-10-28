import test from "node:test";
import assert from "node:assert/strict";
import {
  emojiOnlyCount,
  emojiOnlyFontSize,
  QUICK_REACTIONS,
  EMOJI_SET,
  STATIC_EMOJI_CATEGORIES,
  getRecentEmojis,
  saveRecentEmoji,
  DEFAULT_RECENT_EMOJIS,
} from "../src/emoji";

test("emojiOnlyCount detects 1-3 emojis correctly and rejects mixed text", () => {
  assert.equal(emojiOnlyCount("😀"), 1);
  assert.equal(emojiOnlyCount("😀 😃"), 2);
  assert.equal(emojiOnlyCount("😀 😃 😄"), 3);
  assert.equal(emojiOnlyCount("😀 😃 😄 😁"), null); // exceeds 3
  assert.equal(emojiOnlyCount("hello 😀"), null);
  assert.equal(emojiOnlyCount("123"), null);
  assert.equal(emojiOnlyCount(""), null);
});

test("emojiOnlyFontSize returns expected font size", () => {
  assert.equal(emojiOnlyFontSize(1), 36);
  assert.equal(emojiOnlyFontSize(3), 36);
});

test("QUICK_REACTIONS is preserved and contains compact reactions", () => {
  assert.deepEqual(QUICK_REACTIONS, ["👍", "❤️", "😂", "😮", "😢", "🙏"]);
});

test("categories include all required categories", () => {
  const ids = STATIC_EMOJI_CATEGORIES.map((c) => c.id);
  const expected = [
    "smileys",
    "people",
    "animals",
    "food",
    "activities",
    "travel",
    "objects",
    "symbols",
  ];
  assert.deepEqual(ids, expected);
});

test("EMOJI_SET contains substantial number of emojis across categories", () => {
  assert.ok(EMOJI_SET.length > 300, `Expected > 300 emojis, got ${EMOJI_SET.length}`);
  assert.ok(EMOJI_SET.includes("😀"));
  assert.ok(EMOJI_SET.includes("👍"));
  assert.ok(EMOJI_SET.includes("🐶"));
  assert.ok(EMOJI_SET.includes("🍕"));
  assert.ok(EMOJI_SET.includes("⚽"));
  assert.ok(EMOJI_SET.includes("🚗"));
  assert.ok(EMOJI_SET.includes("💡"));
  assert.ok(EMOJI_SET.includes("❤️"));
});

test("recent emojis fallback to defaults when storage empty and update correctly", () => {
  // Mock localStorage for test environment if undefined
  if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      length: 0,
    } as Storage;
  }

  localStorage.clear();
  assert.deepEqual(getRecentEmojis(), DEFAULT_RECENT_EMOJIS);

  const updated = saveRecentEmoji("🚀");
  assert.equal(updated[0], "🚀");
  assert.ok(getRecentEmojis().includes("🚀"));
});
