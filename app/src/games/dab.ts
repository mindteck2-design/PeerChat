// Dots and Boxes — pure game logic.
//
// Board representation:
//   dots: (rows+1) × (cols+1)
//   hEdges[r][c]: horizontal edge between dot (r,c)→(r,c+1) — length rows×cols
//   vEdges[r][c]: vertical edge between dot (r,c)→(r+1,c)  — length rows×cols
//   boxes[r][c]: owner of box in row r, col c ("A"|"B"|null)

export type Player = "A" | "B";

export type DabState = {
  rows: number;
  cols: number;
  hEdges: boolean[][]; // [row 0..rows][col 0..cols-1]
  vEdges: boolean[][]; // [row 0..rows-1][col 0..cols]
  boxes: (Player | null)[][]; // [row 0..rows-1][col 0..cols-1]
  turn: Player;
  scoreA: number;
  scoreB: number;
  done: boolean;
};

export type EdgeId =
  | { kind: "h"; r: number; c: number }
  | { kind: "v"; r: number; c: number };

export function newDabState(rows = 4, cols = 4): DabState {
  return {
    rows,
    cols,
    hEdges: Array.from({ length: rows + 1 }, () => Array(cols).fill(false)),
    vEdges: Array.from({ length: rows }, () => Array(cols + 1).fill(false)),
    boxes: Array.from({ length: rows }, () => Array(cols).fill(null)),
    turn: "A",
    scoreA: 0,
    scoreB: 0,
    done: false,
  };
}

/** Apply an edge. Returns new state or null if the edge is already drawn. */
export function dabMove(state: DabState, edge: EdgeId): DabState | null {
  if (state.done) return null;
  const { kind, r, c } = edge;

  // bounds check
  if (kind === "h") {
    if (r < 0 || r > state.rows || c < 0 || c >= state.cols) return null;
    if (state.hEdges[r][c]) return null;
  } else {
    if (r < 0 || r >= state.rows || c < 0 || c > state.cols) return null;
    if (state.vEdges[r][c]) return null;
  }

  const hEdges = state.hEdges.map((row) => [...row]);
  const vEdges = state.vEdges.map((row) => [...row]);
  const boxes = state.boxes.map((row) => [...row]) as (Player | null)[][];

  if (kind === "h") hEdges[r][c] = true;
  else vEdges[r][c] = true;

  // Count newly completed boxes
  let gained = 0;
  for (const [br, bc] of boxesToCheck(edge, state.rows, state.cols)) {
    if (isBoxComplete(br, bc, hEdges, vEdges)) {
      if (boxes[br][bc] === null) {
        boxes[br][bc] = state.turn;
        gained++;
      }
    }
  }

  const scoreA = state.scoreA + (state.turn === "A" ? gained : 0);
  const scoreB = state.scoreB + (state.turn === "B" ? gained : 0);
  const totalBoxes = state.rows * state.cols;
  const done = scoreA + scoreB === totalBoxes;

  // Player gets another turn if they completed at least one box
  const turn: Player = gained > 0 && !done ? state.turn : state.turn === "A" ? "B" : "A";

  return { ...state, hEdges, vEdges, boxes, turn, scoreA, scoreB, done };
}

function boxesToCheck(edge: EdgeId, rows: number, cols: number): [number, number][] {
  const { kind, r, c } = edge;
  const candidates: [number, number][] = [];
  if (kind === "h") {
    // Box above: row r-1, col c
    if (r > 0) candidates.push([r - 1, c]);
    // Box below: row r, col c
    if (r < rows) candidates.push([r, c]);
  } else {
    // Box to left: row r, col c-1
    if (c > 0) candidates.push([r, c - 1]);
    // Box to right: row r, col c
    if (c < cols) candidates.push([r, c]);
  }
  return candidates;
}

function isBoxComplete(
  r: number,
  c: number,
  hEdges: boolean[][],
  vEdges: boolean[][]
): boolean {
  return (
    hEdges[r][c] &&     // top
    hEdges[r + 1][c] && // bottom
    vEdges[r][c] &&     // left
    vEdges[r][c + 1]    // right
  );
}

export function edgeKey(e: EdgeId): string {
  return `${e.kind}:${e.r}:${e.c}`;
}

// LAN message payloads
export type DabMsg =
  | { type: "invite"; matchId: string; fromName: string; rows: number; cols: number }
  | { type: "accept"; matchId: string }
  | { type: "decline"; matchId: string }
  | { type: "move"; matchId: string; seq: number; edge: EdgeId }
  | { type: "rematch"; matchId: string; rows: number; cols: number }
  | { type: "resign"; matchId: string }
  | { type: "result"; matchId: string; winnerId: string | null };
