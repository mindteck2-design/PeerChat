import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Fade,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { exportPublic, type Identity } from "../../crypto";
import { peerApi, type Profile } from "../../peer";
import { newUserId } from "../../shared/ids";

function sanitizeNameOrTeam(val: string): string {
  return val.replace(/[^a-zA-Z0-9 _-]/g, "");
}

export function SetupScreen(props: {
  identity: Identity;
  error: string;
  setError: (s: string) => void;
  version: string;
  onReady: (p: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const pubs = exportPublic(props.identity);

  async function create() {
    props.setError("");
    const displayName = name.trim();
    if (!displayName) {
      props.setError("Please enter a display name");
      return;
    }
    const teamTrimmed = team.trim();
    setBusy(true);
    try {
      const p = await peerApi.setupProfile({
        displayName,
        userId: newUserId(),
        x25519Public: pubs.x25519_public,
        ed25519Public: pubs.ed25519_public,
        team: teamTrimmed,
      });
      props.onReady(p);
    } catch (e: any) {
      props.setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "radial-gradient(ellipse 80% 50% at 10% -10%, rgba(15,107,92,0.18), transparent 55%), radial-gradient(ellipse 50% 40% at 100% 0%, rgba(196,92,38,0.12), transparent 50%), linear-gradient(180deg,#E8F2EE 0%, #F3F6F4 45%, #EEF1EF 100%)",
        display: "grid",
        placeItems: "center",
        p: 2,
      }}
    >
      <Fade in timeout={500}>
        <Paper elevation={0} sx={{ width: "min(440px, 100%)", p: 4, border: "1px solid #D5E3DD" }}>
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography variant="overline" color="primary" letterSpacing={2}>
              PeerChat
            </Typography>
            <Typography variant="caption" color="text.secondary">
              v{props.version}
            </Typography>
          </Stack>
          <Typography variant="h4" sx={{ mt: 0.5, mb: 1 }}>
            Your desk identity
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Peer-to-peer on your LAN. No central server — chats live on your PC (SQLite) and
            deliver when peers are online. Your listening port is managed automatically.
          </Typography>
          <Stack spacing={2}>
            <TextField
              label="Display name"
              fullWidth
              value={name}
              onChange={(e) => setName(sanitizeNameOrTeam(e.target.value))}
              helperText="Letters, numbers, spaces, hyphens, and underscores only"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
            />
            <TextField
              label="Team"
              fullWidth
              value={team}
              onChange={(e) => setTeam(sanitizeNameOrTeam(e.target.value))}
              placeholder="HMIS"
              helperText="Your project or team — e.g. HMIS, Shakti"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                }
              }}
            />
            {props.error && <Alert severity="error">{props.error}</Alert>}
            <Button variant="contained" size="large" disabled={busy} onClick={create}>
              {busy ? "Starting…" : "Start PeerChat"}
            </Button>
          </Stack>
        </Paper>
      </Fade>
    </Box>
  );
}
