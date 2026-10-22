// ─── PeerChat build-time feature flags ───────────────────────────────────────
//
// Edit this file before running  npm run tauri:build  to control which features
// are compiled into the binary.
//
// Setting a flag to false:
//   • Removes the UI completely (no sidebar tab, no settings section)
//   • Lets Vite/Rollup tree-shake the dead code out of the bundle
//   • Does NOT affect existing user data or SQLite settings
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Include the offline games section (Snake, 2048, Tic-Tac-Toe, RPS, Dots & Boxes).
 * Tetris is intentionally omitted from the ship catalog.
 * When true, games stay off until the user enables them in Settings
 * (`games_enabled`). Set to false to strip games from the build entirely.
 */
export const FEATURE_GAMES = true;
