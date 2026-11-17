// ─── PeerChat build-time feature flags ───────────────────────────────────────
//
// Release builds (CI + .env.production) ship with games enabled.
// To omit games from a local bundle, set:
//   VITE_ENABLE_GAMES=false
//
// When false:
//   • Removes the UI completely (no sidebar tab, no settings section)
//   • Lets Vite/Rollup tree-shake the dead code out of the bundle
//   • Does NOT affect existing user data or SQLite settings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Include the offline games section (Snake, 2048, Tetris, Tic-Tac-Toe, RPS, Dots & Boxes).
 * Controlled via environment variable VITE_ENABLE_GAMES (true in production/CI).
 */
export const FEATURE_GAMES: boolean = import.meta.env?.VITE_ENABLE_GAMES === "true";
