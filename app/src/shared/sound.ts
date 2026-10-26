/**
 * Web Audio API synthesizer for incoming message notification sounds.
 * Generates alert chimes without external audio assets.
 */

export const NOTIFICATION_SOUND_OPTIONS = [
  { id: "chime", label: "Chime", hint: "Bright two-tone alert" },
  { id: "ping", label: "Ping", hint: "Short single blip" },
  { id: "soft", label: "Soft", hint: "Gentle low pulse" },
  { id: "bright", label: "Bright", hint: "Crisp high sparkle" },
] as const;

export type NotificationSoundId = (typeof NOTIFICATION_SOUND_OPTIONS)[number]["id"];

const SOUND_IDS = new Set<string>(NOTIFICATION_SOUND_OPTIONS.map((o) => o.id));

let audioCtx: AudioContext | null = null;
let lastPlayedAt = 0;

/** True when the stored pref should play a sound (not off). */
export function isNotificationSoundEnabled(pref: string | null | undefined): boolean {
  return normalizeNotificationSoundId(pref) != null;
}

/**
 * Map stored setting → preset id, or null when off.
 * Legacy: "0"/"off" → off, "1" → chime.
 */
export function normalizeNotificationSoundId(
  pref: string | null | undefined
): NotificationSoundId | null {
  const v = (pref || "").trim();
  if (!v || v === "0" || v === "off") return null;
  if (v === "1") return "chime";
  if (SOUND_IDS.has(v)) return v as NotificationSoundId;
  return "chime";
}

function getCtx(): AudioContext | null {
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx || audioCtx.state === "closed") {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    void audioCtx.resume();
  }
  return audioCtx;
}

function playTone(
  ctx: AudioContext,
  opts: {
    freq: number;
    endFreq?: number;
    type?: OscillatorType;
    start?: number;
    duration: number;
    peak?: number;
  }
) {
  const t0 = ctx.currentTime + (opts.start || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type || "sine";
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.endFreq != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(opts.endFreq, 1), t0 + opts.duration * 0.85);
  }
  const peak = opts.peak ?? 0.2;
  gain.gain.setValueAtTime(0.001, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + opts.duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + opts.duration + 0.02);
}

function playPreset(ctx: AudioContext, id: NotificationSoundId) {
  switch (id) {
    case "ping":
      playTone(ctx, { freq: 1046.5, endFreq: 880, type: "sine", duration: 0.18, peak: 0.2 });
      break;
    case "soft":
      playTone(ctx, { freq: 392, endFreq: 330, type: "triangle", duration: 0.42, peak: 0.14 });
      playTone(ctx, {
        freq: 494,
        endFreq: 392,
        type: "sine",
        start: 0.06,
        duration: 0.38,
        peak: 0.1,
      });
      break;
    case "bright":
      playTone(ctx, { freq: 1174.7, endFreq: 1568, type: "sine", duration: 0.16, peak: 0.18 });
      playTone(ctx, {
        freq: 1568,
        endFreq: 2093,
        type: "triangle",
        start: 0.1,
        duration: 0.2,
        peak: 0.12,
      });
      break;
    case "chime":
    default:
      playTone(ctx, { freq: 659.25, endFreq: 880, type: "sine", duration: 0.28, peak: 0.2 });
      playTone(ctx, {
        freq: 880,
        type: "triangle",
        start: 0.08,
        duration: 0.28,
        peak: 0.14,
      });
      break;
  }
}

/** Play a notification preset. `force` bypasses the debounce. */
export function playNotificationSound(id: NotificationSoundId, force = false): void {
  try {
    const nowMs = Date.now();
    if (!force && nowMs - lastPlayedAt < 600) return;
    lastPlayedAt = nowMs;
    const ctx = getCtx();
    if (!ctx) return;
    playPreset(ctx, id);
  } catch (err) {
    console.warn("[Sound] Failed to play notification sound", err);
  }
}

/** Play from a raw app_settings value (handles off / legacy "1"). */
export function playNotificationSoundFromPref(
  pref: string | null | undefined,
  force = false
): void {
  const id = normalizeNotificationSoundId(pref);
  if (!id) return;
  playNotificationSound(id, force);
}
