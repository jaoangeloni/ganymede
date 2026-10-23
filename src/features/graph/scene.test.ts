import { describe, expect, it } from "vitest";
import { makeRef } from "../../testing";
import type { Library, Space } from "../../types";
import { adjacency, centers, otherEnd, refOf, sceneOf } from "./scene";

const library: Library = {
  refs: Object.fromEntries(["a", "b", "c", "d"].map((id) => [id, makeRef(id, { palette: ["#3080d0"] })])),
  collections: [{ id: "x", name: "X", refIds: ["a", "b", "c"], spaceId: "s" }],
  spaces: [],
};

const space = (overrides: Partial<Space> = {}): Space => ({
  id: "s",
  name: "Espaço",
  viewport: { x: 0, y: 0, scale: 1 },
  nodes: [
    { kind: "collection", id: "c:x", collectionId: "x", x: 500, y: 300 },
    { kind: "ref", id: "r:d", refId: "d", x: -40, y: 10 },
  ],
  board: { viewport: { x: 0, y: 0, scale: 1 }, pins: [] },
  places: { "d:x:a": { x: 7, y: 8 }, "d:x:c": { x: 20, y: 8 } },
  ...overrides,
});

const at = (scene: ReturnType<typeof sceneOf>, id: string) => {
  const i = scene.index.get(id)!;
  return { x: scene.start[2 * i], y: scene.start[2 * i + 1] };
};

describe("graph scene", () => {
  it("nodes are collection images and loose images; placed ones stay put, new ones start near a sibling", () => {
    const scene = sceneOf(space(), library, new Map());

    expect(scene.nodes.map((node) => node.id)).toEqual(["d:x:a", "d:x:b", "d:x:c", "r:d"]);
    expect(at(scene, "d:x:a")).toEqual({ x: 7, y: 8 });
    expect(at(scene, "r:d")).toEqual({ x: -40, y: 10 });
    expect(scene.fresh).toBe(1);
    expect(Math.hypot(at(scene, "d:x:b").x - 7, at(scene, "d:x:b").y - 8)).toBeLessThan(120);
  });

  it("when most images have no place they spread in a spiral without overlapping", () => {
    const scene = sceneOf(space({ places: {} }), library, new Map());
    const spread = ["d:x:a", "d:x:b", "d:x:c"].map((id) => at(scene, id));

    expect(scene.fresh).toBe(3);
    for (const [k, a] of spread.entries())
      for (const b of spread.slice(k + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(40);
    expect(at(scene, "r:d")).toEqual({ x: -40, y: 10 });
  });

  it("an image leaving its collection stays where it was: the position follows the reference", () => {
    const live = new Map([["d:x:c", { x: 90, y: 91 }]]);
    const released = space({ nodes: [...space().nodes, { kind: "ref", id: "r:c", refId: "c", x: 0, y: 0 }] });
    const scene = sceneOf(
      released,
      { ...library, collections: [{ ...library.collections[0], refIds: ["a", "b"] }] },
      live,
    );

    expect(at(scene, "r:c")).toEqual({ x: 90, y: 91 });
    expect(refOf("d:x:bing:https://a.com/x.jpg")).toBe("bing:https://a.com/x.jpg");
  });

  it("neighbors in CSR and each collection's center", () => {
    const pairs = Uint32Array.from([0, 1, 1, 2, 3, 1]);
    const graph = adjacency(4, pairs);
    const of = (i: number) =>
      Array.from(graph.edges.slice(graph.start[i], graph.start[i + 1]), (e) => otherEnd(pairs, e, i)).sort();

    expect(of(1)).toEqual([0, 2, 3]);
    expect(of(0)).toEqual([1]);
    const scene = sceneOf(
      space({ places: { "d:x:a": { x: 0, y: 0 }, "d:x:b": { x: 100, y: 0 }, "d:x:c": { x: 50, y: 90 } } }),
      library,
      new Map(),
    );
    expect(centers(scene, scene.start).get("x")).toEqual({ x: 50, y: 30 });
  });
});
