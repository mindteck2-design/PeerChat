import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  decryptFilename,
  decryptMessage,
  exportPublic,
  unwrapContentKey,
  type Identity,
} from "../../crypto";
import { peerApi, type Conversation, type Message, type Profile } from "../../peer";
import { appLog } from "../../shared/appLog";
import { messageAttachmentIds } from "../../shared/messageMeta";

/** Persistent in-memory plaintext cache across renders & conversation toggles */
const plaintextCache = new Map<string, string>();

/** Message ids waiting on transient decrypt failures (missing wrap / key / peer pub). */
const pendingRetry = new Map<string, number>();

const UNABLE = "[unable to decrypt]";

export function getCachedPlaintext(messageId: string): string | undefined {
  return plaintextCache.get(messageId);
}

/** Seed plaintext for an outgoing (or known) message so UI never flashes "…". */
export function cachePlaintext(messageId: string, text: string): void {
  if (!messageId || text == null || text === "") return;
  plaintextCache.set(messageId, text);
  pendingRetry.delete(messageId);
}

export function seedPlainFromCache(messages: Message[]): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const m of messages) {
    if (plaintextCache.has(m.id)) {
      patch[m.id] = plaintextCache.get(m.id)!;
    }
  }
  return patch;
}

/** Fingerprint the loaded window (all rows — DM lists can mix related conversation ids). */
function messageFingerprint(messages: Message[]): string {
  if (!messages.length) return "0";
  let n = 0;
  let last = "";
  let wrapBits = 0;
  for (const m of messages) {
    n += 1;
    last = m.id;
    // Include a cheap wrap/ciphertext signal so late-hydrated crypto fields retrigger decrypt.
    const wraps = m.wrapped_keys;
    if (wraps && typeof wraps === "object") wrapBits += Object.keys(wraps).length;
    else if (typeof wraps === "string") wrapBits += wraps.length;
    wrapBits += (m.ciphertext || "").length & 0xff;
  }
  return `${n}:${last}:${wrapBits}`;
}

function keyEpoch(keys: Record<string, Uint8Array>, convId: string | undefined): string {
  if (!convId) return "none";
  const k = keys[convId];
  if (!k || k.byteLength < 4) return "missing";
  return `${k[0]}-${k[1]}-${k[2]}-${k[3]}-${k.byteLength}`;
}

/** Tauri/SQLite sometimes resurface wrapped_keys as a JSON string. */
function normalizeWrappedKeys(
  raw: Message["wrapped_keys"]
): Record<string, { eph_pub: string; nonce: string; wrapped: string }> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return {};
    }
    return {};
  }
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as any;
  return {};
}

function isTransientDecryptError(reason: string): boolean {
  return /no wrapped key|no group key|waiting for group key|missing signature|invalid message signature/i.test(
    reason
  );
}

/** Builds plaintext + filename maps for the active conversation (loaded window only). */
export function useMessageDecrypt(opts: {
  active: Conversation | null;
  messages: Message[];
  groupKeys: Record<string, Uint8Array>;
  groupKeyHistory: Record<string, Uint8Array[]>;
  peers: { user_id: string; ed25519_public?: string }[];
  profile: Profile;
  identity: Identity;
  fileNames: Record<string, string>;
  fileSizes: Record<string, number>;
  decryptGroupMessageText: (m: Message) => Promise<string>;
  ensureGroupKey?: (convId: string) => Promise<Uint8Array | null>;
  setPlain: Dispatch<SetStateAction<Record<string, string>>>;
  setFileNames: Dispatch<SetStateAction<Record<string, string>>>;
  setFileSizes: Dispatch<SetStateAction<Record<string, number>>>;
  setFileLocalPaths?: Dispatch<SetStateAction<Record<string, string>>>;
  /** Marks attachment ids whose local_path presence has been queried (avoids Download flash). */
  setFileMetaReady?: Dispatch<SetStateAction<Record<string, true>>>;
}) {
  const {
    active,
    messages,
    groupKeys,
    groupKeyHistory,
    peers,
    profile,
    identity,
    fileNames,
    fileSizes,
    decryptGroupMessageText,
    ensureGroupKey,
    setPlain,
    setFileNames,
    setFileSizes,
    setFileLocalPaths,
    setFileMetaReady,
  } = opts;

  const peersRef = useRef(peers);
  peersRef.current = peers;
  const decryptGroupRef = useRef(decryptGroupMessageText);
  decryptGroupRef.current = decryptGroupMessageText;
  const ensureGroupKeyRef = useRef(ensureGroupKey);
  ensureGroupKeyRef.current = ensureGroupKey;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const profileIdRef = useRef(profile.id);
  profileIdRef.current = profile.id;
  const groupKeysRef = useRef(groupKeys);
  groupKeysRef.current = groupKeys;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);

  const activeId = active?.id;
  const activeKind = active?.kind;
  const msgFp = messageFingerprint(messages);
  const gkEpoch = keyEpoch(groupKeys, activeId);
  const histLen = activeId ? (groupKeyHistory[activeId]?.length ?? 0) : 0;

  // Paint-time hydrate from cache so chat switches do not flash "…" for known plaintext.
  useLayoutEffect(() => {
    if (!activeId) return;
    // IMPORTANT: do not filter by conversation_id — DM windows include related/legacy ids.
    const patch = seedPlainFromCache(messages);
    const ids = Object.keys(patch);
    if (!ids.length) return;
    setPlain((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        if (next[id] !== patch[id]) {
          next[id] = patch[id]!;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeId, msgFp, messages, setPlain]);

  useEffect(() => {
    const generation = Symbol("decrypt");
    const convIdAtStart = activeId;
    const kindAtStart = activeKind;
    // Always decrypt the full loaded window (includes dm_related legacy conversation rows).
    const messagesSnapshot = messagesRef.current;

    const commitPlain = (patch: Record<string, string>) => {
      const ids = Object.keys(patch);
      if (!ids.length) return;
      for (const id of ids) {
        const text = patch[id]!;
        // Cache successful decrypts including empty bodies so we do not spin forever.
        // Never cache UNABLE — allow retry when keys/wraps arrive later.
        if (text !== UNABLE) {
          plaintextCache.set(id, text);
          pendingRetry.delete(id);
        }
      }
      setPlain((prev) => ({ ...prev, ...patch }));
    };

    const scheduleRetry = (why: string) => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      const attempt = retryAttemptRef.current;
      const delay = Math.min(6_000, 300 * Math.pow(1.5, attempt));
      retryAttemptRef.current = attempt + 1;
      appLog("info", "[Decrypt:schedule_retry]", {
        conversation_id: convIdAtStart,
        why,
        attempt,
        delay_ms: delay,
      });
      retryTimerRef.current = setTimeout(() => {
        setRetryTick((n) => n + 1);
      }, delay);
    };

    (async () => {
      if (!convIdAtStart || !kindAtStart) return;

      const instant = seedPlainFromCache(messagesSnapshot);
      if (Object.keys(instant).length) {
        commitPlain(instant);
      }

      let gk =
        kindAtStart === "group" ? groupKeysRef.current[convIdAtStart] : undefined;
      if (kindAtStart === "group" && !gk && ensureGroupKeyRef.current) {
        try {
          const loaded = await ensureGroupKeyRef.current(convIdAtStart);
          if (loaded) gk = loaded;
        } catch (err) {
          appLog("warn", "[Decrypt:ensure_group_key_err]", {
            conversation_id: convIdAtStart,
            member_id: profileIdRef.current,
            err: String(err),
          });
        }
      }

      if (kindAtStart === "group" && !gk) {
        const pending = messagesSnapshot.filter(
          (m) => m.kind !== "file_notice" && m.kind !== "deleted" && !plaintextCache.has(m.id)
        );
        for (const m of pending) pendingRetry.set(m.id, (pendingRetry.get(m.id) || 0) + 1);
        appLog("info", "[Decrypt:waiting_group_key]", {
          conversation_id: convIdAtStart,
          member_id: profileIdRef.current,
          pending_count: pending.length,
          sample_ids: pending.slice(0, 6).map((m) => m.id),
          sample_conv_ids: pending.slice(0, 6).map((m) => m.conversation_id),
        });
        scheduleRetry("missing_group_key");
        return;
      }

      const toDecrypt = messagesSnapshot.filter(
        (m) => m.kind !== "file_notice" && m.kind !== "deleted" && !plaintextCache.has(m.id)
      );

      if (toDecrypt.length === 0) {
        retryAttemptRef.current = 0;
        return;
      }

      // Log when loaded rows use a different conversation_id than the open chat (DM legacy).
      const mismatched = toDecrypt.filter((m) => m.conversation_id !== convIdAtStart);
      if (mismatched.length) {
        appLog("info", "[Decrypt:related_conversation_rows]", {
          active_id: convIdAtStart,
          mismatched: mismatched.slice(0, 8).map((m) => ({
            message_id: m.id,
            conversation_id: m.conversation_id,
            sender_id: m.sender_id,
          })),
        });
      }

      appLog("info", "[Decrypt:start]", {
        conversation_id: convIdAtStart,
        kind: kindAtStart,
        member_id: profileIdRef.current,
        count: toDecrypt.length,
        key_epoch: gkEpoch,
        hist_len: histLen,
        generation: String(generation),
      });

      let transientFails = 0;
      const batchSize = 10;
      for (let i = 0; i < toDecrypt.length; i += batchSize) {
        const chunk = toDecrypt.slice(i, i + batchSize);
        const patch: Record<string, string> = {};
        await Promise.all(
          chunk.map(async (m) => {
            try {
              let text = "";
              if (kindAtStart === "group" && gk) {
                text = await decryptGroupRef.current(m);
              } else {
                let senderPub =
                  m.sender_id === profileIdRef.current
                    ? exportPublic(identityRef.current).ed25519_public
                    : peersRef.current.find((p) => p.user_id === m.sender_id)?.ed25519_public;
                if (!senderPub && m.sender_id !== profileIdRef.current) {
                  try {
                    const all = await peerApi.listPeers();
                    const found = all.find((p) => p.user_id === m.sender_id);
                    if (found?.ed25519_public) senderPub = found.ed25519_public;
                  } catch {
                    /* ignore */
                  }
                }
                const wrapped = normalizeWrappedKeys(m.wrapped_keys);
                text = await decryptMessage(
                  { ...m, wrapped_keys: wrapped },
                  profileIdRef.current,
                  identityRef.current,
                  senderPub
                );
              }
              if (!text) {
                // Empty plaintext is valid but must not block retries if crypto was incomplete.
                appLog("warn", "[Decrypt:empty_plaintext]", {
                  conversation_id: m.conversation_id,
                  message_id: m.id,
                  sender_id: m.sender_id,
                });
              }
              patch[m.id] = text;
              pendingRetry.delete(m.id);
              appLog("debug", "[Decrypt:ok]", {
                conversation_id: m.conversation_id,
                active_id: convIdAtStart,
                message_id: m.id,
                sender_id: m.sender_id,
                len: text.length,
              });
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              const attempts = (pendingRetry.get(m.id) || 0) + 1;
              pendingRetry.set(m.id, attempts);
              if (isTransientDecryptError(reason) && attempts < 8) {
                transientFails += 1;
                appLog("warn", "[Decrypt:transient_fail]", {
                  conversation_id: m.conversation_id,
                  active_id: convIdAtStart,
                  message_id: m.id,
                  sender_id: m.sender_id,
                  attempt: attempts,
                  reason,
                  wrap_keys:
                    m.wrapped_keys && typeof m.wrapped_keys === "object"
                      ? Object.keys(m.wrapped_keys as object)
                      : typeof m.wrapped_keys,
                });
                return;
              }
              appLog("error", "[Decrypt:fail]", {
                conversation_id: m.conversation_id,
                active_id: convIdAtStart,
                message_id: m.id,
                sender_id: m.sender_id,
                attempt: attempts,
                reason,
              });
              patch[m.id] = UNABLE;
            }
          })
        );
        commitPlain(patch);
      }

      // Still-undecrypted rows in this window → keep retrying (do not depend on another send).
      const stillPending = messagesSnapshot.filter(
        (m) =>
          m.kind !== "file_notice" &&
          m.kind !== "deleted" &&
          !plaintextCache.has(m.id) &&
          pendingRetry.has(m.id)
      );
      if (transientFails > 0 || stillPending.length > 0) {
        scheduleRetry(
          transientFails > 0 ? "transient_decrypt_errors" : "undecrypted_rows_remain"
        );
      } else {
        retryAttemptRef.current = 0;
      }
    })();
  }, [
    activeId,
    activeKind,
    msgFp,
    gkEpoch,
    histLen,
    messages,
    retryTick,
    setPlain,
  ]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [activeId]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const m of messages) {
        if (m.kind === "deleted") continue;
        for (const fid of messageAttachmentIds(m)) {
          if (seen.has(fid)) continue;
          if (!fileNames[fid] || fileSizes[fid] == null) {
            seen.add(fid);
            ids.push(fid);
          } else {
            seen.add(fid);
          }
        }
      }
      const pathCheck: string[] = [];
      for (const m of messages) {
        if (m.kind === "deleted") continue;
        for (const fid of messageAttachmentIds(m)) {
          if (!pathCheck.includes(fid)) pathCheck.push(fid);
        }
      }
      const batch = Array.from(new Set([...ids, ...pathCheck])).slice(0, 200);
      if (!batch.length) return;
      try {
        const files = await peerApi.getFiles(batch);
        if (cancel) return;
        const nextNames: Record<string, string> = {};
        const nextSizes: Record<string, number> = {};
        const nextPaths: Record<string, string> = {};
        const clearPaths: string[] = [];
        for (const file of files) {
          const fid = file.id;
          if (file.wrapped_keys && file.filename_nonce && file.enc_filename && !fileNames[fid]) {
            try {
              const key = unwrapContentKey(file.wrapped_keys, profile.id, identity);
              nextNames[fid] = decryptFilename(key, file.filename_nonce, file.enc_filename);
            } catch (err) {
              console.error("filename", fid, err);
            }
          }
          const sz = Number(file.size_bytes);
          if (Number.isFinite(sz) && sz > 0 && fileSizes[fid] == null) nextSizes[fid] = sz;
          if (file.local_path_present && file.local_path) {
            nextPaths[fid] = file.local_path;
          } else {
            clearPaths.push(fid);
          }
        }
        if (Object.keys(nextNames).length) {
          setFileNames((prev) => ({ ...prev, ...nextNames }));
        }
        if (Object.keys(nextSizes).length) {
          setFileSizes((prev) => ({ ...prev, ...nextSizes }));
        }
        if (setFileLocalPaths) {
          setFileLocalPaths((prev) => {
            const next = { ...prev, ...nextPaths };
            for (const fid of clearPaths) delete next[fid];
            return next;
          });
        }
        if (setFileMetaReady) {
          const ready: Record<string, true> = {};
          for (const fid of batch) ready[fid] = true;
          setFileMetaReady((prev) => ({ ...prev, ...ready }));
        }
      } catch (err) {
        console.error("getFiles", err);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [
    messages,
    active?.id,
    fileNames,
    fileSizes,
    identity,
    profile.id,
    setFileNames,
    setFileSizes,
    setFileLocalPaths,
    setFileMetaReady,
  ]);
}
