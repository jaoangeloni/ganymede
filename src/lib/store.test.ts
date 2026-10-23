import { describe, expect, it } from "vitest";
import { makeRef } from "../testing";
import type { Library, Space } from "../types";
import { diff, fromRows } from "./store";

const space = (overrides: Partial<Space> = {}): Space => ({
  id: "s",
  name: "Espaço",
  viewport: { x: 0, y: 0, scale: 1 },
  nodes: [
    { kind: "collection", id: "c:a", collectionId: "a", x: 0, y: 0 },
    { kind: "ref", id: "r:r2", refId: "r2", x: 5, y: 5 },
  ],
  board: { viewport: { x: 0, y: 0, scale: 1 }, pins: [] },
  places: { "d:a:r1": { x: 1, y: 2 } },
  ...overrides,
});

const library = (): Library => ({
  refs: { r1: makeRef("r1"), r2: makeRef("r2") },
  collections: [
    { id: "a", name: "A", refIds: ["r1"], spaceId: "s" },
    { id: "b", name: "B", refIds: ["r2"] },
  ],
  spaces: [space()],
});

const persisted = (lib = library()) => ({
  library: lib,
  view: { kind: "space" as const, id: "s" },
  session: null,
  recent: ["s"],
});

describe("store", () => {
  it("everything written comes back equal and in the same order", () => {
    const saved = persisted();
    const { upsert, remove } = diff(null, saved);

    expect(remove).toEqual([]);
    expect(fromRows(upsert)).toEqual(saved);
  });

  it("writes only what changed: objects the reducer did not touch are not rewritten", () => {
    const before = persisted();
    const lib = before.library;
    const moved = {
      ...lib,
      spaces: [{ ...lib.spaces[0], places: { ...lib.spaces[0].places, "d:a:r1": { x: 9, y: 9 } } }],
    };
    const { upsert, remove } = diff(before, { ...before, library: { ...moved, refs: { r1: lib.refs.r1 } } });

    expect(upsert.map(([kind, scope, id]) => `${kind}|${scope}|${id}`).sort()).toEqual(["place|s|d:a:r1", "space||s"]);
    expect(remove).toEqual([["ref", "", "r2"]]);
  });
});
