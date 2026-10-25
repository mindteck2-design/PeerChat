import { useCallback, type Dispatch, type SetStateAction } from "react";
import { wrapGroupKeyForMembers, type Identity } from "../../crypto";
import { peerApi, type Conversation, type Member, type Peer, type Profile } from "../../peer";

export function useGroupAdmin(opts: {
  active: Conversation | null;
  identity: Identity;
  peers: Peer[];
  addPick: string[];
  renameDraft: string;
  ensureGroupKey: (convId: string) => Promise<Uint8Array | null>;
  askConfirm: (opts: {
    title: string;
    body: string;
    confirmLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  refresh: (opts?: { manual?: boolean }) => Promise<void>;
  setAddPick: Dispatch<SetStateAction<string[]>>;
  setMembers: Dispatch<SetStateAction<Member[]>>;
  setActive: Dispatch<SetStateAction<Conversation | null>>;
  setMembersOpen: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
}) {
  const {
    active,
    identity,
    peers,
    addPick,
    renameDraft,
    ensureGroupKey,
    askConfirm,
    refresh,
    setAddPick,
    setMembers,
    setActive,
    setMembersOpen,
    setStatus,
  } = opts;

  const handleAddMembers = useCallback(async () => {
    if (!active || !addPick.length) return;
    try {
      const gk = await ensureGroupKey(active.id);
      if (!gk) {
        setStatus("Group key not available to add members");
        return;
      }
      let allPeers = peers;
      if (addPick.some((id) => !allPeers.find((p) => p.user_id === id && p.x25519_public))) {
        try {
          allPeers = await peerApi.listPeers();
        } catch {
          /* ignore */
        }
      }
      const pubs: Record<string, string> = {};
      for (const id of addPick) {
        const p = allPeers.find((x) => x.user_id === id);
        if (p?.x25519_public) pubs[id] = p.x25519_public;
      }
      if (!Object.keys(pubs).length) {
        setStatus("None of the selected people have been discovered yet");
        return;
      }
      await peerApi.addGroupMembers(active.id, wrapGroupKeyForMembers(gk, identity, pubs));
      setAddPick([]);
      setMembers(await peerApi.listMembers(active.id));
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }, [active, addPick, ensureGroupKey, identity, peers, setAddPick, setMembers, setStatus]);

  const handleRenameGroup = useCallback(async () => {
    if (!active || active.kind !== "group") return;
    const title = renameDraft.trim();
    if (!title || title === active.title) return;
    try {
      await peerApi.renameGroup(active.id, title);
      setActive({ ...active, title });
      await refresh();
      setStatus("Group renamed");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }, [active, refresh, renameDraft, setActive, setStatus]);

  const handleDeleteGroup = useCallback(async () => {
    if (!active || active.kind !== "group") return;
    const ok = await askConfirm({
      title: "Delete group for everyone?",
      body: "Delete this group for everyone? Chats and membership will be removed on all devices.",
      confirmLabel: "Delete group",
      danger: true,
    });
    if (!ok) return;
    try {
      await peerApi.deleteGroup(active.id);
      setMembersOpen(false);
      setActive(null);
      await refresh();
      setStatus("Group deleted");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }, [active, askConfirm, refresh, setActive, setMembersOpen, setStatus]);

  const handleToggleMembersCanAdd = useCallback(
    async (allowed: boolean) => {
      if (!active || active.kind !== "group") return;
      try {
        await peerApi.setGroupMembersCanAdd(active.id, allowed);
        setActive({ ...active, members_can_add: allowed });
        await refresh();
      } catch (err: any) {
        setStatus(err?.message || String(err));
      }
    },
    [active, refresh, setActive, setStatus]
  );

  const handleSetMemberRole = useCallback(
    async (userId: string, role: "admin" | "member") => {
      if (!active || active.kind !== "group") return;
      try {
        await peerApi.setGroupMemberRole(active.id, userId, role);
        setMembers(await peerApi.listMembers(active.id));
      } catch (err: any) {
        setStatus(err?.message || String(err));
      }
    },
    [active, setMembers, setStatus]
  );

  return {
    handleAddMembers,
    handleRenameGroup,
    handleDeleteGroup,
    handleToggleMembersCanAdd,
    handleSetMemberRole,
  };
}
