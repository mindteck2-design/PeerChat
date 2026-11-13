// @ts-nocheck
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopyRounded";
import { fingerprintPublic } from "../../crypto";

import type { ChatScreenVm } from "../chat/chatVm";

function FingerprintBlock(props: {
  label: string;
  value?: string | null;
  onCopy?: (label: string, value: string) => void;
}) {
  const { label, value, onCopy } = props;
  const v = (value || "").trim();
  return (
    <Box sx={{ mt: 1.25 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" alignItems="flex-start" spacing={0.5}>
        <Typography
          fontFamily="ui-monospace, monospace"
          sx={{ wordBreak: "break-all", flex: 1, fontSize: "0.8125rem" }}
        >
          {v || "— (not available yet — ask them to open PeerChat)"}
        </Typography>
        {v && onCopy && (
          <IconButton size="small" aria-label={`Copy ${label}`} onClick={() => onCopy(label, v)}>
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
      </Stack>
    </Box>
  );
}

export function PeerTrustDialogs({ vm }: { vm: ChatScreenVm }) {
  const {
    convs,
    firstContact,
    peerApi,
    pinOpen,
    identityReview,
    dismissIdentityReview,
    acceptIdentityReview,
    refresh,
    selectConversation,
    setFirstContact,
    setNav,
    setPinOpen,
    setTab,
    setStatus,
  } = vm;

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus?.(`Copied ${label}`);
    } catch {
      setStatus?.("Could not copy");
    }
  };

  const trustAndOpen = async (peer: {
    user_id: string;
    tls_fingerprint?: string | null;
  }) => {
    if (!peer.tls_fingerprint) {
      setStatus?.("No TLS fingerprint yet — ask them to keep PeerChat open, then refresh People.");
      return;
    }
    await peerApi.pinPeer(peer.user_id, peer.tls_fingerprint);
    const conv = await peerApi.openDm(peer.user_id);
    setPinOpen(null);
    setFirstContact(null);
    selectConversation(conv);
    setNav("chats");
    setTab(1);
    await refresh();
  };

  return (
    <>
      <Dialog open={!!firstContact} onClose={() => setFirstContact(null)}>
        <DialogTitle>New message</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            <strong>{firstContact?.peer.display_name}</strong> messaged you for the first time.
            You can read the chat now without trusting them.
          </Typography>
          <Alert severity="info" sx={{ mt: 1.5, mb: 0.5 }}>
            On a corporate LAN, compare their TLS fingerprint (phone / desk) before tapping Trust —
            that pins their certificate so impersonation shows up as “New keys”.
          </Alert>
          <FingerprintBlock
            label="Their TLS fingerprint"
            value={firstContact?.peer.tls_fingerprint}
            onCopy={copy}
          />
          <FingerprintBlock
            label="Their identity key fingerprint"
            value={
              firstContact?.peer.x25519_public
                ? fingerprintPublic(firstContact.peer.x25519_public)
                : null
            }
            onCopy={copy}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFirstContact(null)}>Later</Button>
          <Button
            onClick={async () => {
              if (!firstContact) return;
              const conv =
                convs.find((c) => c.id === firstContact.conversationId) ||
                (await peerApi.openDm(firstContact.peer.user_id));
              setFirstContact(null);
              selectConversation(conv);
              setNav("chats");
              setTab(1);
            }}
          >
            Open chat
          </Button>
          <Button
            variant="contained"
            disabled={!firstContact?.peer.tls_fingerprint}
            onClick={async () => {
              if (!firstContact) return;
              await trustAndOpen(firstContact.peer);
            }}
          >
            Trust & open
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!pinOpen} onClose={() => setPinOpen(null)}>
        <DialogTitle>Trust this peer?</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            First contact with <strong>{pinOpen?.display_name}</strong>. Compare the fingerprints
            below with them (call or desk check), then Accept.
          </Typography>
          <Alert severity="info" sx={{ mt: 1, mb: 0.5 }}>
            They can find the same values under Settings → Cryptographic Fingerprints.
          </Alert>
          <FingerprintBlock
            label="TLS fingerprint (pin this)"
            value={pinOpen?.tls_fingerprint}
            onCopy={copy}
          />
          <FingerprintBlock
            label="Identity key fingerprint"
            value={pinOpen?.x25519_public ? fingerprintPublic(pinOpen.x25519_public) : null}
            onCopy={copy}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPinOpen(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!pinOpen?.tls_fingerprint}
            onClick={async () => {
              if (!pinOpen) return;
              await trustAndOpen(pinOpen);
            }}
          >
            Accept & chat
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!identityReview} onClose={() => identityReview && dismissIdentityReview(identityReview)}>
        <DialogTitle>Encryption keys changed</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            <strong>{identityReview?.display_name}</strong> is advertising a new certificate or
            encryption key. Delivery stays sealed to the keys already saved until you accept.
            Confirm with them that they reinstalled or reset PeerChat — then compare fingerprints.
          </Typography>
          <Alert severity="warning" sx={{ mt: 1, mb: 0.5 }}>
            Only Accept if you verified the new fingerprint out of band. A mismatch can mean
            someone else on the LAN is impersonating them.
          </Alert>
          <FingerprintBlock
            label="Saved TLS fingerprint"
            value={identityReview?.tls_fingerprint}
            onCopy={copy}
          />
          <FingerprintBlock
            label="New TLS fingerprint"
            value={identityReview?.pending_tls_fingerprint}
            onCopy={copy}
          />
          {identityReview?.x25519_public && (
            <FingerprintBlock
              label="Saved identity key fingerprint"
              value={fingerprintPublic(identityReview.x25519_public)}
              onCopy={copy}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => identityReview && dismissIdentityReview(identityReview)}>Later</Button>
          <Button
            variant="contained"
            onClick={() => identityReview && acceptIdentityReview(identityReview)}
          >
            Accept new keys
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
