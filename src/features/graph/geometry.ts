import type { Box, Library, Point, Reference, SpaceNode, Viewport } from "../../types";

const GAP = 24;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const NODE_R = 16;
export const LOOSE_R = 22;
export const LABEL_HEIGHT = 40;
const CLUSTER = { spacing: 2.6 * NODE_R, pad: 24, empty: 44 };
const LOOSE_SPACING = (2 * LOOSE_R + GAP / 2) * 0.75;
const DOTS = { world: 24, min: 18 };

export const clusterRadius = (count: number) =>
  count ? CLUSTER.spacing * Math.sqrt(count) + CLUSTER.pad : CLUSTER.empty;

export const spiralAt = (i: number, spacing: number): Point => {
  const radius = spacing * Math.sqrt(i + 0.5);
  return { x: radius * Math.cos(i * GOLDEN_ANGLE), y: radius * Math.sin(i * GOLDEN_ANGLE) };
};

export const looseExtent = (count: number) => (count > 1 ? LOOSE_SPACING * Math.sqrt(count - 0.5) : 0) + LOOSE_R;

export function nodeBox(node: SpaceNode, library: Library): Box {
  if (node.kind === "ref") return { x: node.x - LOOSE_R, y: node.y - LOOSE_R, w: 2 * LOOSE_R, h: 2 * LOOSE_R };
  const r = clusterRadius(
    library.collections.find((collection) => collection.id === node.collectionId)?.refIds.length ?? 0,
  );
  return { x: node.x - r, y: node.y - r, w: 2 * r, h: 2 * r + LABEL_HEIGHT };
}

export function boundsOf(nodes: SpaceNode[], library: Library): Box | null {
  if (!nodes.length) return null;
  const boxes = nodes.map((node) => nodeBox(node, library));
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - x,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - y,
  };
}

export function nextTo(nodes: SpaceNode[], library: Library) {
  const taken = boundsOf(nodes, library);
  return taken ? { x: taken.x + taken.w + GAP * 4, y: taken.y } : { x: 0, y: 0 };
}

const overlaps = (a: Box, b: Box, margin: number) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

export function freeSpot(nodes: SpaceNode[], library: Library, center: Point, size: { w: number; h: number }) {
  const boxes = nodes.map((node) => nodeBox(node, library));
  const at = (dx: number, dy: number) => ({
    x: Math.round(center.x - size.w / 2 + dx),
    y: Math.round(center.y - size.h / 2 + dy),
  });
  const step = Math.max(size.w, size.h) / 2 + GAP;
  for (let ring = 0; ring < 12; ring++) {
    const tries = ring ? ring * 8 : 1;
    for (let k = 0; k < tries; k++) {
      const angle = (k / tries) * 2 * Math.PI;
      const spot = at(Math.cos(angle) * ring * step, Math.sin(angle) * ring * step);
      if (!boxes.some((box) => overlaps(box, { ...spot, ...size }, GAP))) return spot;
    }
  }
  return at(0, 0);
}

export function dotGrid(view: Viewport) {
  const step = DOTS.world * 2 ** Math.ceil(Math.log2(DOTS.min / (DOTS.world * view.scale))) * view.scale;
  const tile = 2 * step;
  const wrap = (value: number) => ((value % tile) + tile) % tile;
  const t = (step - DOTS.min) / DOTS.min;
  return { step, x: wrap(view.x - step), y: wrap(view.y - step), fade: t * t * (3 - 2 * t) };
}

export function placeLoose(refs: Reference[], center: Point): SpaceNode[] {
  return refs.map((ref, i) => {
    const offset = refs.length === 1 ? { x: 0, y: 0 } : spiralAt(i, LOOSE_SPACING);
    return {
      kind: "ref",
      id: `r:${ref.id}`,
      refId: ref.id,
      x: Math.round(center.x + offset.x),
      y: Math.round(center.y + offset.y),
    };
  });
}
