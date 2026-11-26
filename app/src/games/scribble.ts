/**
 * Scribble 1v1 — pure game logic + wire payloads.
 * Live ink uses ephemeral /v1/game-sync; match control uses encrypted game_move.
 */

export const SCRIBBLE_ROUND_SEC = 60;
export const SCRIBBLE_WIN_SCORE = 3;
export const SCRIBBLE_MAX_ROUNDS = 6;

export type ScribblePoint = { x: number; y: number }; // normalized 0–1

export type ScribbleSyncOp = "stroke" | "undo" | "clear";

/** Ephemeral LAN stroke payload (no secret word). */
export type ScribbleSyncPayload = {
  matchId: string;
  seq: number;
  op: ScribbleSyncOp;
  /** Normalized points for a stroke segment (op === "stroke"). */
  points?: ScribblePoint[];
  color?: string;
  width?: number;
  /** True when this batch starts a new stroke (pen down). */
  start?: boolean;
  user_id?: string;
};

export type ScribbleMsg =
  | { type: "invite"; matchId: string; fromName: string }
  | { type: "accept"; matchId: string }
  | { type: "decline"; matchId: string }
  | { type: "cancel"; matchId: string }
  | { type: "resign"; matchId: string }
  | { type: "rematch"; matchId: string }
  /** Drawer announces a round; word stays local to drawer. */
  | {
      type: "round_start";
      matchId: string;
      round: number;
      drawerId: string;
      timerSec: number;
    }
  /** Guesser confirms round_start arrived (drawer stops retrying). */
  | { type: "round_ack"; matchId: string; round: number }
  /** Guesser asks drawer to re-send the current round_start. */
  | { type: "round_query"; matchId: string }
  | { type: "guess"; matchId: string; text: string }
  | { type: "wrong"; matchId: string; text: string }
  | {
      type: "correct";
      matchId: string;
      word: string;
      myScore: number;
      theirScore: number;
      round: number;
    }
  | {
      type: "timeout";
      matchId: string;
      word: string;
      myScore: number;
      theirScore: number;
      round: number;
    }
  | { type: "clear"; matchId: string }
  | { type: "result"; matchId: string; winnerId: string | null };

export type ScribblePhase =
  | "lobby"
  | "drawing"
  | "round_over"
  | "match_over";

export type ScribbleState = {
  round: number;
  /** User id of current drawer (empty until round_start). */
  drawerId: string;
  myScore: number;
  theirScore: number;
  phase: ScribblePhase;
  /** Secret word — only set on the drawer locally. */
  word: string;
  /** Revealed after correct/timeout. */
  revealedWord: string;
  lastWrong: string;
  endsAt: number | null;
};

export function newScribbleState(): ScribbleState {
  return {
    round: 0,
    drawerId: "",
    myScore: 0,
    theirScore: 0,
    phase: "lobby",
    word: "",
    revealedWord: "",
    lastWrong: "",
    endsAt: null,
  };
}

/** Normalize guess for comparison. */
export function normalizeGuess(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function guessMatches(word: string, guess: string): boolean {
  return normalizeGuess(word) === normalizeGuess(guess) && normalizeGuess(word).length > 0;
}

export function isMatchOver(myScore: number, theirScore: number, round: number): boolean {
  if (myScore >= SCRIBBLE_WIN_SCORE || theirScore >= SCRIBBLE_WIN_SCORE) return true;
  return round >= SCRIBBLE_MAX_ROUNDS;
}

/** Winner from my perspective once the match is over; null = draw. */
export function matchWinnerId(opts: {
  myId: string;
  opponentId: string;
  myScore: number;
  theirScore: number;
}): string | null {
  if (opts.myScore > opts.theirScore) return opts.myId;
  if (opts.theirScore > opts.myScore) return opts.opponentId;
  return null;
}

/** Compact points: drop near-duplicates in normalized space (~2px on 500px canvas). */
export function downsamplePoints(
  points: ScribblePoint[],
  minDist = 0.004
): ScribblePoint[] {
  if (points.length <= 2) return points;
  const out: ScribblePoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (dx * dx + dy * dy >= minDist * minDist) out.push(p);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push(last);
  return out;
}

export function quantizePoint(p: ScribblePoint): ScribblePoint {
  return {
    x: Math.round(p.x * 100) / 100,
    y: Math.round(p.y * 100) / 100,
  };
}

const WORD_BANK = [
  "apple", "airplane", "anchor", "ant", "arrow", "astronaut",
  "balloon", "banana", "basketball", "battery", "beach", "bear", "bed", "bee",
  "bicycle", "bird", "boat", "book", "bottle", "bow", "box", "bridge", "broom",
  "bucket", "butterfly", "button", "cactus", "cake", "camera", "candle", "candy",
  "cannon", "canoe", "carrot", "cat", "chair", "cheese", "cherry", "chicken",
  "chimney", "circle", "clock", "cloud", "coat", "coffee", "compass", "cookie",
  "crab", "crayon", "crown", "cup", "diamond", "dinosaur", "dog", "dolphin",
  "donut", "door", "dragon", "drum", "duck", "eagle", "ear", "earth", "egg",
  "elephant", "envelope", "eye", "feather", "fence", "fire", "fish", "flag",
  "flower", "flute", "football", "fork", "frog", "ghost", "giraffe", "glasses",
  "globe", "glove", "goat", "guitar", "hammer", "hat", "heart", "helicopter",
  "helmet", "hill", "hockey", "hook", "horse", "house", "iceberg", "igloo",
  "island", "jacket", "jellyfish", "kangaroo", "key", "kite", "knife", "ladder",
  "lamp", "leaf", "lemon", "lightbulb", "lion", "lipstick", "lizard", "lock",
  "lollipop", "magnet", "mailbox", "map", "medal", "microphone", "mirror",
  "monkey", "moon", "mountain", "mouse", "mushroom", "nail", "needle", "nest",
  "nose", "octopus", "onion", "orange", "owl", "paintbrush", "panda", "pants",
  "paperclip", "parrot", "peach", "peacock", "pear", "pencil", "penguin",
  "piano", "pig", "pillow", "pineapple", "pizza", "planet", "plant", "plate",
  "pocket", "pool", "pretzel", "pumpkin", "pyramid", "rabbit", "rainbow",
  "refrigerator", "rhinoceros", "ring", "robot", "rocket", "ruler", "sailboat",
  "sandwich", "satellite", "saxophone", "scissors", "scooter", "scorpion",
  "screwdriver", "seahorse", "seal", "shark", "sheep", "shoe", "shovel",
  "skateboard", "skeleton", "skull", "snail", "snake", "snowflake", "snowman",
  "soap", "sock", "spider", "spoon", "squirrel", "stairs", "star", "stethoscope",
  "strawberry", "submarine", "sun", "sunglasses", "sweater", "swing", "sword",
  "syringe", "table", "taco", "teapot", "telephone", "telescope", "tennis",
  "tent", "tiger", "toast", "toothbrush", "tornado", "tractor", "train", "tree",
  "triangle", "trombone", "truck", "trumpet", "turtle", "umbrella", "unicorn",
  "vacuum", "vase", "violin", "volcano", "waffle", "wagon", "watch", "watermelon",
  "whale", "wheel", "whistle", "window", "wolf", "zebra", "zipper",
];

let lastWord = "";

export function pickWord(): string {
  if (WORD_BANK.length === 0) return "cat";
  let word = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
  // Avoid immediate repeat.
  if (word === lastWord && WORD_BANK.length > 1) {
    word = WORD_BANK[Math.floor(Math.random() * WORD_BANK.length)];
  }
  lastWord = word;
  return word;
}

export const SCRIBBLE_COLORS = [
  "#212121",
  "#E53935",
  "#FB8C00",
  "#FDD835",
  "#43A047",
  "#1E88E5",
  "#8E24AA",
  "#FFFFFF",
] as const;

export const SCRIBBLE_WIDTHS = [2, 4, 8] as const;
