// @ts-nocheck
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography,
} from "@mui/material";
import { fingerprintPublic, exportPublic } from "../../crypto";

import type { ChatScreenVm } from "../chat/chatVm";

export function PeerTrustDialogs({ vm }: { vm: ChatScreenVm }) {
  const {
    convs,
    firstContact,
    openDm,
    peerApi,
    pinOpen,
    refresh,
    selectConversation,
    setFirstContact,
    setNav,
    setPinOpen,
    setTab,
    text
  } = vm;
  return (
    <>
      <Dialog open={!!firstContact} onClose={() => setFirstContact(null)}>
        <DialogTitle>New message</DialogTitle>
        <DialogContent>
          <Typography gutterBottom>
            <strong>{firstContact?.peer.display_name}</strong> messaged you for the first time.
            Their chat is in your Chats list — you do not need to accept before reading it.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Trusting them pins their certificate so you can spot impersonation later.
          </Typography>
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
            onClick={async () => {
              if (!firstContact) return;
              const peer = firstContact.peer;
              if (peer.tls_fingerprint) {
                await peerApi.pinPeer(peer.user_id, peer.tls_fingerprint);
              }
              const conv = await peerApi.openDm(peer.user_id);
              setFirstContact(null);
              selectConversation(conv);
              setNav("chats");
              setTab(1);
              await refresh();
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
            First contact with <strong>{pinOpen?.display_name}</strong>. Verify TLS fingerprint
            out-of-band, then pin.
          </Typography>
          <Typography fontFamily="monospace" sx={{ wordBreak: "break-all" }}>
            {pinOpen?.tls_fingerprint}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPinOpen(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!pinOpen?.tls_fingerprint) return;
              await peerApi.pinPeer(pinOpen.user_id, pinOpen.tls_fingerprint);
              const c = await peerApi.openDm(pinOpen.user_id);
              setPinOpen(null);
              selectConversation(c);
              setNav("chats");
              setTab(1);
              await refresh();
            }}
          >
            Accept & chat
          </Button>
        </DialogActions>
      </Dialog>

    </>
  );
}
