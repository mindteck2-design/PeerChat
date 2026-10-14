/**
 * PeerChat Games — selection screen and all game UIs.
 *
 * LAN multiplayer uses the existing E2E-encrypted DM transport.
 * Game messages are sent as kind="game_move" through sendGameMsg() provided
 * by ChatScreen. They're delivered via inbox-updated and routed here.
 */

import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBackRounded";
import UndoIcon from "@mui/icons-material/UndoRounded";
import RestartAltIcon from "@mui/icons-material/RestartAltRounded";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { newTttState, tttMove, tttStateFromBoard, type TttState, type TttMsg } from "./ttt";
import { newRpsState, rpsResolveRound, type RpsState, type RpsMsg, type RpsChoice, type MatchFormat } from "./rps";
import { newDabState, dabMove, type DabState, type DabMsg, type EdgeId } from "./dab";
import { new2048State, move2048, undo2048, type Direction } from "./g2048";
import {
  COLS as TETRIS_COLS,
  gravityMs,
  hardDrop,
  moveLeft,
  moveRight,
  newTetrisState,
  previewCells,
  renderBoard,
  rotateCW,
  softDrop,
  tickGravity,
} from "./tetris";
import { SnakeGame } from "../panels";
import type { Peer } from "../peer";
import {
  clearGameHistory,
  gameLabel,
  getDabSession,
  getRpsSession,
  getTttSession,
  loadGameHistory,
  pushGameHistory,
  sessionBadge,
  setDabSession,
  setRpsSession,
  setTttSession,
  type GameHistoryEntry,
  type MpPhase as SessionMpPhase,
} from "./gameSession";

// ─── Types the host (App.tsx) must provide ───────────────────────────────────

export type GameMsg = {
  game: "ttt" | "rps" | "dab";
  payload: TttMsg | RpsMsg | DabMsg;
};

export type GameSendFn = (peerId: string, msg: GameMsg) => Promise<void>;

/** Called by ChatScreen when an inbox-updated message has kind=game_move */
export type GameDispatchFn = (fromId: string, msg: GameMsg) => void;

/** Accept from a chat invite card — GamesHub opens the game and joins.
 *  When `openOnly` is true, jump into an already-accepted match without re-sending accept. */
export type PendingGameInvite = {
  game: "ttt" | "rps" | "dab";
  matchId: string;
  fromId: string;
  fromName: string;
  format?: MatchFormat;
  rows?: number;
  cols?: number;
  openOnly?: boolean;
};

// ─── Selection screen ────────────────────────────────────────────────────────

const GAME_CARDS = [
  {
    id: "snake",
    name: "Snake",
    desc: "Classic arcade. Eat food, avoid yourself.",
    tags: ["Single-player"],
  },
  {
    id: "2048",
    name: "2048",
    desc: "Slide tiles and merge them to reach 2048.",
    tags: ["Single-player"],
  },
  {
    id: "tetris",
    name: "Tetris",
    desc: "Clear lines with falling blocks. Arrow keys to play.",
    tags: ["Single-player"],
  },
  {
    id: "ttt",
    name: "Tic-Tac-Toe",
    desc: "X vs O on a 3×3 grid. First to 3 in a row wins.",
    tags: ["Local 2P", "LAN multiplayer"],
  },
  {
    id: "rps",
    name: "Rock Paper Scissors",
    desc: "Best-of-1, 3, or 5. Choices stay hidden until both commit.",
    tags: ["Local 2P", "LAN multiplayer"],
  },
  {
    id: "dab",
    name: "Dots & Boxes",
    desc: "Draw edges, complete boxes, outscore your opponent.",
    tags: ["Local 2P", "LAN multiplayer"],
  },
] as const;

type GameId = typeof GAME_CARDS[number]["id"];

export type GameReplayFn = (peerId: string, matchId: string) => Promise<GameMsg[]>;

export function GamesHub({
  peers,
  myId,
  myName,
  sendGameMsg,
  dispatchRef,
  pendingInvite,
  onPendingConsumed,
  replayLanMoves,
}: {
  peers: Peer[];
  myId: string;
  myName: string;
  sendGameMsg: GameSendFn;
  /** Caller stores a ref so inbox-updated can route inbound messages here */
  dispatchRef: React.MutableRefObject<GameDispatchFn | null>;
  pendingInvite?: PendingGameInvite | null;
  onPendingConsumed?: () => void;
  /** Rebuild LAN board from encrypted chat history when reopening a match */
  replayLanMoves?: GameReplayFn;
}) {
  const [active, setActive] = useState<GameId | null>(null);
  const [history, setHistory] = useState<GameHistoryEntry[]>(() => loadGameHistory());
  const [sessionTick, setSessionTick] = useState(0);
  const childDispatch = useRef<GameDispatchFn | null>(null);

  useEffect(() => {
    if (!pendingInvite) return;
    setActive(pendingInvite.game);
  }, [pendingInvite]);

  // Hub dispatcher: App already calls applyInboundToSession — only fan out to
  // the mounted game UI and refresh badges. Avoid double-applying moves.
  useEffect(() => {
    dispatchRef.current = (fromId, msg) => {
      setSessionTick((n) => n + 1);
      childDispatch.current?.(fromId, msg);
    };
    return () => {
      dispatchRef.current = null;
    };
  }, [dispatchRef]);

  const back = () => {
    setActive(null);
    setSessionTick((n) => n + 1);
    setHistory(loadGameHistory());
  };

  if (active === "snake") return <Box sx={{ p: 3 }}><BackBar onBack={back} title="Snake" /><SnakeGame /></Box>;
  if (active === "2048") return <Game2048 onBack={back} />;
  if (active === "tetris") return <GameTetris onBack={back} />;
  if (active === "ttt") return (
    <TicTacToe
      onBack={back}
      peers={peers}
      myId={myId}
      myName={myName}
      sendGameMsg={sendGameMsg}
      dispatchRef={childDispatch}
      pendingInvite={pendingInvite?.game === "ttt" ? pendingInvite : null}
      onPendingConsumed={onPendingConsumed}
      onHistory={() => setHistory(loadGameHistory())}
      replayLanMoves={replayLanMoves}
    />
  );
  if (active === "rps") return (
    <RockPaperScissors
      onBack={back}
      peers={peers}
      myId={myId}
      myName={myName}
      sendGameMsg={sendGameMsg}
      dispatchRef={childDispatch}
      pendingInvite={pendingInvite?.game === "rps" ? pendingInvite : null}
      onPendingConsumed={onPendingConsumed}
      onHistory={() => setHistory(loadGameHistory())}
    />
  );
  if (active === "dab") return (
    <DotsAndBoxes
      onBack={back}
      peers={peers}
      myId={myId}
      myName={myName}
      sendGameMsg={sendGameMsg}
      dispatchRef={childDispatch}
      pendingInvite={pendingInvite?.game === "dab" ? pendingInvite : null}
      onPendingConsumed={onPendingConsumed}
      onHistory={() => setHistory(loadGameHistory())}
      replayLanMoves={replayLanMoves}
    />
  );

  void sessionTick; // re-render badges when sessions change while on this screen

  return (
    <Box sx={{ p: 3, overflow: "auto", height: "100%" }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Games
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        All games run entirely offline. LAN multiplayer uses the existing encrypted peer channel.
      </Typography>
      <Grid container spacing={2}>
        {GAME_CARDS.map((g) => {
          const badge =
            g.id === "ttt" || g.id === "rps" || g.id === "dab"
              ? sessionBadge(g.id)
              : null;
          return (
          <Grid item xs={12} sm={6} md={4} key={g.id}>
            <Card variant="outlined" sx={{ height: "100%" }}>
              <CardActionArea
                sx={{ height: "100%", p: 0.5 }}
                onClick={() => setActive(g.id as GameId)}
              >
                <CardContent>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Typography variant="h6" fontWeight={700} flex={1}>
                      {g.name}
                    </Typography>
                    {badge && <Chip size="small" color="primary" label={badge} />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {g.desc}
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={0.5}>
                    {g.tags.map((t) => (
                      <Chip
                        key={t}
                        size="small"
                        label={t}
                        color={t === "LAN multiplayer" ? "primary" : "default"}
                        variant={t === "LAN multiplayer" ? "filled" : "outlined"}
                      />
                    ))}
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
          );
        })}
      </Grid>

      <Divider sx={{ my: 3 }} />
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="h6" fontWeight={700} flex={1}>
          Recent matches
        </Typography>
        {history.length > 0 && (
          <Button
            size="small"
            onClick={() => {
              clearGameHistory();
              setHistory([]);
            }}
          >
            Clear
          </Button>
        )}
      </Stack>
      {!history.length ? (
        <Typography variant="body2" color="text.secondary">
          Finished LAN games will show up here.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {history.slice(0, 12).map((h) => (
            <Box
              key={h.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                px: 1.5,
                py: 1,
                borderRadius: 2,
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
              }}
            >
              <Box flex={1} minWidth={0}>
                <Typography fontWeight={700} fontSize={14} noWrap>
                  {gameLabel(h.game)} · vs {h.opponentName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatHistoryWhen(h.at)}
                  {h.detail ? ` · ${h.detail}` : ""}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={h.outcome === "win" ? "Won" : h.outcome === "lose" ? "Lost" : "Draw"}
                color={h.outcome === "win" ? "success" : h.outcome === "lose" ? "error" : "default"}
              />
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}

function formatHistoryWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Update persisted LAN session when the game screen is not mounted. */
export function applyInboundToSession(
  fromId: string,
  msg: GameMsg,
  peers: Peer[],
  myId: string
) {
  const peer = peers.find((p) => p.user_id === fromId);
  const peerName = peer?.display_name || "Peer";

  if (msg.game === "ttt") {
    const p = msg.payload as TttMsg;
    const s = getTttSession();
    if (p.type === "invite") {
      if (s && s.mpPhase !== "idle" && s.mpPhase !== "done") return;
      setTttSession({
        mode: "lan",
        mpPhase: "invited",
        opponentId: fromId,
        opponentName: peerName,
        myRole: "O",
        matchId: p.matchId,
        state: newTttState(),
        seq: 0,
        inboundInvite: { fromId, matchId: p.matchId },
        mpError: "",
      });
      return;
    }
    if (!s) return;
    if ("matchId" in p && p.matchId && s.matchId && p.matchId !== s.matchId) {
      return;
    }
    if (p.type === "accept" && s.mpPhase === "inviting") {
      setTttSession({ ...s, mpPhase: "playing", mpError: "" });
    } else if (p.type === "decline" && s.mpPhase === "inviting") {
      setTttSession(null);
    } else if (p.type === "move" && (s.mpPhase === "playing" || s.mpPhase === "done")) {
      // Prefer authoritative boardAfter so returning to a match stays in sync
      // even if a prior move was missed while the Games UI was unmounted.
      let next: TttState | null = null;
      if (Array.isArray(p.boardAfter) && p.boardAfter.length === 9) {
        next = tttStateFromBoard(p.boardAfter);
      } else {
        const expected = s.myRole === "X" ? "O" : "X";
        if (s.state.turn === expected) next = tttMove(s.state, p.index);
      }
      if (!next) return;
      setTttSession({
        ...s,
        state: next,
        seq: s.seq + 1,
        mpPhase: next.winner !== null ? "done" : "playing",
      });
      if (next.winner !== null) {
        const winnerId =
          next.winner === "draw" ? null : next.winner === s.myRole ? myId : fromId;
        pushGameHistory({
          game: "ttt",
          matchId: s.matchId,
          opponentId: fromId,
          opponentName: s.opponentName,
          outcome: winnerId === null ? "draw" : winnerId === myId ? "win" : "lose",
        });
      }
    } else if (p.type === "result") {
      const outcome =
        p.winnerId == null ? "draw" : p.winnerId === myId ? "win" : "lose";
      pushGameHistory({
        game: "ttt",
        matchId: p.matchId || s.matchId,
        opponentId: fromId,
        opponentName: s.opponentName,
        outcome,
      });
      setTttSession({ ...s, mpPhase: "done" });
    } else if (p.type === "resign") {
      pushGameHistory({
        game: "ttt",
        matchId: p.matchId || s.matchId,
        opponentId: fromId,
        opponentName: s.opponentName,
        outcome: "win",
        detail: "Opponent resigned",
      });
      setTttSession({ ...s, mpPhase: "done", mpError: `${peerName} resigned.` });
    } else if (p.type === "rematch") {
      setTttSession({
        ...s,
        state: newTttState(),
        seq: 0,
        mpPhase: "playing",
        myRole: s.myRole === "X" ? "O" : "X",
        mpError: "",
      });
    }
    return;
  }

  if (msg.game === "rps") {
    const p = msg.payload as RpsMsg;
    const s = getRpsSession();
    if (p.type === "invite") {
      if (s && s.mpPhase !== "idle" && s.mpPhase !== "done") return;
      setRpsSession({
        mode: "lan",
        mpPhase: "invited",
        opponentId: fromId,
        opponentName: peerName,
        matchId: p.matchId,
        format: p.format,
        state: newRpsState(p.format),
        myChoice: null,
        theyCommitted: false,
        theirReveal: null,
        inboundInvite: { fromId, matchId: p.matchId, format: p.format },
        mpError: "",
      });
      return;
    }
    if (!s) return;
    if (p.type === "accept" && s.mpPhase === "inviting") {
      setRpsSession({
        ...s,
        mpPhase: "playing",
        state: newRpsState(s.format),
        myChoice: null,
        theyCommitted: false,
        theirReveal: null,
        mpError: "",
      });
    } else if (p.type === "decline" && s.mpPhase === "inviting") {
      setRpsSession(null);
    } else if (p.type === "commit" && s.mpPhase === "playing") {
      setRpsSession({ ...s, theyCommitted: true });
    } else if (p.type === "reveal" && s.mpPhase === "playing") {
      let nextSession: typeof s = { ...s, theirReveal: p.choice };
      if (s.myChoice) {
        const next = rpsResolveRound(s.state, s.myChoice, p.choice);
        nextSession = {
          ...s,
          state: next,
          myChoice: null,
          theyCommitted: false,
          theirReveal: null,
          mpPhase: next.phase === "done" ? "done" : "playing",
        };
        if (next.phase === "done") {
          const needed = Math.ceil(s.format / 2);
          const winnerId =
            next.myScore >= needed ? myId : next.theirScore >= needed ? fromId : null;
          pushGameHistory({
            game: "rps",
            matchId: s.matchId,
            opponentId: fromId,
            opponentName: s.opponentName,
            outcome: winnerId === null ? "draw" : winnerId === myId ? "win" : "lose",
            detail: `Best of ${s.format}`,
          });
        }
      }
      setRpsSession(nextSession);
    } else if (p.type === "result") {
      const outcome =
        p.winnerId == null ? "draw" : p.winnerId === myId ? "win" : "lose";
      pushGameHistory({
        game: "rps",
        matchId: p.matchId || s.matchId,
        opponentId: fromId,
        opponentName: s.opponentName,
        outcome,
        detail: `Best of ${s.format}`,
      });
      setRpsSession({ ...s, mpPhase: "done" });
    } else if (p.type === "resign") {
      pushGameHistory({
        game: "rps",
        matchId: p.matchId || s.matchId,
        opponentId: fromId,
        opponentName: s.opponentName,
        outcome: "win",
        detail: "Opponent resigned",
      });
      setRpsSession({ ...s, mpPhase: "done", mpError: `${peerName} resigned.` });
    }
    return;
  }

  if (msg.game === "dab") {
    const p = msg.payload as DabMsg;
    const s = getDabSession();
    if (p.type === "invite") {
      if (s && s.mpPhase !== "idle" && s.mpPhase !== "done") return;
      setDabSession({
        mode: "lan",
        mpPhase: "invited",
        opponentId: fromId,
        opponentName: peerName,
        myPlayer: "B",
        matchId: p.matchId,
        state: newDabState(p.rows, p.cols),
        seq: 0,
        rows: p.rows,
        cols: p.cols,
        inboundInvite: { fromId, matchId: p.matchId, rows: p.rows, cols: p.cols },
        mpError: "",
      });
      return;
    }
    if (!s) return;
    if (p.type === "accept" && s.mpPhase === "inviting") {
      setDabSession({ ...s, mpPhase: "playing", mpError: "" });
    } else if (p.type === "decline" && s.mpPhase === "inviting") {
      setDabSession(null);
    } else if (p.type === "move" && (s.mpPhase === "playing" || s.mpPhase === "done")) {
      // Apply by edge; if turn guard would reject (missed prior moves), try anyway
      // after forcing turn to the expected player so the board catches up.
      let base = s.state;
      const expected = s.myPlayer === "A" ? "B" : "A";
      if (base.turn !== expected) {
        base = { ...base, turn: expected };
      }
      const next = dabMove(base, p.edge);
      if (!next) return;
      setDabSession({
        ...s,
        state: next,
        seq: p.seq,
        mpPhase: next.done ? "done" : "playing",
      });
      if (next.done) {
        const winnerId =
          next.scoreA === next.scoreB
            ? null
            : next.scoreA > next.scoreB
              ? s.myPlayer === "A"
                ? myId
                : fromId
              : s.myPlayer === "B"
                ? myId
                : fromId;
        pushGameHistory({
          game: "dab",
          matchId: s.matchId,
          opponentId: fromId,
          opponentName: s.opponentName,
          outcome: winnerId === null ? "draw" : winnerId === myId ? "win" : "lose",
          detail: `${next.scoreA}–${next.scoreB}`,
        });
      }
    } else if (p.type === "result") {
      const outcome =
        p.winnerId == null ? "draw" : p.winnerId === myId ? "win" : "lose";
      pushGameHistory({
        game: "dab",
        matchId: p.matchId || s.matchId,
        opponentId: fromId,
        opponentName: s.opponentName,
        outcome,
      });
      setDabSession({ ...s, mpPhase: "done" });
    } else if (p.type === "resign") {
      pushGameHistory({
        game: "dab",
        matchId: p.matchId || s.matchId,
        opponentId: fromId,
        opponentName: s.opponentName,
        outcome: "win",
        detail: "Opponent resigned",
      });
      setDabSession({ ...s, mpPhase: "done", mpError: `${peerName} resigned.` });
    }
  }
}

// ─── Back button helper ───────────────────────────────────────────────────────

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
      <IconButton onClick={onBack} size="small" aria-label="Back to games">
        <ArrowBackIcon />
      </IconButton>
      <Typography variant="h6" fontWeight={700}>{title}</Typography>
    </Stack>
  );
}

// ─── Peer picker dialog for LAN multiplayer ───────────────────────────────────

function PeerPickerDialog({
  open,
  peers,
  title,
  onPick,
  onClose,
}: {
  open: boolean;
  peers: Peer[];
  title: string;
  onPick: (peer: Peer) => void;
  onClose: () => void;
}) {
  const online = peers.filter((p) => p.online);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {!online.length && (
          <Box sx={{ p: 2 }}>
            <Alert severity="info">No online peers on this LAN.</Alert>
          </Box>
        )}
        <List dense>
          {online.map((p) => (
            <ListItemButton key={p.user_id} onClick={() => onPick(p)}>
              <ListItemText primary={p.display_name} />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Shared multiplayer state machine types ───────────────────────────────────

type MpPhase = SessionMpPhase;

function peerFromSession(peers: Peer[], id: string, name: string): Peer {
  return (
    peers.find((p) => p.user_id === id) || {
      user_id: id,
      display_name: name,
      x25519_public: "",
      ed25519_public: "",
    }
  );
}

// ─── Tetris ──────────────────────────────────────────────────────────────────

const TETRIS_COLORS: Record<number, string> = {
  0: "action.hover",
  1: "#00f0f0", // I
  2: "#f0f000", // O
  3: "#a000f0", // T
  4: "#00f000", // S
  5: "#f00000", // Z
  6: "#0000f0", // J
  7: "#f0a000", // L
};

function GameTetris({ onBack }: { onBack: () => void }) {
  const savedBest = () => Number(localStorage.getItem("peerchat.tetris.best") || "0");
  const [state, setState] = useState(() => newTetrisState(savedBest()));
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (state.best > savedBest()) {
      localStorage.setItem("peerchat.tetris.best", String(state.best));
    }
  }, [state.best]);

  useEffect(() => {
    if (state.over || paused) return;
    const id = window.setInterval(() => {
      setState((prev) => tickGravity(prev));
    }, gravityMs(state.level));
    return () => window.clearInterval(id);
  }, [state.over, state.level, paused]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        setPaused((p) => !p);
        return;
      }
      if (paused || state.over) return;
      const actions: Record<string, () => void> = {
        ArrowLeft: () => setState((s) => moveLeft(s)),
        ArrowRight: () => setState((s) => moveRight(s)),
        ArrowDown: () => setState((s) => softDrop(s)),
        ArrowUp: () => setState((s) => rotateCW(s)),
        " ": () => setState((s) => hardDrop(s)),
        x: () => setState((s) => rotateCW(s)),
        X: () => setState((s) => rotateCW(s)),
      };
      const fn = actions[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, state.over]);

  const restart = () => {
    setPaused(false);
    setState(newTetrisState(savedBest()));
  };

  const cells = renderBoard(state);
  const cellPx = 22;
  const preview = previewCells(state.next);

  return (
    <Box sx={{ p: 3 }}>
      <BackBar onBack={onBack} title="Tetris" />
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap">
        <Chip label={`Score: ${state.score}`} />
        <Chip label={`Best: ${state.best}`} color="primary" />
        <Chip label={`Lines: ${state.lines}`} />
        <Chip label={`Level: ${state.level}`} />
        <Box flex={1} />
        <Button size="small" variant="outlined" onClick={() => setPaused((p) => !p)} disabled={state.over}>
          {paused ? "Resume" : "Pause"}
        </Button>
        <Tooltip title="Restart">
          <IconButton size="small" onClick={restart}>
            <RestartAltIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {state.over && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Game over! Score: {state.score}
          <Button size="small" sx={{ ml: 1 }} onClick={restart}>
            Restart
          </Button>
        </Alert>
      )}
      {paused && !state.over && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Paused — press P to resume
        </Alert>
      )}

      <Stack direction="row" spacing={3} alignItems="flex-start">
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(${TETRIS_COLS}, ${cellPx}px)`,
            gap: "1px",
            bgcolor: "divider",
            p: "2px",
            borderRadius: 1,
            width: "fit-content",
          }}
        >
          {cells.map((val, i) => (
            <Box
              key={i}
              sx={{
                width: cellPx,
                height: cellPx,
                bgcolor: TETRIS_COLORS[val] ?? "action.hover",
                borderRadius: 0.4,
              }}
            />
          ))}
        </Box>
        <Stack spacing={1.5}>
          <Typography variant="subtitle2" fontWeight={700}>
            Next
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 18px)",
              gap: "1px",
              width: "fit-content",
              minHeight: 76,
            }}
          >
            {Array.from({ length: 16 }, (_, i) => {
              const x = i % 4;
              const y = Math.floor(i / 4);
              const on = preview.some((p) => p.x === x && p.y === y);
              return (
                <Box
                  key={i}
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: 0.3,
                    bgcolor: on ? TETRIS_COLORS[state.next + 1] : "transparent",
                  }}
                />
              );
            })}
          </Box>
          <Typography variant="caption" color="text.secondary">
            ← → move · ↑ / X rotate · ↓ soft drop · Space hard drop · P pause
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}

// ─── 2048 ────────────────────────────────────────────────────────────────────

function Game2048({ onBack }: { onBack: () => void }) {
  const savedBest = () => Number(localStorage.getItem("peerchat.2048.best") || "0");
  const [state, setState] = useState(() => new2048State(savedBest()));

  // Persist best score
  useEffect(() => {
    if (state.best > savedBest()) {
      localStorage.setItem("peerchat.2048.best", String(state.best));
    }
  }, [state.best]);

  const handleDir = useCallback(
    (dir: Direction) => {
      setState((prev) => {
        const next = move2048(prev, dir);
        return next ?? prev;
      });
    },
    []
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const map: Record<string, Direction> = {
        ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
        w: "up", s: "down", a: "left", d: "right",
        W: "up", S: "down", A: "left", D: "right",
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      handleDir(dir);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleDir]);

  const restart = () => setState(new2048State(savedBest()));
  const undoFn = () => setState((prev) => undo2048(prev) ?? prev);

  const tileColor: Record<number, string> = {
    0: "action.hover", 2: "#eee4da", 4: "#ede0c8", 8: "#f2b179",
    16: "#f59563", 32: "#f67c5f", 64: "#f65e3b", 128: "#edcf72",
    256: "#edcc61", 512: "#edc850", 1024: "#edc53f", 2048: "#edc22e",
  };

  return (
    <Box sx={{ p: 3 }}>
      <BackBar onBack={onBack} title="2048" />
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Chip label={`Score: ${state.score}`} />
        <Chip label={`Best: ${state.best}`} color="primary" />
        <Box flex={1} />
        <Tooltip title="Undo">
          <span>
            <IconButton size="small" onClick={undoFn} disabled={!state.history.length}>
              <UndoIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Restart">
          <IconButton size="small" onClick={restart}>
            <RestartAltIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      {state.won && !state.over && (
        <Alert severity="success" sx={{ mb: 1 }}>
          You reached 2048! Keep going or restart.
        </Alert>
      )}
      {state.over && (
        <Alert severity="error" sx={{ mb: 1 }}>
          Game over! Score: {state.score}
          <Button size="small" sx={{ ml: 1 }} onClick={restart}>Restart</Button>
        </Alert>
      )}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 72px)",
          gap: "6px",
          bgcolor: "divider",
          p: "6px",
          borderRadius: 2,
          width: "fit-content",
        }}
      >
        {state.board.map((val, i) => (
          <Box
            key={i}
            sx={{
              width: 72,
              height: 72,
              borderRadius: 1.5,
              bgcolor: tileColor[val] ?? "#3c3a32",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {val !== 0 && (
              <Typography
                fontWeight={800}
                sx={{
                  fontSize: val >= 1024 ? 18 : val >= 128 ? 22 : 28,
                  color: val <= 4 ? "#776e65" : "#f9f6f2",
                }}
              >
                {val}
              </Typography>
            )}
          </Box>
        ))}
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: "block" }}>
        Arrow keys or WASD to move tiles.
      </Typography>
    </Box>
  );
}

// ─── Tic-Tac-Toe ─────────────────────────────────────────────────────────────

type TttMode = "local" | "lan";
type TttLanRole = "X" | "O"; // which symbol I am

function TicTacToe({
  onBack, peers, myId, myName, sendGameMsg, dispatchRef, pendingInvite, onPendingConsumed, onHistory, replayLanMoves,
}: {
  onBack: () => void;
  peers: Peer[];
  myId: string;
  myName: string;
  sendGameMsg: GameSendFn;
  dispatchRef: React.MutableRefObject<GameDispatchFn | null>;
  pendingInvite?: PendingGameInvite | null;
  onPendingConsumed?: () => void;
  onHistory?: () => void;
  replayLanMoves?: GameReplayFn;
}) {
  const [mode, setMode] = useState<TttMode>("local");
  const [state, setState] = useState<TttState>(newTttState);
  const [mpPhase, setMpPhase] = useState<MpPhase>("idle");
  const [opponent, setOpponent] = useState<Peer | null>(null);
  const [myRole, setMyRole] = useState<TttLanRole>("X");
  const [matchId, setMatchId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inboundInvite, setInboundInvite] = useState<{ from: Peer; matchId: string } | null>(null);
  const [mpError, setMpError] = useState("");
  const [seq, setSeq] = useState(0); // move sequence for ordering
  const pendingConsumed = useRef(false);
  const restored = useRef(false);
  const replayed = useRef(false);

  // Restore LAN session when returning to this game.
  useEffect(() => {
    if (restored.current || pendingInvite) return;
    const s = getTttSession();
    if (!s) return;
    restored.current = true;
    setMode("lan");
    setMpPhase(s.mpPhase);
    setMatchId(s.matchId);
    setMyRole(s.myRole);
    setState(s.state);
    setSeq(s.seq);
    setMpError(s.mpError);
    const peer = peerFromSession(peers, s.opponentId, s.opponentName);
    setOpponent(peer);
    if (s.inboundInvite || s.mpPhase === "invited") {
      setInboundInvite({
        from: peer,
        matchId: s.inboundInvite?.matchId || s.matchId,
      });
    }
  }, [peers, pendingInvite]);

  // Reconcile board from chat history (fixes "stuck on opponent's turn" after leaving).
  useEffect(() => {
    if (!replayLanMoves || !opponent || !matchId || mode !== "lan") return;
    if (mpPhase !== "playing" && mpPhase !== "done") return;
    if (replayed.current) return;
    replayed.current = true;
    let cancel = false;
    void (async () => {
      try {
        const msgs = await replayLanMoves(opponent.user_id, matchId);
        if (cancel || !msgs.length) return;
        let board = newTttState();
        let role: TttLanRole = myRole;
        let phase: MpPhase = "playing";
        let moveCount = 0;
        for (const msg of msgs) {
          if (msg.game !== "ttt") continue;
          const p = msg.payload as TttMsg;
          if (p.type === "accept") phase = "playing";
          if (p.type === "move") {
            if (Array.isArray(p.boardAfter) && p.boardAfter.length === 9) {
              board = tttStateFromBoard(p.boardAfter);
            } else {
              board = tttMove(board, p.index) ?? board;
            }
            moveCount += 1;
            phase = board.winner !== null ? "done" : "playing";
          }
          if (p.type === "rematch") {
            board = newTttState();
            role = role === "X" ? "O" : "X";
            phase = "playing";
            moveCount = 0;
          }
          if (p.type === "result" || p.type === "resign") phase = "done";
        }
        if (cancel) return;
        setState(board);
        setMyRole(role);
        setMpPhase(phase);
        setSeq(moveCount);
      } catch {
        /* keep restored session */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [replayLanMoves, opponent, matchId, mode, mpPhase, myRole]);

  // Persist LAN session so leaving the screen does not lose invite/play state.
  useEffect(() => {
    if (mode !== "lan") return;
    if (mpPhase === "idle" || !opponent) {
      setTttSession(null);
      return;
    }
    setTttSession({
      mode: "lan",
      mpPhase,
      opponentId: opponent.user_id,
      opponentName: opponent.display_name,
      myRole,
      matchId,
      state,
      seq,
      inboundInvite: inboundInvite
        ? { fromId: inboundInvite.from.user_id, matchId: inboundInvite.matchId }
        : null,
      mpError,
    });
  }, [mode, mpPhase, opponent, myRole, matchId, state, seq, inboundInvite, mpError]);

  useEffect(() => {
    if (!pendingInvite || pendingInvite.game !== "ttt" || pendingConsumed.current) return;
    const fromPeer = peers.find((p) => p.user_id === pendingInvite.fromId);
    if (!fromPeer) return;
    pendingConsumed.current = true;
    if (pendingInvite.openOnly) {
      // Already accepted — jump into match; prefer session, else empty board + replay.
      const s = getTttSession();
      setMode("lan");
      setOpponent(fromPeer);
      setMatchId(pendingInvite.matchId);
      if (s && s.matchId === pendingInvite.matchId) {
        setMyRole(s.myRole);
        setMpPhase(s.mpPhase === "idle" ? "playing" : s.mpPhase);
        setState(s.state);
        setSeq(s.seq);
        setMpError(s.mpError);
      } else {
        setMyRole("O");
        setMpPhase("playing");
        setState(newTttState());
        setSeq(0);
      }
      restored.current = true;
      replayed.current = false;
      onPendingConsumed?.();
      return;
    }
    setOpponent(fromPeer);
    setMatchId(pendingInvite.matchId);
    setMyRole("O");
    setMode("lan");
    setMpPhase("playing");
    setState(newTttState());
    setSeq(0);
    sendGameMsg(fromPeer.user_id, {
      game: "ttt",
      payload: { type: "accept", matchId: pendingInvite.matchId },
    }).catch(() => setMpError("Failed to accept invite."));
    onPendingConsumed?.();
  }, [pendingInvite, peers, sendGameMsg, onPendingConsumed]);

  const sendMsg = useCallback(
    async (payload: TttMsg) => {
      if (!opponent) return;
      await sendGameMsg(opponent.user_id, { game: "ttt", payload });
    },
    [opponent, sendGameMsg]
  );

  // Register inbound dispatcher
  useEffect(() => {
    dispatchRef.current = (fromId: string, msg: GameMsg) => {
      if (msg.game !== "ttt") return;
      const p = msg.payload as TttMsg;
      const fromPeer = peers.find((x) => x.user_id === fromId);
      if (!fromPeer) return;

      if (p.type === "invite") {
        if (mpPhase !== "idle") return; // already in a game
        setInboundInvite({ from: fromPeer, matchId: p.matchId });
        setMpPhase("invited");
        setOpponent(fromPeer);
        setMatchId(p.matchId);
        setMyRole("O"); // invitee is always O
      }
      if (p.type === "accept" && mpPhase === "inviting") {
        setMpPhase("playing");
        setMpError("");
      }
      if (p.type === "decline" && mpPhase === "inviting") {
        setMpPhase("idle");
        setMpError(`${fromPeer.display_name} declined.`);
        setOpponent(null);
        setTttSession(null);
      }
      if (
        p.type === "move" &&
        (mpPhase === "playing" || mpPhase === "done") &&
        p.matchId === matchId
      ) {
        setState((prev) => {
          if (prev.winner !== null && Array.isArray(p.boardAfter) && p.boardAfter.length === 9) {
            // Late snapshot after result — still paint the winning board.
            return tttStateFromBoard(p.boardAfter) ?? prev;
          }
          if (prev.winner !== null) return prev;
          let next: TttState | null = null;
          if (Array.isArray(p.boardAfter) && p.boardAfter.length === 9) {
            next = tttStateFromBoard(p.boardAfter);
          } else {
            const expectedTurn = myRole === "X" ? "O" : "X";
            if (prev.turn === expectedTurn) next = tttMove(prev, p.index);
          }
          if (!next) return prev;
          if (next.winner !== null) {
            setMpPhase("done");
            const winnerId =
              next.winner === "draw" ? null : next.winner === myRole ? myId : fromId;
            pushGameHistory({
              game: "ttt",
              matchId: p.matchId,
              opponentId: fromId,
              opponentName: fromPeer.display_name,
              outcome: winnerId === null ? "draw" : winnerId === myId ? "win" : "lose",
            });
            onHistory?.();
            void sendGameMsg(fromId, {
              game: "ttt",
              payload: { type: "result", matchId: p.matchId, winnerId },
            });
          }
          return next;
        });
        setSeq((s) => s + 1);
      }
      if (p.type === "result" && p.matchId === matchId) {
        setMpPhase("done");
      }
      if (p.type === "rematch" && mpPhase === "done") {
        setState(newTttState());
        setMpPhase("playing");
        setSeq(0);
        // Roles swap on rematch
        setMyRole((r) => (r === "X" ? "O" : "X"));
      }
      if (p.type === "resign") {
        setMpPhase("done");
        setMpError(`${fromPeer.display_name} resigned.`);
        pushGameHistory({
          game: "ttt",
          matchId: p.matchId || matchId,
          opponentId: fromId,
          opponentName: fromPeer.display_name,
          outcome: "win",
          detail: "Opponent resigned",
        });
        onHistory?.();
        void sendGameMsg(fromId, {
          game: "ttt",
          payload: { type: "result", matchId: p.matchId || matchId, winnerId: myId },
        });
      }
    };
    return () => { dispatchRef.current = null; };
  }, [mpPhase, peers, matchId, myRole, myId, dispatchRef, sendGameMsg, onHistory]);

  function recordTttHistory(outcome: "win" | "lose" | "draw", detail?: string) {
    if (!opponent || !matchId) return;
    pushGameHistory({
      game: "ttt",
      matchId,
      opponentId: opponent.user_id,
      opponentName: opponent.display_name,
      outcome,
      detail,
    });
    onHistory?.();
  }

  function startLocalGame() {
    setMode("local");
    setState(newTttState());
    setMpPhase("idle");
    setOpponent(null);
    setInboundInvite(null);
    setTttSession(null);
  }

  function handleInvite(peer: Peer) {
    setPickerOpen(false);
    const mid = `ttt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMatchId(mid);
    setOpponent(peer);
    setMyRole("X");
    setMpPhase("inviting");
    setMode("lan");
    setState(newTttState());
    setSeq(0);
    setInboundInvite(null);
    sendGameMsg(peer.user_id, {
      game: "ttt",
      payload: { type: "invite", matchId: mid, fromName: myName },
    }).catch(() => setMpError("Failed to send invite."));
  }

  function acceptInvite() {
    if (!inboundInvite) return;
    setInboundInvite(null);
    setMpPhase("playing");
    setMode("lan");
    setState(newTttState());
    setSeq(0);
    sendMsg({ type: "accept", matchId });
  }

  function declineInvite() {
    if (!inboundInvite) return;
    sendMsg({ type: "decline", matchId });
    setInboundInvite(null);
    setMpPhase("idle");
    setOpponent(null);
    setTttSession(null);
  }

  async function publishTttResult(next: TttState) {
    if (mode !== "lan" || !opponent || !matchId) return;
    if (next.winner === null) return;
    const winnerId =
      next.winner === "draw" ? null : next.winner === myRole ? myId : opponent.user_id;
    recordTttHistory(winnerId === null ? "draw" : winnerId === myId ? "win" : "lose");
    await sendMsg({ type: "result", matchId, winnerId });
  }

  async function handleCellClick(index: number) {
    if (mode === "local") {
      setState((prev) => tttMove(prev, index) ?? prev);
      return;
    }
    // LAN: only move on my turn
    if (mpPhase !== "playing") return;
    if (state.turn !== myRole) return;
    const next = tttMove(state, index);
    if (!next) return;
    setState(next);
    const newSeq = seq + 1;
    setSeq(newSeq);
    if (next.winner !== null || next.board.every((c) => c !== null)) setMpPhase("done");
    await sendMsg({ type: "move", matchId, index, boardAfter: next.board });
    if (next.winner !== null) await publishTttResult(next);
  }

  async function handleRematch() {
    setState(newTttState());
    setSeq(0);
    if (mode === "lan") {
      setMpPhase("playing");
      setMyRole((r) => (r === "X" ? "O" : "X"));
      await sendMsg({ type: "rematch", matchId });
    }
  }

  const canMove = mode === "local" || (mpPhase === "playing" && state.turn === myRole);
  const statusLabel = () => {
    if (state.winner === "draw") return "Draw!";
    if (state.winner) return mode === "local" ? `${state.winner} wins!` : (state.winner === myRole ? "You win!" : "You lose!");
    if (mode === "lan") {
      if (mpPhase === "inviting") return `Waiting for ${opponent?.display_name}…`;
      if (mpPhase === "invited") return `${opponent?.display_name} invited you`;
      if (mpPhase === "playing") return state.turn === myRole ? "Your turn" : `${opponent?.display_name}'s turn`;
    }
    return `${state.turn}'s turn`;
  };

  const COLORS = { X: "primary.main", O: "error.main" };

  return (
    <Box sx={{ p: 3 }}>
      <BackBar onBack={onBack} title="Tic-Tac-Toe" />

      {/* Inbound invite dialog */}
      <Dialog open={!!inboundInvite}>
        <DialogTitle>Game invite</DialogTitle>
        <DialogContent>
          <Typography>{inboundInvite?.from.display_name} invited you to Tic-Tac-Toe.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={declineInvite}>Decline</Button>
          <Button variant="contained" onClick={acceptInvite}>Accept</Button>
        </DialogActions>
      </Dialog>

      <PeerPickerDialog
        open={pickerOpen}
        peers={peers.filter((p) => p.user_id !== myId)}
        title="Invite to Tic-Tac-Toe"
        onPick={handleInvite}
        onClose={() => setPickerOpen(false)}
      />

      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Button variant={mode === "local" ? "contained" : "outlined"} size="small" onClick={startLocalGame}>
          Local 2P
        </Button>
        <Button variant="outlined" size="small" onClick={() => setPickerOpen(true)}>
          LAN invite…
        </Button>
        {mode === "lan" && opponent && (
          <Chip size="small" label={`vs ${opponent.display_name} (you=${myRole})`} color="primary" />
        )}
      </Stack>

      {mpError && <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setMpError("")}>{mpError}</Alert>}

      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
        {statusLabel()}
      </Typography>

      {/* Board */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 80px)",
          gridTemplateRows: "repeat(3, 80px)",
          gap: "4px",
          width: "fit-content",
        }}
      >
        {state.board.map((cell, i) => {
          const isWin = state.winLine?.includes(i);
          return (
            <Box
              key={i}
              onClick={() => handleCellClick(i)}
              sx={{
                width: 80,
                height: 80,
                border: "2px solid",
                borderColor: isWin ? "success.main" : "divider",
                borderRadius: 2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: canMove && !cell && !state.winner ? "pointer" : "default",
                bgcolor: isWin ? "success.light" : "background.paper",
                transition: "background 0.15s",
                "&:hover": canMove && !cell && !state.winner ? { bgcolor: "action.hover" } : {},
              }}
            >
              {cell && (
                <Typography
                  sx={{ fontSize: 40, fontWeight: 800, color: COLORS[cell] }}
                >
                  {cell}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>

      {state.winner !== null && (
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleRematch}>
          {mode === "lan" ? "Rematch" : "Play again"}
        </Button>
      )}
    </Box>
  );
}

// ─── Rock Paper Scissors ──────────────────────────────────────────────────────

const CHOICE_EMOJI: Record<RpsChoice, string> = { rock: "✊", paper: "✋", scissors: "✌️" };

function RockPaperScissors({
  onBack, peers, myId, myName, sendGameMsg, dispatchRef, pendingInvite, onPendingConsumed, onHistory,
}: {
  onBack: () => void;
  peers: Peer[];
  myId: string;
  myName: string;
  sendGameMsg: GameSendFn;
  dispatchRef: React.MutableRefObject<GameDispatchFn | null>;
  pendingInvite?: PendingGameInvite | null;
  onPendingConsumed?: () => void;
  onHistory?: () => void;
}) {
  const [mode, setMode] = useState<"local" | "lan">("local");
  const [format, setFormat] = useState<MatchFormat>(3);
  const [state, setState] = useState<RpsState>(() => newRpsState(3));
  const [localP1Choice, setLocalP1Choice] = useState<RpsChoice | null>(null);
  const [localP2Choice, setLocalP2Choice] = useState<RpsChoice | null>(null);
  const [localRevealed, setLocalRevealed] = useState(false);

  // LAN state
  const [mpPhase, setMpPhase] = useState<MpPhase>("idle");
  const [opponent, setOpponent] = useState<Peer | null>(null);
  const [matchId, setMatchId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inboundInvite, setInboundInvite] = useState<{ from: Peer; matchId: string; format: MatchFormat } | null>(null);
  const [myChoice, setMyChoice] = useState<RpsChoice | null>(null);
  const [theyCommitted, setTheyCommitted] = useState(false);
  const [theirReveal, setTheirReveal] = useState<RpsChoice | null>(null);
  const [mpError, setMpError] = useState("");
  const pendingConsumed = useRef(false);
  const restored = useRef(false);

  const roundNum = state.rounds.length;

  useEffect(() => {
    if (restored.current || pendingInvite) return;
    const s = getRpsSession();
    if (!s) return;
    restored.current = true;
    setMode("lan");
    setMpPhase(s.mpPhase);
    setMatchId(s.matchId);
    setFormat(s.format);
    setState(s.state);
    setMyChoice(s.myChoice);
    setTheyCommitted(s.theyCommitted);
    setTheirReveal(s.theirReveal);
    setMpError(s.mpError);
    const peer = peerFromSession(peers, s.opponentId, s.opponentName);
    setOpponent(peer);
    if (s.inboundInvite || s.mpPhase === "invited") {
      setInboundInvite({
        from: peer,
        matchId: s.inboundInvite?.matchId || s.matchId,
        format: s.inboundInvite?.format || s.format,
      });
    }
  }, [peers, pendingInvite]);

  useEffect(() => {
    if (mode !== "lan") return;
    if (mpPhase === "idle" || !opponent) {
      setRpsSession(null);
      return;
    }
    setRpsSession({
      mode: "lan",
      mpPhase,
      opponentId: opponent.user_id,
      opponentName: opponent.display_name,
      matchId,
      format,
      state,
      myChoice,
      theyCommitted,
      theirReveal,
      inboundInvite: inboundInvite
        ? { fromId: inboundInvite.from.user_id, matchId: inboundInvite.matchId, format: inboundInvite.format }
        : null,
      mpError,
    });
  }, [mode, mpPhase, opponent, matchId, format, state, myChoice, theyCommitted, theirReveal, inboundInvite, mpError]);

  useEffect(() => {
    if (!pendingInvite || pendingInvite.game !== "rps" || pendingConsumed.current) return;
    const fromPeer = peers.find((p) => p.user_id === pendingInvite.fromId);
    if (!fromPeer) return;
    pendingConsumed.current = true;
    if (pendingInvite.openOnly) {
      const s = getRpsSession();
      const fmt = (pendingInvite.format || s?.format || 3) as MatchFormat;
      setFormat(fmt);
      setOpponent(fromPeer);
      setMatchId(pendingInvite.matchId);
      setMode("lan");
      if (s && s.matchId === pendingInvite.matchId) {
        setMpPhase(s.mpPhase === "idle" ? "playing" : s.mpPhase);
        setState(s.state);
        setMyChoice(s.myChoice);
        setTheyCommitted(s.theyCommitted);
        setTheirReveal(s.theirReveal);
        setMpError(s.mpError);
      } else {
        setMpPhase("playing");
        setState(newRpsState(fmt));
        setMyChoice(null);
        setTheyCommitted(false);
        setTheirReveal(null);
      }
      restored.current = true;
      onPendingConsumed?.();
      return;
    }
    const fmt = (pendingInvite.format || 3) as MatchFormat;
    setFormat(fmt);
    setOpponent(fromPeer);
    setMatchId(pendingInvite.matchId);
    setMode("lan");
    setMpPhase("playing");
    setState(newRpsState(fmt));
    setMyChoice(null);
    setTheyCommitted(false);
    setTheirReveal(null);
    sendGameMsg(fromPeer.user_id, {
      game: "rps",
      payload: { type: "accept", matchId: pendingInvite.matchId },
    }).catch(() => setMpError("Failed to accept invite."));
    onPendingConsumed?.();
  }, [pendingInvite, peers, sendGameMsg, onPendingConsumed]);

  const sendMsg = useCallback(
    async (payload: RpsMsg) => {
      if (!opponent) return;
      await sendGameMsg(opponent.user_id, { game: "rps", payload });
    },
    [opponent, sendGameMsg]
  );

  useEffect(() => {
    dispatchRef.current = (fromId: string, msg: GameMsg) => {
      if (msg.game !== "rps") return;
      const p = msg.payload as RpsMsg;
      const fromPeer = peers.find((x) => x.user_id === fromId);
      if (!fromPeer) return;

      if (p.type === "invite") {
        if (mpPhase !== "idle") return;
        setInboundInvite({ from: fromPeer, matchId: p.matchId, format: p.format });
        setMpPhase("invited");
        setOpponent(fromPeer);
        setMatchId(p.matchId);
      }
      if (p.type === "accept" && mpPhase === "inviting") {
        setState(newRpsState(format));
        setMpPhase("playing");
        setMyChoice(null);
        setTheyCommitted(false);
        setTheirReveal(null);
        setMpError("");
      }
      if (p.type === "decline" && mpPhase === "inviting") {
        setMpPhase("idle");
        setMpError(`${fromPeer.display_name} declined.`);
        setOpponent(null);
        setRpsSession(null);
      }
      if (
        p.type === "commit" &&
        (mpPhase === "playing" || mpPhase === "done") &&
        p.matchId === matchId &&
        p.round === roundNum
      ) {
        setTheyCommitted(true);
      }
      if (
        p.type === "reveal" &&
        (mpPhase === "playing" || mpPhase === "done") &&
        p.matchId === matchId &&
        p.round === roundNum
      ) {
        setTheirReveal(p.choice);
      }
      if (p.type === "result" && p.matchId === matchId) {
        setMpPhase("done");
      }
      if (p.type === "rematch" && (mpPhase === "done" || mpPhase === "playing")) {
        setState(newRpsState(p.format));
        setFormat(p.format);
        setMpPhase("playing");
        setMyChoice(null);
        setTheyCommitted(false);
        setTheirReveal(null);
      }
      if (p.type === "resign") {
        setMpPhase("done");
        setMpError(`${fromPeer.display_name} resigned.`);
        pushGameHistory({
          game: "rps",
          matchId: p.matchId || matchId,
          opponentId: fromId,
          opponentName: fromPeer.display_name,
          outcome: "win",
          detail: "Opponent resigned",
        });
        onHistory?.();
      }
    };
    return () => { dispatchRef.current = null; };
  }, [mpPhase, peers, matchId, roundNum, format, dispatchRef, onHistory]);

  // When both LAN choices are known, resolve the round
  useEffect(() => {
    if (mode !== "lan" || mpPhase !== "playing") return;
    if (!myChoice || !theirReveal) return;
    const next = rpsResolveRound(state, myChoice, theirReveal);
    setState(next);
    setMyChoice(null);
    setTheyCommitted(false);
    setTheirReveal(null);
    if (next.phase === "done") {
      setMpPhase("done");
      if (mode === "lan" && opponent && matchId) {
        const needed = Math.ceil(format / 2);
        const winnerId =
          next.myScore >= needed ? myId : next.theirScore >= needed ? opponent.user_id : null;
        pushGameHistory({
          game: "rps",
          matchId,
          opponentId: opponent.user_id,
          opponentName: opponent.display_name,
          outcome: winnerId === null ? "draw" : winnerId === myId ? "win" : "lose",
          detail: `Best of ${format}`,
        });
        onHistory?.();
        void sendMsg({ type: "result", matchId, winnerId });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myChoice, theirReveal]);

  async function lanChoose(choice: RpsChoice) {
    if (mpPhase !== "playing" || myChoice) return;
    setMyChoice(choice);
    // Send commit (hides choice) then reveal once they also commit
    await sendMsg({ type: "commit", matchId, round: roundNum });
    // Reveal immediately after commit — the peer resolves when they have both
    await sendMsg({ type: "reveal", matchId, round: roundNum, choice });
  }

  function handleInvite(peer: Peer) {
    setPickerOpen(false);
    const mid = `rps-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMatchId(mid);
    setOpponent(peer);
    setMpPhase("inviting");
    setMode("lan");
    setState(newRpsState(format));
    setMyChoice(null);
    setTheyCommitted(false);
    setTheirReveal(null);
    setInboundInvite(null);
    sendGameMsg(peer.user_id, {
      game: "rps",
      payload: { type: "invite", matchId: mid, fromName: myName, format },
    }).catch(() => setMpError("Failed to send invite."));
  }

  function acceptInvite() {
    if (!inboundInvite) return;
    setFormat(inboundInvite.format);
    setState(newRpsState(inboundInvite.format));
    setInboundInvite(null);
    setMpPhase("playing");
    setMode("lan");
    setMyChoice(null);
    setTheyCommitted(false);
    setTheirReveal(null);
    sendMsg({ type: "accept", matchId });
  }

  function declineInvite() {
    if (!inboundInvite) return;
    sendMsg({ type: "decline", matchId });
    setInboundInvite(null);
    setMpPhase("idle");
    setOpponent(null);
    setRpsSession(null);
  }

  async function rematch() {
    setState(newRpsState(format));
    setMyChoice(null);
    setTheyCommitted(false);
    setTheirReveal(null);
    if (mode === "lan") {
      setMpPhase("playing");
      await sendMsg({ type: "rematch", matchId, format });
    }
  }

  // Local two-player logic
  function localChooseP1(c: RpsChoice) { if (!localP1Choice) setLocalP1Choice(c); }
  function localChooseP2(c: RpsChoice) { if (!localP2Choice) setLocalP2Choice(c); }
  function localReveal() {
    if (!localP1Choice || !localP2Choice) return;
    setLocalRevealed(true);
    const next = rpsResolveRound(state, localP1Choice, localP2Choice);
    setState(next);
  }
  function localNext() {
    setLocalP1Choice(null);
    setLocalP2Choice(null);
    setLocalRevealed(false);
  }
  function startLocalGame() {
    setMode("local");
    setState(newRpsState(format));
    setLocalP1Choice(null);
    setLocalP2Choice(null);
    setLocalRevealed(false);
    setMpPhase("idle");
    setOpponent(null);
    setInboundInvite(null);
    setRpsSession(null);
  }

  const winnerLabel = () => {
    const needed = Math.ceil(format / 2);
    if (mode === "local") {
      if (state.myScore >= needed) return "Player 1 wins the match!";
      if (state.theirScore >= needed) return "Player 2 wins the match!";
    } else {
      if (state.myScore >= needed) return "You win the match!";
      if (state.theirScore >= needed) return `${opponent?.display_name} wins the match!`;
    }
    return null;
  };

  return (
    <Box sx={{ p: 3 }}>
      <BackBar onBack={onBack} title="Rock Paper Scissors" />

      <Dialog open={!!inboundInvite}>
        <DialogTitle>Game invite</DialogTitle>
        <DialogContent>
          <Typography>
            {inboundInvite?.from.display_name} invited you to Rock Paper Scissors (best of {inboundInvite?.format}).
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={declineInvite}>Decline</Button>
          <Button variant="contained" onClick={acceptInvite}>Accept</Button>
        </DialogActions>
      </Dialog>

      <PeerPickerDialog
        open={pickerOpen}
        peers={peers.filter((p) => p.user_id !== myId)}
        title="Invite to Rock Paper Scissors"
        onPick={handleInvite}
        onClose={() => setPickerOpen(false)}
      />

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap">
        <Button variant={mode === "local" ? "contained" : "outlined"} size="small" onClick={startLocalGame}>
          Local 2P
        </Button>
        <Button variant="outlined" size="small" onClick={() => setPickerOpen(true)}>
          LAN invite…
        </Button>
        <Select
          size="small"
          value={format}
          onChange={(e) => setFormat(Number(e.target.value) as MatchFormat)}
          sx={{ minWidth: 110 }}
          disabled={mpPhase === "playing" || mpPhase === "inviting"}
        >
          <MenuItem value={1}>Single round</MenuItem>
          <MenuItem value={3}>Best of 3</MenuItem>
          <MenuItem value={5}>Best of 5</MenuItem>
        </Select>
        {mode === "lan" && opponent && (
          <Chip size="small" label={`vs ${opponent.display_name}`} color="primary" />
        )}
      </Stack>

      {mpError && <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setMpError("")}>{mpError}</Alert>}

      {/* Score bar */}
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography fontWeight={700}>{mode === "local" ? "P1" : "You"}: {state.myScore}</Typography>
        <Typography color="text.secondary">–</Typography>
        <Typography fontWeight={700}>{mode === "local" ? "P2" : (opponent?.display_name ?? "Them")}: {state.theirScore}</Typography>
        <Typography variant="caption" color="text.secondary">
          Round {state.rounds.length + 1} of {format}
        </Typography>
      </Stack>

      {/* LAN multiplayer UI */}
      {mode === "lan" && mpPhase === "playing" && (
        <Stack spacing={2}>
          {theyCommitted && !myChoice && (
            <Alert severity="info">{opponent?.display_name} has chosen — now you go!</Alert>
          )}
          {myChoice && !theirReveal && (
            <Alert severity="info">You chose {CHOICE_EMOJI[myChoice]}. Waiting for {opponent?.display_name}…</Alert>
          )}
          {!myChoice && (
            <Stack direction="row" spacing={1}>
              {(["rock", "paper", "scissors"] as RpsChoice[]).map((c) => (
                <Button key={c} variant="outlined" onClick={() => lanChoose(c)} sx={{ fontSize: 28, p: 1.5 }}>
                  {CHOICE_EMOJI[c]}
                </Button>
              ))}
            </Stack>
          )}
        </Stack>
      )}

      {/* Local 2P UI */}
      {mode === "local" && state.phase === "choosing" && (
        <Stack spacing={2}>
          <Typography variant="subtitle2">Player 1 — choose (Player 2 look away)</Typography>
          <Stack direction="row" spacing={1}>
            {(["rock", "paper", "scissors"] as RpsChoice[]).map((c) => (
              <Button key={c} variant={localP1Choice === c ? "contained" : "outlined"} onClick={() => localChooseP1(c)} sx={{ fontSize: 28, p: 1.5 }}>
                {CHOICE_EMOJI[c]}
              </Button>
            ))}
          </Stack>
          {localP1Choice && (
            <>
              <Typography variant="subtitle2">Player 2 — choose</Typography>
              <Stack direction="row" spacing={1}>
                {(["rock", "paper", "scissors"] as RpsChoice[]).map((c) => (
                  <Button key={c} variant={localP2Choice === c ? "contained" : "outlined"} onClick={() => localChooseP2(c)} sx={{ fontSize: 28, p: 1.5 }}>
                    {CHOICE_EMOJI[c]}
                  </Button>
                ))}
              </Stack>
            </>
          )}
          {localP1Choice && localP2Choice && !localRevealed && (
            <Button variant="contained" onClick={localReveal}>Reveal!</Button>
          )}
        </Stack>
      )}

      {/* Round history */}
      {state.rounds.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Round history</Typography>
          <Stack spacing={0.5}>
            {state.rounds.map((r, i) => (
              <Stack key={i} direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary" sx={{ width: 60 }}>
                  Round {i + 1}
                </Typography>
                <Typography>{CHOICE_EMOJI[r.myChoice]}</Typography>
                <Typography color="text.secondary">vs</Typography>
                <Typography>{CHOICE_EMOJI[r.theirChoice]}</Typography>
                <Chip
                  size="small"
                  label={r.result === "win" ? (mode === "local" ? "P1 wins" : "You win") : r.result === "lose" ? (mode === "local" ? "P2 wins" : "They win") : "Draw"}
                  color={r.result === "win" ? "success" : r.result === "lose" ? "error" : "default"}
                />
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      {/* Match done */}
      {(state.phase === "done" || (mode === "local" && state.phase === "choosing" && state.rounds.length > 0 && winnerLabel())) && winnerLabel() && (
        <Box sx={{ mt: 2 }}>
          <Alert severity={state.myScore > state.theirScore ? "success" : state.myScore === state.theirScore ? "info" : "error"}>
            {winnerLabel()}
          </Alert>
          <Button variant="contained" sx={{ mt: 1 }} onClick={rematch}>
            {mode === "lan" ? "Rematch" : "Play again"}
          </Button>
        </Box>
      )}

      {mode === "local" && localRevealed && state.phase === "choosing" && !winnerLabel() && (
        <Button variant="outlined" sx={{ mt: 1 }} onClick={localNext}>Next round</Button>
      )}
    </Box>
  );
}

// ─── Dots and Boxes ───────────────────────────────────────────────────────────

const PRESET_SIZES: { label: string; rows: number; cols: number }[] = [
  { label: "Small (3×3)", rows: 3, cols: 3 },
  { label: "Medium (4×4)", rows: 4, cols: 4 },
  { label: "Large (5×5)", rows: 5, cols: 5 },
];

function DotsAndBoxes({
  onBack, peers, myId, myName, sendGameMsg, dispatchRef, pendingInvite, onPendingConsumed, onHistory, replayLanMoves,
}: {
  onBack: () => void;
  peers: Peer[];
  myId: string;
  myName: string;
  sendGameMsg: GameSendFn;
  dispatchRef: React.MutableRefObject<GameDispatchFn | null>;
  pendingInvite?: PendingGameInvite | null;
  onPendingConsumed?: () => void;
  onHistory?: () => void;
  replayLanMoves?: GameReplayFn;
}) {
  const [presetIdx, setPresetIdx] = useState(1);
  const preset = PRESET_SIZES[presetIdx];
  const [state, setState] = useState<DabState>(() => newDabState(preset.rows, preset.cols));
  const [mode, setMode] = useState<"local" | "lan">("local");

  // LAN
  const [mpPhase, setMpPhase] = useState<MpPhase>("idle");
  const [opponent, setOpponent] = useState<Peer | null>(null);
  const [myPlayer, setMyPlayer] = useState<"A" | "B">("A");
  const [matchId, setMatchId] = useState("");
  const [seq, setSeq] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inboundInvite, setInboundInvite] = useState<{ from: Peer; matchId: string; rows: number; cols: number } | null>(null);
  const [mpError, setMpError] = useState("");
  const pendingConsumed = useRef(false);
  const restored = useRef(false);
  const replayed = useRef(false);

  const sendMsg = useCallback(
    async (payload: DabMsg) => {
      if (!opponent) return;
      await sendGameMsg(opponent.user_id, { game: "dab", payload });
    },
    [opponent, sendGameMsg]
  );

  useEffect(() => {
    if (restored.current || pendingInvite) return;
    const s = getDabSession();
    if (!s) return;
    restored.current = true;
    setMode("lan");
    setMpPhase(s.mpPhase);
    setMatchId(s.matchId);
    setMyPlayer(s.myPlayer);
    setState(s.state);
    setSeq(s.seq);
    setMpError(s.mpError);
    const peer = peerFromSession(peers, s.opponentId, s.opponentName);
    setOpponent(peer);
    if (s.inboundInvite || s.mpPhase === "invited") {
      setInboundInvite({
        from: peer,
        matchId: s.inboundInvite?.matchId || s.matchId,
        rows: s.inboundInvite?.rows || s.rows,
        cols: s.inboundInvite?.cols || s.cols,
      });
    }
  }, [peers, pendingInvite]);

  useEffect(() => {
    if (!replayLanMoves || !opponent || !matchId || mode !== "lan") return;
    if (mpPhase !== "playing" && mpPhase !== "done") return;
    if (replayed.current) return;
    replayed.current = true;
    let cancel = false;
    void (async () => {
      try {
        const msgs = await replayLanMoves(opponent.user_id, matchId);
        if (cancel || !msgs.length) return;
        let board = newDabState(state.rows, state.cols);
        let phase: MpPhase = "playing";
        let moveSeq = 0;
        for (const msg of msgs) {
          if (msg.game !== "dab") continue;
          const p = msg.payload as DabMsg;
          if (p.type === "accept") phase = "playing";
          if (p.type === "move") {
            const next = dabMove(board, p.edge);
            if (next) {
              board = next;
              moveSeq = p.seq || moveSeq + 1;
              phase = next.done ? "done" : "playing";
            }
          }
          if (p.type === "rematch") {
            board = newDabState(board.rows, board.cols);
            phase = "playing";
            moveSeq = 0;
          }
          if (p.type === "result" || p.type === "resign") phase = "done";
        }
        if (cancel) return;
        setState(board);
        setMpPhase(phase);
        setSeq(moveSeq);
      } catch {
        /* keep restored */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [replayLanMoves, opponent, matchId, mode, mpPhase, state.rows, state.cols]);

  useEffect(() => {
    if (mode !== "lan") return;
    if (mpPhase === "idle" || !opponent) {
      setDabSession(null);
      return;
    }
    setDabSession({
      mode: "lan",
      mpPhase,
      opponentId: opponent.user_id,
      opponentName: opponent.display_name,
      myPlayer,
      matchId,
      state,
      seq,
      rows: state.rows,
      cols: state.cols,
      inboundInvite: inboundInvite
        ? {
            fromId: inboundInvite.from.user_id,
            matchId: inboundInvite.matchId,
            rows: inboundInvite.rows,
            cols: inboundInvite.cols,
          }
        : null,
      mpError,
    });
  }, [mode, mpPhase, opponent, myPlayer, matchId, state, seq, inboundInvite, mpError]);

  useEffect(() => {
    if (!pendingInvite || pendingInvite.game !== "dab" || pendingConsumed.current) return;
    const fromPeer = peers.find((p) => p.user_id === pendingInvite.fromId);
    if (!fromPeer) return;
    pendingConsumed.current = true;
    if (pendingInvite.openOnly) {
      const s = getDabSession();
      const rows = pendingInvite.rows || s?.rows || 4;
      const cols = pendingInvite.cols || s?.cols || 4;
      setOpponent(fromPeer);
      setMatchId(pendingInvite.matchId);
      setMode("lan");
      if (s && s.matchId === pendingInvite.matchId) {
        setMyPlayer(s.myPlayer);
        setMpPhase(s.mpPhase === "idle" ? "playing" : s.mpPhase);
        setState(s.state);
        setSeq(s.seq);
        setMpError(s.mpError);
      } else {
        setMyPlayer("B");
        setMpPhase("playing");
        setState(newDabState(rows, cols));
        setSeq(0);
      }
      restored.current = true;
      replayed.current = false;
      onPendingConsumed?.();
      return;
    }
    const rows = pendingInvite.rows || 4;
    const cols = pendingInvite.cols || 4;
    setOpponent(fromPeer);
    setMatchId(pendingInvite.matchId);
    setMyPlayer("B");
    setMode("lan");
    setMpPhase("playing");
    setState(newDabState(rows, cols));
    setSeq(0);
    sendGameMsg(fromPeer.user_id, {
      game: "dab",
      payload: { type: "accept", matchId: pendingInvite.matchId },
    }).catch(() => setMpError("Failed to accept invite."));
    onPendingConsumed?.();
  }, [pendingInvite, peers, sendGameMsg, onPendingConsumed]);

  useEffect(() => {
    dispatchRef.current = (fromId: string, msg: GameMsg) => {
      if (msg.game !== "dab") return;
      const p = msg.payload as DabMsg;
      const fromPeer = peers.find((x) => x.user_id === fromId);
      if (!fromPeer) return;

      if (p.type === "invite") {
        if (mpPhase !== "idle") return;
        setInboundInvite({ from: fromPeer, matchId: p.matchId, rows: p.rows, cols: p.cols });
        setMpPhase("invited");
        setOpponent(fromPeer);
        setMatchId(p.matchId);
        setMyPlayer("B");
      }
      if (p.type === "accept" && mpPhase === "inviting") {
        setMpPhase("playing");
        setMpError("");
      }
      if (p.type === "decline" && mpPhase === "inviting") {
        setMpPhase("idle");
        setMpError(`${fromPeer.display_name} declined.`);
        setOpponent(null);
        setDabSession(null);
      }
      if (
        p.type === "move" &&
        (mpPhase === "playing" || mpPhase === "done") &&
        p.matchId === matchId
      ) {
        const expectedPlayer = myPlayer === "A" ? "B" : "A";
        setState((prev) => {
          if (prev.done) return prev;
          const base =
            prev.turn === expectedPlayer
              ? prev
              : { ...prev, turn: expectedPlayer as "A" | "B" };
          const next = dabMove(base, p.edge);
          if (!next) return prev;
          if (next.done) {
            setMpPhase("done");
            const winnerId =
              next.scoreA === next.scoreB
                ? null
                : next.scoreA > next.scoreB
                  ? myPlayer === "A"
                    ? myId
                    : fromId
                  : myPlayer === "B"
                    ? myId
                    : fromId;
            pushGameHistory({
              game: "dab",
              matchId: p.matchId,
              opponentId: fromId,
              opponentName: fromPeer.display_name,
              outcome: winnerId === null ? "draw" : winnerId === myId ? "win" : "lose",
              detail: `${next.scoreA}–${next.scoreB}`,
            });
            onHistory?.();
            void sendGameMsg(fromId, {
              game: "dab",
              payload: { type: "result", matchId: p.matchId, winnerId },
            });
          }
          return next;
        });
        setSeq(p.seq);
      }
      if (p.type === "result" && p.matchId === matchId) {
        setMpPhase("done");
      }
      if (p.type === "rematch") {
        setState(newDabState(p.rows, p.cols));
        setMpPhase("playing");
        setSeq(0);
        setMyPlayer((pl) => (pl === "A" ? "B" : "A"));
      }
      if (p.type === "resign") {
        setMpPhase("done");
        setMpError(`${fromPeer.display_name} resigned.`);
        pushGameHistory({
          game: "dab",
          matchId: p.matchId || matchId,
          opponentId: fromId,
          opponentName: fromPeer.display_name,
          outcome: "win",
          detail: "Opponent resigned",
        });
        onHistory?.();
        void sendGameMsg(fromId, {
          game: "dab",
          payload: { type: "result", matchId: p.matchId || matchId, winnerId: myId },
        });
      }
    };
    return () => { dispatchRef.current = null; };
  }, [mpPhase, peers, matchId, myPlayer, myId, dispatchRef, sendGameMsg, onHistory]);

  function handleInvite(peer: Peer) {
    setPickerOpen(false);
    const mid = `dab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMatchId(mid);
    setOpponent(peer);
    setMyPlayer("A");
    setMpPhase("inviting");
    setMode("lan");
    setState(newDabState(preset.rows, preset.cols));
    setSeq(0);
    setInboundInvite(null);
    sendGameMsg(peer.user_id, {
      game: "dab",
      payload: { type: "invite", matchId: mid, fromName: myName, rows: preset.rows, cols: preset.cols },
    }).catch(() => setMpError("Failed to send invite."));
  }

  function acceptInvite() {
    if (!inboundInvite) return;
    setState(newDabState(inboundInvite.rows, inboundInvite.cols));
    setInboundInvite(null);
    setMpPhase("playing");
    setMode("lan");
    setSeq(0);
    sendMsg({ type: "accept", matchId });
  }

  function declineInvite() {
    if (!inboundInvite) return;
    sendMsg({ type: "decline", matchId });
    setInboundInvite(null);
    setMpPhase("idle");
    setOpponent(null);
    setDabSession(null);
  }

  async function handleEdgeClick(edge: EdgeId) {
    if (state.done) return;
    if (mode === "lan" && (mpPhase !== "playing" || state.turn !== myPlayer)) return;
    const next = dabMove(state, edge);
    if (!next) return;
    setState(next);
    if (mode === "lan") {
      const newSeq = seq + 1;
      setSeq(newSeq);
      if (next.done) {
        setMpPhase("done");
        const winnerId =
          next.scoreA === next.scoreB
            ? null
            : next.scoreA > next.scoreB
              ? myPlayer === "A"
                ? myId
                : opponent?.user_id ?? null
              : myPlayer === "B"
                ? myId
                : opponent?.user_id ?? null;
        if (opponent) {
          pushGameHistory({
            game: "dab",
            matchId,
            opponentId: opponent.user_id,
            opponentName: opponent.display_name,
            outcome: winnerId === null ? "draw" : winnerId === myId ? "win" : "lose",
            detail: `${next.scoreA}–${next.scoreB}`,
          });
          onHistory?.();
        }
        await sendMsg({ type: "move", matchId, seq: newSeq, edge });
        await sendMsg({ type: "result", matchId, winnerId });
        return;
      }
      await sendMsg({ type: "move", matchId, seq: newSeq, edge });
    }
  }

  async function rematch() {
    setState(newDabState(preset.rows, preset.cols));
    setSeq(0);
    if (mode === "lan") {
      setMpPhase("playing");
      setMyPlayer((pl) => (pl === "A" ? "B" : "A"));
      await sendMsg({ type: "rematch", matchId, rows: preset.rows, cols: preset.cols });
    }
  }

  function startLocalGame() {
    setMode("local");
    setState(newDabState(preset.rows, preset.cols));
    setMpPhase("idle");
    setOpponent(null);
    setInboundInvite(null);
    setDabSession(null);
  }

  const canMove = mode === "local" || (mpPhase === "playing" && state.turn === myPlayer);
  const { rows, cols } = state;
  const DOT = 10;
  const CELL = 72;
  const EDGE_W = 8;

  const playerColor: Record<"A" | "B", string> = { A: "#4C8DFF", B: "#FF6B6B" };
  const playerLabel = (p: "A" | "B") => {
    if (mode === "local") return p === "A" ? "Blue" : "Red";
    return p === myPlayer ? "You" : (opponent?.display_name ?? "Them");
  };

  // Render grid using SVG for crispness
  const svgW = cols * CELL + DOT;
  const svgH = rows * CELL + DOT;

  const hEdgeElements = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const drawn = state.hEdges[r][c];
      const x = c * CELL + DOT;
      const y = r * CELL + DOT / 2;
      hEdgeElements.push(
        <rect
          key={`h${r}${c}`}
          x={x}
          y={y - EDGE_W / 2}
          width={CELL - DOT}
          height={EDGE_W}
          rx={3}
          fill={drawn ? playerColor["A"] : "transparent"}
          stroke={drawn ? "none" : "transparent"}
          style={{ cursor: canMove && !drawn && !state.done ? "pointer" : "default" }}
          onClick={() => handleEdgeClick({ kind: "h", r, c })}
        >
          {!drawn && <title>Draw edge here</title>}
        </rect>
      );
      // Hit area (wider for easier clicking)
      if (!drawn && canMove && !state.done) {
        hEdgeElements.push(
          <rect
            key={`hh${r}${c}`}
            x={x}
            y={y - 12}
            width={CELL - DOT}
            height={24}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onClick={() => handleEdgeClick({ kind: "h", r, c })}
          />
        );
      }
    }
  }

  const vEdgeElements = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const drawn = state.vEdges[r][c];
      const x = c * CELL + DOT / 2;
      const y = r * CELL + DOT;
      vEdgeElements.push(
        <rect
          key={`v${r}${c}`}
          x={x - EDGE_W / 2}
          y={y}
          width={EDGE_W}
          height={CELL - DOT}
          rx={3}
          fill={drawn ? playerColor["A"] : "transparent"}
          onClick={() => handleEdgeClick({ kind: "v", r, c })}
          style={{ cursor: canMove && !drawn && !state.done ? "pointer" : "default" }}
        />
      );
      if (!drawn && canMove && !state.done) {
        vEdgeElements.push(
          <rect
            key={`vh${r}${c}`}
            x={x - 12}
            y={y}
            width={24}
            height={CELL - DOT}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onClick={() => handleEdgeClick({ kind: "v", r, c })}
          />
        );
      }
    }
  }

  // Colour drawn edges by who drew them (we track owner via boxes, not edges individually)
  // Re-colour: use box ownership to infer edge colour is tricky — simplify: A=blue, B=red for edges
  // We'll colour edges based on current turn when drawn (tracked in state implicitly via box ownership)
  // For simplicity, color all drawn edges with a neutral colour and box fills show ownership.

  return (
    <Box sx={{ p: 3 }}>
      <BackBar onBack={onBack} title="Dots & Boxes" />

      <Dialog open={!!inboundInvite}>
        <DialogTitle>Game invite</DialogTitle>
        <DialogContent>
          <Typography>
            {inboundInvite?.from.display_name} invited you to Dots & Boxes ({inboundInvite?.rows}×{inboundInvite?.cols}).
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={declineInvite}>Decline</Button>
          <Button variant="contained" onClick={acceptInvite}>Accept</Button>
        </DialogActions>
      </Dialog>

      <PeerPickerDialog
        open={pickerOpen}
        peers={peers.filter((p) => p.user_id !== myId)}
        title="Invite to Dots & Boxes"
        onPick={handleInvite}
        onClose={() => setPickerOpen(false)}
      />

      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap">
        <Button variant={mode === "local" ? "contained" : "outlined"} size="small" onClick={startLocalGame}>
          Local 2P
        </Button>
        <Button variant="outlined" size="small" onClick={() => setPickerOpen(true)}>
          LAN invite…
        </Button>
        <Select
          size="small"
          value={presetIdx}
          onChange={(e) => {
            const idx = Number(e.target.value);
            setPresetIdx(idx);
            const p = PRESET_SIZES[idx];
            setState(newDabState(p.rows, p.cols));
          }}
          sx={{ minWidth: 140 }}
          disabled={mpPhase === "playing" || mpPhase === "inviting"}
        >
          {PRESET_SIZES.map((p, i) => (
            <MenuItem key={i} value={i}>{p.label}</MenuItem>
          ))}
        </Select>
        {mode === "lan" && opponent && (
          <Chip size="small" label={`vs ${opponent.display_name} (you=${playerLabel(myPlayer)})`} color="primary" />
        )}
      </Stack>

      {mpError && <Alert severity="warning" sx={{ mb: 1 }} onClose={() => setMpError("")}>{mpError}</Alert>}

      <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
        <Typography fontWeight={700} sx={{ color: playerColor.A }}>
          {playerLabel("A")}: {state.scoreA}
        </Typography>
        <Typography fontWeight={700} sx={{ color: playerColor.B }}>
          {playerLabel("B")}: {state.scoreB}
        </Typography>
        {!state.done && (
          <Typography variant="caption" color="text.secondary" alignSelf="center">
            {canMove ? `${playerLabel(state.turn)}'s turn` : `Waiting for ${opponent?.display_name}…`}
          </Typography>
        )}
      </Stack>

      {/* SVG board */}
      <Box sx={{ overflow: "auto" }}>
        <svg width={svgW} height={svgH} style={{ display: "block" }}>
          {/* Box fills */}
          {Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols }, (_, c) => {
              const owner = state.boxes[r][c];
              if (!owner) return null;
              return (
                <rect
                  key={`b${r}${c}`}
                  x={c * CELL + DOT}
                  y={r * CELL + DOT}
                  width={CELL - DOT}
                  height={CELL - DOT}
                  fill={playerColor[owner]}
                  opacity={0.35}
                />
              );
            })
          )}

          {/* Drawn horizontal edges */}
          {Array.from({ length: rows + 1 }, (_, r) =>
            Array.from({ length: cols }, (_, c) => {
              const drawn = state.hEdges[r][c];
              return drawn ? (
                <line
                  key={`hd${r}${c}`}
                  x1={c * CELL + DOT}
                  y1={r * CELL + DOT / 2}
                  x2={(c + 1) * CELL}
                  y2={r * CELL + DOT / 2}
                  stroke="#aaa"
                  strokeWidth={EDGE_W}
                  strokeLinecap="round"
                />
              ) : null;
            })
          )}
          {/* Drawn vertical edges */}
          {Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols + 1 }, (_, c) => {
              const drawn = state.vEdges[r][c];
              return drawn ? (
                <line
                  key={`vd${r}${c}`}
                  x1={c * CELL + DOT / 2}
                  y1={r * CELL + DOT}
                  x2={c * CELL + DOT / 2}
                  y2={(r + 1) * CELL}
                  stroke="#aaa"
                  strokeWidth={EDGE_W}
                  strokeLinecap="round"
                />
              ) : null;
            })
          )}

          {/* Clickable edge hit areas */}
          {Array.from({ length: rows + 1 }, (_, r) =>
            Array.from({ length: cols }, (_, c) => {
              if (state.hEdges[r][c]) return null;
              return (
                <rect
                  key={`hclick${r}${c}`}
                  x={c * CELL + DOT}
                  y={r * CELL + DOT / 2 - 10}
                  width={CELL - DOT}
                  height={20}
                  fill={canMove && !state.done ? "rgba(255,255,255,0.05)" : "transparent"}
                  style={{ cursor: canMove && !state.done ? "pointer" : "default" }}
                  onClick={() => handleEdgeClick({ kind: "h", r, c })}
                />
              );
            })
          )}
          {Array.from({ length: rows }, (_, r) =>
            Array.from({ length: cols + 1 }, (_, c) => {
              if (state.vEdges[r][c]) return null;
              return (
                <rect
                  key={`vclick${r}${c}`}
                  x={c * CELL + DOT / 2 - 10}
                  y={r * CELL + DOT}
                  width={20}
                  height={CELL - DOT}
                  fill={canMove && !state.done ? "rgba(255,255,255,0.05)" : "transparent"}
                  style={{ cursor: canMove && !state.done ? "pointer" : "default" }}
                  onClick={() => handleEdgeClick({ kind: "v", r, c })}
                />
              );
            })
          )}

          {/* Dots */}
          {Array.from({ length: rows + 1 }, (_, r) =>
            Array.from({ length: cols + 1 }, (_, c) => (
              <circle
                key={`dot${r}${c}`}
                cx={c * CELL + DOT / 2}
                cy={r * CELL + DOT / 2}
                r={DOT / 2}
                fill="currentColor"
              />
            ))
          )}
        </svg>
      </Box>

      {state.done && (
        <Box sx={{ mt: 2 }}>
          <Alert
            severity={
              state.scoreA > state.scoreB ? (mode === "local" || myPlayer === "A" ? "success" : "error")
              : state.scoreB > state.scoreA ? (mode === "local" || myPlayer === "B" ? "success" : "error")
              : "info"
            }
          >
            {state.scoreA > state.scoreB
              ? `${playerLabel("A")} wins! (${state.scoreA}–${state.scoreB})`
              : state.scoreB > state.scoreA
              ? `${playerLabel("B")} wins! (${state.scoreB}–${state.scoreA})`
              : `Draw! (${state.scoreA}–${state.scoreB})`}
          </Alert>
          <Button variant="contained" sx={{ mt: 1 }} onClick={rematch}>
            {mode === "lan" ? "Rematch" : "Play again"}
          </Button>
        </Box>
      )}
    </Box>
  );
}
