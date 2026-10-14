// Tetris — pure game logic. 10×20 board, classic 7-bag pieces.

export const COLS = 10;
export const ROWS = 20;

export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // 0 empty, 1–7 piece colors

export type TetrisState = {
  board: Cell[]; // row-major, length COLS*ROWS
  piece: { kind: number; rot: number; x: number; y: number } | null;
  next: number;
  bag: number[];
  score: number;
  best: number;
  lines: number;
  level: number;
  over: boolean;
};

const SHAPES: number[][][][] = [
  // I
  [
    [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0], [0, 0, 1, 0]],
    [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0]],
  ],
  // O
  [
    [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 1, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
  ],
  // T
  [
    [[0, 1, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 1, 1, 0], [0, 1, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [1, 1, 1, 0], [0, 1, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]],
  ],
  // S
  [
    [[0, 1, 1, 0], [1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 1, 1, 0], [0, 0, 1, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [0, 1, 1, 0], [1, 1, 0, 0], [0, 0, 0, 0]],
    [[1, 0, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]],
  ],
  // Z
  [
    [[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 1, 0], [0, 1, 1, 0], [0, 1, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [1, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 0]],
  ],
  // J
  [
    [[1, 0, 0, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 1, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [1, 1, 1, 0], [0, 0, 1, 0], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0], [0, 0, 0, 0]],
  ],
  // L
  [
    [[0, 0, 1, 0], [1, 1, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 1, 0, 0], [0, 1, 1, 0], [0, 0, 0, 0]],
    [[0, 0, 0, 0], [1, 1, 1, 0], [1, 0, 0, 0], [0, 0, 0, 0]],
    [[1, 1, 0, 0], [0, 1, 0, 0], [0, 1, 0, 0], [0, 0, 0, 0]],
  ],
];

function emptyBoard(): Cell[] {
  return Array(COLS * ROWS).fill(0) as Cell[];
}

function shuffleBag(): number[] {
  const bag = [0, 1, 2, 3, 4, 5, 6];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function cellsOf(kind: number, rot: number, x: number, y: number): Array<{ x: number; y: number }> {
  const shape = SHAPES[kind][rot % 4];
  const out: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (shape[r][c]) out.push({ x: x + c, y: y + r });
    }
  }
  return out;
}

function fits(board: Cell[], kind: number, rot: number, x: number, y: number): boolean {
  for (const p of cellsOf(kind, rot, x, y)) {
    if (p.x < 0 || p.x >= COLS || p.y >= ROWS) return false;
    if (p.y < 0) continue;
    if (board[p.y * COLS + p.x] !== 0) return false;
  }
  return true;
}

function lockPiece(state: TetrisState): TetrisState {
  if (!state.piece) return state;
  const board = [...state.board];
  const color = (state.piece.kind + 1) as Cell;
  for (const p of cellsOf(state.piece.kind, state.piece.rot, state.piece.x, state.piece.y)) {
    if (p.y < 0) {
      return { ...state, over: true, piece: null, best: Math.max(state.best, state.score) };
    }
    board[p.y * COLS + p.x] = color;
  }

  let cleared = 0;
  const kept: Cell[] = [];
  for (let r = 0; r < ROWS; r++) {
    const row = board.slice(r * COLS, (r + 1) * COLS);
    if (row.every((c) => c !== 0)) cleared++;
    else kept.push(...row);
  }
  while (kept.length < COLS * ROWS) kept.unshift(0 as Cell);

  const lineScores = [0, 100, 300, 500, 800];
  const lines = state.lines + cleared;
  const level = Math.floor(lines / 10) + 1;
  const score = state.score + (lineScores[cleared] || 0) * level;
  const best = Math.max(state.best, score);

  let bag = [...state.bag];
  if (!bag.length) bag = shuffleBag();
  const nextKind = bag.shift()!;
  const spawn = { kind: state.next, rot: 0, x: 3, y: 0 };
  if (!fits(kept as Cell[], spawn.kind, spawn.rot, spawn.x, spawn.y)) {
    return {
      ...state,
      board: kept as Cell[],
      piece: null,
      next: nextKind,
      bag,
      score,
      best,
      lines,
      level,
      over: true,
    };
  }
  return {
    ...state,
    board: kept as Cell[],
    piece: spawn,
    next: nextKind,
    bag,
    score,
    best,
    lines,
    level,
    over: false,
  };
}

export function newTetrisState(best = 0): TetrisState {
  let bag = shuffleBag();
  const first = bag.shift()!;
  if (!bag.length) bag = shuffleBag();
  const next = bag.shift()!;
  return {
    board: emptyBoard(),
    piece: { kind: first, rot: 0, x: 3, y: 0 },
    next,
    bag,
    score: 0,
    best,
    lines: 0,
    level: 1,
    over: false,
  };
}

export function tickGravity(state: TetrisState): TetrisState {
  if (state.over || !state.piece) return state;
  const { kind, rot, x, y } = state.piece;
  if (fits(state.board, kind, rot, x, y + 1)) {
    return { ...state, piece: { ...state.piece, y: y + 1 } };
  }
  return lockPiece(state);
}

export function moveLeft(state: TetrisState): TetrisState {
  if (state.over || !state.piece) return state;
  const { kind, rot, x, y } = state.piece;
  if (!fits(state.board, kind, rot, x - 1, y)) return state;
  return { ...state, piece: { ...state.piece, x: x - 1 } };
}

export function moveRight(state: TetrisState): TetrisState {
  if (state.over || !state.piece) return state;
  const { kind, rot, x, y } = state.piece;
  if (!fits(state.board, kind, rot, x + 1, y)) return state;
  return { ...state, piece: { ...state.piece, x: x + 1 } };
}

export function softDrop(state: TetrisState): TetrisState {
  if (state.over || !state.piece) return state;
  const { kind, rot, x, y } = state.piece;
  if (fits(state.board, kind, rot, x, y + 1)) {
    return { ...state, piece: { ...state.piece, y: y + 1 }, score: state.score + 1 };
  }
  return lockPiece({ ...state, score: state.score });
}

export function hardDrop(state: TetrisState): TetrisState {
  if (state.over || !state.piece) return state;
  let y = state.piece.y;
  let gained = 0;
  while (fits(state.board, state.piece.kind, state.piece.rot, state.piece.x, y + 1)) {
    y++;
    gained += 2;
  }
  return lockPiece({
    ...state,
    score: state.score + gained,
    piece: { ...state.piece, y },
  });
}

export function rotateCW(state: TetrisState): TetrisState {
  if (state.over || !state.piece) return state;
  const { kind, rot, x, y } = state.piece;
  const nextRot = (rot + 1) % 4;
  // Simple wall kicks: try 0, -1, +1, -2, +2
  for (const dx of [0, -1, 1, -2, 2]) {
    if (fits(state.board, kind, nextRot, x + dx, y)) {
      return { ...state, piece: { ...state.piece, rot: nextRot, x: x + dx } };
    }
  }
  return state;
}

/** Board with active piece painted for rendering. */
export function renderBoard(state: TetrisState): Cell[] {
  const board = [...state.board];
  if (!state.piece) return board;
  const color = (state.piece.kind + 1) as Cell;
  for (const p of cellsOf(state.piece.kind, state.piece.rot, state.piece.x, state.piece.y)) {
    if (p.y >= 0 && p.y < ROWS && p.x >= 0 && p.x < COLS) {
      board[p.y * COLS + p.x] = color;
    }
  }
  return board;
}

export function previewCells(kind: number): Array<{ x: number; y: number }> {
  return cellsOf(kind, 0, 0, 0).map((p) => ({ x: p.x, y: p.y }));
}

export function gravityMs(level: number): number {
  return Math.max(100, 800 - (level - 1) * 60);
}
