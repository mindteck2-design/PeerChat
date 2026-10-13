import { getVersion } from "@tauri-apps/api/app";

/** Fallback when not running inside Tauri (vite preview). Keep in sync with package.json. */
export const APP_VERSION_FALLBACK = "0.4.2";

let cached: string | null = null;

export async function appVersion(): Promise<string> {
  if (cached) return cached;
  try {
    cached = await getVersion();
  } catch {
    cached = APP_VERSION_FALLBACK;
  }
  return cached;
}
