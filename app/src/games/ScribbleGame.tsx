/**
 * Scribble 1v1 LAN game UI — invite, draw, guess, score.
 */

import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import UndoIcon from "@mui/icons-material/UndoRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineRounded";
import ArrowBackIcon from "@mui/icons-material/ArrowBackRounded";
import IconButton from "@mui/material/IconButton";
import { useCallback, useEffect, useRef, useState } from "react";

import { peerApi, peerHasLanIp, type Peer } from "../peer";
import {
  clearMatchSessions,
  getScribbleSession,
  pushGameHistory,
  setScribbleSession,
  subscribeGameSessions,
  type MpPhase,
} from "./gameSession";
import {
  SCRIBBLE_COLORS,
  SCRIBBLE_MAX_ROUNDS,
  SCRIBBLE_ROUND_SEC,
  SCRIBBLE_WIDTHS,
  SCRIBBLE_WIN_SCORE,
  guessMatches,
  isMatchOver,
  matchWinnerId,
  newScribbleState,
  pickWord,
  type ScribbleMsg,
  type ScribbleState,
  type ScribbleSyncPayload,
} from "./scribble";
import { ScribbleCanvas, type ScribbleStrokeBatch } from "./ScribbleCanvas";
import type { GameDispatchFn, GameSendFn, PendingGameInvite } from "./gameTypes";

export type ScribbleStrokeDispatchFn = (fromId: string, payload: ScribbleSyncPayload) => void;

async function leaveScribbleMatch(opts: {
  mpPhase: MpPhase;
  matchId: string;
  opponentId?: string | null;
  sendGameMsg: GameSendFn;
}): Promise<void> {
  if (!opts.matchId) {
    clearMatchSessions(opts.matchId);
    return;
  }
  const peerId = opts.opponentId || "";
  try {
    if (peerId && (opts.mpPhase === "inviting" || opts.mpPhase === "invited")) {
      await opts.sendGameMsg(peerId, {
        game: "scribble",
        payload: {
          type: opts.mpPhase === "inviting" ? "cancel" : "decline",
          matchId: opts.matchId,
        },
      });
    } else if (peerId && opts.mpPhase === "playing") {
      await opts.sendGameMsg(peerId, {
        game: "scribble",
        payload: { type: "resign", matchId: opts.matchId },
      });
    }
  } catch {
    /* offline */
  }
  clearMatchSessions(opts.matchId);
}

function PeerPicker({
  open,
  peers,
  onPick,
  onClose,
}: {
  open: boolean;
  peers: Peer[];
  onPick: (p: Peer) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const lan = peers.filter(peerHasLanIp);
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        bgcolor: "rgba(0,0,0,0.35)",
        zIndex: 1300,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 2,
      }}
      onClick={onClose}
    >
      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          bgcolor: "background.paper",
          borderRadius: 2,
          p: 2,
          minWidth: 280,
          maxWidth: 420,
          maxHeight: "70vh",
          overflow: "auto",
        }}
      >
        <Typography fontWeight={700} sx={{ mb: 1 }}>
          Invite a peer
        </Typography>
        {!lan.length ? (
          <Typography variant="body2" color="text.secondary">
            No LAN peers online.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {lan.map((p) => (
              <Button key={p.user_id} onClick={() => onPick(p)} sx={{ justifyContent: "flex-start" }}>
                {p.display_name}
              </Button>
            ))}
          </Stack>
        )}
        <Button onClick={onClose} sx={{ mt: 1 }}>
          Cancel
        </Button>
      </Box>
    </Box>
  );
}

export function ScribbleGame({
  onBack,
  peers,
  myId,
  myName,
  sendGameMsg,
  dispatchRef,
  strokeSyncRef,
  pendingInvite,
  onPendingConsumed,
  onHistory,
}: {
  onBack: () => void;
  peers: Peer[];
  myId: string;
  myName: string;
  sendGameMsg: GameSendFn;
  dispatchRef: React.MutableRefObject<GameDispatchFn | null>;
  strokeSyncRef: React.MutableRefObject<ScribbleStrokeDispatchFn | null>;
  pendingInvite?: PendingGameInvite | null;
  onPendingConsumed?: () => void;
  onHistory?: () => void;
}) {
  const [mpPhase, setMpPhase] = useState<MpPhase>("idle");
  const [matchId, setMatchId] = useState("");
  const [opponent, setOpponent] = useState<Peer | null>(null);
  const [iAmInviter, setIAmInviter] = useState(true);
  const [state, setState] = useState<ScribbleState>(() => newScribbleState());
  const [mpError, setMpError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inboundInvite, setInboundInvite] = useState<{
    from: Peer;
    matchId: string;
  } | null>(null);
  const [color, setColor] = useState<string>(SCRIBBLE_COLORS[0]);
  const [penWidth, setPenWidth] = useState<number>(SCRIBBLE_WIDTHS[1]);
  const [clearTick, setClearTick] = useState(0);
  const [undoTick, setUndoTick] = useState(0);
  const [guessText, setGuessText] = useState("");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [syncSeq, setSyncSeq] = useState(0);
  const [guessLog, setGuessLog] = useState<
    { id: string; fromId: string; text: string; ok: boolean; at: number }[]
  >([]);
  const [waitingNextRound, setWaitingNextRound] = useState(false);

  const canvasInboundRef = useRef<((p: ScribbleSyncPayload) => void) | null>(null);
  const syncInFlight = useRef(false);
  const syncQueued = useRef<ScribbleSyncPayload | null>(null);
  const stateRef = useRef(state);
  const matchIdRef = useRef(matchId);
  const mpPhaseRef = useRef(mpPhase);
  const opponentRef = useRef(opponent);
  const pendingConsumed = useRef(false);
  const restored = useRef(false);
  const roundTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startingRound = useRef(false);
  const timeoutSent = useRef(false);
  const roundAckedRef = useRef<number | null>(null);
  const roundRetryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRoundStartRef = useRef<Extract<ScribbleMsg, { type: "round_start" }> | null>(
    null
  );
  const guessLogRef = useRef<HTMLDivElement | null>(null);

  const stopRoundRetry = useCallback(() => {
    if (roundRetryTimer.current) {
      clearInterval(roundRetryTimer.current);
      roundRetryTimer.current = null;
    }
  }, []);

  stateRef.current = state;
  matchIdRef.current = matchId;
  mpPhaseRef.current = mpPhase;
  opponentRef.current = opponent;

  const persist = useCallback(
    (patch: Partial<{
      mpPhase: MpPhase;
      matchId: string;
      opponent: Peer | null;
      iAmInviter: boolean;
      state: ScribbleState;
      mpError: string;
      inboundInvite: { from: Peer; matchId: string } | null;
    }>) => {
      const nextPhase = patch.mpPhase ?? mpPhaseRef.current;
      const nextMatch = patch.matchId ?? matchIdRef.current;
      const nextOpp = patch.opponent !== undefined ? patch.opponent : opponentRef.current;
      const nextState = patch.state ?? stateRef.current;
      const nextErr = patch.mpError !== undefined ? patch.mpError : mpError;
      const inv =
        patch.inboundInvite !== undefined ? patch.inboundInvite : inboundInvite;
      if (nextPhase === "idle" || !nextMatch) {
        setScribbleSession(null);
        return;
      }
      setScribbleSession({
        mode: "lan",
        mpPhase: nextPhase,
        opponentId: nextOpp?.user_id || inv?.from.user_id || "",
        opponentName: nextOpp?.display_name || inv?.from.display_name || "Peer",
        matchId: nextMatch,
        iAmInviter: patch.iAmInviter ?? iAmInviter,
        state: nextState,
        seq: syncSeq,
        inboundInvite: inv
          ? { fromId: inv.from.user_id, matchId: inv.matchId }
          : null,
        mpError: nextErr,
      });
    },
    [iAmInviter, inboundInvite, mpError, syncSeq]
  );

  useEffect(() => subscribeGameSessions(() => {}), []);

  // Restore session
  useEffect(() => {
    if (restored.current || pendingInvite) return;
    restored.current = true;
    const s = getScribbleSession();
    if (!s || s.mpPhase === "idle") return;
    const peer = peers.find((p) => p.user_id === s.opponentId) || null;
    setMatchId(s.matchId);
    setMpPhase(s.mpPhase);
    setOpponent(peer);
    setIAmInviter(s.iAmInviter);
    setState(s.state);
    setMpError(s.mpError);
    setSyncSeq(s.seq);
    if (s.inboundInvite) {
      const from = peers.find((p) => p.user_id === s.inboundInvite!.fromId);
      if (from) setInboundInvite({ from, matchId: s.inboundInvite.matchId });
    }
  }, [peers, pendingInvite]);

  const sendMsg = useCallback(
    async (payload: ScribbleMsg) => {
      const peerId = opponentRef.current?.user_id || inboundInvite?.from.user_id;
      if (!peerId) return;
      await sendGameMsg(peerId, { game: "scribble", payload });
    },
    [sendGameMsg, inboundInvite]
  );

  const flushSync = useCallback(async (payload: ScribbleSyncPayload) => {
    const peerId = opponentRef.current?.user_id;
    if (!peerId) return;
    if (syncInFlight.current) {
      // Merge: keep latest stroke batch; undo/clear replace queue.
      if (payload.op !== "stroke") {
        syncQueued.current = payload;
      } else if (!syncQueued.current || syncQueued.current.op !== "stroke") {
        syncQueued.current = payload;
      } else {
        const q = syncQueued.current;
        syncQueued.current = {
          ...payload,
          start: q.start || payload.start,
          points: [...(q.points || []), ...(payload.points || [])],
        };
      }
      return;
    }
    syncInFlight.current = true;
    try {
      await peerApi.sendGameSync(peerId, payload as unknown as Record<string, unknown>);
    } catch {
      /* drop — next batch continues */
    } finally {
      syncInFlight.current = false;
      const next = syncQueued.current;
      syncQueued.current = null;
      if (next) void flushSync(next);
    }
  }, []);

  const clearCanvasLocal = useCallback(() => {
    setClearTick((n) => n + 1);
  }, []);

  const beginRound = useCallback(
    async (round: number, drawerId: string) => {
      if (startingRound.current) return;
      startingRound.current = true;
      try {
        const word = drawerId === myId ? pickWord() : "";
        const endsAt = Date.now() + SCRIBBLE_ROUND_SEC * 1000;
        const next: ScribbleState = {
          ...stateRef.current,
          round,
          drawerId,
          word,
          revealedWord: "",
          lastWrong: "",
          phase: "drawing",
          endsAt,
        };
        timeoutSent.current = false;
        setWaitingNextRound(false);
        setGuessLog([]);
        setState(next);
        // Drawer clears locally; guesser clears on inbound round_start (synced).
        if (drawerId === myId) clearCanvasLocal();
        setGuessText("");
        setSecondsLeft(SCRIBBLE_ROUND_SEC);
        setMpPhase("playing");
        persist({ mpPhase: "playing", state: next });
        if (drawerId === myId) {
          const startMsg: Extract<ScribbleMsg, { type: "round_start" }> = {
            type: "round_start",
            matchId: matchIdRef.current,
            round,
            drawerId,
            timerSec: SCRIBBLE_ROUND_SEC,
          };
          lastRoundStartRef.current = startMsg;
          roundAckedRef.current = null;
          await sendMsg(startMsg);
          stopRoundRetry();
          roundRetryTimer.current = setInterval(() => {
            if (roundAckedRef.current === round) {
              stopRoundRetry();
              return;
            }
            if (Date.now() > endsAt) {
              stopRoundRetry();
              return;
            }
            if (lastRoundStartRef.current) void sendMsg(lastRoundStartRef.current);
          }, 2000);
        }
      } finally {
        startingRound.current = false;
      }
    },
    [myId, clearCanvasLocal, persist, sendMsg, stopRoundRetry]
  );

  const finishMatch = useCallback(
    async (myScore: number, theirScore: number) => {
      const opp = opponentRef.current;
      if (!opp) return;
      const winnerId = matchWinnerId({
        myId,
        opponentId: opp.user_id,
        myScore,
        theirScore,
      });
      setMpPhase("done");
      setState((s) => ({ ...s, phase: "match_over", endsAt: null }));
      persist({
        mpPhase: "done",
        state: { ...stateRef.current, phase: "match_over", endsAt: null, myScore, theirScore },
      });
      pushGameHistory({
        game: "scribble",
        matchId: matchIdRef.current,
        opponentId: opp.user_id,
        opponentName: opp.display_name,
        outcome: winnerId === null ? "draw" : winnerId === myId ? "win" : "lose",
        detail: `${myScore}–${theirScore}`,
      });
      onHistory?.();
      await sendMsg({
        type: "result",
        matchId: matchIdRef.current,
        winnerId,
      });
    },
    [myId, onHistory, persist, sendMsg]
  );

  const endRound = useCallback(
    async (
      kind: "correct" | "timeout",
      word: string,
      scorePatch?: { myScore: number; theirScore: number }
    ) => {
      const s = stateRef.current;
      if (s.phase !== "drawing") return;
      const myScore = scorePatch?.myScore ?? s.myScore;
      const theirScore = scorePatch?.theirScore ?? s.theirScore;
      const next: ScribbleState = {
        ...s,
        myScore,
        theirScore,
        revealedWord: word,
        word: "",
        phase: "round_over",
        endsAt: null,
        lastWrong: "",
      };
      setState(next);
      persist({ state: next });
      stopRoundRetry();
      // Only the current drawer clears now; next round_start clears for both.
      if (s.drawerId === myId) clearCanvasLocal();
      setWaitingNextRound(true);

      if (isMatchOver(myScore, theirScore, s.round)) {
        setWaitingNextRound(false);
        await finishMatch(myScore, theirScore);
        return;
      }

      // Next drawer is the previous guesser.
      const nextDrawer = s.drawerId === myId
        ? opponentRef.current?.user_id || ""
        : myId;
      // Only the next drawer starts the following round.
      if (nextDrawer === myId) {
        window.setTimeout(() => {
          void beginRound(s.round + 1, myId);
        }, 1500);
      }
    },
    [beginRound, clearCanvasLocal, finishMatch, myId, persist, stopRoundRetry]
  );

  // Guesser stuck without drawerId → ask drawer to re-send round_start.
  useEffect(() => {
    if (mpPhase !== "playing") return;
    if (state.phase === "match_over") return;
    if (state.phase === "drawing" && state.drawerId) return;
    const t = window.setTimeout(() => {
      const s = stateRef.current;
      if (s.phase === "drawing" && s.drawerId) return;
      if (!matchIdRef.current) return;
      void sendMsg({ type: "round_query", matchId: matchIdRef.current });
    }, 2000);
    return () => window.clearTimeout(t);
  }, [mpPhase, state.phase, state.drawerId, state.round, sendMsg]);

  useEffect(() => {
    return () => stopRoundRetry();
  }, [stopRoundRetry]);

  // Local countdown (drawer owns timeout announce).
  useEffect(() => {
    if (roundTimerRef.current) {
      clearInterval(roundTimerRef.current);
      roundTimerRef.current = null;
    }
    if (state.phase !== "drawing" || !state.endsAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((state.endsAt! - Date.now()) / 1000));
      setSecondsLeft(left);
      if (
        left <= 0 &&
        state.drawerId === myId &&
        stateRef.current.phase === "drawing" &&
        !timeoutSent.current
      ) {
        timeoutSent.current = true;
        const word = stateRef.current.word;
        void sendMsg({
          type: "timeout",
          matchId: matchIdRef.current,
          word,
          myScore: stateRef.current.myScore,
          theirScore: stateRef.current.theirScore,
          round: stateRef.current.round,
        });
        void endRound("timeout", word);
      }
    };
    tick();
    roundTimerRef.current = setInterval(tick, 250);
    return () => {
      if (roundTimerRef.current) clearInterval(roundTimerRef.current);
    };
  }, [state.phase, state.endsAt, state.drawerId, myId, sendMsg, endRound]);

  // Pending invite from chat card
  useEffect(() => {
    if (!pendingInvite || pendingInvite.game !== "scribble" || pendingConsumed.current) return;
    const fromPeer = peers.find((p) => p.user_id === pendingInvite.fromId);
    if (!fromPeer) return;
    pendingConsumed.current = true;
    onPendingConsumed?.();

    const existing = getScribbleSession();
    const sameMatch = existing && existing.matchId === pendingInvite.matchId;

    if (pendingInvite.openOnly) {
      setOpponent(fromPeer);
      setMatchId(pendingInvite.matchId);
      if (sameMatch) {
        setMpPhase(existing.mpPhase);
        setState(existing.state);
        setIAmInviter(existing.iAmInviter);
      } else {
        setIAmInviter(false);
        setMpPhase("playing");
      }
      return;
    }

    // Chat card already sent accept — never clobber a live drawing session.
    setOpponent(fromPeer);
    setMatchId(pendingInvite.matchId);
    setIAmInviter(false);
    setInboundInvite(null);
    if (
      sameMatch &&
      (existing.state.drawerId ||
        existing.state.phase === "drawing" ||
        existing.mpPhase === "playing" ||
        existing.mpPhase === "done")
    ) {
      setMpPhase(existing.mpPhase === "idle" ? "playing" : existing.mpPhase);
      setState(existing.state);
      persist({
        mpPhase: existing.mpPhase === "idle" ? "playing" : existing.mpPhase,
        matchId: pendingInvite.matchId,
        opponent: fromPeer,
        iAmInviter: false,
        state: existing.state,
        inboundInvite: null,
      });
      return;
    }
    const fresh = sameMatch ? existing.state : newScribbleState();
    setState(fresh);
    setMpPhase("playing");
    setWaitingNextRound(true);
    persist({
      mpPhase: "playing",
      matchId: pendingInvite.matchId,
      opponent: fromPeer,
      iAmInviter: false,
      state: fresh,
      inboundInvite: null,
    });
    // MessageList may have already sent accept; a second accept is harmless.
    void sendGameMsg(fromPeer.user_id, {
      game: "scribble",
      payload: { type: "accept", matchId: pendingInvite.matchId },
    });
  }, [pendingInvite, peers, sendGameMsg, onPendingConsumed, persist]);

  // Inbound game_move
  useEffect(() => {
    dispatchRef.current = (fromId, msg) => {
      if (msg.game !== "scribble") return;
      const p = msg.payload as ScribbleMsg;
      const fromPeer = peers.find((x) => x.user_id === fromId);
      if (!fromPeer) return;

      if (p.type === "invite") {
        if (mpPhaseRef.current !== "idle" && mpPhaseRef.current !== "done") return;
        setInboundInvite({ from: fromPeer, matchId: p.matchId });
        setMatchId(p.matchId);
        setOpponent(fromPeer);
        setIAmInviter(false);
        setMpPhase("invited");
        const fresh = newScribbleState();
        setState(fresh);
        persist({
          mpPhase: "invited",
          matchId: p.matchId,
          opponent: fromPeer,
          iAmInviter: false,
          state: fresh,
          inboundInvite: { from: fromPeer, matchId: p.matchId },
        });
        return;
      }

      if ("matchId" in p && p.matchId && matchIdRef.current && p.matchId !== matchIdRef.current) {
        return;
      }

      if (p.type === "accept" && mpPhaseRef.current === "inviting") {
        setMpPhase("playing");
        setOpponent(fromPeer);
        persist({ mpPhase: "playing", opponent: fromPeer });
        // Inviter draws round 1.
        void beginRound(1, myId);
      } else if (p.type === "decline" && mpPhaseRef.current === "inviting") {
        setMpPhase("idle");
        setMpError(`${fromPeer.display_name} declined.`);
        setOpponent(null);
        setScribbleSession(null);
      } else if (p.type === "cancel") {
        if (mpPhaseRef.current === "inviting" || mpPhaseRef.current === "invited") {
          setMpPhase("idle");
          setInboundInvite(null);
          setOpponent(null);
          setScribbleSession(null);
        }
      } else if (p.type === "round_start") {
        const endsAt = Date.now() + (p.timerSec || SCRIBBLE_ROUND_SEC) * 1000;
        const next: ScribbleState = {
          ...stateRef.current,
          round: p.round,
          drawerId: p.drawerId,
          word: "",
          revealedWord: "",
          lastWrong: "",
          phase: "drawing",
          endsAt,
        };
        timeoutSent.current = false;
        setWaitingNextRound(false);
        setGuessLog([]);
        setState(next);
        setMpPhase("playing");
        clearCanvasLocal();
        setGuessText("");
        setSecondsLeft(p.timerSec || SCRIBBLE_ROUND_SEC);
        persist({ mpPhase: "playing", state: next });
        // Ack so drawer stops retrying.
        if (p.drawerId !== myId) {
          void sendMsg({
            type: "round_ack",
            matchId: matchIdRef.current || p.matchId,
            round: p.round,
          });
        }
      } else if (p.type === "round_ack") {
        if (p.round === stateRef.current.round) {
          roundAckedRef.current = p.round;
          stopRoundRetry();
        }
      } else if (p.type === "round_query") {
        if (
          stateRef.current.drawerId === myId &&
          lastRoundStartRef.current &&
          stateRef.current.phase === "drawing"
        ) {
          void sendMsg(lastRoundStartRef.current);
        }
      } else if (p.type === "guess" && stateRef.current.drawerId === myId) {
        const word = stateRef.current.word;
        if (stateRef.current.phase !== "drawing") return;
        if (guessMatches(word, p.text)) {
          setGuessLog((prev) => [
            ...prev,
            {
              id: `${Date.now()}-ok`,
              fromId,
              text: p.text,
              ok: true,
              at: Date.now(),
            },
          ]);
          // Guesser scores.
          const theirScore = stateRef.current.theirScore + 1;
          const myScore = stateRef.current.myScore;
          void sendMsg({
            type: "correct",
            matchId: matchIdRef.current,
            word,
            myScore,
            theirScore,
            round: stateRef.current.round,
          });
          void endRound("correct", word, { myScore, theirScore });
        } else {
          setState((s) => ({ ...s, lastWrong: p.text }));
          setGuessLog((prev) => [
            ...prev,
            {
              id: `${Date.now()}-bad`,
              fromId,
              text: p.text,
              ok: false,
              at: Date.now(),
            },
          ]);
          void sendMsg({ type: "wrong", matchId: matchIdRef.current, text: p.text });
        }
      } else if (p.type === "wrong") {
        // Guesser already logged on submit; drawer never receives wrong.
        setState((s) => ({ ...s, lastWrong: p.text }));
      } else if (p.type === "correct") {
        // Mark our last guess as correct if we were the guesser.
        setGuessLog((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i]!.fromId === myId && !next[i]!.ok) {
              next[i] = { ...next[i]!, ok: true, text: p.word || next[i]!.text };
              break;
            }
          }
          return next;
        });
        // Scores in payload are from the drawer's perspective.
        const iAmDrawer = stateRef.current.drawerId === myId;
        const myScore = iAmDrawer ? p.myScore : p.theirScore;
        const theirScore = iAmDrawer ? p.theirScore : p.myScore;
        void endRound("correct", p.word, { myScore, theirScore });
      } else if (p.type === "timeout") {
        const iAmDrawer = stateRef.current.drawerId === myId;
        const myScore = iAmDrawer ? p.myScore : p.theirScore;
        const theirScore = iAmDrawer ? p.theirScore : p.myScore;
        void endRound("timeout", p.word, { myScore, theirScore });
      } else if (p.type === "clear") {
        clearCanvasLocal();
      } else if (p.type === "result") {
        setMpPhase("done");
        setState((s) => ({ ...s, phase: "match_over", endsAt: null }));
        persist({ mpPhase: "done" });
        const outcome =
          p.winnerId == null ? "draw" : p.winnerId === myId ? "win" : "lose";
        pushGameHistory({
          game: "scribble",
          matchId: p.matchId || matchIdRef.current,
          opponentId: fromId,
          opponentName: fromPeer.display_name,
          outcome,
          detail: `${stateRef.current.myScore}–${stateRef.current.theirScore}`,
        });
        onHistory?.();
      } else if (p.type === "resign") {
        setMpPhase("done");
        setMpError(`${fromPeer.display_name} left the game.`);
        setState((s) => ({ ...s, phase: "match_over", endsAt: null }));
        pushGameHistory({
          game: "scribble",
          matchId: p.matchId || matchIdRef.current,
          opponentId: fromId,
          opponentName: fromPeer.display_name,
          outcome: "win",
          detail: "Opponent left",
        });
        onHistory?.();
        void sendMsg({
          type: "result",
          matchId: p.matchId || matchIdRef.current,
          winnerId: myId,
        });
        persist({ mpPhase: "done", mpError: `${fromPeer.display_name} left the game.` });
      } else if (p.type === "rematch") {
        const fresh = newScribbleState();
        setState(fresh);
        setMpPhase("playing");
        setIAmInviter((v) => !v);
        clearCanvasLocal();
        persist({ mpPhase: "playing", state: fresh, iAmInviter: !iAmInviter });
        // Previous invitee becomes inviter for rematch drawer order — swap.
        // The peer who sent rematch starts as drawer.
        void beginRound(1, fromId);
      }
    };
    return () => {
      dispatchRef.current = null;
    };
  }, [
    dispatchRef,
    peers,
    myId,
    beginRound,
    clearCanvasLocal,
    endRound,
    persist,
    sendMsg,
    onHistory,
    iAmInviter,
  ]);

  // Ephemeral stroke sync inbound
  useEffect(() => {
    strokeSyncRef.current = (fromId, payload) => {
      if (!payload?.matchId || payload.matchId !== matchIdRef.current) return;
      if (fromId === myId) return;
      canvasInboundRef.current?.(payload);
    };
    return () => {
      strokeSyncRef.current = null;
    };
  }, [strokeSyncRef, myId]);

  function handleInvite(peer: Peer) {
    setPickerOpen(false);
    const mid = `scribble-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMatchId(mid);
    setOpponent(peer);
    setIAmInviter(true);
    setMpPhase("inviting");
    const fresh = newScribbleState();
    setState(fresh);
    setInboundInvite(null);
    setMpError("");
    persist({
      mpPhase: "inviting",
      matchId: mid,
      opponent: peer,
      iAmInviter: true,
      state: fresh,
      inboundInvite: null,
      mpError: "",
    });
    sendGameMsg(peer.user_id, {
      game: "scribble",
      payload: { type: "invite", matchId: mid, fromName: myName },
    }).catch(() => setMpError("Failed to send invite."));
  }

  function acceptInvite() {
    if (!inboundInvite) return;
    const existing = getScribbleSession();
    const sameMatch = existing && existing.matchId === inboundInvite.matchId;
    setOpponent(inboundInvite.from);
    setMatchId(inboundInvite.matchId);
    setIAmInviter(false);
    setMpPhase("playing");
    setInboundInvite(null);
    // Keep a round_start that may have landed before accept finished.
    if (
      sameMatch &&
      (existing.state.drawerId || existing.state.phase === "drawing")
    ) {
      setState(existing.state);
      persist({
        mpPhase: "playing",
        matchId: inboundInvite.matchId,
        opponent: inboundInvite.from,
        iAmInviter: false,
        state: existing.state,
        inboundInvite: null,
      });
    } else {
      const fresh = newScribbleState();
      setState(fresh);
      setWaitingNextRound(true);
      persist({
        mpPhase: "playing",
        matchId: inboundInvite.matchId,
        opponent: inboundInvite.from,
        iAmInviter: false,
        state: fresh,
        inboundInvite: null,
      });
    }
    void sendMsg({ type: "accept", matchId: inboundInvite.matchId });
  }

  function declineInvite() {
    if (!inboundInvite) return;
    void sendMsg({ type: "decline", matchId: inboundInvite.matchId });
    setInboundInvite(null);
    setMpPhase("idle");
    setOpponent(null);
    setScribbleSession(null);
  }

  async function handleBack() {
    await leaveScribbleMatch({
      mpPhase,
      matchId,
      opponentId: opponent?.user_id || inboundInvite?.from.user_id,
      sendGameMsg,
    });
    setMpPhase("idle");
    setOpponent(null);
    setInboundInvite(null);
    setMatchId("");
    setState(newScribbleState());
    setMpError("");
    setScribbleSession(null);
    onBack();
  }

  async function cancelInvite() {
    if (mpPhase !== "inviting" || !opponent || !matchId) return;
    await leaveScribbleMatch({
      mpPhase: "inviting",
      matchId,
      opponentId: opponent.user_id,
      sendGameMsg,
    });
    setMpPhase("idle");
    setOpponent(null);
    setMatchId("");
    setScribbleSession(null);
  }

  const iAmDrawer = state.drawerId === myId && state.phase === "drawing";
  const iAmGuesser =
    state.phase === "drawing" && state.drawerId && state.drawerId !== myId;

  const onStrokeBatch = useCallback(
    (batch: ScribbleStrokeBatch) => {
      if (!iAmDrawer || !matchIdRef.current) return;
      const seq = syncSeq + 1;
      setSyncSeq(seq);
      void flushSync({
        matchId: matchIdRef.current,
        seq,
        op: "stroke",
        points: batch.points,
        color: batch.color,
        width: batch.width,
        start: batch.start,
      });
    },
    [iAmDrawer, flushSync, syncSeq]
  );

  const onUndoLocal = useCallback(() => {
    if (!iAmDrawer || !matchIdRef.current) return;
    const seq = syncSeq + 1;
    setSyncSeq(seq);
    void flushSync({ matchId: matchIdRef.current, seq, op: "undo" });
  }, [iAmDrawer, flushSync, syncSeq]);

  async function clearBoard() {
    if (!iAmDrawer || !matchIdRef.current) return;
    clearCanvasLocal();
    const seq = syncSeq + 1;
    setSyncSeq(seq);
    void flushSync({ matchId: matchIdRef.current, seq, op: "clear" });
    await sendMsg({ type: "clear", matchId: matchIdRef.current });
  }

  async function submitGuess() {
    if (!iAmGuesser || !guessText.trim()) return;
    const text = guessText.trim();
    setGuessText("");
    setGuessLog((prev) => [
      ...prev,
      {
        id: `${Date.now()}-me`,
        fromId: myId,
        text,
        ok: false,
        at: Date.now(),
      },
    ]);
    await sendMsg({ type: "guess", matchId: matchIdRef.current, text });
  }

  useEffect(() => {
    const el = guessLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [guessLog]);

  async function rematch() {
    if (!opponent) return;
    const fresh = newScribbleState();
    setState(fresh);
    setGuessLog([]);
    setWaitingNextRound(false);
    stopRoundRetry();
    setMpPhase("playing");
    setIAmInviter((v) => !v);
    clearCanvasLocal();
    persist({ mpPhase: "playing", state: fresh });
    await sendMsg({ type: "rematch", matchId });
    // Sender of rematch draws first.
    void beginRound(1, myId);
  }

  return (
    <Box sx={{ p: 3, height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <IconButton onClick={() => void handleBack()} size="small" aria-label="Back">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" fontWeight={700} flex={1}>
          Scribble
        </Typography>
        {mpPhase === "playing" && (
          <Chip
            size="small"
            label={`${state.myScore} – ${state.theirScore}`}
            color="primary"
          />
        )}
      </Stack>

      {mpError && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setMpError("")}>
          {mpError}
        </Alert>
      )}

      {mpPhase === "idle" && (
        <Stack spacing={2} maxWidth={420}>
          <Typography variant="body2" color="text.secondary">
            One draws, one guesses. First to {SCRIBBLE_WIN_SCORE} (max {SCRIBBLE_MAX_ROUNDS}{" "}
            rounds). Drawing syncs over a light LAN channel — no chat lag.
          </Typography>
          <Button variant="contained" onClick={() => setPickerOpen(true)}>
            Invite peer
          </Button>
        </Stack>
      )}

      {mpPhase === "inviting" && (
        <Stack spacing={1.5}>
          <Typography>
            Waiting for {opponent?.display_name || "peer"} to accept…
          </Typography>
          <Button onClick={() => void cancelInvite()}>Cancel invite</Button>
        </Stack>
      )}

      {mpPhase === "invited" && inboundInvite && (
        <Stack spacing={1.5}>
          <Typography>
            {inboundInvite.from.display_name} invited you to Scribble
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={acceptInvite}>
              Accept
            </Button>
            <Button onClick={declineInvite}>Decline</Button>
          </Stack>
        </Stack>
      )}

      {(mpPhase === "playing" || mpPhase === "done") && (
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            minHeight: 0,
            gap: 1.5,
          }}
        >
          <Box
            sx={{
              flex: { xs: "1 1 auto", md: "1 1 70%" },
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              minHeight: 0,
              gap: 1.5,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
              <Typography variant="body2" color="text.secondary">
                Round {state.round || "—"} ·{" "}
                {waitingNextRound && state.phase !== "drawing" && state.phase !== "match_over"
                  ? "Next round…"
                  : state.phase === "drawing"
                    ? iAmDrawer
                      ? "You draw"
                      : `${opponent?.display_name || "They"} draw`
                    : state.phase === "round_over"
                      ? "Round over"
                      : state.phase === "match_over"
                        ? "Match over"
                        : waitingNextRound
                          ? "Next round…"
                          : "Get ready"}
              </Typography>
              {secondsLeft != null && state.phase === "drawing" && (
                <Chip
                  size="small"
                  label={`${secondsLeft}s`}
                  color={secondsLeft <= 10 ? "error" : "default"}
                />
              )}
              {iAmDrawer && state.word && (
                <Chip size="small" color="secondary" label={`Word: ${state.word}`} />
              )}
              {state.revealedWord && (
                <Chip size="small" label={`It was: ${state.revealedWord}`} />
              )}
            </Stack>

            {waitingNextRound && !state.drawerId && state.phase !== "match_over" && (
              <Alert severity="info" sx={{ py: 0.5 }}>
                Next round… waiting for the drawer to start.
              </Alert>
            )}

            <Box sx={{ flex: 1, minHeight: 240 }}>
              <ScribbleCanvas
                canDraw={iAmDrawer}
                color={color}
                width={penWidth}
                clearTick={clearTick}
                undoTick={undoTick}
                onStrokeBatch={onStrokeBatch}
                onUndo={onUndoLocal}
                onClear={() => {}}
                inboundRef={canvasInboundRef}
              />
            </Box>

            {iAmDrawer && (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                {SCRIBBLE_COLORS.map((c) => (
                  <Box
                    key={c}
                    onClick={() => setColor(c)}
                    sx={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      bgcolor: c,
                      border: color === c ? "2px solid" : "1px solid",
                      borderColor: color === c ? "primary.main" : "divider",
                      cursor: "pointer",
                      boxShadow: c === "#FFFFFF" ? "inset 0 0 0 1px #ccc" : undefined,
                    }}
                  />
                ))}
                {SCRIBBLE_WIDTHS.map((w) => (
                  <Chip
                    key={w}
                    size="small"
                    label={`${w}px`}
                    color={penWidth === w ? "primary" : "default"}
                    onClick={() => setPenWidth(w)}
                  />
                ))}
                <IconButton
                  size="small"
                  aria-label="Undo"
                  onClick={() => setUndoTick((n) => n + 1)}
                >
                  <UndoIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" aria-label="Clear" onClick={() => void clearBoard()}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            )}

            {mpPhase === "done" && (
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={() => void rematch()}>
                  Rematch
                </Button>
                <Button onClick={() => void handleBack()}>Leave</Button>
              </Stack>
            )}
          </Box>

          <Box
            sx={{
              flex: { xs: "0 0 auto", md: "0 0 280px" },
              width: { xs: "100%", md: 280 },
              display: "flex",
              flexDirection: "column",
              minHeight: { xs: 200, md: 0 },
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              overflow: "hidden",
              bgcolor: "background.paper",
            }}
          >
            <Box
              sx={{
                px: 1.5,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Typography variant="subtitle2" fontWeight={700}>
                Guesses
              </Typography>
            </Box>
            <Box
              ref={guessLogRef}
              sx={{
                flex: 1,
                overflowY: "auto",
                px: 1.5,
                py: 1,
                minHeight: 0,
              }}
            >
              {guessLog.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {state.phase === "drawing"
                    ? "No guesses yet."
                    : waitingNextRound
                      ? "Waiting for next round…"
                      : "Guesses appear here."}
                </Typography>
              ) : (
                <Stack spacing={0.75}>
                  {guessLog.map((g) => {
                    const who =
                      g.fromId === myId
                        ? "You"
                        : opponent?.display_name || "Peer";
                    return (
                      <Box key={g.id}>
                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                            color: g.ok ? "success.main" : "text.secondary",
                            fontWeight: g.ok ? 700 : 400,
                          }}
                        >
                          {who}: “{g.text}”
                          {g.ok ? " ✓" : ""}
                        </Typography>
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Box>
            <Box
              sx={{
                px: 1.5,
                py: 1,
                borderTop: 1,
                borderColor: "divider",
              }}
            >
              {iAmGuesser ? (
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Type your guess…"
                    value={guessText}
                    onChange={(e) => setGuessText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitGuess();
                    }}
                  />
                  <Button variant="contained" onClick={() => void submitGuess()}>
                    Send
                  </Button>
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {iAmDrawer
                    ? "You’re drawing — wait for guesses"
                    : waitingNextRound
                      ? "Next round…"
                      : "Guesses will show here"}
                </Typography>
              )}
            </Box>
          </Box>
        </Box>
      )}

      <PeerPicker
        open={pickerOpen}
        peers={peers}
        onPick={handleInvite}
        onClose={() => setPickerOpen(false)}
      />
    </Box>
  );
}
