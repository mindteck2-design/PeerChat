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

/** Pending decrypts that failed only because the group key was not ready yet. */
const pendingMissingKey = new Set<string>();

export function getCachedPlaintext(messageId: string): string | undefined {
  return plaintextCache.get(messageId);
}

/** Seed plaintext for an outgoing (or known) message so UI never flashes "…". */
export function cachePlaintext(messageId: string, text: string): void {
  if (!messageId || text == null) return;
  plaintextCache.set(messageId, text);
  pendingMissingKey.delete(messageId);
}

export function seedPlainFromCache(
  messages: Message[],
  conversationId: string
): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const m of messages) {
    if (m.conversation_id === conversationId && plaintextCache.has(m.id)) {
      patch[m.id] = plaintextCache.get(m.id)!;
    }
  }
  return patch;
}

function messageFingerprint(messages: Message[], conversationId: string): string {
  let n = 0;
  let last = "";
  for (const m of messages) {
    if (m.conversation_id !== conversationId) continue;
    n += 1;
    last = m.id;
  }
  return `${n}:${last}`;
}

function keyEpoch(keys: Record<string, Uint8Array>, convId: string | undefined): string {
  if (!convId) return "none";
  const k = keys[convId];
  if (!k || k.byteLength < 4) return "missing";
  return `${k[0]}-${k[1]}-${k[2]}-${k[3]}-${k.byteLength}`;
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

  // Stable refs so peer/online churn and callback identity do not cancel in-flight decrypts.
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
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const [retryTick, setRetryTick] = useState(0);

  const activeId = active?.id;
  const activeKind = active?.kind;
  const msgFp = activeId ? messageFingerprint(messages, activeId) : "";
  const gkEpoch = keyEpoch(groupKeys, activeId);
  const histLen = activeId ? (groupKeyHistory[activeId]?.length ?? 0) : 0;

  // Paint-time hydrate from cache so chat switches do not flash "…" for known plaintext.
  useLayoutEffect(() => {
    if (!activeId) return;
    const patch = seedPlainFromCache(messages, activeId);
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
    // Snapshot ids so concurrent message merges don't drop work mid-flight.
    const messagesSnapshot = messages;

    const commitPlain = (patch: Record<string, string>) => {
      const ids = Object.keys(patch);
      if (!ids.length) return;
      // Always commit successful plaintext — never drop it because a newer effect started.
      for (const id of ids) {
        const text = patch[id]!;
        if (text && text !== "[unable to decrypt]") {
          plaintextCache.set(id, text);
          pendingMissingKey.delete(id);
        }
      }
      setPlain((prev) => ({ ...prev, ...patch }));
    };

    (async () => {
      if (!convIdAtStart || !activeKind) return;

      const instant = seedPlainFromCache(messagesSnapshot, convIdAtStart);
      if (Object.keys(instant).length) {
        commitPlain(instant);
      }

      let gk =
        activeKind === "group" ? groupKeysRef.current[convIdAtStart] : undefined;
      if (activeKind === "group" && !gk && ensureGroupKeyRef.current) {
        try {
          const loaded = await ensureGroupKeyRef.current(convIdAtStart);
          if (loaded) gk = loaded;
        } catch (err) {
          appLog("warn", "[GroupCrypto:decrypt:ensure_err]", {
            group_id: convIdAtStart,
            member_id: profileIdRef.current,
            err: String(err),
          });
        }
      }

      // Never abort after awaits due to messages/peers churn — commitPlain is merge-safe.

      if (activeKind === "group" && !gk) {
        const pending = messagesSnapshot.filter(
          (m) =>
            m.conversation_id === convIdAtStart &&
            m.kind !== "file_notice" &&
            m.kind !== "deleted" &&
            !plaintextCache.has(m.id)
        );
        for (const m of pending) pendingMissingKey.add(m.id);
        appLog("info", "[GroupCrypto:decrypt:waiting_key]", {
          group_id: convIdAtStart,
          member_id: profileIdRef.current,
          pending_count: pending.length,
          message_ids: pending.slice(0, 8).map((m) => m.id),
          attempt: retryAttemptRef.current,
        });
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        const delay = Math.min(8_000, 400 * Math.pow(1.6, retryAttemptRef.current));
        retryAttemptRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          setRetryTick((n) => n + 1);
        }, delay);
        return;
      }

      retryAttemptRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      const toDecrypt = messagesSnapshot.filter(
        (m) =>
          m.conversation_id === convIdAtStart &&
          m.kind !== "file_notice" &&
          m.kind !== "deleted" &&
          !plaintextCache.has(m.id)
      );

      if (toDecrypt.length === 0) return;

      appLog("info", "[GroupCrypto:decrypt:start]", {
        group_id: convIdAtStart,
        kind: activeKind,
        member_id: profileIdRef.current,
        count: toDecrypt.length,
        key_epoch: gkEpoch,
        hist_len: histLen,
        generation: String(generation),
      });

      const batchSize = 10;
      for (let i = 0; i < toDecrypt.length; i += batchSize) {
        const chunk = toDecrypt.slice(i, i + batchSize);
        const patch: Record<string, string> = {};
        await Promise.all(
          chunk.map(async (m) => {
            try {
              let text = "";
              if (activeKind === "group" && gk) {
                text = await decryptGroupRef.current(m);
              } else {
                let senderPub =
                  m.sender_id === profileIdRef.current
                    ? exportPublic(identityRef.current).ed25519_public
                    : peersRef.current.find((p) => p.user_id === m.sender_id)
                        ?.ed25519_public;
                if (!senderPub && m.sender_id !== profileIdRef.current) {
                  try {
                    const all = await peerApi.listPeers();
                    const found = all.find((p) => p.user_id === m.sender_id);
                    if (found?.ed25519_public) {
                      senderPub = found.ed25519_public;
                    }
                  } catch {
                    /* ignore */
                  }
                }
                text = await decryptMessage(
                  { ...m, wrapped_keys: m.wrapped_keys || {} },
                  profileIdRef.current,
                  identityRef.current,
                  senderPub
                );
              }
              patch[m.id] = text;
              appLog("debug", "[GroupCrypto:decrypt:ok]", {
                group_id: convIdAtStart,
                message_id: m.id,
                sender_id: m.sender_id,
                len: text.length,
              });
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              const missingKey =
                /no group key|waiting for group key/i.test(reason) ||
                reason.includes("unable to decrypt: no group key");
              if (missingKey) {
                pendingMissingKey.add(m.id);
                appLog("warn", "[GroupCrypto:decrypt:missing_key]", {
                  group_id: convIdAtStart,
                  message_id: m.id,
                  sender_id: m.sender_id,
                  reason,
                });
                return;
              }
              appLog("error", "[GroupCrypto:decrypt:fail]", {
                group_id: convIdAtStart,
                message_id: m.id,
                sender_id: m.sender_id,
                key_epoch: gkEpoch,
                reason,
              });
              patch[m.id] = "[unable to decrypt]";
            }
          })
        );
        commitPlain(patch);
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
      // Also refresh local_path_present for known names missing path hints.
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
