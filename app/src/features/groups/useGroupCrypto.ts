import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  b64,
  createGroupKey,
  decryptWithGroupKey,
  exportPublic,
  fromB64,
  unwrapGroupKey,
  wrapGroupKeyForMembers,
  type Identity,
} from "../../crypto";
import { peerApi, type Message, type Peer, type Profile } from "../../peer";

const GROUP_KEY_HIST_PREFIX = "group_key_history:";

function groupKeysEqual(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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
    },
    [groupKeyHistoryRef, groupKeysRef, savePersistedKeyHistory, setGroupKeyHistory, setGroupKeys]
  );

  const decryptGroupMessageText = useCallback(
    async (m: Message): Promise<string> => {
      const convId = m.conversation_id;
      const current = groupKeysRef.current[convId];
      const hist = groupKeyHistoryRef.current[convId] || [];
      const candidates: Uint8Array[] = [];
      if (current) candidates.push(current);
      for (const k of hist) {
        if (!current || !groupKeysEqual(k, current)) candidates.push(k);
      }
      const sender = peers.find((p) => p.user_id === m.sender_id);
      const edPub = sender?.ed25519_public;
      for (const gk of candidates) {
        try {
          return await decryptWithGroupKey(m, gk, edPub);
        } catch {
          /* try older key */
        }
      }
      throw new Error("unable to decrypt");
    },
    [groupKeyHistoryRef, groupKeysRef, peers]
  );

  const persistMyGroupWrap = useCallback(
    async (convId: string, gk: Uint8Array) => {
      const pubs = { [profile.id]: exportPublic(identity).x25519_public };
      const wraps = wrapGroupKeyForMembers(gk, identity, pubs);
      const mine = wraps[profile.id];
      if (mine) await peerApi.setMyGroupKey(convId, mine);
    },
    [identity, profile.id]
  );

  const syncGroupKeyIfRotated = useCallback(
    async (convId: string) => {
      const wrap = await peerApi.getGroupKey(convId);
      const current = groupKeysRef.current[convId];
      if (!wrap) {
        if (current) {
          try {
            await persistMyGroupWrap(convId, current);
          } catch (e) {
            console.error(e);
          }
        }
        return;
      }
      try {
        const gk = unwrapGroupKey(wrap, identity);
        if (!current) {
          const hist = await loadPersistedKeyHistory(convId);
          groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
          setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
          groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
          setGroupKeys((g) => ({ ...g, [convId]: gk }));
          return;
        }
        if (!groupKeysEqual(current, gk)) {
          await adoptGroupKey(convId, gk);
        }
      } catch (err) {
        if (current) {
          try {
            await persistMyGroupWrap(convId, current);
          } catch (e) {
            console.error(e);
          }
          return;
        }
        const gk = createGroupKey();
        await persistMyGroupWrap(convId, gk);
        const hist = await loadPersistedKeyHistory(convId);
        groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
        setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
        groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
        setGroupKeys((g) => ({ ...g, [convId]: gk }));
        console.warn("Repaired group key after unwrap failure", err);
      }
    },
    [
      adoptGroupKey,
      groupKeyHistoryRef,
      groupKeysRef,
      identity,
      loadPersistedKeyHistory,
      persistMyGroupWrap,
      setGroupKeyHistory,
      setGroupKeys,
    ]
  );

  const ensureGroupKey = useCallback(
    async (convId: string) => {
      const existing = groupKeysRef.current[convId];
      if (existing) return existing;
      const wrap = await peerApi.getGroupKey(convId);
      if (wrap) {
        try {
          const gk = unwrapGroupKey(wrap, identity);
          const hist = await loadPersistedKeyHistory(convId);
          groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
          setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
          groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
          setGroupKeys((g) => ({ ...g, [convId]: gk }));
          return gk;
        } catch (err) {
          console.error(err);
        }
      }
      const gk = createGroupKey();
      await persistMyGroupWrap(convId, gk);
      const hist = await loadPersistedKeyHistory(convId);
      groupKeyHistoryRef.current = { ...groupKeyHistoryRef.current, [convId]: hist };
      setGroupKeyHistory((h) => ({ ...h, [convId]: hist }));
      groupKeysRef.current = { ...groupKeysRef.current, [convId]: gk };
      setGroupKeys((g) => ({ ...g, [convId]: gk }));
      return gk;
    },
    [
      groupKeyHistoryRef,
      groupKeysRef,
      identity,
      loadPersistedKeyHistory,
      persistMyGroupWrap,
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
