import { useCallback, type Dispatch, type SetStateAction } from "react";
import { FEATURE_GAMES } from "../../features";
import {
  peerApi,
  type Conversation,
  type LanHost,
  type Peer,
  type SavedItem,
  type TransferLog,
} from "../../peer";

/** Refresh peers / conversations / transfers from the local DB + discovery. */
export function useChatSync(opts: {
  setScanning: Dispatch<SetStateAction<boolean>>;
  setPeers: Dispatch<SetStateAction<Peer[]>>;
  setConvs: Dispatch<SetStateAction<Conversation[]>>;
  setLanHosts: Dispatch<SetStateAction<LanHost[]>>;
  setTransfers: Dispatch<SetStateAction<TransferLog[]>>;
  setSavedItems: Dispatch<SetStateAction<SavedItem[]>>;
  setGamesOn: Dispatch<SetStateAction<boolean>>;
  setActive: Dispatch<SetStateAction<Conversation | null>>;
}) {
  const {
    setScanning,
    setPeers,
    setConvs,
    setLanHosts,
    setTransfers,
    setSavedItems,
    setGamesOn,
    setActive,
  } = opts;

  const refresh = useCallback(
    async (refreshOpts?: { manual?: boolean }) => {
      const manual = !!refreshOpts?.manual;
      if (manual) setScanning(true);
      try {
        await peerApi.discoverPeers();
      } catch {
        /* ignore */
      }
      try {
        const [p, c, hosts, logs, saved, gamesFlag] = await Promise.all([
          peerApi.listPeers(),
          peerApi.listConversations(),
          peerApi.listLanHosts().catch(() => []),
          peerApi.listTransfers().catch(() => [] as TransferLog[]),
          peerApi.listSavedItems().catch(() => [] as SavedItem[]),
          FEATURE_GAMES
            ? peerApi.getAppSetting("games_enabled").catch(() => "0")
            : Promise.resolve("0"),
        ]);
        setPeers((prev) => {
          if (
            prev.length === p.length &&
            prev.every(
              (x, i) =>
                x.user_id === p[i].user_id &&
                x.display_name === p[i].display_name &&
                x.online === p[i].online &&
                x.last_ip === p[i].last_ip &&
                x.pinned === p[i].pinned &&
                x.blocked === p[i].blocked
            )
          ) {
            return prev;
          }
          return p;
        });

        setConvs((prev) => {
          if (
            prev.length === c.length &&
            prev.every(
              (x, i) =>
                x.id === c[i].id &&
                x.title === c[i].title &&
                x.last_message_at === c[i].last_message_at &&
                x.last_message_ciphertext === c[i].last_message_ciphertext &&
                x.unread_count === c[i].unread_count &&
                x.pinned_at === c[i].pinned_at && x.muted === c[i].muted
            )
          ) {
            return prev;
          }
          return c;
        });

        setLanHosts((prev) => {
          if (
            prev.length === hosts.length &&
            prev.every((x, i) => x.ip === hosts[i].ip && x.label === hosts[i].label)
          ) {
            return prev;
          }
          return hosts;
        });

        setTransfers((prev) => {
          if (
            prev.length === logs.length &&
            prev.every(
              (x, i) =>
                x.id === logs[i].id &&
                x.status === logs[i].status &&
                x.bytes_done === logs[i].bytes_done
            )
          ) {
            return prev;
          }
          return logs;
        });

        setSavedItems((prev) => {
          if (
            prev.length === saved.length &&
            prev.every((x, i) => x.id === saved[i].id)
          ) {
            return prev;
          }
          return saved;
        });

        setGamesOn(FEATURE_GAMES && gamesFlag === "1");
        setActive((prev) => {
          if (!prev) return prev;
          const fresh = c.find((x) => x.id === prev.id);
          return fresh ?? prev;
        });
      } finally {
        if (manual) setScanning(false);
      }
    },
    [
      setActive,
      setConvs,
      setGamesOn,
      setLanHosts,
      setPeers,
      setSavedItems,
      setScanning,
      setTransfers,
    ]
  );

  return { refresh };
}
