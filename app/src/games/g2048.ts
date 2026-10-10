// 2048 — pure game logic. 4×4 board, flat array row-major.

export type G2048State = {
  board: number[]; // 16 tiles; 0 = empty
  score: number;
  best: number;
  over: boolean;   // no legal moves left
  won: boolean;    // reached 2048
  history: { board: number[]; score: number }[]; // for undo, max 10 entries
};

export type Direction = "up" | "down" | "left" | "right";

export function new2048State(best = 0): G2048State {
  const board = Array(16).fill(0);
  addRandomTile(board);
  addRandomTile(board);
  return { board, score: 0, best, over: false, won: false, history: [] };
}

function addRandomTile(board: number[]): void {
  const empty = board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  if (!empty.length) return;
  const idx = empty[Math.floor(Math.random() * empty.length)];
  board[idx] = Math.random() < 0.9 ? 2 : 4;
}

/** Slide a row left, return {row, gained}. */
function slideLeft(row: number[]): { row: number[]; gained: number } {
  const cells = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  let i = 0;
  while (i < cells.length) {
    if (i + 1 < cells.length && cells[i] === cells[i + 1]) {
      const val = cells[i] * 2;
      out.push(val);
      gained += val;
      i += 2;
    } else {
      out.push(cells[i]);
      i++;
    }
  }
  while (out.length < 4) out.push(0);
  return { row: out, gained };
}

function rotateBoard(board: number[]): number[] {
  // Rotate 90° clockwise
  const out = Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c * 4 + (3 - r)] = board[r * 4 + c];
    }
  }
  return out;
}

function moveLeft(board: number[]): { board: number[]; gained: number } {
  const out: number[] = [];
  let gained = 0;
  for (let r = 0; r < 4; r++) {
    const row = board.slice(r * 4, r * 4 + 4);
    const { row: slid, gained: g } = slideLeft(row);
    out.push(...slid);
    gained += g;
  }
  return { board: out, gained };
}

function applyDirection(
  board: number[],
  dir: Direction
): { board: number[]; gained: number } {
  const rotations: Record<Direction, number> = { left: 0, up: 1, right: 2, down: 3 };
  const rots = rotations[dir];
  // Rotate so that the target direction is "left", then rotate back
  let b = board;
  for (let i = 0; i < rots; i++) b = rotateBoard(b);
  const { board: moved, gained } = moveLeft(b);
  // Rotate back: 4 - rots rotations clockwise
  let result = moved;
  for (let i = 0; i < (4 - rots) % 4; i++) result = rotateBoard(result);
  return { board: result, gained };
}

function hasLegalMove(board: number[]): boolean {
  if (board.some((v) => v === 0)) return true;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = board[r * 4 + c];
      if (c < 3 && board[r * 4 + c + 1] === v) return true;
      if (r < 3 && board[(r + 1) * 4 + c] === v) return true;
    }
  }
  return false;
}

function boardsEqual(a: number[], b: number[]): boolean {
  return a.every((v, i) => v === b[i]);
}

export function move2048(state: G2048State, dir: Direction): G2048State | null {
  if (state.over) return null;
  const { board: moved, gained } = applyDirection(state.board, dir);
  if (boardsEqual(moved, state.board)) return null; // no change — invalid move

  const newBoard = [...moved];
  addRandomTile(newBoard);
  const score = state.score + gained;
  const best = Math.max(state.best, score);
  const won = state.won || newBoard.some((v) => v >= 2048);
  const over = !hasLegalMove(newBoard);

  const history = [
    ...state.history.slice(-9),
    { board: [...state.board], score: state.score },
  ];

  return { board: newBoard, score, best, over, won, history };
}

export function undo2048(state: G2048State): G2048State | null {
  if (!state.history.length) return null;
  const prev = state.history[state.history.length - 1];
  return {
    ...state,
    board: [...prev.board],
    score: prev.score,
    over: false,
    history: state.history.slice(0, -1),
  };
}
