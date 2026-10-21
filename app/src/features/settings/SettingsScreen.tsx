import { useContext, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Paper,
  Switch,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import InfoRoundedIcon from "@mui/icons-material/InfoRounded";
import NotificationsNoneRoundedIcon from "@mui/icons-material/NotificationsNoneRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import SecurityRoundedIcon from "@mui/icons-material/SecurityRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { exportPublic, fingerprintPublic, type Identity } from "../../crypto";
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
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const [fp, setFp] = useState("");
  const [name, setName] = useState(props.profile.display_name);
  const [team, setTeam] = useState(props.profile.team || "");
  const [savingName, setSavingName] = useState(false);
  const [status, setStatus] = useState("");
  const [notifOn, setNotifOn] = useState(true);
  const [notifBusy, setNotifBusy] = useState(false);
  const [autostartOn, setAutostartOn] = useState(true);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [downloadDir, setDownloadDir] = useState("");
  const [shellExt, setShellExt] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);
  const keyFp = fingerprintPublic(exportPublic(props.identity).x25519_public);
  const accent = dark ? "#38bdf8" : theme.palette.primary.main;

  useEffect(() => {
    peerApi.myFingerprint().then(setFp).catch(() => setFp("(unavailable)"));
    peerApi.getNotificationsEnabled().then(setNotifOn).catch(() => setNotifOn(true));
    peerApi.getAppSetting("download_dir").then((v) => setDownloadDir(v || "")).catch(() => {});
    peerApi.shellExtensionInstalled().then(setShellExt).catch(() => setShellExt(false));
    peerApi
      .getAutostartEnabled()
      .then((enabled) => setAutostartOn(enabled))
      .catch(() => setAutostartOn(true));
  }, []);

  async function toggleAutostart(enabled: boolean) {
    setAutostartBusy(true);
    try {
      await peerApi.setAutostartEnabled(enabled);
      setAutostartOn(await peerApi.getAutostartEnabled());
      setStatus(
        enabled
          ? "PeerChat will start in the tray when you sign in"
          : "Start at login turned off"
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

  const cardSx = {
    p: 2.5,
    borderRadius: 3,
    bgcolor: "background.paper",
    border: 1,
    borderColor: "divider",
    boxShadow: dark
      ? "0 4px 20px rgba(0, 0, 0, 0.2)"
      : "0 2px 12px rgba(20, 32, 28, 0.08)",
  };

  const inputSx = {
    "& .MuiOutlinedInput-root": {
      bgcolor: dark ? "#070c18" : "#F7FAF8",
      borderRadius: 2,
      color: "text.primary",
      "& fieldset": { borderColor: "divider" },
      "&:hover fieldset": {
        borderColor: dark ? "rgba(255, 255, 255, 0.2)" : "rgba(20, 32, 28, 0.25)",
      },
      "&.Mui-focused fieldset": { borderColor: accent },
    },
    "& .MuiInputBase-input": {
      fontSize: "0.875rem",
      py: 1,
    },
  };

  const switchSx = {
    "& .MuiSwitch-switchBase.Mui-checked": { color: accent },
    "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
      bgcolor: dark ? "#0284c7" : theme.palette.primary.main,
    },
  };

  const titleColor = "text.primary";
  const mutedColor = "text.secondary";
  const bodyColor = "text.primary";
  const iconBtnSx = {
    color: mutedColor,
    "&:hover": { color: titleColor },
  };
  const saveBtnSx = {
    bgcolor: dark ? "#2563eb" : "primary.main",
    color: dark ? undefined : "primary.contrastText",
    "&:hover": { bgcolor: dark ? "#1d4ed8" : "primary.dark" },
    borderRadius: 2,
    px: 3,
    py: 0.75,
    fontWeight: 600,
    textTransform: "none" as const,
  };

  return (
    <Box
      sx={{
        minHeight: "100%",
        width: "100%",
        maxWidth: 1080,
        mx: "auto",
        p: { xs: 2.5, md: 4 },
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, color: titleColor, letterSpacing: "-0.02em" }}>
            Settings
          </Typography>
          <Typography variant="body2" sx={{ color: mutedColor, mt: 0.5 }}>
            Configure PeerChat to work the way you want
          </Typography>
        </Box>
        <Box
          sx={{
            px: 2,
            py: 0.6,
            borderRadius: "20px",
            bgcolor: dark ? "rgba(30, 41, 59, 0.7)" : "rgba(20, 32, 28, 0.06)",
            border: 1,
            borderColor: "divider",
            color: mutedColor,
            fontSize: "0.8125rem",
            fontWeight: 600,
            letterSpacing: "0.01em",
          }}
        >
          PeerChat v{props.version}
        </Box>
      </Box>

      {/* Top Banner Card: About */}
      <Paper sx={{ ...cardSx, mb: 2.5 }} elevation={0}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.25 }}>
          <InfoRoundedIcon sx={{ color: accent, fontSize: 22 }} />
          <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
            About
          </Typography>
        </Box>
        <Typography sx={{ fontWeight: 700, fontSize: "0.9375rem", color: bodyColor, mb: 0.5 }}>
          PeerChat {props.version}
        </Typography>
        <Typography sx={{ fontSize: "0.875rem", color: mutedColor, lineHeight: 1.5 }}>
          A lightweight, secure peer-to-peer messaging app for direct communication and file sharing over your network.
        </Typography>
      </Paper>

      {/* 2-Column Grid */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
          gap: 2.5,
          alignItems: "start",
        }}
      >
        {/* Row 1 Left: Notifications */}
        <Paper sx={cardSx} elevation={0}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
            <NotificationsNoneRoundedIcon sx={{ color: accent, fontSize: 22 }} />
            <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
              Notifications
            </Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
              Desktop notifications for new messages
            </Typography>
            <Switch
              checked={notifOn}
              disabled={notifBusy}
              onChange={(_, v) => toggleNotifications(v)}
              sx={switchSx}
            />
          </Box>
          <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, mt: 1 }}>
            Get desktop alerts for new messages. Muted chats stay silent.
          </Typography>
        </Paper>

        {/* Row 1 Right: Startup */}
        <Paper sx={cardSx} elevation={0}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
            <PowerSettingsNewRoundedIcon sx={{ color: accent, fontSize: 22 }} />
            <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
              Startup
            </Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
              Start at login (system tray)
            </Typography>
            <Switch
              checked={autostartOn}
              disabled={autostartBusy}
              onChange={(_, v) => toggleAutostart(v)}
              sx={switchSx}
            />
          </Box>
          <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, mt: 1 }}>
            After you sign in, PeerChat runs in the tray so it can receive messages and show notifications. Open it from the tray icon.
          </Typography>
        </Paper>

        {/* Row 2 Left: Profile */}
        <Paper sx={cardSx} elevation={0}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
            <PersonOutlineRoundedIcon sx={{ color: accent, fontSize: 22 }} />
            <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
              Profile
            </Typography>
          </Box>
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
              Display name
            </Typography>
            <TextField
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
              sx={inputSx}
            />
          </Box>
          <Box sx={{ mb: 1.75 }}>
            <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
              Team
            </Typography>
            <TextField
              size="small"
              fullWidth
              value={team}
              placeholder="HMIS"
              onChange={(e) => setTeam(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveName();
                }
              }}
              sx={inputSx}
            />
            <Typography sx={{ fontSize: "0.75rem", color: mutedColor, mt: 0.5 }}>
              e.g. HMIS, Shakti
            </Typography>
          </Box>
          <Button
            variant="contained"
            disabled={
              savingName ||
              !name.trim() ||
              (name.trim() === props.profile.display_name &&
                team.trim() === (props.profile.team || "").trim())
            }
            onClick={saveName}
            sx={{ ...saveBtnSx, mb: 2 }}
          >
            Save
          </Button>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              pt: 1.5,
              borderTop: 1,
              borderColor: "divider",
            }}
          >
            <Typography sx={{ fontFamily: "monospace", fontSize: "0.8125rem", color: mutedColor, wordBreak: "break-all" }}>
              {props.profile.id}
            </Typography>
            <IconButton
              size="small"
              onClick={() => copy("User id", props.profile.id)}
              sx={{ ...iconBtnSx, ml: 1 }}
            >
              <ContentCopyIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Paper>

        {/* Row 2 Right: Stack of Security fingerprints + Windows shell integration */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          {/* Security fingerprints */}
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
              <SecurityRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                Security fingerprints
              </Typography>
            </Box>
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                Your key fingerprint
              </Typography>
              <TextField
                size="small"
                fullWidth
                value={keyFp}
                InputProps={{
                  readOnly: true,
                  sx: { fontFamily: "monospace", fontSize: "0.8125rem" },
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => copy("Key fingerprint", keyFp)}
                        sx={iconBtnSx}
                      >
                        <ContentCopyIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={inputSx}
              />
            </Box>
            <Box>
              <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                Your peer TLS fingerprint
              </Typography>
              <TextField
                size="small"
                fullWidth
                value={fp || "…"}
                InputProps={{
                  readOnly: true,
                  sx: { fontFamily: "monospace", fontSize: "0.8125rem" },
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        disabled={!fp}
                        onClick={() => copy("TLS fingerprint", fp)}
                        sx={iconBtnSx}
                      >
                        <ContentCopyIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={inputSx}
              />
            </Box>
          </Paper>

          {/* Windows shell integration */}
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
              <LinkRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                Windows shell integration
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
                Add 'Share in PeerChat' to right-click menu
              </Typography>
              <Switch
                checked={shellExt}
                disabled={shellBusy}
                onChange={async (_, v) => {
                  setShellBusy(true);
                  try {
                    if (v) {
                      const exePath =
                        (window as any).__TAURI_INTERNALS__?.metadata?.currentExe ||
                        (window as any).__TAURI__?.metadata?.currentExe ||
                        "PeerChat.exe";
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
                sx={switchSx}
              />
            </Box>
            <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, mt: 1 }}>
              Add "Share in PeerChat" to the File Explorer right-click menu to share files easily.
            </Typography>
          </Paper>
        </Box>

        {/* Row 3 Left: Appearance */}
        <Paper sx={cardSx} elevation={0}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
            <PaletteOutlinedIcon sx={{ color: accent, fontSize: 22 }} />
            <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
              Appearance
            </Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
              Light theme
            </Typography>
            <Switch
              checked={mode === "light"}
              onChange={(_, v) => {
                const next = v ? "light" : "dark";
                setMode(next);
                peerApi.setAppSetting("theme", next).catch(() => {});
              }}
              sx={switchSx}
            />
          </Box>
          <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, mt: 1 }}>
            Dark theme is the default. Your choice is saved locally.
          </Typography>
        </Paper>

        {/* Row 3 Right: Downloads */}
        <Paper sx={cardSx} elevation={0}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
            <DownloadRoundedIcon sx={{ color: accent, fontSize: 22 }} />
            <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
              Downloads
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Download folder"
              value={downloadDir}
              onChange={(e) => setDownloadDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  peerApi
                    .setAppSetting("download_dir", downloadDir.trim())
                    .then(() => setStatus("Download folder saved"))
                    .catch((err: any) => setStatus(err?.message || String(err)));
                }
              }}
              sx={inputSx}
            />
            <Button
              variant="contained"
              onClick={() => {
                peerApi
                  .setAppSetting("download_dir", downloadDir.trim())
                  .then(() => setStatus("Download folder saved"))
                  .catch((err: any) => setStatus(err?.message || String(err)));
              }}
              sx={{ ...saveBtnSx, flexShrink: 0 }}
            >
              Save
            </Button>
          </Box>
          <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, mt: 1 }}>
            Received files land here. Leave blank to use the system Downloads folder.
          </Typography>
        </Paper>
      </Box>

      {/* Bottom Info Banner */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          p: 1.5,
          mt: 2.5,
          borderRadius: 2,
          bgcolor: dark ? "rgba(56, 189, 248, 0.05)" : "rgba(15, 107, 92, 0.06)",
          border: 1,
          borderColor: dark ? "rgba(56, 189, 248, 0.2)" : "rgba(15, 107, 92, 0.2)",
        }}
      >
        <InfoRoundedIcon sx={{ color: accent, fontSize: 20, flexShrink: 0 }} />
        <Typography sx={{ fontSize: "0.8125rem", color: mutedColor }}>
          No central server — chats live in local SQLite and deliver when peers come online.
        </Typography>
      </Box>

      {status && (
        <Alert severity="success" onClose={() => setStatus("")} sx={{ mt: 2 }}>
          {status}
        </Alert>
      )}
    </Box>
  );
}
