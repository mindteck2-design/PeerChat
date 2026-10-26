/**
 * Web Audio API synthesizer for incoming message notification sounds.
 * Generates an alert chime without external audio assets or network latency.
 */

let audioCtx: AudioContext | null = null;
let lastPlayedAt = 0;

export function playNotificationSound(force = false): void {
  try {
    const nowMs = Date.now();
    // Debounce rapid bursts: don't play more than once every 600ms unless forced
    if (!force && nowMs - lastPlayedAt < 600) {
      return;
    }
    lastPlayedAt = nowMs;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }

    const t = audioCtx.currentTime;

    // Tone 1: E5 (659.25 Hz)
    const osc1 = audioCtx.createOscillator();
    // Tone 2: A5 (880.00 Hz)
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(659.25, t);
    osc1.frequency.exponentialRampToValueAtTime(880, t + 0.12);

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(880, t + 0.08);

    // Envelope: quick attack to 0.22 volume, gentle decay over 350ms
    gainNode.gain.setValueAtTime(0.001, t);
    gainNode.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc1.start(t);
    osc1.stop(t + 0.35);
    osc2.start(t + 0.08);
    osc2.stop(t + 0.35);
  } catch (err) {
    console.warn("[Sound] Failed to play notification sound", err);
  }
}
