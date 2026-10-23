import type { Box, Pin, Point, Reference } from "../../types";

export const PIN = { w: 220, min: 40, gap: 16, frame: 12, radius: 10 };
export const NOTE = { w: 200, min: 150, fold: 0.11 };

const TILT = { min: 0.3, max: 1.2 };
const CURVE = 120;

type Side = "left" | "right" | "top" | "bottom";
const OUT: Record<Side, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
const OPPOSITE: Record<Side, Side> = { left: "right", right: "left", top: "bottom", bottom: "top" };

const anchor = ({ x, y, w, h }: Box, side: Side): Point => ({
  x: x + ((1 + OUT[side].x) * w) / 2,
  y: y + ((1 + OUT[side].y) * h) / 2,
});

export function linkPath(a: Box, b: Box, head: number): string {
  const [dx, dy] = [b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2)];
  const from: Side =
    Math.abs(dx) / (a.w + b.w) >= Math.abs(dy) / (a.h + b.h) ? (dx < 0 ? "left" : "right") : dy < 0 ? "top" : "bottom";
  const [p, q, n] = [anchor(a, from), anchor(b, OPPOSITE[from]), OUT[from]];
  const k = Math.min(Math.hypot(q.x - p.x, q.y - p.y) / 2, CURVE);
  const at = (point: Point, along: number, across = 0) =>
    `${Math.round((point.x + n.x * along - n.y * across) * 10) / 10},${Math.round((point.y + n.y * along + n.x * across) * 10) / 10}`;
  return `M${at(p, 0)}C${at(p, k)} ${at(q, -k)} ${at(q, 0)}M${at(q, -head, head * 0.6)}L${at(q, 0)}L${at(q, -head, -head * 0.6)}`;
}

const ratioOf = (ref: Reference | undefined) => (ref?.width && ref.height ? ref.height / ref.width : 1);

export const pinHeight = (w: number, ref: Reference | undefined) => (w - 2 * PIN.frame) * ratioOf(ref) + 2 * PIN.frame;

export const tiltOf = (seed: number) =>
  Math.round((Math.sign(seed - 0.5) || 1) * (TILT.min + Math.abs(seed - 0.5) * 2 * (TILT.max - TILT.min)) * 10) / 10;

export const restingTilt = (angle: number | undefined) => Math.max(-TILT.max, Math.min(TILT.max, angle ?? 0));

export function tiltFromId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return tiltOf(((hash ^ (hash >>> 16)) >>> 0) / 4294967296);
}

export const landing = () => tiltOf(Math.random());

export function pinGrid(refs: Reference[], at: Point): Pin[] {
  const cols = Math.ceil(Math.sqrt(refs.length));
  const rows: Reference[][] = [];
  for (let i = 0; i < refs.length; i += cols) rows.push(refs.slice(i, i + cols));
  const heights = rows.map((row) => Math.max(...row.map((ref) => pinHeight(PIN.w, ref))));
  const width = Math.min(cols, refs.length) * (PIN.w + PIN.gap) - PIN.gap;
  let y = at.y - heights.reduce((sum, h) => sum + h + PIN.gap, -PIN.gap) / 2;
  return rows.flatMap((row, r) => {
    const top = y;
    y += heights[r] + PIN.gap;
    return row.map((ref, c) => ({
      refId: ref.id,
      x: Math.round(at.x - width / 2 + c * (PIN.w + PIN.gap)),
      y: Math.round(top),
      w: PIN.w,
      angle: tiltFromId(ref.id),
    }));
  });
}
