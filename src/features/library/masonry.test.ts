import { describe, expect, it } from "vitest";
import { balanceColumns, masonry } from "./masonry";

describe("masonry", () => {
  it("lays items in fixed columns keeping each item's ratio", () => {
    const { boxes, width, height } = masonry([2, 1, 0.5, 1], 2, 100, 10);

    expect(boxes).toEqual([
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 110, y: 0, w: 100, h: 100 },
      { x: 0, y: 60, w: 100, h: 200 },
      { x: 110, y: 110, w: 100, h: 100 },
    ]);
    expect(width).toBe(210);
    expect(height).toBe(260);
  });

  it("has no height without items", () => {
    expect(masonry([], 4, 100, 10).height).toBe(0);
  });
});

describe("balanceColumns", () => {
  const ratioOf = (ratio: number) => ratio;
  const columnHeights = (ratios: number[], columns: number) =>
    Array.from({ length: columns }, (_, column) =>
      ratios.filter((_, i) => i % columns === column).reduce((sum, ratio) => sum + 1 / ratio, 0),
    );

  it("keeps every item and only changes the order", () => {
    const ratios = [0.5, 0.5, 2, 2, 1, 1.5, 0.7];
    expect([...balanceColumns(ratios, 3, ratioOf)].sort()).toEqual([...ratios].sort());
  });

  it("balances column heights", () => {
    const ratios = [0.5, 2, 0.5, 2, 0.5, 2, 0.5, 2];
    const spread = (heights: number[]) => Math.max(...heights) - Math.min(...heights);

    expect(spread(columnHeights(ratios, 2))).toBe(6);
    expect(spread(columnHeights(balanceColumns(ratios, 2, ratioOf), 2))).toBe(0);
  });

  it("fills the last row from left to right", () => {
    const balanced = balanceColumns([1, 1, 1, 1, 1, 1], 4, ratioOf);
    expect(balanced).toHaveLength(6);
    expect(balanced.every((item) => item !== undefined)).toBe(true);
  });
});
