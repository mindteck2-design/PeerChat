import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { Box, CircularProgress } from "@mui/material";
import { APP_VERSION_FALLBACK, appVersion } from "../version";
import { peerApi, type Profile } from "../peer";
import { exportPublic, type Identity } from "../crypto";
import { getOrCreateIdentity } from "../storage";
import { SetupScreen } from "../features/setup/SetupScreen";
import { ChatScreen } from "./ChatScreen";
import { appLog } from "../shared/appLog";

type Screen = "setup" | "chat";

export default function App() {
  const [screen, setScreen] = useState<Screen>("setup");
  const [boot, setBoot] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(APP_VERSION_FALLBACK);

  useEffect(() => {
    (async () => {
      appLog("info", "App boot starting");
      const ver = await appVersion();
      setVersion(ver);
      appLog("info", "version", ver);
      try {
        await getCurrentWindow().setTitle(`PeerChat ${ver}`);
      } catch (e) {
        appLog("warn", "setTitle failed (browser preview?)", e);
      }
      let id: Identity | null = null;
      try {
        id = await getOrCreateIdentity();
        setIdentity(id);
        appLog("info", "identity ready");
      } catch (e) {
        appLog("error", "getOrCreateIdentity failed", e);
        setBoot(false);
        return;
      }
      try {
        let p = await peerApi.getProfile();
        if (p && id) {
          // Beacons advertise SQLite pubs; messages are signed with the store identity.
          // Keep them identical or peers see typing but never get delivered ciphertext.
          const pubs = exportPublic(id);
          if (
            p.x25519_public !== pubs.x25519_public ||
            p.ed25519_public !== pubs.ed25519_public
          ) {
            try {
              p = await peerApi.syncProfileKeys(pubs.x25519_public, pubs.ed25519_public);
              appLog("warn", "synced profile keys to match local identity");
            } catch (e) {
              appLog("warn", "syncProfileKeys failed", e);
            }
          }
        }
        if (p) {
          setProfile(p);
          setScreen("chat");
          appLog("info", "profile loaded → chat", { id: p.id, name: p.display_name });
        } else {
          appLog("info", "no profile → setup");
        }
      } catch (e) {
        appLog("warn", "getProfile failed (browser preview?)", e);
      }
      setBoot(false);
      appLog("info", "App boot complete");
    })();
  }, []);

  if (boot || !identity) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (screen === "setup" || !profile) {
    return (
      <SetupScreen
        identity={identity}
        error={error}
        setError={setError}
        version={version}
        onReady={(p) => {
          setProfile(p);
          setScreen("chat");
        }}
      />
    );
  }

  return (
    <ChatScreen
      profile={profile}
      identity={identity}
      version={version}
      onProfileUpdated={(p) => setProfile(p)}
    />
  );
}
