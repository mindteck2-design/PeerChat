import { invoke } from "@tauri-apps/api/core";

export type AppLogLevel = "info" | "warn" | "error" | "debug";

let cachedPath: string | null = null;
let installPromise: Promise<void> | null = null;

function stamp(level: AppLogLevel, message: string, detail?: unknown): string {
  const ts = new Date().toISOString();
  let extra = "";
  if (detail !== undefined) {
    try {
      extra =
        typeof detail === "string"
          ? ` ${detail}`
          : detail instanceof Error
            ? ` ${detail.stack || detail.message}`
            : ` ${JSON.stringify(detail)}`;
    } catch {
      extra = ` ${String(detail)}`;
    }
  }
  return `[${ts}] [${level.toUpperCase()}] ${message}${extra}`;
}

async function appendLine(line: string): Promise<void> {
  try {
    await invoke("append_app_log", { line });
  } catch {
    /* browser preview / before IPC ready — console still has it */
  }
}

export async function appLogPath(): Promise<string | null> {
  if (cachedPath) return cachedPath;
  try {
    cachedPath = await invoke<string>("app_log_path");
    return cachedPath;
  } catch {
    return null;
  }
}

export function appLog(level: AppLogLevel, message: string, detail?: unknown): void {
  const line = stamp(level, message, detail);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  void appendLine(line);
}

/** Install once: window errors + unhandled promise rejections → peerchat.log */
export function installAppLogging(): Promise<void> {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const path = await appLogPath();
    appLog("info", "PeerChat frontend logging started", path ? { path } : undefined);

    window.addEventListener("error", (ev) => {
      appLog(
        "error",
        "window.error",
        ev.error instanceof Error
          ? ev.error
          : `${ev.message} @ ${ev.filename}:${ev.lineno}:${ev.colno}`
      );
    });

    window.addEventListener("unhandledrejection", (ev) => {
      const reason = ev.reason;
      appLog(
        "error",
        "unhandledrejection",
        reason instanceof Error ? reason : reason
      );
    });
  })();
  return installPromise;
}
