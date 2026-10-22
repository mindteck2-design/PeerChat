/** Local playtime helpers for Games (session clock + rematch streak). Not synced to peers. */

export const SESSION_LIMIT_SEC = 5 * 60;
export const MAX_LAN_STREAK = 3;

const TODAY_KEY = "peerchat.gamePlaytime.v1";
const STREAK_KEY = "peerchat.gameRematchStreak.v1";

function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type TodayStore = { date: string; seconds: number };

function loadToday(): TodayStore {
  try {
    const raw = localStorage.getItem(TODAY_KEY);
    if (!raw) return { date: localDateKey(), seconds: 0 };
    const parsed = JSON.parse(raw) as TodayStore;
    if (!parsed || typeof parsed.seconds !== "number") {
      return { date: localDateKey(), seconds: 0 };
    }
    if (parsed.date !== localDateKey()) return { date: localDateKey(), seconds: 0 };
    return parsed;
  } catch {
    return { date: localDateKey(), seconds: 0 };
  }
}

function saveToday(store: TodayStore) {
  try {
    localStorage.setItem(TODAY_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/** Seconds of playtime recorded today (local calendar day). */
export function getSecondsToday(): number {
  return loadToday().seconds;
}

/** Whole minutes played today (for hub display). */
export function getMinutesToday(): number {
  return Math.floor(getSecondsToday() / 60);
}

/** Add elapsed play seconds to today's total. */
export function addPlaySeconds(seconds: number) {
  if (seconds <= 0) return;
  const store = loadToday();
  store.seconds += Math.floor(seconds);
  saveToday(store);
}

type StreakStore = Record<string, number>;

function loadStreaks(): StreakStore {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StreakStore) : {};
  } catch {
    return {};
  }
}

function saveStreaks(store: StreakStore) {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/** Games completed / started in this LAN match streak (1 = first game). */
export function getLanStreak(matchId: string): number {
  if (!matchId) return 0;
  return loadStreaks()[matchId] || 0;
}

/** Call when a LAN match first becomes playing (invite accepted / start). */
export function ensureLanStreakStarted(matchId: string) {
  if (!matchId) return;
  const store = loadStreaks();
  if (!store[matchId]) {
    store[matchId] = 1;
    saveStreaks(store);
  }
}

/** Call when starting a rematch; returns false if already at max streak. */
export function tryIncrementLanStreak(matchId: string): boolean {
  if (!matchId) return false;
  const store = loadStreaks();
  const cur = store[matchId] || 1;
  if (cur >= MAX_LAN_STREAK) return false;
  store[matchId] = cur + 1;
  saveStreaks(store);
  return true;
}

export function canLanRematch(matchId: string): boolean {
  if (!matchId) return false;
  const cur = getLanStreak(matchId) || 1;
  return cur < MAX_LAN_STREAK;
}

/** Clear streak when leaving the match / starting a new invite. */
export function clearLanStreak(matchId: string) {
  if (!matchId) return;
  const store = loadStreaks();
  if (!(matchId in store)) return;
  delete store[matchId];
  saveStreaks(store);
}
