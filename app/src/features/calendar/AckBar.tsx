import { Button, Chip, Stack, Typography } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import type { Peer } from "../../peer";
import type { AcksMap } from "./calendarTypes";

function nameFor(id: string, peers: Peer[], myId: string, myName: string) {
  if (id === myId) return myName || "You";
  return peers.find((p) => p.user_id === id)?.display_name || id.slice(0, 8);
}

export function AckBar({
  acks,
  participantIds,
  myId,
  myName,
  peers,
  onAck,
  disabled,
  readOnly,
}: {
  acks: AcksMap;
  /** Everyone who should acknowledge (owner + participants). */
  participantIds: string[];
  myId: string;
  myName: string;
  peers: Peer[];
  onAck: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const expected = Array.from(new Set(participantIds.filter(Boolean)));
  const ackIds = Object.keys(acks);
  const count = expected.filter((id) => !!acks[id]).length;
  const total = expected.length || ackIds.length;
  const iAcked = !!acks[myId];

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" fontWeight={700} flex={1}>
          Acknowledgements
        </Typography>
        <Chip
          size="small"
          label={`${count}/${Math.max(total, 1)} acknowledged`}
          color={count > 0 && count >= total ? "success" : "default"}
          variant="outlined"
        />
      </Stack>
      {ackIds.length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          {ackIds.map((uid) => (
            <Chip
              key={uid}
              size="small"
              icon={<CheckCircleOutlineIcon />}
              label={nameFor(uid, peers, myId, myName)}
              sx={{ height: 22, fontSize: 11 }}
            />
          ))}
        </Stack>
      )}
      {!readOnly && !iAcked && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<CheckCircleOutlineIcon />}
          disabled={disabled}
          onClick={onAck}
          sx={{ alignSelf: "flex-start" }}
        >
          Acknowledge
        </Button>
      )}
      {!readOnly && iAcked && (
        <Typography variant="caption" color="text.secondary">
          You acknowledged this.
        </Typography>
      )}
    </Stack>
  );
}
