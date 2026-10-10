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
 * Set to false for deployments where teams do not want games.
 * Runtime setting "games_enabled" in Settings still works independently
 * when this is true — it lets individual users toggle without a rebuild.
 */
export const FEATURE_GAMES = true;
