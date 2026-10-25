import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  b64,
  decryptWithGroupKey,
  exportPublic,
  fromB64,
  unwrapGroupKey,
  wrapGroupKeyForMembers,
  type Identity,
} from "../../crypto";
import { peerApi, type Message, type Peer, type Profile } from "../../peer";
import { appLog } from "../../shared/appLog";

const GROUP_KEY_HIST_PREFIX = "group_key_history:";

function groupKeysEqual(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Short stable id for logs (not a secret commitment). */
function keyId(key: Uint8Array): string {
  if (key.byteLength < 4) return "short";
  return `${key[0]!.toString(16).padStart(2, "0")}${key[1]!.toString(16).padStart(2, "0")}${key[2]!.toString(16).padStart(2, "0")}${key[3]!.toString(16).padStart(2, "0")}`;
}

export function useGroupCrypto(opts: {
  identity: Identity;
  profile: Profile;
  peers: Peer[];
  groupKeysRef: MutableRefObject<Record<string, Uint8Array>>;
  groupKeyHistoryRef: MutableRefObject<Record<string, Uint8Array[]>>;
  setGroupKeys: Dispatch<SetStateAction<Record<string, Uint8Array>>>;
  setGroupKeyHistory: Dispatch<SetStateAction<Record<string, Uint8Array[]>>>;
}) {
  const {
    identity,
    profile,
    peers,
    groupKeysRef,
    groupKeyHistoryRef,
    setGroupKeys,
    setGroupKeyHistory,
  } = opts;

  const peersRef = useRef(peers);
  peersRef.current = peers;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const profileIdRef = useRef(profile.id);
  profileIdRef.current = profile.id;
  const ensureInflight = useRef<Record<string, Promise<Uint8Array | null>>>({});

  const loadPersistedKeyHistory = useCallback(async (convId: string): Promise<Uint8Array[]> => {
    const raw = await peerApi.getAppSetting(`${GROUP_KEY_HIST_PREFIX}${convId}`).catch(() => null);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as string[];
      return parsed.map((s) => fromB64(s));
    } catch {
      return [];
    }
  }, []);

  const savePersistedKeyHistory = useCallback(async (convId: string, keys: Uint8Array[]) => {
    if (!keys.length) return;
    const payload = JSON.stringify(keys.map((k) => b64(k)));
    await peerApi.setAppSetting(`${GROUP_KEY_HIST_PREFIX}${convId}`, payload);
  }, []);

  const adoptGroupKey = useCallback(
    async (convId: string, newKey: Uint8Array) => {
      const prev = groupKeysRef.current[convId];
      let hist = groupKeyHistoryRef.current[convId] || [];
      if (prev && !groupKeysEqual(prev, newKey)) {
        if (!hist.some((k) => groupKeysEqual(k, prev))) {
          hist = [...hist, prev];
        }
      }
      groupKeysRef.current = { ...groupKeysRef.current, [convId]: newKey };
      groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
      setGroupKeys((g) => ({ ...g, [convId]: newKey }));
      setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
      await savePersistedKeyHistory(convId, hist);
      appLog("info", "[GroupCrypto:adoptGroupKey]", {
        group_id: convId,
        member_id: profileIdRef.current,
        key_id: keyId(newKey),
        rotated: !!(prev && !groupKeysEqual(prev, newKey)),
        hist_len: hist.length,
      });
    },
    [groupKeyHistoryRef, groupKeysRef, savePersistedKeyHistory, setGroupKeyHistory, setGroupKeys]
  );

  const decryptGroupMessageText = useCallback(
    async (m: Message): Promise<string> => {
      const convId = m.conversation_id;
      const identityNow = identityRef.current;
      const myId = profileIdRef.current;
      let current = groupKeysRef.current[convId];
      if (!current) {
        try {
          const wrap = await peerApi.getGroupKey(convId);
          if (wrap) {
            current = unwrapGroupKey(wrap, identityNow);
            groupKeysRef.current = { ...groupKeysRef.current, [convId]: current };
            setGroupKeys((g) => ({ ...g, [convId]: current! }));
            appLog("info", "[GroupCrypto:decrypt:on_demand_unwrap]", {
              group_id: convId,
              member_id: myId,
              message_id: m.id,
              key_id: keyId(current),
            });
          }
        } catch (e) {
          appLog("warn", "[GroupCrypto:decrypt:on_demand_err]", {
            group_id: convId,
            message_id: m.id,
            err: String(e),
          });
        }
      }
      const hist = groupKeyHistoryRef.current[convId] || [];
      const candidates: Uint8Array[] = [];
      if (current) candidates.push(current);
      for (const k of hist) {
        if (!current || !groupKeysEqual(k, current)) candidates.push(k);
      }
      if (!candidates.length) {
        appLog("warn", "[GroupCrypto:decrypt:no_candidates]", {
          group_id: convId,
          message_id: m.id,
          sender_id: m.sender_id,
          member_id: myId,
        });
        throw new Error("unable to decrypt: no group key available");
      }
      let edPub =
        m.sender_id === myId
          ? exportPublic(identityNow).ed25519_public
          : peersRef.current.find((p) => p.user_id === m.sender_id)?.ed25519_public;
      if (!edPub && m.sender_id !== myId) {
        try {
          const all = await peerApi.listPeers();
          const found = all.find((p) => p.user_id === m.sender_id);
          if (found?.ed25519_public) {
            edPub = found.ed25519_public;
          }
        } catch {
          /* ignore */
        }
      }
      let lastErr: unknown = null;
      for (let i = 0; i < candidates.length; i++) {
        const gk = candidates[i]!;
        try {
          const text = await decryptWithGroupKey(m, gk, edPub);
          appLog("info", "[GroupCrypto:decrypt:success]", {
            group_id: convId,
            message_id: m.id,
            sender_id: m.sender_id,
            member_id: myId,
            key_id: keyId(gk),
            key_idx: i,
            has_sender_pub: !!edPub,
          });
          return text;
        } catch (err) {
          lastErr = err;
        }
      }
      const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
      appLog("warn", "[GroupCrypto:decrypt:failed]", {
        group_id: convId,
        message_id: m.id,
        sender_id: m.sender_id,
        member_id: myId,
        candidates: candidates.length,
        has_sender_pub: !!edPub,
        reason,
      });
      throw new Error(`unable to decrypt: ${reason || "invalid key"}`);
    },
    [groupKeyHistoryRef, groupKeysRef, setGroupKeys]
  );

  const persistMyGroupWrap = useCallback(
    async (convId: string, gk: Uint8Array) => {
      const pubs = { [profile.id]: exportPublic(identity).x25519_public };
      const wraps = wrapGroupKeyForMembers(gk, identity, pubs);
      const mine = wraps[profile.id];
      if (mine) {
        await peerApi.setMyGroupKey(convId, mine);
        appLog("info", "[GroupCrypto:persistMyGroupWrap]", {
          group_id: convId,
          member_id: profile.id,
          key_id: keyId(gk),
        });
      }
    },
    [identity, profile.id]
  );

  const syncGroupKeyIfRotated = useCallback(
    async (convId: string) => {
      const wrap = await peerApi.getGroupKey(convId);
      const current = groupKeysRef.current[convId];
      if (!wrap) {
        appLog("info", "[GroupCrypto:syncGroupKeyIfRotated:no_wrap]", {
          group_id: convId,
          member_id: profileIdRef.current,
        });
        return;
      }
      try {
        const gk = unwrapGroupKey(wrap, identityRef.current);
        if (!current) {
          const hist = await loadPersistedKeyHistory(convId);
          groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
          setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
          groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
          setGroupKeys((g) => ({ ...g, [convId]: gk }));
          appLog("info", "[GroupCrypto:syncGroupKeyIfRotated:loaded]", {
            group_id: convId,
            member_id: profileIdRef.current,
            key_id: keyId(gk),
            hist_len: hist.length,
          });
          return;
        }
        if (!groupKeysEqual(current, gk)) {
          appLog("info", "[GroupCrypto:syncGroupKeyIfRotated:rotated]", {
            group_id: convId,
            member_id: profileIdRef.current,
            old_key_id: keyId(current),
            new_key_id: keyId(gk),
          });
          await adoptGroupKey(convId, gk);
        }
      } catch (err) {
        appLog("warn", "[GroupCrypto:syncGroupKeyIfRotated:unwrap_err]", {
          group_id: convId,
          member_id: profileIdRef.current,
          err: String(err),
        });
      }
    },
    [
      adoptGroupKey,
      groupKeyHistoryRef,
      groupKeysRef,
      loadPersistedKeyHistory,
      setGroupKeyHistory,
      setGroupKeys,
    ]
  );

  const ensureGroupKey = useCallback(
    async (convId: string): Promise<Uint8Array | null> => {
      const existing = groupKeysRef.current[convId];
      if (existing) return existing;

      const inflight = ensureInflight.current[convId];
      if (inflight) return inflight;

      const work = (async (): Promise<Uint8Array | null> => {
        const tryUnwrap = async (): Promise<Uint8Array | null> => {
          const wrap = await peerApi.getGroupKey(convId);
          if (!wrap) return null;
          try {
            const gk = unwrapGroupKey(wrap, identityRef.current);
            const hist = await loadPersistedKeyHistory(convId);
            groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
            setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
            groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
            setGroupKeys((g) => ({ ...g, [convId]: gk }));
            appLog("info", "[GroupCrypto:ensureGroupKey:unwrapped]", {
              group_id: convId,
              member_id: profileIdRef.current,
              key_id: keyId(gk),
              hist_len: hist.length,
            });
            return gk;
          } catch (err) {
            appLog("error", "[GroupCrypto:ensureGroupKey:unwrap_failed]", {
              group_id: convId,
              member_id: profileIdRef.current,
              err: String(err),
            });
            return null;
          }
        };

        let gk = await tryUnwrap();
        if (gk) return gk;

        // Do not generate a rogue key — request sync and briefly poll for the wrap.
        appLog("warn", "[GroupCrypto:ensureGroupKey:missing_key]", {
          group_id: convId,
          member_id: profileIdRef.current,
          wrap_found: false,
        });
        try {
          await peerApi.requestGroupSync(convId);
        } catch (e) {
          appLog("warn", "[GroupCrypto:ensureGroupKey:request_sync_err]", {
            group_id: convId,
            err: String(e),
          });
        }

        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 250 + i * 150));
          const again = groupKeysRef.current[convId];
          if (again) return again;
          gk = await tryUnwrap();
          if (gk) return gk;
        }

        appLog("warn", "[GroupCrypto:ensureGroupKey:still_missing]", {
          group_id: convId,
          member_id: profileIdRef.current,
        });
        return null;
      })();

      ensureInflight.current[convId] = work;
      try {
        return await work;
      } finally {
        delete ensureInflight.current[convId];
      }
    },
    [
      groupKeyHistoryRef,
      groupKeysRef,
      loadPersistedKeyHistory,
      setGroupKeyHistory,
      setGroupKeys,
    ]
  );

  return {
    adoptGroupKey,
    decryptGroupMessageText,
    ensureGroupKey,
    persistMyGroupWrap,
    syncGroupKeyIfRotated,
  };
}
