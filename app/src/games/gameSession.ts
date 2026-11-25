import type { TttState } from "./ttt";
import type { RpsState, MatchFormat, RpsChoice } from "./rps";
import type { DabState } from "./dab";
import type { ScribbleState } from "./scribble";

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

export type ScribbleSession = {
  mode: "lan";
  mpPhase: MpPhase;
  opponentId: string;
  opponentName: string;
  matchId: string;
  /** Inviter draws round 1. */
  iAmInviter: boolean;
  state: ScribbleState;
  seq: number;
  inboundInvite: { fromId: string; matchId: string } | null;
  mpError: string;
};

type Store = {
  ttt?: TttSession;
  rps?: RpsSession;
  dab?: DabSession;
  scribble?: ScribbleSession;
};

const STORE_KEY = "peerchat.gameSessions.v1";
const SESSION_EVENT = "peerchat-game-sessions";

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function notifySessionListeners() {
  try {
    window.dispatchEvent(new Event(SESSION_EVENT));
  } catch {
    /* ignore */
  }
}

function persistStore(store: Store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota */
  }
  notifySessionListeners();
}

const store: Store = loadStore();

/** Games hub / screens re-read badges when invite/leave clears a session from chat. */
export function subscribeGameSessions(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
}

export function getTttSession(): TttSession | undefined {
  return store.ttt;
}
export function setTttSession(s: TttSession | null) {
  if (s && s.mpPhase !== "idle") store.ttt = s;
  else delete store.ttt;
  persistStore(store);
}

export function getRpsSession(): RpsSession | undefined {
  return store.rps;
}
export function setRpsSession(s: RpsSession | null) {
  if (s && s.mpPhase !== "idle") store.rps = s;
  else delete store.rps;
  persistStore(store);
}

export function getDabSession(): DabSession | undefined {
  return store.dab;
}
export function setDabSession(s: DabSession | null) {
  if (s && s.mpPhase !== "idle") store.dab = s;
  else delete store.dab;
  persistStore(store);
}

export function getScribbleSession(): ScribbleSession | undefined {
  return store.scribble;
}
export function setScribbleSession(s: ScribbleSession | null) {
  if (s && s.mpPhase !== "idle") store.scribble = s;
  else delete store.scribble;
  persistStore(store);
}

/**
 * Drop inviting/invited rows for a match (invite deleted or canceled).
 * Leaves in-progress / finished matches alone.
 */
export function clearPendingMatch(matchId: string): boolean {
  if (!matchId) return false;
  let cleared = false;
  const pending = (phase: MpPhase) => phase === "inviting" || phase === "invited";
  if (store.ttt && store.ttt.matchId === matchId && pending(store.ttt.mpPhase)) {
    delete store.ttt;
    cleared = true;
  }
  if (store.rps && store.rps.matchId === matchId && pending(store.rps.mpPhase)) {
    delete store.rps;
    cleared = true;
  }
  if (store.dab && store.dab.matchId === matchId && pending(store.dab.mpPhase)) {
    delete store.dab;
    cleared = true;
  }
  if (store.scribble && store.scribble.matchId === matchId && pending(store.scribble.mpPhase)) {
    delete store.scribble;
    cleared = true;
  }
  if (cleared) persistStore(store);
  return cleared;
}

/** Drop any session for this matchId (leave mid-game / force reset). */
export function clearMatchSessions(matchId: string): boolean {
  if (!matchId) return false;
  let cleared = false;
  if (store.ttt?.matchId === matchId) {
    delete store.ttt;
    cleared = true;
  }
  if (store.rps?.matchId === matchId) {
    delete store.rps;
    cleared = true;
  }
  if (store.dab?.matchId === matchId) {
    delete store.dab;
    cleared = true;
  }
  if (store.scribble?.matchId === matchId) {
    delete store.scribble;
    cleared = true;
  }
  if (cleared) persistStore(store);
  return cleared;
}

export function sessionBadge(
  game: "ttt" | "rps" | "dab" | "scribble"
): string | null {
  const s =
    game === "ttt"
      ? store.ttt
      : game === "rps"
        ? store.rps
        : game === "dab"
          ? store.dab
          : store.scribble;
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
  game: "ttt" | "rps" | "dab" | "scribble";
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
  game: "ttt" | "rps" | "dab" | "scribble";
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

export function gameLabel(game: "ttt" | "rps" | "dab" | "scribble"): string {
  if (game === "ttt") return "Tic-Tac-Toe";
  if (game === "rps") return "Rock Paper Scissors";
  if (game === "scribble") return "Scribble";
  return "Dots & Boxes";
}
