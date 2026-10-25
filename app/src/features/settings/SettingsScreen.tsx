import { useContext, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Switch,
  Tab,
  Tabs,
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
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import PowerSettingsNewRoundedIcon from "@mui/icons-material/PowerSettingsNewRounded";
import DnsRoundedIcon from "@mui/icons-material/DnsRounded";
import VolumeUpRoundedIcon from "@mui/icons-material/VolumeUpRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { exportPublic, fingerprintPublic, type Identity } from "../../crypto";
import { peerApi, type Profile } from "../../peer";
import { ThemeMode } from "../../theme";

function sanitizeNameOrTeam(val: string): string {
  return val.replace(/[^a-zA-Z0-9 _-]/g, "");
}

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
  const [tab, setTab] = useState(0);

  // Profile tab state
  const [name, setName] = useState(props.profile.display_name);
  const [team, setTeam] = useState(props.profile.team || "");
  const [designation, setDesignation] = useState("");
  const [empId, setEmpId] = useState("");
  const [presence, setPresence] = useState("Available");
  const [statusMsg, setStatusMsg] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // General tab state
  const [autostartOn, setAutostartOn] = useState(true);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [shellExt, setShellExt] = useState(false);
  const [shellBusy, setShellBusy] = useState(false);

  // Notifications tab state
  const [notifOn, setNotifOn] = useState(true);
  const [notifBusy, setNotifBusy] = useState(false);
  const [notifSound, setNotifSound] = useState(true);
  const [notifPreview, setNotifPreview] = useState(true);

  // Network tab state
  const [scanFreq, setScanFreq] = useState("1m");
  const [scanningNow, setScanningNow] = useState(false);

  // Storage & Security tab state
  const [fp, setFp] = useState("");
  const [downloadDir, setDownloadDir] = useState("");
  const [status, setStatus] = useState("");

  const keyFp = fingerprintPublic(exportPublic(props.identity).x25519_public);
  const accent = theme.palette.primary.main;

  useEffect(() => {
    peerApi.myFingerprint().then(setFp).catch(() => setFp("(unavailable)"));
    peerApi.getNotificationsEnabled().then(setNotifOn).catch(() => setNotifOn(true));
    peerApi.getAppSetting("download_dir").then((v) => setDownloadDir(v || "")).catch(() => {});
    peerApi.shellExtensionInstalled().then(setShellExt).catch(() => setShellExt(false));
    peerApi
      .getAutostartEnabled()
      .then((enabled) => setAutostartOn(enabled))
      .catch(() => setAutostartOn(true));

    peerApi.getAppSetting("scan_frequency").then((v) => setScanFreq(v || "1m")).catch(() => {});
    peerApi.getAppSetting("notification_sound").then((v) => setNotifSound(v !== "0")).catch(() => {});
    peerApi.getAppSetting("notification_preview").then((v) => setNotifPreview(v !== "0")).catch(() => {});

    peerApi.getAppSetting("profile_designation").then((v) => setDesignation(v || "")).catch(() => {});
    peerApi.getAppSetting("profile_emp_id").then((v) => setEmpId(v || "")).catch(() => {});
    peerApi.getAppSetting("profile_status").then((v) => setPresence(v || "Available")).catch(() => {});
    peerApi.getAppSetting("profile_status_msg").then((v) => setStatusMsg(v || "")).catch(() => {});
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

  async function saveProfile() {
    const trimmed = name.trim();
    const teamTrimmed = team.trim();
    if (!trimmed) return;
    setSavingProfile(true);
    try {
      const p = await peerApi.updateDisplayName(trimmed, teamTrimmed);
      props.onNameUpdated(p);
      await Promise.all([
        peerApi.setAppSetting("profile_designation", designation.trim()),
        peerApi.setAppSetting("profile_emp_id", empId.trim()),
        peerApi.setAppSetting("profile_status", presence),
        peerApi.setAppSetting("profile_status_msg", statusMsg.trim()),
      ]);
      setStatus("Profile updated successfully");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setSavingProfile(false);
    }
  }

  async function chooseDownloadDir() {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Download Folder",
      });
      if (picked && typeof picked === "string") {
        setDownloadDir(picked);
        await peerApi.setAppSetting("download_dir", picked);
        setStatus("Download folder saved");
      }
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function handleScanFreqChange(val: string) {
    setScanFreq(val);
    try {
      await peerApi.setAppSetting("scan_frequency", val);
      setStatus(`Peer scan frequency set to ${val === "manual" ? "manual" : `every ${val}`}`);
    } catch (err: any) {
      setStatus(err?.message || String(err));
    }
  }

  async function triggerManualScan() {
    setScanningNow(true);
    try {
      await peerApi.discoverPeers();
      setStatus("Peer discovery scan completed");
    } catch (err: any) {
      setStatus(err?.message || String(err));
    } finally {
      setScanningNow(false);
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
      bgcolor: dark ? "chat.input" : "#F7FAF8",
      borderRadius: 2,
      color: "text.primary",
      "& fieldset": { borderColor: "divider" },
      "&:hover fieldset": {
        borderColor: dark ? "rgba(160, 184, 232, 0.28)" : "rgba(20, 32, 28, 0.25)",
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
      bgcolor: dark ? "primary.dark" : theme.palette.primary.main,
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
    bgcolor: "primary.main",
    color: "primary.contrastText",
    "&:hover": { bgcolor: "primary.dark" },
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
        maxWidth: 960,
        mx: "auto",
        p: { xs: 2.5, md: 4 },
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <IconButton onClick={props.onBack} sx={{ color: "text.primary" }}>
            <ArrowBackRoundedIcon />
          </IconButton>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700, color: titleColor, letterSpacing: "-0.02em" }}>
              Settings
            </Typography>
            <Typography variant="body2" sx={{ color: mutedColor, mt: 0.25 }}>
              Preferences, profile, notifications, and network configuration
            </Typography>
          </Box>
        </Box>
        <Box
          sx={{
            px: 2,
            py: 0.6,
            borderRadius: "20px",
            bgcolor: dark ? "chat.input" : "rgba(20, 32, 28, 0.06)",
            border: 1,
            borderColor: "divider",
            color: mutedColor,
            fontSize: "0.8125rem",
            fontWeight: 600,
            letterSpacing: "0.01em",
          }}
        >
          v{props.version}
        </Box>
      </Box>

      {/* Tabs navigation */}
      <Tabs
        value={tab}
        onChange={(_, val) => setTab(val)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          mb: 3,
          "& .MuiTab-root": {
            textTransform: "none",
            fontWeight: 600,
            fontSize: "0.875rem",
            minHeight: 48,
            gap: 0.75,
          },
        }}
      >
        <Tab icon={<PersonOutlineRoundedIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Profile" />
        <Tab icon={<PaletteOutlinedIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="General" />
        <Tab icon={<NotificationsNoneRoundedIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Notifications" />
        <Tab icon={<DnsRoundedIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Network" />
        <Tab icon={<SecurityRoundedIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Storage & Security" />
      </Tabs>

      {/* TAB 0: PROFILE */}
      {tab === 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 2 }}>
              <PersonOutlineRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                Personal & Team Details
              </Typography>
            </Box>

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mb: 2 }}>
              <Box>
                <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                  Display Name *
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  value={name}
                  onChange={(e) => setName(sanitizeNameOrTeam(e.target.value))}
                  helperText="Letters, numbers, spaces, - and _"
                  sx={inputSx}
                />
              </Box>

              <Box>
                <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                  Team / Department
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  value={team}
                  placeholder="e.g. HMIS"
                  onChange={(e) => setTeam(sanitizeNameOrTeam(e.target.value))}
                  helperText="HMIS and Hmis are treated as one team"
                  sx={inputSx}
                />
              </Box>

              <Box>
                <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                  Designation / Role
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  value={designation}
                  placeholder="e.g. Senior Software Engineer"
                  onChange={(e) => setDesignation(e.target.value)}
                  sx={inputSx}
                />
              </Box>

              <Box>
                <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                  Employee ID
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  value={empId}
                  placeholder="e.g. EMP-1048"
                  onChange={(e) => setEmpId(e.target.value)}
                  sx={inputSx}
                />
              </Box>
            </Box>

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "180px 1fr" }, gap: 2, mb: 2.5 }}>
              <Box>
                <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                  Status
                </Typography>
                <FormControl size="small" fullWidth>
                  <Select
                    value={presence}
                    onChange={(e) => setPresence(e.target.value)}
                    sx={{ ...inputSx, borderRadius: 2 }}
                  >
                    <MenuItem value="Available">🟢 Available</MenuItem>
                    <MenuItem value="In a meeting">🟡 In a meeting</MenuItem>
                    <MenuItem value="Do Not Disturb">🔴 Do Not Disturb</MenuItem>
                    <MenuItem value="On a break">☕ On a break</MenuItem>
                    <MenuItem value="Away">⚪ Away</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Box>
                <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                  Status Message
                </Typography>
                <TextField
                  size="small"
                  fullWidth
                  placeholder="What are you working on?"
                  value={statusMsg}
                  onChange={(e) => setStatusMsg(e.target.value)}
                  sx={inputSx}
                />
              </Box>
            </Box>

            <Button
              variant="contained"
              disabled={savingProfile || !name.trim()}
              onClick={saveProfile}
              sx={saveBtnSx}
            >
              {savingProfile ? "Saving…" : "Save Profile"}
            </Button>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                mt: 3,
                pt: 2,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Your Unique Peer ID
                </Typography>
                <Typography sx={{ fontFamily: "monospace", fontSize: "0.8125rem", color: mutedColor, wordBreak: "break-all" }}>
                  {props.profile.id}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={() => copy("User id", props.profile.id)}
                sx={{ ...iconBtnSx, ml: 1 }}
              >
                <ContentCopyIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          </Paper>
        </Box>
      )}

      {/* TAB 1: GENERAL */}
      {tab === 1 && (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2.5 }}>
          {/* Appearance */}
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
              <PaletteOutlinedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                Appearance
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
                Light Theme
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
              Toggle between Dark and Light mode. Your choice is saved locally.
            </Typography>
          </Paper>

          {/* Startup */}
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
              Runs quietly in the tray on boot to receive messages in the background.
            </Typography>
          </Paper>

          {/* Windows Shell Integration */}
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
              <LinkRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                File Explorer Context Menu
              </Typography>
            </Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
                'Share in PeerChat' on right-click
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
              Adds a shortcut in Windows File Explorer to quickly beam files to LAN peers.
            </Typography>
          </Paper>
        </Box>
      )}

      {/* TAB 2: NOTIFICATIONS */}
      {tab === 2 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 2 }}>
              <NotificationsNoneRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                Notification Preferences
              </Typography>
            </Box>

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 1 }}>
              <Box>
                <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
                  Desktop Notifications
                </Typography>
                <Typography sx={{ fontSize: "0.8125rem", color: mutedColor }}>
                  Show desktop toast alerts when new messages arrive.
                </Typography>
              </Box>
              <Switch
                checked={notifOn}
                disabled={notifBusy}
                onChange={(_, v) => toggleNotifications(v)}
                sx={switchSx}
              />
            </Box>

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 1, borderTop: 1, borderColor: "divider" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                <VolumeUpRoundedIcon sx={{ color: mutedColor, fontSize: 20 }} />
                <Box>
                  <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
                    Play Sound
                  </Typography>
                  <Typography sx={{ fontSize: "0.8125rem", color: mutedColor }}>
                    Play an alert sound when receiving a message.
                  </Typography>
                </Box>
              </Box>
              <Switch
                checked={notifSound}
                onChange={async (_, v) => {
                  setNotifSound(v);
                  await peerApi.setAppSetting("notification_sound", v ? "1" : "0");
                }}
                sx={switchSx}
              />
            </Box>

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", py: 1, borderTop: 1, borderColor: "divider" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                <VisibilityRoundedIcon sx={{ color: mutedColor, fontSize: 20 }} />
                <Box>
                  <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
                    Show Message Preview
                  </Typography>
                  <Typography sx={{ fontSize: "0.8125rem", color: mutedColor }}>
                    Display sender name and message content in toast alert (uncheck for meeting privacy).
                  </Typography>
                </Box>
              </Box>
              <Switch
                checked={notifPreview}
                onChange={async (_, v) => {
                  setNotifPreview(v);
                  await peerApi.setAppSetting("notification_preview", v ? "1" : "0");
                }}
                sx={switchSx}
              />
            </Box>
          </Paper>
        </Box>
      )}

      {/* TAB 3: NETWORK & DISCOVERY */}
      {tab === 3 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 2 }}>
              <DnsRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                LAN Peer Discovery
              </Typography>
            </Box>

            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
              <Box sx={{ pr: 2 }}>
                <Typography sx={{ fontSize: "0.875rem", fontWeight: 500, color: bodyColor }}>
                  Peer Scan Frequency
                </Typography>
                <Typography sx={{ fontSize: "0.8125rem", color: mutedColor }}>
                  How often PeerChat broadcasts a UDP beacon on the LAN to discover active coworkers.
                </Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <Select
                  value={scanFreq}
                  onChange={(e) => handleScanFreqChange(e.target.value)}
                  sx={{ ...inputSx, borderRadius: 2 }}
                >
                  <MenuItem value="30s">Every 30 seconds</MenuItem>
                  <MenuItem value="1m">Every 1 minute (Default)</MenuItem>
                  <MenuItem value="5m">Every 5 minutes</MenuItem>
                  <MenuItem value="10m">Every 10 minutes</MenuItem>
                  <MenuItem value="manual">Manual only</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, pt: 2, borderTop: 1, borderColor: "divider" }}>
              <Button
                variant="outlined"
                disabled={scanningNow}
                startIcon={<SyncRoundedIcon />}
                onClick={triggerManualScan}
                sx={{ textTransform: "none", fontWeight: 600, borderRadius: 2 }}
              >
                {scanningNow ? "Scanning LAN…" : "Scan Network Now"}
              </Button>
              <Typography variant="caption" color="text.secondary">
                Manual scan immediately broadcasts a beacon across all physical network adapters.
              </Typography>
            </Box>
          </Paper>

          <Paper sx={cardSx} elevation={0}>
            <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor, mb: 1.5 }}>
              Network Protocol Ports
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: dark ? "chat.input" : "#F7FAF8", border: 1, borderColor: "divider" }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  HTTPS Peer Server Port
                </Typography>
                <Typography variant="h6" fontWeight={700} sx={{ fontFamily: "monospace" }}>
                  {props.profile.listen_port || 9876}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Local TLS listener for receiving direct messages and file chunks.
                </Typography>
              </Box>

              <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: dark ? "chat.input" : "#F7FAF8", border: 1, borderColor: "divider" }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  UDP Discovery Broadcast Port
                </Typography>
                <Typography variant="h6" fontWeight={700} sx={{ fontFamily: "monospace" }}>
                  41234
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Local subnet beacon port for peer presence discovery.
                </Typography>
              </Box>
            </Box>
          </Paper>
        </Box>
      )}

      {/* TAB 4: STORAGE & SECURITY */}
      {tab === 4 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
          {/* Downloads */}
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
              <FolderOpenRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                File Downloads
              </Typography>
            </Box>
            <Box sx={{ display: "flex", gap: 1.25, alignItems: "center" }}>
              <TextField
                size="small"
                fullWidth
                placeholder="Default system Downloads folder"
                value={downloadDir}
                onChange={(e) => setDownloadDir(e.target.value)}
                sx={inputSx}
              />
              <Button
                variant="outlined"
                onClick={chooseDownloadDir}
                sx={{ borderRadius: 2, px: 2, py: 0.75, textTransform: "none", fontWeight: 600, flexShrink: 0 }}
              >
                Browse…
              </Button>
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
              Received files land here. Leave blank to default to your operating system's Downloads folder.
            </Typography>
          </Paper>

          {/* Security Fingerprints */}
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.75 }}>
              <SecurityRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                Cryptographic Fingerprints
              </Typography>
            </Box>
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: "0.8125rem", color: mutedColor, fontWeight: 500, mb: 0.75 }}>
                Your Public Identity Key Fingerprint (X25519)
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
                Your Local Peer TLS Certificate Fingerprint (SHA-256)
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

          {/* About PeerChat */}
          <Paper sx={cardSx} elevation={0}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 1.25 }}>
              <InfoRoundedIcon sx={{ color: accent, fontSize: 22 }} />
              <Typography sx={{ fontSize: "1.05rem", fontWeight: 700, color: titleColor }}>
                About PeerChat
              </Typography>
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: "0.9375rem", color: bodyColor, mb: 0.5 }}>
              PeerChat Desktop v{props.version}
            </Typography>
            <Typography sx={{ fontSize: "0.875rem", color: mutedColor, lineHeight: 1.5 }}>
              Decentralized, zero-server local-first peer-to-peer workspace chat application.
              End-to-end encrypted (X25519/Ed25519/AES-256-GCM) with persistent SQLite storage.
            </Typography>
          </Paper>
        </Box>
      )}

      {status && (
        <Alert severity="success" onClose={() => setStatus("")} sx={{ mt: 3 }}>
          {status}
        </Alert>
      )}
    </Box>
  );
}
