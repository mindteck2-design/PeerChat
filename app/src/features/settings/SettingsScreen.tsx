import { useContext, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { exportPublic, fingerprintPublic, type Identity } from "../../crypto";
import { FEATURE_GAMES } from "../../features";
import { peerApi, type Profile } from "../../peer";
import { ThemeMode } from "../../theme";

export function SettingsScreen(props: {
  profile: Profile;
  identity: Identity;
  version: string;
  onBack: () => void;
  onNameUpdated: (p: Profile) => void;
}) {
  const { mode, setMode } = useContext(ThemeMode);
  const [fp, setFp] = useState("");
  const [name, setName] = useState(props.profile.display_name);
  const [team, setTeam] = useState(props.profile.team || "");
  const [savingName, setSavingName] = useState(false);
  const [status, setStatus] = useState("");
  const [notifOn, setNotifOn] = useState(true);
  const [notifBusy, setNotifBusy] = useState(false);
  const [autostartOn, setAutostartOn] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [downloadDir, setDownloadDir] = useState("");
  const [gamesEnabled, setGamesEnabled] = useState(false);
  const [shellExt, setShellExt] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const keyFp = fingerprintPublic(exportPublic(props.identity).x25519_public);

  useEffect(() => {
    peerApi.myFingerprint().then(setFp).catch(() => setFp("(unavailable)"));
    peerApi.getNotificationsEnabled().then(setNotifOn).catch(() => setNotifOn(true));
    peerApi.getAppSetting("download_dir").then((v) => setDownloadDir(v || "")).catch(() => {});
    peerApi.getAppSetting("games_enabled").then((v) => setGamesEnabled(v === "1")).catch(() => setGamesEnabled(false));
    peerApi.shellExtensionInstalled().then(setShellExt).catch(() => setShellExt(false));
    peerApi
      .getAutostartEnabled()
      .then(setAutostartOn)
      .catch(() => setAutostartOn(false));
  }, []);

  async function toggleAutostart(enabled: boolean) {
    setAutostartBusy(true);
    try {
      await peerApi.setAutostartEnabled(enabled);
      setAutostartOn(await peerApi.getAutostartEnabled());
      setStatus(
        enabled
          ? "PeerChat will start in the tray when you sign in to Windows"
          : "Start with Windows turned off"
      );
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setAutostartBusy(false);
    }
  }

  async function toggleNotifications(enabled: boolean) {
    setNotifBusy(true);
    try {
      if (enabled) {
        let granted = await isPermissionGranted();
        if (!granted) {
          granted = (await requestPermission()) === "granted";
        }
        if (!granted) {
          setStatus("Windows blocked notification permission");
          setNotifOn(false);
          await peerApi.setNotificationsEnabled(false);
          return;
        }
      }
      await peerApi.setNotificationsEnabled(enabled);
      setNotifOn(enabled);
      setStatus(enabled ? "Desktop notifications on" : "Desktop notifications off");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setNotifBusy(false);
    }
  }

  async function saveName() {
    const trimmed = name.trim();
    const teamTrimmed = team.trim();
    if (!trimmed) return;
    const nameSame = trimmed === props.profile.display_name;
    const teamSame = teamTrimmed === (props.profile.team || "").trim();
    if (nameSame && teamSame) return;
    setSavingName(true);
    try {
      const p = await peerApi.updateDisplayName(trimmed, teamTrimmed);
      props.onNameUpdated(p);
      setStatus("Profile updated");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setSavingName(false);
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} copied`);
    } catch {
      setStatus("Could not copy");
    }
  }

  return (
    <Box minHeight="100vh" p={3} maxWidth={720} mx="auto">
      <Stack direction="row" alignItems="center" spacing={1} mb={3}>
        <Button onClick={props.onBack}>Back</Button>
        <Typography variant="h5">Settings</Typography>
        <Chip size="small" label={`v${props.version}`} sx={{ ml: "auto" }} />
      </Stack>
      <Stack spacing={3}>
        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            About
          </Typography>
          <Typography variant="body1" fontWeight={600}>
            PeerChat {props.version}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            A lightweight, secure peer-to-peer messaging app for direct communication and file sharing over your network.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Notifications
          </Typography>
          <FormControlLabel
            sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
            labelPlacement="start"
            disabled={notifBusy}
            control={
              <Switch checked={notifOn} onChange={(_, v) => toggleNotifications(v)} />
            }
            label="Desktop notifications for new messages"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Get desktop alerts for new messages. Muted chats stay silent.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Startup
          </Typography>
          <FormControlLabel
            sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
            labelPlacement="start"
            disabled={autostartBusy}
            control={
              <Switch checked={autostartOn} onChange={(_, v) => toggleAutostart(v)} />
            }
            label="Start with Windows (system tray)"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            After you sign in, PeerChat runs in the tray so it can receive messages and show
            notifications. Open it from the tray icon.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Profile
          </Typography>
          <Stack spacing={1.5} sx={{ mb: 1.5 }}>
            <TextField
              label="Display name"
              size="small"
              fullWidth
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveName();
                }
              }}
            />
            <TextField
              label="Team"
              size="small"
              fullWidth
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="HMIS"
              helperText="e.g. HMIS, Shakti"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveName();
                }
              }}
            />
            <Button
              variant="contained"
              disabled={
                savingName ||
                !name.trim() ||
                (name.trim() === props.profile.display_name &&
                  team.trim() === (props.profile.team || "").trim())
              }
              onClick={saveName}
              sx={{ alignSelf: "flex-start" }}
            >
              Save
            </Button>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography
              variant="body2"
              color="text.secondary"
              fontFamily="monospace"
              sx={{ wordBreak: "break-all" }}
              flex={1}
            >
              {props.profile.id}
            </Typography>
            <IconButton size="small" aria-label="Copy user id" onClick={() => copy("User id", props.profile.id)}>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Listening port: Managed automatically
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Security fingerprints
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box flex={1} minWidth={0}>
              <Typography variant="body2" color="text.secondary">
                Your key fingerprint
              </Typography>
              <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
                {keyFp}
              </Typography>
            </Box>
            <IconButton
              size="small"
              aria-label="Copy key fingerprint"
              onClick={() => copy("Key fingerprint", keyFp)}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
            <Box flex={1} minWidth={0}>
              <Typography variant="body2" color="text.secondary">
                Your peer TLS fingerprint
              </Typography>
              <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
                {fp || "…"}
              </Typography>
            </Box>
            <IconButton
              size="small"
              aria-label="Copy TLS fingerprint"
              disabled={!fp}
              onClick={() => copy("TLS fingerprint", fp)}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Windows shell integration
          </Typography>
          <FormControlLabel
            sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
            labelPlacement="start"
            disabled={shellBusy}
            control={
              <Switch
                checked={shellExt}
                onChange={async (_, v) => {
                  setShellBusy(true);
                  try {
                    if (v) {
                      const exePath = (window as any).__TAURI_INTERNALS__?.metadata?.currentExe
                        || (window as any).__TAURI__?.metadata?.currentExe
                        || "PeerChat.exe";
                      await peerApi.installShellExtension(exePath);
                      setShellExt(true);
                      setStatus("Right-click 'Share in PeerChat' registered");
                    } else {
                      await peerApi.uninstallShellExtension();
                      setShellExt(false);
                      setStatus("Right-click 'Share in PeerChat' removed");
                    }
                  } catch (err: any) {
                    setStatus(err?.message || String(err));
                  } finally {
                    setShellBusy(false);
                  }
                }}
              />
            }
            label="Add 'Share in PeerChat' to right-click menu"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Add "Share in PeerChat" to the File Explorer right-click menu to share files easily.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Appearance
          </Typography>
          <FormControlLabel
            sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
            labelPlacement="start"
            control={
              <Switch
                checked={mode === "light"}
                onChange={(_, v) => {
                  const next = v ? "light" : "dark";
                  setMode(next);
                  peerApi.setAppSetting("theme", next).catch(() => {});
                }}
              />
            }
            label="Light theme"
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Dark theme is the default. Your choice is saved locally.
          </Typography>
        </Paper>

        <Paper sx={{ p: 2.5 }} variant="outlined">
          <Typography variant="h6" gutterBottom>
            Downloads
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label="Download folder"
              size="small"
              fullWidth
              placeholder="(default: system Downloads folder)"
              value={downloadDir}
              onChange={(e) => setDownloadDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  peerApi.setAppSetting("download_dir", downloadDir.trim()).then(() => setStatus("Download folder saved")).catch((err: any) => setStatus(err?.message || String(err)));
                }
              }}
            />
            <Button
              variant="contained"
              onClick={() => {
                peerApi.setAppSetting("download_dir", downloadDir.trim()).then(() => setStatus("Download folder saved")).catch((err: any) => setStatus(err?.message || String(err)));
              }}
            >
              Save
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Received files land here. Leave blank to use the system Downloads folder.
          </Typography>
        </Paper>

        {FEATURE_GAMES && (
          <Paper sx={{ p: 2.5 }} variant="outlined">
            <Typography variant="h6" gutterBottom>
              Games
            </Typography>
            <FormControlLabel
              sx={{ m: 0, width: "100%", justifyContent: "space-between" }}
              labelPlacement="start"
              control={
                <Switch
                  checked={gamesEnabled}
                  onChange={(_, v) => {
                    setGamesEnabled(v);
                    peerApi.setAppSetting("games_enabled", v ? "1" : "0").then(() => setStatus(v ? "Games enabled" : "Games disabled")).catch((err: any) => setStatus(err?.message || String(err)));
                  }}
                />
              }
              label="Enable offline games"
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Shows the Games tab in the sidebar. Currently includes Snake, 2048, Tic-Tac-Toe, Rock Paper Scissors, and Dots & Boxes.
            </Typography>
          </Paper>
        )}

        <Alert severity="info">
          No central server — chats live in local SQLite and deliver when peers come online.
        </Alert>
        {status && (
          <Alert severity="success" onClose={() => setStatus("")}>
            {status}
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
