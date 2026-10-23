import { describe, expect, it } from "vitest";
import { aspectOf, capacityFor, PAGE_GAP, pageLayout } from "./pageGrid";

const MIXED = [1.5, 0.75, 1.33, 1, 0.8, 1.6, 0.67, 1.25, 1.5, 1, 0.75, 1.33, 1.78, 0.8, 1.2, 1.5];
const rowsOf = (layout: ReturnType<typeof pageLayout>) =>
  [...new Set(layout.boxes.map((box) => box.row))].map((row) => layout.boxes.filter((box) => box.row === row));

describe("search page grid", () => {
  it("capacity goes from 9 to 16 with the space, with rows of at least 140 px", () => {
    expect(capacityFor(1000, 780)).toBe(16);
    expect(capacityFor(880, 520)).toBe(12);
    expect(capacityFor(520, 400)).toBe(9);
    expect(capacityFor(100, 100)).toBe(9);
  });

  it("an image keeps its ratio within a band that cuts extremes", () => {
    expect(aspectOf({ width: 800, height: 600 })).toBeCloseTo(1.333, 3);
    expect(aspectOf({ width: 600, height: 900 })).toBeCloseTo(0.667, 3);
    expect(aspectOf({ width: 0, height: 0 })).toBe(1);
    expect(aspectOf({ width: 5000, height: 100 })).toBe(2.4);
    expect(aspectOf({ width: 100, height: 5000 })).toBe(0.45);
  });

  it("each image keeps exactly its original ratio", () => {
    const layout = pageLayout(MIXED.slice(0, 12), 900, 520);
    layout.boxes.forEach((box, i) => expect(box.w / box.h).toBeCloseTo(MIXED[i], 6));
  });

  it("every row has the same width (an even block) with similar heights", () => {
    for (const count of [9, 10, 12, 13, 16]) {
      const layout = pageLayout(MIXED.slice(0, count), 900, 700);
      const rows = rowsOf(layout);
      for (const row of rows) {
        expect(row[0].x).toBe(0);
        const last = row[row.length - 1];
        expect(last.x + last.w).toBeCloseTo(layout.width, 6);
      }
      const heights = rows.map((row) => row[0].h);
      const mean = heights.reduce((total, h) => total + h, 0) / heights.length;
      expect((Math.max(...heights) - Math.min(...heights)) / mean).toBeLessThan(0.1);
    }
  });

  it("the number of rows follows the total", () => {
    const rows = (count: number, height = 700) => rowsOf(pageLayout(MIXED.slice(0, count), 900, height)).length;
    expect([rows(9), rows(12), rows(13), rows(16), rows(5), rows(2)]).toEqual([3, 3, 4, 4, 2, 1]);
  });

  it("relevance order holds: the first stays in the first row and nothing moves more than one row", () => {
    for (const count of [9, 12, 16]) {
      const { boxes } = pageLayout(MIXED.slice(0, count), 900, 600);
      const perRow = count / (count === 16 ? 4 : 3);
      expect(boxes[0].row).toBe(0);
      expect(boxes[0].col).toBe(0);
      boxes.forEach((box, i) => expect(Math.abs(box.row - Math.floor(i / perRow))).toBeLessThanOrEqual(2));
    }
  });

  it("never exceeds the box (no scroll) or the height cap, and the gap is constant", () => {
    for (const [count, width, height] of [
      [16, 860, 700],
      [12, 860, 520],
      [9, 600, 480],
      [9, 2000, 2000],
      [13, 400, 300],
      [10, 1200, 260],
    ]) {
      const layout = pageLayout(MIXED.slice(0, count), width, height);
      expect(layout.width).toBeLessThanOrEqual(width);
      expect(layout.height).toBeLessThanOrEqual(height + 1e-6);
      for (const box of layout.boxes) expect(box.h).toBeLessThanOrEqual(232 + 1e-6);
      for (const row of rowsOf(layout))
        row.slice(1).forEach((box, i) => expect(box.x - (row[i].x + row[i].w)).toBeCloseTo(PAGE_GAP, 6));
    }
  });

  it("no results means no box", () => {
    expect(pageLayout([], 800, 500)).toEqual({ boxes: [], width: 0, height: 0 });
  });
});
