import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  decryptFilename,
  decryptMessage,
  exportPublic,
  unwrapContentKey,
  type Identity,
} from "../../crypto";
import { peerApi, type Conversation, type Message, type Profile } from "../../peer";
import { messageAttachmentIds } from "../../shared/messageMeta";

/** Persistent in-memory plaintext cache across renders & conversation toggles */
const plaintextCache = new Map<string, string>();

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
  ensureGroupKey?: (convId: string) => Promise<Uint8Array>;
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

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!active) return;

      // 1. Synchronously hydrate any messages already present in plaintextCache
      const instantPatch: Record<string, string> = {};
      for (const m of messages) {
        if (m.conversation_id === active.id && plaintextCache.has(m.id)) {
          instantPatch[m.id] = plaintextCache.get(m.id)!;
        }
      }
      if (Object.keys(instantPatch).length > 0) {
        setPlain((prev) => ({ ...prev, ...instantPatch }));
      }

      // 2. Ensure group key if active conversation is a group
      let gk = active.kind === "group" ? groupKeys[active.id] : undefined;
      if (active.kind === "group" && !gk && ensureGroupKey) {
        try {
          gk = await ensureGroupKey(active.id);
        } catch {
          /* ignore */
        }
      }
      if (active.kind === "group" && !gk) return;

      const toDecrypt = messages.filter(
        (m) =>
          m.conversation_id === active.id &&
          m.kind !== "file_notice" &&
          m.kind !== "deleted" &&
          !plaintextCache.has(m.id)
      );

      if (toDecrypt.length === 0) return;

      const patch: Record<string, string> = {};
      const batchSize = 10;
      for (let i = 0; i < toDecrypt.length; i += batchSize) {
        if (cancel) return;
        const chunk = toDecrypt.slice(i, i + batchSize);
        await Promise.all(
          chunk.map(async (m) => {
            try {
              let text = "";
              if (active.kind === "group" && gk) {
                text = await decryptGroupMessageText(m);
              } else {
                let senderPub =
                  m.sender_id === profile.id
                    ? exportPublic(identity).ed25519_public
                    : peers.find((p) => p.user_id === m.sender_id)?.ed25519_public;
                if (!senderPub && m.sender_id !== profile.id) {
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
                  profile.id,
                  identity,
                  senderPub
                );
              }
              plaintextCache.set(m.id, text);
              patch[m.id] = text;
            } catch (err) {
              console.error("decrypt", m.id, err);
              patch[m.id] = "[unable to decrypt]";
            }
          })
        );
        if (cancel) return;
        setPlain((prev) => ({ ...prev, ...patch }));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [
    messages,
    groupKeys,
    groupKeyHistory,
    peers,
    active?.id,
    active?.kind,
    decryptGroupMessageText,
    ensureGroupKey,
    identity,
    profile.id,
    setPlain,
  ]);

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
