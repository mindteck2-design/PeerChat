// Tic-Tac-Toe — pure game logic, no React, no I/O.

export type Cell = "X" | "O" | null;
export type Board = Cell[]; // length 9, row-major

export type TttState = {
  board: Board;
  turn: "X" | "O";
  winner: "X" | "O" | "draw" | null;
  winLine: number[] | null; // indices of the winning triple
};

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function newTttState(): TttState {
  return { board: Array(9).fill(null), turn: "X", winner: null, winLine: null };
}

export function tttMove(state: TttState, index: number): TttState | null {
  if (state.winner !== null) return null;
  if (state.board[index] !== null) return null;
  const board = [...state.board] as Board;
  board[index] = state.turn;
  const win = checkWinner(board);
  const isDraw = !win && board.every((c) => c !== null);
  return {
    board,
    turn: state.turn === "X" ? "O" : "X",
    winner: win ? state.turn : isDraw ? "draw" : null,
    winLine: win ?? null,
  };
}

function checkWinner(board: Board): number[] | null {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return [a, b, c];
  }
  return null;
}

// LAN message payloads
export type TttMsg =
  | { type: "invite"; matchId: string; fromName: string }
  | { type: "accept"; matchId: string }
  | { type: "decline"; matchId: string }
  | { type: "move"; matchId: string; index: number; boardAfter: Board }
  | { type: "rematch"; matchId: string }
  | { type: "resign"; matchId: string };
