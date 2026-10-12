// Rock Paper Scissors — pure game logic.

export type RpsChoice = "rock" | "paper" | "scissors";
export type RpsResult = "win" | "lose" | "draw";
export type MatchFormat = 1 | 3 | 5; // best of N

export type RpsRound = {
  myChoice: RpsChoice;
  theirChoice: RpsChoice;
  result: RpsResult; // from MY perspective
};

export type RpsState = {
  format: MatchFormat;
  rounds: RpsRound[];
  myScore: number;
  theirScore: number;
  phase: "choosing" | "revealing" | "done";
  myChoice: RpsChoice | null;
  theirChoiceHidden: boolean; // true when they have committed but we don't know yet
};

const BEATS: Record<RpsChoice, RpsChoice> = {
  rock: "scissors",
  scissors: "paper",
  paper: "rock",
};

export function rpsResult(mine: RpsChoice, theirs: RpsChoice): RpsResult {
  if (mine === theirs) return "draw";
  return BEATS[mine] === theirs ? "win" : "lose";
}

export function newRpsState(format: MatchFormat): RpsState {
  return {
    format,
    rounds: [],
    myScore: 0,
    theirScore: 0,
    phase: "choosing",
    myChoice: null,
    theirChoiceHidden: false,
  };
}

export function rpsNeeded(format: MatchFormat) {
  return Math.ceil(format / 2);
}

/** Resolve a round once both choices are known. Returns updated state. */
export function rpsResolveRound(
  state: RpsState,
  myChoice: RpsChoice,
  theirChoice: RpsChoice
): RpsState {
  const result = rpsResult(myChoice, theirChoice);
  const round: RpsRound = { myChoice, theirChoice, result };
  const rounds = [...state.rounds, round];
  const myScore = state.myScore + (result === "win" ? 1 : 0);
  const theirScore = state.theirScore + (result === "lose" ? 1 : 0);
  const needed = rpsNeeded(state.format);
  const done = myScore >= needed || theirScore >= needed || rounds.length >= state.format;
  return {
    ...state,
    rounds,
    myScore,
    theirScore,
    phase: done ? "done" : "choosing",
    myChoice: null,
    theirChoiceHidden: false,
  };
}

// LAN message payloads
export type RpsMsg =
  | { type: "invite"; matchId: string; fromName: string; format: MatchFormat }
  | { type: "accept"; matchId: string }
  | { type: "decline"; matchId: string }
  | { type: "commit"; matchId: string; round: number } // "I have chosen" — no choice revealed
  | { type: "reveal"; matchId: string; round: number; choice: RpsChoice }
  | { type: "rematch"; matchId: string; format: MatchFormat }
  | { type: "resign"; matchId: string }
  | { type: "result"; matchId: string; winnerId: string | null };
