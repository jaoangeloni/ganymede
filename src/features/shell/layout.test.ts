import { describe, expect, it } from "vitest";
import type { Pane } from "../../state";
import {
  arrange,
  DEFAULT_LAYOUT,
  dock,
  even,
  GUTTER,
  leaves,
  minAlong,
  PANE_MIN,
  resized,
  type Tile,
  validLayout,
} from "./layout";

const all = () => true;
const box = { x: 0, y: 0, w: 1208, h: 808 };

describe("pane layout", () => {
  it("dropping on the outer edge stacks or lines up all three", () => {
    const row = dock(dock(DEFAULT_LAYOUT, "board", { target: null, edge: "left" }), "map", {
      target: null,
      edge: "left",
    });
    expect(row).toEqual({ axis: "row", children: ["map", "board", "catalog"], sizes: expect.any(Array) });

    const column = dock(
      dock(dock(row, "map", { target: null, edge: "top" }), "board", { target: "map", edge: "bottom" }),
      "catalog",
      { target: "board", edge: "bottom" },
    );
    expect(column).toMatchObject({ axis: "column", children: ["map", "board", "catalog"] });
  });

  it("a pane on the outer edge takes half and the other two share the rest", () => {
    const stacked = dock(DEFAULT_LAYOUT, "board", { target: "catalog", edge: "top" });
    const half = dock(stacked, "map", { target: null, edge: "left" });
    const { panes } = arrange(half, all, box);

    expect(half).toMatchObject({ axis: "row", children: ["map", { axis: "column", children: ["board", "catalog"] }] });
    expect(panes.map!.w).toBeCloseTo((box.w - GUTTER) / 2);
    expect(panes.board!.h).toBeCloseTo((box.h - GUTTER) / 2);
    expect(panes.catalog!.x).toBeCloseTo(panes.map!.w + GUTTER);
  });

  it("dropping in the middle of another pane swaps them", () => {
    expect(dock(DEFAULT_LAYOUT, "catalog", { target: "board", edge: "center" })).toEqual({
      axis: "row",
      children: [{ axis: "column", children: ["catalog", "map"], sizes: [0.4, 0.6] }, "board"],
      sizes: [0.7, 0.3],
    });
  });

  it("removing a pane leaves no single-child split or nested split on the same axis", () => {
    const moved = dock(DEFAULT_LAYOUT, "map", { target: "catalog", edge: "right" });
    expect(moved).toMatchObject({ axis: "row", children: ["board", "catalog", "map"] });
    expect(leaves(moved).sort()).toEqual(["board", "catalog", "map"]);
  });

  it("a hidden pane leaves the arrangement and its neighbors take its place", () => {
    const shown = (pane: Pane) => pane !== "map";
    const { panes, gaps } = arrange(DEFAULT_LAYOUT, shown, box);

    expect(panes.map).toBeUndefined();
    expect(panes.board!.h).toBe(box.h);
    expect(gaps).toHaveLength(1);
    expect(panes.board!.w + GUTTER + panes.catalog!.w).toBeCloseTo(box.w);
  });

  it("resizing changes only the two neighbors' weights, and the minimum counts stacked panes", () => {
    const next = resized(DEFAULT_LAYOUT, [0], { 0: 0.3, 1: 0.7 });
    expect(next).toMatchObject({ children: [{ sizes: [0.3, 0.7] }, "catalog"], sizes: [0.7, 0.3] });
    expect(minAlong(DEFAULT_LAYOUT, "column", all)).toBe(2 * PANE_MIN.column + GUTTER);
    expect(minAlong(DEFAULT_LAYOUT, "row", all)).toBe(2 * PANE_MIN.row + GUTTER);
  });

  it("while dragging the arrangement is even: exact halves, thirds and quarters", () => {
    const { panes } = arrange(even(dock(DEFAULT_LAYOUT, "catalog", { target: "map", edge: "right" })), all, box);
    const unit = (box.h - GUTTER) / 2;

    expect(panes.board).toEqual({ x: 0, y: 0, w: box.w, h: unit });
    expect(panes.map!.w).toBeCloseTo((box.w - GUTTER) / 2);
    expect(panes.catalog!.w).toBeCloseTo((box.w - GUTTER) / 2);
    expect(panes.catalog!.h).toBeCloseTo(unit);
  });

  it("accepts from localStorage only a layout with all three panes", () => {
    expect(validLayout(DEFAULT_LAYOUT)).toBe(true);
    expect(validLayout({ axis: "row", children: ["board", "map"], sizes: [1, 1] })).toBe(false);
    expect(validLayout({ axis: "row", children: ["board", "map", "map"], sizes: [1, 1, 1] })).toBe(false);
    expect(
      validLayout({ axis: "diagonal", children: ["board", "map", "catalog"], sizes: [1, 1, 1] } as unknown as Tile),
    ).toBe(false);
    expect(validLayout(null)).toBe(false);
  });
});
