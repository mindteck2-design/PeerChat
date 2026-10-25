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
      const gk = active.kind === "group" ? groupKeys[active.id] : undefined;
      if (active.kind === "group" && !gk) return;
      const patch: Record<string, string> = {};
      const loadedIds = new Set<string>();
      for (const m of messages) {
        if (
          m.conversation_id !== active.id ||
          m.kind === "file_notice" ||
          m.kind === "deleted"
        ) {
          continue;
        }
        loadedIds.add(m.id);
        try {
          if (active.kind === "group" && gk) {
            patch[m.id] = await decryptGroupMessageText(m);
          } else {
            const senderPub =
              m.sender_id === profile.id
                ? exportPublic(identity).ed25519_public
                : peers.find((p) => p.user_id === m.sender_id)?.ed25519_public;
            patch[m.id] = await decryptMessage(
              { ...m, wrapped_keys: m.wrapped_keys || {} },
              profile.id,
              identity,
              senderPub
            );
          }
        } catch (err) {
          console.error("decrypt", m.id, err);
          patch[m.id] = "[unable to decrypt]";
        }
        if (cancel) return;
      }
      if (!cancel) {
        setPlain((prev) => {
          const next: Record<string, string> = { ...patch };
          // Keep plaintext for ids still in the loaded window that somehow weren't patched.
          for (const [id, text] of Object.entries(prev)) {
            if (loadedIds.has(id) && next[id] === undefined) next[id] = text;
          }
          return next;
        });
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
