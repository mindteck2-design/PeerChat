import { Box, Button, Stack, Typography } from "@mui/material";
import SportsEsportsIcon from "@mui/icons-material/SportsEsportsRounded";
import type { GameMsg } from "./games";

export type GameCardStatus =
  | "incoming"
  | "waiting"
  | "accepted"
  | "declined"
  | "win"
  | "lose"
  | "draw"
  | "resigned_them"
  | "resigned_you";

export function gameTitle(game: GameMsg["game"]): string {
  if (game === "ttt") return "Tic-Tac-Toe";
  if (game === "rps") return "Rock Paper Scissors";
  return "Dots & Boxes";
}

export function parseGameMsg(raw: string): GameMsg | null {
  try {
    const o = JSON.parse(raw);
    if (
      o &&
      (o.game === "ttt" || o.game === "rps" || o.game === "dab") &&
      o.payload &&
      typeof o.payload.type === "string"
    ) {
      return o as GameMsg;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function matchIdOf(msg: GameMsg): string {
  const p = msg.payload as { matchId?: string };
  return p.matchId || "";
}

export type RelatedGameMove = { msg: GameMsg; senderId: string };

/** Resolve invite card status from later game_move messages with the same matchId. */
export function resolveGameCardStatus(opts: {
  invite: GameMsg;
  mine: boolean;
  myId: string;
  related: RelatedGameMove[];
}): GameCardStatus {
  const mid = matchIdOf(opts.invite);
  const related = opts.related.filter(
    (r) => matchIdOf(r.msg) === mid && r.msg.game === opts.invite.game
  );

  for (const r of related) {
    const t = r.msg.payload.type;
    if (t === "result") {
      const p = r.msg.payload as { winnerId?: string | null };
      if (p.winnerId == null) return "draw";
      return p.winnerId === opts.myId ? "win" : "lose";
    }
  }
  for (const r of related) {
    const t = r.msg.payload.type;
    if (t === "decline") return "declined";
    if (t === "resign") {
      return r.senderId === opts.myId ? "resigned_you" : "resigned_them";
    }
    if (t === "accept" || t === "move" || t === "commit" || t === "reveal") return "accepted";
  }
  return opts.mine ? "waiting" : "incoming";
}

export function GameInviteCard(props: {
  game: GameMsg["game"];
  fromName: string;
  mine: boolean;
  status: GameCardStatus;
  busy?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onOpenGame?: () => void;
}) {
  const title = gameTitle(props.game);
  const headline = props.mine
    ? `You invited ${props.fromName} to ${title}`
    : `${props.fromName} invited you to ${title}`;

  let statusLine = "";
  let statusColor: "text.secondary" | "success.main" | "error.main" | "warning.main" =
    "text.secondary";
  switch (props.status) {
    case "waiting":
      statusLine = "Waiting for a response…";
      break;
    case "accepted":
      statusLine = "Accepted — play in Games";
      statusColor = "success.main";
      break;
    case "declined":
      statusLine = "Declined";
      statusColor = "error.main";
      break;
    case "win":
      statusLine = "You won!";
      statusColor = "success.main";
      break;
    case "lose":
      statusLine = "You lost";
      statusColor = "error.main";
      break;
    case "draw":
      statusLine = "Draw";
      break;
    case "resigned_them":
      statusLine = "Opponent resigned — you win";
      statusColor = "success.main";
      break;
    case "resigned_you":
      statusLine = "You resigned";
      statusColor = "warning.main";
      break;
    default:
      statusLine = "";
  }

  return (
    <Box
      sx={{
        minWidth: 220,
        maxWidth: 300,
        pr: 1.5,
        py: 0.25,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 0.75 }}>
        <SportsEsportsIcon sx={{ fontSize: 20, mt: 0.15, color: "primary.main" }} />
        <Box minWidth={0}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>
            {headline}
          </Typography>
          {statusLine && (
            <Typography
              sx={{ fontSize: 12, mt: 0.35, color: statusColor, fontWeight: 600 }}
            >
              {statusLine}
            </Typography>
          )}
        </Box>
      </Stack>

      {props.status === "incoming" && (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disabled={props.busy}
            onClick={props.onDecline}
          >
            Decline
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={props.busy}
            onClick={props.onAccept}
          >
            Accept
          </Button>
        </Stack>
      )}
      {props.status === "accepted" && props.onOpenGame && (
        <Stack direction="row" justifyContent="flex-end">
          <Button size="small" variant="outlined" onClick={props.onOpenGame}>
            Open game
          </Button>
        </Stack>
      )}
    </Box>
  );
}
