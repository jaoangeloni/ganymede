import type { Pane } from "../../state";

export type Axis = "row" | "column";
export type Edge = "left" | "right" | "top" | "bottom";
export interface Split {
  axis: Axis;
  children: Tile[];
  sizes: number[];
}
export type Tile = Pane | Split;
export type Drop = { target: Pane | null; edge: Edge | "center" };
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Gap {
  path: number[];
  before: number;
  after: number;
  axis: Axis;
  rect: Rect;
  unit: number;
}

export const GUTTER = 8;
export const PANE_MIN = { row: 260, column: 140 };
export const DEFAULT_LAYOUT: Tile = {
  axis: "row",
  children: [{ axis: "column", children: ["board", "map"], sizes: [0.4, 0.6] }, "catalog"],
  sizes: [0.7, 0.3],
};

const ALL: Pane[] = ["board", "map", "catalog"];
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const axisOf = (edge: Edge): Axis => (edge === "left" || edge === "right" ? "row" : "column");
const leading = (edge: Edge) => edge === "left" || edge === "top";

export const leaves = (tile: Tile): Pane[] => (typeof tile === "string" ? [tile] : tile.children.flatMap(leaves));

export function validLayout(value: unknown): value is Tile {
  const ok = (tile: unknown): boolean => {
    if (typeof tile === "string") return ALL.includes(tile as Pane);
    const split = tile as Split | null;
    return (
      !!split &&
      (split.axis === "row" || split.axis === "column") &&
      Array.isArray(split.children) &&
      Array.isArray(split.sizes) &&
      split.children.length >= 2 &&
      split.children.length === split.sizes.length &&
      split.sizes.every((size) => typeof size === "number" && size > 0) &&
      split.children.every(ok)
    );
  };
  return ok(value) && [...leaves(value as Tile)].sort().join() === [...ALL].sort().join();
}

function flatten(split: Split): Split {
  const children: Tile[] = [];
  const sizes: number[] = [];
  split.children.forEach((child, i) => {
    if (typeof child === "string" || child.axis !== split.axis) {
      children.push(child);
      sizes.push(split.sizes[i]);
      return;
    }
    const total = sum(child.sizes);
    child.children.forEach((grand, j) => {
      children.push(grand);
      sizes.push((split.sizes[i] * child.sizes[j]) / total);
    });
  });
  return { axis: split.axis, children, sizes };
}

function remove(tile: Tile, pane: Pane): Tile | null {
  if (typeof tile === "string") return tile === pane ? null : tile;
  const kept = tile.children.flatMap((child, i) => {
    const rest = remove(child, pane);
    return rest ? [{ child: rest, size: tile.sizes[i] }] : [];
  });
  if (kept.length < 2) return kept[0]?.child ?? null;
  return flatten({ axis: tile.axis, children: kept.map((item) => item.child), sizes: kept.map((item) => item.size) });
}

function insert(tile: Tile, pane: Pane, target: Pane | null, edge: Edge): Tile {
  const axis = axisOf(edge);
  const pair = (other: Tile): Split => ({
    axis,
    children: leading(edge) ? [pane, other] : [other, pane],
    sizes: [1, 1],
  });
  if (target === null) {
    if (typeof tile === "string" || tile.axis !== axis) return pair(tile);
    const children = leading(edge) ? [pane, ...tile.children] : [...tile.children, pane];
    return { axis, children, sizes: children.map(() => 1) };
  }
  if (tile === target) return pair(tile);
  if (typeof tile === "string") return tile;
  const at = tile.children.indexOf(target);
  if (at < 0 || tile.axis !== axis)
    return { ...tile, children: tile.children.map((child) => insert(child, pane, target, edge)) };
  const [children, sizes] = [[...tile.children], [...tile.sizes]];
  const half = sizes[at] / 2;
  const index = leading(edge) ? at : at + 1;
  sizes[at] = half;
  children.splice(index, 0, pane);
  sizes.splice(index, 0, half);
  return { axis, children, sizes };
}

function swap(tile: Tile, a: Pane, b: Pane): Tile {
  if (typeof tile === "string") return tile === a ? b : tile === b ? a : tile;
  return { ...tile, children: tile.children.map((child) => swap(child, a, b)) };
}

export function dock(layout: Tile, pane: Pane, drop: Drop): Tile {
  if (drop.target === pane) return layout;
  if (drop.edge === "center") return drop.target ? swap(layout, pane, drop.target) : layout;
  const rest = remove(layout, pane);
  if (!rest) return layout;
  const placed = insert(rest, pane, drop.target, drop.edge);
  return typeof placed === "string" ? placed : flatten(placed);
}

export const even = (tile: Tile): Tile =>
  typeof tile === "string" ? tile : { ...tile, children: tile.children.map(even), sizes: tile.children.map(() => 1) };

export function resized(layout: Tile, path: number[], sizes: Record<number, number>): Tile {
  if (typeof layout === "string") return layout;
  if (!path.length) return { ...layout, sizes: layout.sizes.map((size, i) => sizes[i] ?? size) };
  const [head, ...rest] = path;
  return { ...layout, children: layout.children.map((child, i) => (i === head ? resized(child, rest, sizes) : child)) };
}

export function splitAt(layout: Tile, path: number[]): Split | null {
  const tile = path.reduce<Tile | undefined>(
    (node, i) => (node && typeof node !== "string" ? node.children[i] : undefined),
    layout,
  );
  return tile && typeof tile !== "string" ? tile : null;
}

export function minAlong(tile: Tile, axis: Axis, shown: (pane: Pane) => boolean): number {
  if (typeof tile === "string") return PANE_MIN[axis];
  const mins = tile.children.filter((child) => leaves(child).some(shown)).map((child) => minAlong(child, axis, shown));
  return tile.axis === axis ? sum(mins) + GUTTER * (mins.length - 1) : Math.max(...mins);
}

export function arrange(
  layout: Tile,
  shown: (pane: Pane) => boolean,
  box: Rect,
): { panes: Partial<Record<Pane, Rect>>; gaps: Gap[] } {
  const panes: Partial<Record<Pane, Rect>> = {};
  const gaps: Gap[] = [];
  const place = (tile: Tile, area: Rect, path: number[]) => {
    if (typeof tile === "string") {
      panes[tile] = area;
      return;
    }
    const visible = tile.children.flatMap((child, i) => (leaves(child).some(shown) ? [i] : []));
    if (visible.length === 1) return place(tile.children[visible[0]], area, [...path, visible[0]]);
    const row = tile.axis === "row";
    const length = (row ? area.w : area.h) - GUTTER * (visible.length - 1);
    const unit = length / sum(visible.map((i) => tile.sizes[i]));
    let offset = row ? area.x : area.y;
    visible.forEach((i, k) => {
      const span = tile.sizes[i] * unit;
      place(
        tile.children[i],
        row ? { x: offset, y: area.y, w: span, h: area.h } : { x: area.x, y: offset, w: area.w, h: span },
        [...path, i],
      );
      offset += span;
      if (k === visible.length - 1) return;
      gaps.push({
        path,
        before: i,
        after: visible[k + 1],
        axis: tile.axis,
        unit,
        rect: row ? { x: offset, y: area.y, w: GUTTER, h: area.h } : { x: area.x, y: offset, w: area.w, h: GUTTER },
      });
      offset += GUTTER;
    });
  };
  place(layout, box, []);
  return { panes, gaps };
}
