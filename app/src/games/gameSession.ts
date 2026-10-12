import type { TttState } from "./ttt";
import type { RpsState, MatchFormat, RpsChoice } from "./rps";
import type { DabState } from "./dab";

export type MpPhase = "idle" | "inviting" | "invited" | "playing" | "done";

export type TttSession = {
  mode: "lan";
  mpPhase: MpPhase;
  opponentId: string;
  opponentName: string;
  myRole: "X" | "O";
  matchId: string;
  state: TttState;
  seq: number;
  inboundInvite: { fromId: string; matchId: string } | null;
  mpError: string;
};

export type RpsSession = {
  mode: "lan";
  mpPhase: MpPhase;
  opponentId: string;
  opponentName: string;
  matchId: string;
  format: MatchFormat;
  state: RpsState;
  myChoice: RpsChoice | null;
  theyCommitted: boolean;
  theirReveal: RpsChoice | null;
  inboundInvite: { fromId: string; matchId: string; format: MatchFormat } | null;
  mpError: string;
};

export type DabSession = {
  mode: "lan";
  mpPhase: MpPhase;
  opponentId: string;
  opponentName: string;
  myPlayer: "A" | "B";
  matchId: string;
  state: DabState;
  seq: number;
  rows: number;
  cols: number;
  inboundInvite: { fromId: string; matchId: string; rows: number; cols: number } | null;
  mpError: string;
};

type Store = {
  ttt?: TttSession;
  rps?: RpsSession;
  dab?: DabSession;
};

const store: Store = {};

export function getTttSession(): TttSession | undefined {
  return store.ttt;
}
export function setTttSession(s: TttSession | null) {
  if (s && s.mpPhase !== "idle") store.ttt = s;
  else delete store.ttt;
}

export function getRpsSession(): RpsSession | undefined {
  return store.rps;
}
export function setRpsSession(s: RpsSession | null) {
  if (s && s.mpPhase !== "idle") store.rps = s;
  else delete store.rps;
}

export function getDabSession(): DabSession | undefined {
  return store.dab;
}
export function setDabSession(s: DabSession | null) {
  if (s && s.mpPhase !== "idle") store.dab = s;
  else delete store.dab;
}

export function sessionBadge(
  game: "ttt" | "rps" | "dab"
): string | null {
  const s =
    game === "ttt" ? store.ttt : game === "rps" ? store.rps : store.dab;
  if (!s) return null;
  if (s.mpPhase === "inviting") return "Waiting…";
  if (s.mpPhase === "invited") return "Invite";
  if (s.mpPhase === "playing") return "In progress";
  if (s.mpPhase === "done") return "Finished";
  return null;
}

// ─── History ─────────────────────────────────────────────────────────────────

const HISTORY_KEY = "peerchat.gameHistory.v1";
const HISTORY_MAX = 40;

export type GameHistoryEntry = {
  id: string;
  game: "ttt" | "rps" | "dab";
  at: string;
  opponentName: string;
  opponentId: string;
  outcome: "win" | "lose" | "draw";
  detail?: string;
};

export function loadGameHistory(): GameHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function pushGameHistory(entry: {
  game: "ttt" | "rps" | "dab";
  opponentName: string;
  opponentId: string;
  outcome: "win" | "lose" | "draw";
  detail?: string;
  matchId?: string;
}) {
  const list = loadGameHistory();
  const id = entry.matchId || `${entry.game}-${Date.now()}`;
  // Avoid duplicate result rows for the same match.
  if (list.some((x) => x.id === id)) return;
  list.unshift({
    id,
    game: entry.game,
    at: new Date().toISOString(),
    opponentName: entry.opponentName,
    opponentId: entry.opponentId,
    outcome: entry.outcome,
    detail: entry.detail,
  });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
}

export function clearGameHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

export function gameLabel(game: "ttt" | "rps" | "dab"): string {
  if (game === "ttt") return "Tic-Tac-Toe";
  if (game === "rps") return "Rock Paper Scissors";
  return "Dots & Boxes";
}
