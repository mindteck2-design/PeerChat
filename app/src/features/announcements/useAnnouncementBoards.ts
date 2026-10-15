import { useCallback, type Dispatch, type SetStateAction } from "react";
import {
  exportPublic,
  wrapGroupKeyForMembers,
  type Identity,
} from "../../crypto";
import { peerApi, type Conversation, type Peer, type Profile } from "../../peer";

export function useAnnouncementBoards(opts: {
  profile: Profile;
  identity: Identity;
  peers: Peer[];
  ensureGroupKey: (convId: string) => Promise<Uint8Array>;
  setAnnounceBoards: Dispatch<SetStateAction<Conversation[]>>;
  setStatus: Dispatch<SetStateAction<string>>;
}) {
  const { profile, identity, peers, ensureGroupKey, setAnnounceBoards, setStatus } = opts;

  const ensureAnnounceBoards = useCallback(async () => {
    try {
      const boards = await peerApi.ensureAnnouncementBoards();
      setAnnounceBoards(boards);
      const myTeam = (profile.team || "").trim().toLowerCase();
      for (const board of boards) {
        try {
          const gk = await ensureGroupKey(board.id);
          const pubs: Record<string, string> = {};
          for (const p of peers) {
            if (p.user_id === profile.id) continue;
            if (board.id === "board:org") {
              pubs[p.user_id] = p.x25519_public;
            } else if (myTeam && (p.team || "").trim().toLowerCase() === myTeam) {
              pubs[p.user_id] = p.x25519_public;
            }
          }
          if (Object.keys(pubs).length) {
            await peerApi.addGroupMembers(
              board.id,
              wrapGroupKeyForMembers(gk, identity, pubs)
            );
          }
        } catch (e) {
          console.error("announce board sync", board.id, e);
        }
      }
      return boards;
    } catch (err: any) {
      setStatus(err?.message || String(err));
      return [] as Conversation[];
    }
  }, [ensureGroupKey, identity, peers, profile.id, profile.team, setAnnounceBoards, setStatus]);

  return { ensureAnnounceBoards };
}
