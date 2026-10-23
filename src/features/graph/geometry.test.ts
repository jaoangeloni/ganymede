import { describe, expect, it } from "vitest";
import { makeRef } from "../../testing";
import type { Library } from "../../types";
import {
  boundsOf,
  clusterRadius,
  dotGrid,
  freeSpot,
  LABEL_HEIGHT,
  LOOSE_R,
  looseExtent,
  nextTo,
  nodeBox,
  placeLoose,
} from "./geometry";

describe("map dot grid", () => {
  it("screen spacing stays between 18 and 36 px, the larger dot sits on the world origin and levels blend", () => {
    for (const scale of [0.02, 0.1, 0.37, 0.75, 1, 2.3, 4]) {
      const view = { x: 317, y: -91, scale };
      const { step, x, y } = dotGrid(view);
      expect(step).toBeGreaterThanOrEqual(18);
      expect(step).toBeLessThan(36);
      for (const [offset, origin] of [
        [x, view.x],
        [y, view.y],
      ]) {
        const phase = (offset + step - origin) / (2 * step);
        expect(Math.abs(phase - Math.round(phase))).toBeLessThan(1e-9);
      }
    }
    const [below, above] = [dotGrid({ x: 0, y: 0, scale: 0.7499 }), dotGrid({ x: 0, y: 0, scale: 0.7501 })];
    expect(below.fade).toBeGreaterThan(0.99);
    expect(above.fade).toBeLessThan(0.01);
    expect(Math.abs(2 * above.step - below.step)).toBeLessThan(0.01);
  });
});

describe("loose images, collections and new items", () => {
  const refs = ["a", "b", "c", "d", "e"].map((id) => makeRef(id));
  const library: Library = { refs: Object.fromEntries(refs.map((ref) => [ref.id, ref])), collections: [], spaces: [] };

  it("loose images spiral around the point without overlapping and within the expected extent", () => {
    const nodes = placeLoose(refs, { x: 100, y: 50 });

    expect(nodes.map((node) => (node.kind === "ref" ? node.refId : ""))).toEqual(["a", "b", "c", "d", "e"]);
    for (const [i, node] of nodes.entries()) {
      expect(Math.hypot(node.x - 100, node.y - 50) + LOOSE_R).toBeLessThanOrEqual(looseExtent(5) + 1);
      for (const other of nodes.slice(i + 1))
        expect(Math.hypot(node.x - other.x, node.y - other.y)).toBeGreaterThanOrEqual(2 * LOOSE_R);
    }
    expect(nodeBox(nodes[0], library)).toEqual({
      x: nodes[0].x - LOOSE_R,
      y: nodes[0].y - LOOSE_R,
      w: 2 * LOOSE_R,
      h: 2 * LOOSE_R,
    });
  });

  it("something new lands to the right of what exists", () => {
    const existing = placeLoose(refs, { x: 0, y: 0 });
    const taken = boundsOf(existing, library)!;
    const origin = nextTo(existing, library);

    expect(origin.x).toBeGreaterThan(taken.x + taken.w);
    expect(origin.y).toBe(taken.y);
    expect(nextTo([], library)).toEqual({ x: 0, y: 0 });
  });

  it("a collection's footprint grows with its content and is centered on its node, with a label row", () => {
    const withRefs: Library = { ...library, collections: [{ id: "x", name: "", refIds: ["a", "b", "c", "d", "e"] }] };
    const node = { kind: "collection" as const, id: "c:x", collectionId: "x", x: 500, y: 300 };
    const r = clusterRadius(5);

    expect(clusterRadius(0)).toBeLessThan(clusterRadius(1));
    expect(clusterRadius(40)).toBeGreaterThan(clusterRadius(10));
    expect(nodeBox(node, withRefs)).toEqual({ x: 500 - r, y: 300 - r, w: 2 * r, h: 2 * r + LABEL_HEIGHT });
  });

  it("something created mid-view does not land on top of what is there", () => {
    const size = { w: 100, h: 80 };
    const first = freeSpot([], library, { x: 500, y: 300 }, size);
    const node = { kind: "ref" as const, id: "r:a", refId: "a", x: first.x + size.w / 2, y: first.y + size.h / 2 };
    const second = freeSpot([node], library, { x: 500, y: 300 }, size);
    const box = nodeBox(node, library);

    expect(first).toEqual({ x: 450, y: 260 });
    const apart =
      second.x >= box.x + box.w ||
      second.x + size.w <= box.x ||
      second.y >= box.y + box.h ||
      second.y + size.h <= box.y;
    expect(apart).toBe(true);
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeLessThan(200);
  });
});
