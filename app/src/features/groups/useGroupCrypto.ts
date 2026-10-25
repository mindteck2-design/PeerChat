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
      let current = groupKeysRef.current[convId];
      if (!current) {
        try {
          const wrap = await peerApi.getGroupKey(convId);
          if (wrap) {
            current = unwrapGroupKey(wrap, identity);
            groupKeysRef.current = { ...groupKeysRef.current, [convId]: current };
            setGroupKeys((g) => ({ ...g, [convId]: current! }));
            console.log(`[GroupCrypto:decrypt:on_demand_unwrap] group_id=${convId} member_id=${profile.id}`);
          }
        } catch (e) {
          console.warn(`[GroupCrypto:decrypt:on_demand_err] group_id=${convId}`, e);
        }
      }
      const hist = groupKeyHistoryRef.current[convId] || [];
      const candidates: Uint8Array[] = [];
      if (current) candidates.push(current);
      for (const k of hist) {
        if (!current || !groupKeysEqual(k, current)) candidates.push(k);
      }
      if (!candidates.length) {
        console.warn(
          `[GroupCrypto:decrypt:no_candidates] group_id=${convId} msg_id=${m.id} sender_id=${m.sender_id}`
        );
        throw new Error("unable to decrypt: no group key available");
      }
      let edPub =
        m.sender_id === profile.id
          ? exportPublic(identity).ed25519_public
          : peers.find((p) => p.user_id === m.sender_id)?.ed25519_public;
      if (!edPub && m.sender_id !== profile.id) {
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
      let lastErr: any = null;
      for (let i = 0; i < candidates.length; i++) {
        const gk = candidates[i]!;
        try {
          const text = await decryptWithGroupKey(m, gk, edPub);
          console.log(
            `[GroupCrypto:decrypt:success] group_id=${convId} msg_id=${m.id} sender_id=${m.sender_id} key_idx=${i}`
          );
          return text;
        } catch (err) {
          lastErr = err;
        }
      }
      console.warn(
        `[GroupCrypto:decrypt:failed] group_id=${convId} msg_id=${m.id} sender_id=${m.sender_id} candidates=${candidates.length} reason=${lastErr?.message || String(lastErr)}`
      );
      throw new Error(`unable to decrypt: ${lastErr?.message || "invalid key"}`);
    },
    [groupKeyHistoryRef, groupKeysRef, identity, peers, profile.id, setGroupKeys]
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
        console.log(`[GroupCrypto:syncGroupKeyIfRotated] no wrap in DB for group_id=${convId}`);
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
          console.log(`[GroupCrypto:syncGroupKeyIfRotated] loaded initial key for group_id=${convId}`);
          return;
        }
        if (!groupKeysEqual(current, gk)) {
          console.log(`[GroupCrypto:syncGroupKeyIfRotated] adopting rotated key for group_id=${convId}`);
          await adoptGroupKey(convId, gk);
        }
      } catch (err) {
        console.warn(`[GroupCrypto:syncGroupKeyIfRotated:unwrap_err] group_id=${convId}`, err);
      }
    },
    [
      adoptGroupKey,
      groupKeyHistoryRef,
      groupKeysRef,
      identity,
      loadPersistedKeyHistory,
      setGroupKeyHistory,
      setGroupKeys,
    ]
  );

  const ensureGroupKey = useCallback(
    async (convId: string): Promise<Uint8Array | null> => {
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
          console.log(`[GroupCrypto:ensureGroupKey] unwrapped key for group_id=${convId} member_id=${profile.id}`);
          return gk;
        } catch (err) {
          console.error(
            `[GroupCrypto:ensureGroupKey:unwrap_failed] group_id=${convId} member_id=${profile.id}`,
            err
          );
        }
      }
      // If wrap is not present or failed to unwrap, do not generate a rogue key!
      // Request group sync from group peers instead.
      console.warn(
        `[GroupCrypto:ensureGroupKey:missing_key] group_id=${convId} member_id=${profile.id} wrap_found=${!!wrap}`
      );
      try {
        await peerApi.requestGroupSync(convId);
      } catch (e) {
        console.warn(`[GroupCrypto:ensureGroupKey:request_sync_err] group_id=${convId}`, e);
      }
      return null;
    },
    [
      groupKeyHistoryRef,
      groupKeysRef,
      identity,
      loadPersistedKeyHistory,
      profile.id,
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
