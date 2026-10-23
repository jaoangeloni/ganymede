import { describe, expect, it } from "vitest";
import { fitBounds, flight, LIMITS, limitView, MAX_SCALE, MIN_SCALE, rubber, zoomAt, zoomBetween } from "./camera";

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const before = { x: 40, y: -20, scale: 1 };
    const point = { x: 300, y: 200 };
    const after = zoomAt(before, point, 2);

    const worldBefore = { x: (point.x - before.x) / before.scale, y: (point.y - before.y) / before.scale };
    const worldAfter = { x: (point.x - after.x) / after.scale, y: (point.y - after.y) / after.scale };
    expect(after.scale).toBe(2);
    expect(worldAfter).toEqual(worldBefore);
  });

  it("respects zoom limits", () => {
    const viewport = { x: 0, y: 0, scale: 1 };
    expect(zoomAt(viewport, { x: 0, y: 0 }, 1000).scale).toBe(MAX_SCALE);
    expect(zoomAt(viewport, { x: 0, y: 0 }, 0.0001).scale).toBe(MIN_SCALE);
  });
});

describe("fitBounds", () => {
  const window = { width: 1360, height: 860 };

  it("centers content in the free area without zooming past 100%", () => {
    const viewport = fitBounds({ x: 0, y: 0, w: 400, h: 300 }, window);

    expect(viewport.scale).toBe(1);
    expect(viewport.x).toBe((window.width - 400) / 2);
    expect(viewport.y).toBeGreaterThan(0);
    expect(viewport.y + 300).toBeLessThan(window.height - 136);
  });

  it("zooms out to fit a large catalog, down to the minimum", () => {
    const viewport = fitBounds({ x: 2000, y: 0, w: 1500, h: 2000 }, window);

    expect(viewport.scale).toBeLessThan(1);
    expect(viewport.x + 2000 * viewport.scale).toBeGreaterThanOrEqual(72);
    expect(viewport.y + 2000 * viewport.scale).toBeLessThanOrEqual(window.height - 136);
    expect(fitBounds({ x: 0, y: 0, w: 30000, h: 40000 }, window).scale).toBe(MIN_SCALE);
  });
});

describe("camera", () => {
  const size = { width: 1000, height: 800 };
  const near = (a: { x: number; y: number; scale: number }, b: { x: number; y: number; scale: number }) => {
    expect(a.scale).toBeCloseTo(b.scale, 6);
    expect(a.x).toBeCloseTo(b.x, 4);
    expect(a.y).toBeCloseTo(b.y, 4);
  };

  it("between two views the point both show alike does not slide", () => {
    const a = { x: 0, y: 0, scale: 1 };
    const b = zoomAt(a, { x: 300, y: 200 }, 2.5);
    near(zoomBetween(a, b, 0), a);
    near(zoomBetween(a, b, 1), b);
    const half = zoomBetween(a, b, 0.5);
    expect((300 - half.x) / half.scale).toBeCloseTo(300, 6);
    expect((200 - half.y) / half.scale).toBeCloseTo(200, 6);
  });

  it("a flight leaves one view and reaches the other, zooming out on long trips", () => {
    const a = { x: 0, y: 0, scale: 1 };
    const b = { x: -20000, y: -9000, scale: 1 };
    const path = flight(a, b, size);
    near(path.at(0), a);
    near(path.at(1), b);
    expect(path.at(0.5).scale).toBeLessThan(1);
    expect(path.ms).toBeGreaterThan(0);
  });

  it("zoom stays between min and max, and the screen center stays over content", () => {
    const content = { x: 0, y: 0, w: 4000, h: 3000 };
    expect(limitView({ x: 0, y: 0, scale: 0.01 }, content, size).scale).toBe(MIN_SCALE);
    expect(limitView({ x: 0, y: 0, scale: 10 }, content, size).scale).toBe(MAX_SCALE);
    const far = limitView({ x: 50000, y: 50000, scale: 1 }, content, size);
    const center = { x: (size.width / 2 - far.x) / far.scale, y: (size.height / 2 - far.y) / far.scale };
    expect(center.x).toBeGreaterThanOrEqual(content.x - (LIMITS.margin * size.height) / far.scale - 1e-6);
    expect(center.y).toBeGreaterThanOrEqual(content.y - (LIMITS.margin * size.height) / far.scale - 1e-6);
  });

  it("past the limit, dragging stretches less and less and never beyond the maximum", () => {
    expect(rubber(0)).toBe(0);
    expect(rubber(100)).toBeLessThan(100);
    expect(rubber(400) - rubber(300)).toBeLessThan(rubber(100) - rubber(0));
    expect(rubber(1e6)).toBeLessThan(LIMITS.stretch);
    expect(rubber(-50)).toBe(-rubber(50));
  });
});
