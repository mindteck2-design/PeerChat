import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  decryptFilename,
  decryptMessage,
  unwrapContentKey,
  type Identity,
} from "../../crypto";
import { peerApi, type Conversation, type Message, type Profile } from "../../peer";
import { messageAttachmentIds } from "../../shared/messageMeta";

/** Builds plaintext + filename maps for the active conversation. */
export function useMessageDecrypt(opts: {
  active: Conversation | null;
  messages: Message[];
  groupKeys: Record<string, Uint8Array>;
  groupKeyHistory: Record<string, Uint8Array[]>;
  peers: { user_id: string }[];
  profile: Profile;
  identity: Identity;
  fileNames: Record<string, string>;
  fileSizes: Record<string, number>;
  decryptGroupMessageText: (m: Message) => Promise<string>;
  setPlain: Dispatch<SetStateAction<Record<string, string>>>;
  setFileNames: Dispatch<SetStateAction<Record<string, string>>>;
  setFileSizes: Dispatch<SetStateAction<Record<string, number>>>;
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
  } = opts;

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!active) return;
      const gk = active.kind === "group" ? groupKeys[active.id] : undefined;
      if (active.kind === "group" && !gk) return;
      const next: Record<string, string> = {};
      for (const m of messages) {
        if (
          m.conversation_id !== active.id ||
          m.kind === "file_notice" ||
          m.kind === "deleted"
        ) {
          continue;
        }
        try {
          if (active.kind === "group" && gk) {
            next[m.id] = await decryptGroupMessageText(m);
          } else {
            next[m.id] = await decryptMessage(
              { ...m, wrapped_keys: m.wrapped_keys || {} },
              profile.id,
              identity
            );
          }
        } catch (err) {
          console.error("decrypt", m.id, err);
          next[m.id] = "[unable to decrypt]";
        }
      }
      if (!cancel) setPlain(next);
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
      const nextNames: Record<string, string> = {};
      const nextSizes: Record<string, number> = {};
      const ids = new Set<string>();
      for (const m of messages) {
        if (m.kind === "deleted") continue;
        for (const fid of messageAttachmentIds(m)) {
          if (!fileNames[fid]) ids.add(fid);
          else if (fileSizes[fid] == null) ids.add(fid);
        }
      }
      for (const fid of ids) {
        if (cancel) break;
        try {
          const file = await peerApi.getFile(fid);
          if (!file?.wrapped_keys || !file.filename_nonce || !file.enc_filename) continue;
          const key = unwrapContentKey(file.wrapped_keys, profile.id, identity);
          if (!fileNames[fid]) {
            nextNames[fid] = decryptFilename(key, file.filename_nonce, file.enc_filename);
          }
          const sz = Number(file.size_bytes);
          if (Number.isFinite(sz) && sz > 0) nextSizes[fid] = sz;
        } catch (err) {
          console.error("filename", fid, err);
        }
      }
      if (!cancel && Object.keys(nextNames).length) {
        setFileNames((prev) => ({ ...prev, ...nextNames }));
      }
      if (!cancel && Object.keys(nextSizes).length) {
        setFileSizes((prev) => ({ ...prev, ...nextSizes }));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [messages, active?.id, fileNames, fileSizes, identity, profile.id, setFileNames, setFileSizes]);
}
