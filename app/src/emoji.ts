/**
 * WhatsApp-style: message is only emoji(s), 1–3 graphemes → large, no bubble.
 * Returns emoji count, or null if this should render as a normal text bubble.
 */
export function emojiOnlyCount(text: string, max = 3): number | null {
  const t = text.trim();
  if (!t) return null;
  // Reject obvious non-emoji text early (letters/digits/URLs).
  if (/[A-Za-z0-9@#$%&=<>/\\_]/.test(t)) return null;
  let segments: string[];
  try {
    segments = [
      ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t),
    ]
      .map((s) => s.segment)
      .filter((s) => s.trim().length > 0);
  } catch {
    // Fallback: rough code-point split (worse for ZWJ, but rare).
    segments = Array.from(t).filter((s) => s.trim().length > 0);
  }
  if (segments.length < 1 || segments.length > max) return null;
  // Each grapheme must contain an emoji pictograph / regional indicator (flags).
  const emojiBit =
    /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}]/u;
  for (const s of segments) {
    if (!emojiBit.test(s)) return null;
  }
  return segments.length;
}

/** Font size (px) for large emoji-only bubbles (same size for 1–3). */
export function emojiOnlyFontSize(_count: number): number {
  return 36;
}

/** Curated emoji set for the PeerTalk picker. */
export const EMOJI_SET = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
  "🙂", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚", "😋",
  "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔", "🤐",
  "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌",
  "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮", "🤧",
  "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓", "🧐",
  "😕", "😟", "🙁", "😮", "😯", "😲", "😳", "🥺", "😦", "😧",
  "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞", "😓",
  "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿", "💀",
  "👍", "👎", "👊", "✊", "🤛", "🤜", "👏", "🙌", "👐", "🤲",
  "🤝", "🙏", "✍️", "💪", "🦾", "🦵", "🦶", "👂", "👃", "🧠",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
  "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "☮️",
  "✅", "❌", "⭐", "🌟", "💯", "🔥", "🎉", "🎊", "🎈", "🎁",
  "🍕", "🍔", "🍟", "☕", "🍺", "🍷", "🎂", "🍪", "🍩", "🍎",
];

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
