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
  /**
   * Sharees who should acknowledge. Prefer excluding the creator; callers may still
   * pass a mixed list — ownerId is used to filter them out.
   */
  participantIds: string[];
  /** Creator — never prompted to acknowledge their own item. */
  ownerId?: string;
  myId: string;
  myName: string;
  peers: Peer[];
  onAck: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const expected = Array.from(
    new Set(
      participantIds
        .map((id) => id.trim())
        .filter((id) => id && (!ownerId || id !== ownerId))
    )
  );
  const isAccepted = (v: string | undefined) =>
    !!v && !v.startsWith("rejected|") && v !== "rejected";
  const ackIds = expected.filter((id) => isAccepted(acks[id]));
  const count = ackIds.length;
  const total = expected.length;
  const iAmAudience = expected.some((id) => id === myId);
  const iAcked = isAccepted(acks[myId]);
  const iRejected =
    !!acks[myId] && (acks[myId]!.startsWith("rejected|") || acks[myId] === "rejected");

  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" fontWeight={700} flex={1}>
          Acknowledgements
        </Typography>
        {total > 0 && (
          <Chip
            size="small"
            label={`${count}/${total} acknowledged`}
            color={count > 0 && count >= total ? "success" : "default"}
            variant="outlined"
          />
        )}
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
      {!readOnly && iAmAudience && !iAcked && !iRejected && (
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
      {!readOnly && iAmAudience && iAcked && (
        <Typography variant="caption" color="success.main" fontWeight={600}>
          Accepted
        </Typography>
      )}
      {!readOnly && iAmAudience && iRejected && (
        <Typography variant="caption" color="text.secondary" fontWeight={600}>
          Rejected
        </Typography>
      )}
    </Stack>
  );
}
