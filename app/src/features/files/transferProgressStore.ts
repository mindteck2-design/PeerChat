import { useSyncExternalStore } from "react";
import type { IncomingFileState, OutgoingFileState } from "../../shared/transferTypes";

type Snap = {
  incoming: IncomingFileState | null;
  outgoing: OutgoingFileState | null;
};

let snap: Snap = { incoming: null, outgoing: null };
const listeners = new Set<() => void>();
let lastEmit = 0;
let pending: Snap | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function emitNow(next: Snap) {
  snap = next;
  listeners.forEach((l) => l());
}

/** Throttle UI progress updates (~8 Hz) while applying final states immediately. */
export function publishTransferProgress(partial: Partial<Snap>, force = false) {
  const next: Snap = {
    incoming: partial.incoming !== undefined ? partial.incoming : snap.incoming,
    outgoing: partial.outgoing !== undefined ? partial.outgoing : snap.outgoing,
  };
  const doneish =
    force ||
    next.incoming?.cancelled ||
    next.outgoing?.cancelled ||
    next.incoming?.paused ||
    next.outgoing?.paused ||
    !next.incoming ||
    !next.outgoing;
  if (doneish) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
    emitNow(next);
    return;
  }
  pending = next;
  const now = Date.now();
  const wait = Math.max(0, 120 - (now - lastEmit));
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    lastEmit = Date.now();
    if (pending) emitNow(pending);
    pending = null;
  }, wait);
}

export function getTransferProgress() {
  return snap;
}

export function subscribeTransferProgress(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTransferProgress(): Snap {
  return useSyncExternalStore(subscribeTransferProgress, getTransferProgress, getTransferProgress);
}

export function useIncomingTransfer(): IncomingFileState | null {
  return useTransferProgress().incoming;
}

export function useOutgoingTransfer(): OutgoingFileState | null {
  return useTransferProgress().outgoing;
}
