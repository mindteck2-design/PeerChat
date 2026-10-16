export type Tool =
  | "select"
  | "pen"
  | "arrow"
  | "rect"
  | "circle"
  | "text"
  | "rect_text"
  | "arrow_text"
  | "highlight"
  | "blur"
  | "crop";

export type Point = { x: number; y: number };

export type Annotation =
  | { id: string; type: "pen"; color: string; stroke: number; points: Point[] }
  | { id: string; type: "arrow"; color: string; stroke: number; from: Point; to: Point }
  | { id: string; type: "rect"; color: string; stroke: number; from: Point; to: Point }
  | { id: string; type: "circle"; color: string; stroke: number; from: Point; to: Point }
  | { id: string; type: "text"; color: string; stroke: number; at: Point; text: string }
  | {
      id: string;
      type: "rect_text";
      color: string;
      stroke: number;
      from: Point;
      to: Point;
      text: string;
    }
  | {
      id: string;
      type: "arrow_text";
      color: string;
      stroke: number;
      from: Point;
      to: Point;
      text: string;
    }
  | { id: string; type: "highlight"; color: string; stroke: number; from: Point; to: Point }
  | { id: string; type: "blur"; stroke: number; from: Point; to: Point }
  | { id: string; type: "crop"; from: Point; to: Point };

export const COLORS = [
  "#E53935",
  "#FB8C00",
  "#FDD835",
  "#43A047",
  "#1E88E5",
  "#212121",
  "#FFFFFF",
  "#BDBDBD",
] as const;

export const ACCENT = "#0F6B5C";

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeRect(from: Point, to: Point) {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const w = Math.abs(to.x - from.x);
  const h = Math.abs(to.y - from.y);
  return { x, y, w, h };
}
