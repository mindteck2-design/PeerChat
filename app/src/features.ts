// ─── PeerChat build-time feature flags ───────────────────────────────────────
//
// By default, games are disabled for public / internet builds.
// For intranet / enterprise builds with games enabled, set:
//   VITE_ENABLE_GAMES=true
// or run:
//   npm run build:intranet
//
// When false:
//   • Removes the UI completely (no sidebar tab, no settings section)
//   • Lets Vite/Rollup tree-shake the dead code out of the bundle
//   • Does NOT affect existing user data or SQLite settings
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Include the offline games section (Snake, 2048, Tetris, Tic-Tac-Toe, RPS, Dots & Boxes).
 * Controlled via environment variable VITE_ENABLE_GAMES="true".
 */
export const FEATURE_GAMES: boolean = import.meta.env?.VITE_ENABLE_GAMES === "true";
