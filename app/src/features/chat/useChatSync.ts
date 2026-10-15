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
        setPeers(p);
        setConvs(c);
        setLanHosts(hosts);
        setTransfers(logs);
        setSavedItems(saved);
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
