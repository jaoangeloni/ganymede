import { beforeEach, describe, expect, it, vi } from "vitest";
import { boundsOf, LOOSE_R } from "./features/graph/geometry";
import {
  type Action,
  type AppState,
  type ArrivedWave,
  currentSpace,
  initialState,
  reducer,
  savePrefs,
  searchedPlans,
  shownReferences,
  stateFrom,
} from "./state";
import { makeRef } from "./testing";

const persisted = ({ library, view, session, ui }: AppState) => ({ library, view, session, recent: ui.recent });
import type { SearchTarget } from "./types";

const waveTimings = { waitMs: 1, rankMs: 1, visionMs: 1, candidates: 40 };
const run = (actions: Action[], from: AppState = initialState) => actions.reduce(reducer, from);
const planOf = (queries: string[]) => ({ queries, avoid: [] });
const waveOf = (queries: string[], ids: string[]): ArrivedWave => ({
  plan: planOf(queries),
  pool: ids.map((id) => makeRef(id)),
  timings: waveTimings,
  at: 0,
});

const round = (prompt: string, queries: string[], ids: string[], target: SearchTarget = {}): Action[] => [
  { type: "search-started", prompt, target },
  { type: "wave-arrived", wave: waveOf(queries, ids) },
  { type: "revealed", results: ids.map((id) => makeRef(id)), spares: [] },
];

describe("search session", () => {
  it("Enter opens a session with the prompt and shows skeletons", () => {
    const state = run([{ type: "search-started", prompt: "cidade medieval" }]);

    expect(state.session).toEqual({ prompt: "cidade medieval", iterations: [], approved: [], target: {}, seed: [] });
    expect(state.round).toEqual({ phase: "searching" });
  });

  it("records each revealed round as an iteration", () => {
    const state = run(round("cidade medieval", ["medieval old town"], ["a", "b"]));

    expect(state.round).toEqual({ phase: "ready", spares: [] });
    expect(state.session?.iterations).toHaveLength(1);
    expect(state.session?.iterations[0]).toMatchObject({
      plan: planOf(["medieval old town"]),
    });
    expect(shownReferences(state.session).map((ref) => ref.id)).toEqual(["a", "b"]);
    expect(searchedPlans(state.session).flatMap((plan) => plan.queries)).toEqual(["medieval old town"]);
  });

  it("approves and removes an approval", () => {
    const ready = run(round("cidade medieval", ["q"], ["a", "b"]));

    const approved = run(
      [
        { type: "approval-toggled", ref: makeRef("a") },
        { type: "approval-toggled", ref: makeRef("b") },
      ],
      ready,
    );
    expect(approved.session?.approved.map((ref) => ref.id)).toEqual(["a", "b"]);

    const removed = reducer(approved, { type: "approval-toggled", ref: makeRef("a") });
    expect(removed.session?.approved.map((ref) => ref.id)).toEqual(["b"]);
  });

  it("searching more keeps approvals and history, and accepts an edited prompt", () => {
    const state = run([
      ...round("cidade medieval", ["q1"], ["a", "b"]),
      { type: "approval-toggled", ref: makeRef("a") },
      ...round("cidade medieval chuvosa", ["q2"], ["c", "d"]),
      { type: "approval-toggled", ref: makeRef("d") },
    ]);

    expect(state.session?.prompt).toBe("cidade medieval chuvosa");
    expect(state.session?.approved.map((ref) => ref.id)).toEqual(["a", "d"]);
    expect(shownReferences(state.session).map((ref) => ref.id)).toEqual(["a", "b", "c", "d"]);
    expect(searchedPlans(state.session).flatMap((plan) => plan.queries)).toEqual(["q1", "q2"]);
  });

  it("a failed search becomes an error state without losing the session", () => {
    const state = run([
      ...round("cidade medieval", ["q"], ["a"]),
      { type: "approval-toggled", ref: makeRef("a") },
      { type: "search-started", prompt: "cidade medieval" },
      { type: "search-failed", reason: "offline" },
    ]);

    expect(state.round).toEqual({ phase: "error", reason: "offline" });
    expect(state.session?.approved).toHaveLength(1);
  });

  it("only the first wave of a round becomes a page; later ones are ignored", () => {
    const loading = run([
      { type: "search-started", prompt: "cidade medieval" },
      { type: "wave-arrived", wave: waveOf(["literal"], ["a", "b"]) },
      { type: "wave-arrived", wave: waveOf(["literal", "q2"], ["c"]) },
    ]);
    expect(loading.round).toMatchObject({ phase: "loading", pool: [makeRef("a"), makeRef("b")] });

    const ready = reducer(loading, { type: "revealed", results: [makeRef("a"), makeRef("b")], spares: [] });
    expect(ready.round).toEqual({ phase: "ready", spares: [] });
    expect(reducer(ready, { type: "wave-arrived", wave: waveOf(["q"], ["z"]) })).toBe(ready);
    expect(ready.session?.iterations).toHaveLength(1);
    expect(shownReferences(ready.session).map((ref) => ref.id)).toEqual(["a", "b"]);
    expect(searchedPlans(ready.session).flatMap((plan) => plan.queries)).toEqual(["literal"]);
  });

  it("ignores an untimely reveal", () => {
    const ready = run(round("cidade medieval", ["q"], ["a"]));
    expect(reducer(ready, { type: "revealed", results: [makeRef("z")], spares: [] })).toBe(ready);
  });

  it("an image that fails after the reveal is swapped for a spare while there are any", () => {
    const ready = run([
      { type: "search-started", prompt: "cidade medieval" },
      { type: "wave-arrived", wave: waveOf(["q"], []) },
      { type: "revealed", results: [makeRef("a"), makeRef("b")], spares: [makeRef("s1")] },
    ]);

    const replaced = reducer(ready, { type: "result-failed", id: "b" });
    expect(shownReferences(replaced.session).map((ref) => ref.id)).toEqual(["a", "s1"]);

    const noSpares = reducer(replaced, { type: "result-failed", id: "a" });
    expect(noSpares).toBe(replaced);
  });
});

describe("concluding a search", () => {
  const folder: Action[] = [
    { type: "collection-created", id: "arq", name: "", spaceId: "inicio", at: { x: 40, y: 60 } },
  ];
  const approving = (target: SearchTarget): Action[] => [
    ...round("cidade medieval, ruas de pedra", ["q"], ["a", "b", "c"], target),
    { type: "approval-toggled", ref: makeRef("a") },
    { type: "approval-toggled", ref: makeRef("c") },
  ];
  const conclude: Action = { type: "concluded" };

  it("approvals go into the collection the search started from, which gets a name and keeps the prompt", () => {
    const state = run([...folder, ...approving({ spaceId: "inicio", collectionId: "arq" }), conclude]);

    expect(state.session).toBeNull();
    expect(state.round).toEqual({ phase: "idle" });
    expect(state.library.collections).toEqual([
      {
        id: "arq",
        name: "Cidade medieval",
        refIds: ["a", "c"],
        prompt: "cidade medieval, ruas de pedra",
        spaceId: "inicio",
      },
    ]);
    expect(state.library.spaces[0].nodes).toEqual([
      { kind: "collection", id: "c:arq", collectionId: "arq", x: 40, y: 60 },
    ]);
    expect(Object.keys(state.library.refs).sort()).toEqual(["a", "c"]);
  });

  it("a named collection keeps its name and accumulates approvals", () => {
    const named = run([
      { type: "collection-created", id: "arq", name: "Arquitetura" },
      { type: "refs-added", refs: [makeRef("z")], to: { collectionId: "arq" } },
    ]);
    const state = run([...approving({ collectionId: "arq" }), conclude], named);

    expect(state.library.collections).toEqual([
      { id: "arq", name: "Arquitetura", refIds: ["z", "a", "c"], prompt: "cidade medieval, ruas de pedra" },
    ]);
    expect(state.library.spaces[0].nodes).toEqual([]);
  });

  it("without approvals it only closes the layer", () => {
    const before = run(folder);
    const state = run([...round("cidade medieval", ["q"], ["a"], { collectionId: "arq" }), conclude], before);

    expect(state.session).toBeNull();
    expect(state.library).toBe(before.library);
  });

  it("cancelling drops the search without touching the library; undo resumes it as it was", () => {
    const searching = run([
      ...round("casa", ["casa"], ["a", "b"], { collectionId: "c1" }),
      { type: "approval-toggled", ref: makeRef("a") },
    ]);
    const cancelled = reducer(searching, { type: "search-cancelled" });

    expect(cancelled.session).toBeNull();
    expect(cancelled.library).toBe(searching.library);
    expect(reducer(cancelled, { type: "session-resumed", session: searching.session! }).session).toBe(
      searching.session,
    );
  });

  it("without a target nothing is saved", () => {
    const state = run([...approving({}), conclude]);

    expect(state.library.refs).toEqual({});
    expect(state.library.collections).toEqual([]);
  });
});

describe("space", () => {
  const withRefs = run([
    { type: "refs-added", refs: [makeRef("a"), makeRef("b")], to: { spaceId: "inicio", at: { x: 0, y: 0 } } },
  ]);
  const nodesOf = (state: AppState) => state.library.spaces[0].nodes;

  it("references dropped at a point become space nodes", () => {
    expect(
      nodesOf(withRefs)
        .map((node) => node.id)
        .sort(),
    ).toEqual(["r:a", "r:b"]);
    expect(Object.keys(withRefs.library.refs)).toEqual(["a", "b"]);
  });

  it("removing a loose reference from the space loses it", () => {
    const state = reducer(withRefs, { type: "nodes-removed", ids: ["r:a"] });

    expect(nodesOf(state).map((node) => node.id)).toEqual(["r:b"]);
    expect(state.library.refs.a).toBeUndefined();
  });

  it("a collection created in a space belongs to it and sits at the requested point", () => {
    const state = reducer(withRefs, {
      type: "collection-created",
      id: "atm",
      name: "",
      spaceId: "inicio",
      at: { x: 900, y: 20 },
    });

    expect(state.library.collections).toEqual([{ id: "atm", name: "", refIds: [], spaceId: "inicio" }]);
    expect(nodesOf(state).at(-1)).toEqual({ kind: "collection", id: "c:atm", collectionId: "atm", x: 900, y: 20 });
  });

  it("collecting selected references puts them in a collection centered where they were", () => {
    const area = boundsOf(nodesOf(withRefs), withRefs.library)!;
    const state = reducer(withRefs, { type: "selection-collected", id: "atm", nodeIds: ["r:a", "r:b"] });

    expect(state.library.collections).toEqual([
      { id: "atm", name: "", refIds: expect.arrayContaining(["a", "b"]), spaceId: "inicio" },
    ]);
    expect(nodesOf(state)).toEqual([
      { kind: "collection", id: "c:atm", collectionId: "atm", x: area.x + area.w / 2, y: area.y + area.h / 2 },
    ]);
  });

  it("removing a collection node deletes the collection and its references", () => {
    const collected = reducer(withRefs, { type: "selection-collected", id: "atm", nodeIds: ["r:a"] });
    const state = reducer(collected, { type: "nodes-removed", ids: ["c:atm"] });

    expect(state.library.collections).toEqual([]);
    expect(Object.keys(state.library.refs)).toEqual(["b"]);
  });

  it("loose references arrive in a spiral without overlapping", () => {
    const nodes = nodesOf(
      run(
        [
          {
            type: "refs-added",
            refs: ["c", "d", "e", "f"].map((id) => makeRef(id)),
            to: { spaceId: "inicio", at: { x: 900, y: 700 } },
          },
        ],
        withRefs,
      ),
    );
    for (const [i, a] of nodes.entries()) {
      for (const b of nodes.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2 * LOOSE_R);
    }
    const arrived = nodes.filter((node) => ["r:c", "r:d", "r:e", "r:f"].includes(node.id));
    const middle = {
      x: arrived.reduce((sum, node) => sum + node.x, 0) / 4,
      y: arrived.reduce((sum, node) => sum + node.y, 0) / 4,
    };
    expect(Math.hypot(middle.x - 900, middle.y - 700)).toBeLessThan(LOOSE_R);
  });

  it("pan and zoom update the space viewport", () => {
    const viewport = { x: 120, y: 80, scale: 0.5 };
    expect(reducer(withRefs, { type: "viewport-changed", viewport }).library.spaces[0].viewport).toEqual(viewport);
  });
});

describe("board", () => {
  const boardOf = (state: AppState) => state.library.spaces[0].board.pins;
  const wide = makeRef("w", { width: 400, height: 200 });
  const tall = makeRef("t", { width: 200, height: 400 });
  const pinned = run([{ type: "pinned", refs: [wide, tall, makeRef("q")], at: { x: 1000, y: 500 } }]);

  it("arrivals land in a grid centered where they were dropped, in each image's proportions, without overlapping", () => {
    const pins = boardOf(pinned);
    expect(pins.map((pin) => pin.refId)).toEqual(["w", "t", "q"]);
    expect(Object.keys(pinned.library.refs).sort()).toEqual(["q", "t", "w"]);
    const boxes = pins.map((pin) => ({
      ...pin,
      h: (pin.w * pinned.library.refs[pin.refId].height) / pinned.library.refs[pin.refId].width,
    }));
    for (const a of boxes)
      for (const b of boxes)
        if (a !== b) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    const left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.w));
    expect(Math.abs((left + right) / 2 - 1000)).toBeLessThanOrEqual(1);
  });

  it("pinning the same reference again only moves it; a moved item goes on top", () => {
    const again = reducer(pinned, { type: "pinned", refs: [wide], at: { x: 0, y: 0 } });
    expect(boardOf(again)).toHaveLength(3);
    const moved = reducer(again, { type: "pins-changed", pins: [{ refId: "t", x: 5, y: 6, w: 90 }] });
    expect(boardOf(moved).at(-1)).toEqual({ refId: "t", x: 5, y: 6, w: 90 });
  });

  it("unpinning loses only what is nowhere else", () => {
    const owned = reducer(pinned, { type: "refs-added", refs: [wide], to: { spaceId: "inicio", at: { x: 0, y: 0 } } });
    const state = reducer(owned, { type: "unpinned", ids: ["w", "t"] });
    expect(boardOf(state).map((pin) => pin.refId)).toEqual(["q"]);
    expect(state.library.refs.w).toBeDefined();
    expect(state.library.refs.t).toBeUndefined();
  });

  it("notes join the board, move and change text without duplicating, and leave with the images", () => {
    const note = { id: "note:1", x: 10, y: 20, w: 200, text: "" };
    const added = reducer(pinned, { type: "note-added", note });
    const edited = reducer(added, { type: "notes-changed", notes: [{ ...note, x: 50, text: "luz baixa", angle: 3 }] });
    const notesOf = (state: AppState) => state.library.spaces[0].board.notes;

    expect(notesOf(added)).toEqual([note]);
    expect(notesOf(edited)).toEqual([{ ...note, x: 50, text: "luz baixa", angle: 3 }]);
    expect(notesOf(reducer(edited, { type: "unpinned", ids: ["note:1", "t"] }))).toEqual([]);
    expect(boardOf(reducer(edited, { type: "unpinned", ids: ["note:1", "t"] })).map((pin) => pin.refId)).toEqual([
      "w",
      "q",
    ]);
  });

  it("links: many per item, no repeats or self links, and they go away with either end", () => {
    const linksOf = (state: AppState) => state.library.spaces[0].board.links?.map((link) => link.id);
    const linked = run(
      [
        { type: "board-linked", link: { id: "link:1", from: "w", to: "t" } },
        { type: "board-linked", link: { id: "link:2", from: "w", to: "q" } },
        { type: "board-linked", link: { id: "link:3", from: "q", to: "t" } },
        { type: "board-linked", link: { id: "link:4", from: "w", to: "t" } },
        { type: "board-linked", link: { id: "link:5", from: "q", to: "q" } },
      ],
      pinned,
    );

    expect(linksOf(linked)).toEqual(["link:1", "link:2", "link:3"]);
    expect(linksOf(reducer(linked, { type: "unpinned", ids: ["link:2"] }))).toEqual(["link:1", "link:3"]);
    expect(linksOf(reducer(linked, { type: "unpinned", ids: ["t"] }))).toEqual(["link:2"]);
  });
});

describe("collections", () => {
  const base = run([
    { type: "space-created", id: "outro", name: "Personagem" },
    { type: "collection-created", id: "arq", name: "Arquitetura" },
    { type: "refs-added", refs: [makeRef("a"), makeRef("b")], to: { collectionId: "arq" } },
  ]);

  it("adding a standalone collection to a space creates a copy that belongs to it", () => {
    const state = reducer(base, {
      type: "collection-copied",
      id: "arq",
      newId: "arq2",
      spaceId: "outro",
      at: { x: 5, y: 6 },
    });

    expect(state.library.collections).toEqual([
      { id: "arq", name: "Arquitetura", refIds: ["a", "b"] },
      { id: "arq2", name: "Arquitetura", refIds: ["a", "b"], spaceId: "outro" },
    ]);
    expect(state.library.spaces[1].nodes).toEqual([
      { kind: "collection", id: "c:arq2", collectionId: "arq2", x: 5, y: 6 },
    ]);
  });

  it("copying a space collection to standalone: each keeps its own content", () => {
    const owned = reducer(base, { type: "collection-copied", id: "arq", newId: "proj", spaceId: "inicio" });
    const copied = reducer(owned, { type: "collection-copied", id: "proj", newId: "solta" });
    const changed = reducer(copied, { type: "refs-removed", collectionId: "proj", refIds: ["a"] });

    expect(changed.library.collections.find((c) => c.id === "solta")).toEqual({
      id: "solta",
      name: "Arquitetura",
      refIds: ["a", "b"],
    });
    expect(changed.library.collections.find((c) => c.id === "proj")?.refIds).toEqual(["b"]);
    expect(changed.library.refs.a).toBeDefined();
  });

  it("deleting references from a collection loses them", () => {
    const state = reducer(base, { type: "refs-removed", collectionId: "arq", refIds: ["a"] });

    expect(state.library.collections[0].refIds).toEqual(["b"]);
    expect(Object.keys(state.library.refs)).toEqual(["b"]);
  });

  it("duplicating a collection creates an independent copy", () => {
    const state = reducer(base, { type: "duplicated", kind: "collection", id: "arq", newId: "arq2" });

    expect(state.library.collections[1]).toEqual({ id: "arq2", name: "Arquitetura (copy)", refIds: ["a", "b"] });
  });

  it("deleting a collection removes its node, loses its references and leaves its view", () => {
    const viewing = run(
      [
        { type: "collection-copied", id: "arq", newId: "proj", spaceId: "inicio" },
        { type: "view-changed", view: { kind: "collection", id: "proj" } },
      ],
      base,
    );
    const state = run(
      [
        { type: "deleted", kind: "collection", id: "proj" },
        { type: "deleted", kind: "collection", id: "arq" },
      ],
      viewing,
    );

    expect(state.library.collections).toEqual([]);
    expect(state.library.refs).toEqual({});
    expect(state.library.spaces[0].nodes).toEqual([]);
    expect(state.view).toEqual({ kind: "space", id: "inicio" });
  });

  it("duplicating a space copies its collections, which belong to the copy", () => {
    const owned = reducer(base, { type: "collection-copied", id: "arq", newId: "proj", spaceId: "inicio" });
    const state = reducer(owned, { type: "duplicated", kind: "space", id: "inicio", newId: "dup" });
    const copy = state.library.spaces.find((space) => space.id === "dup")!;

    expect(copy.nodes).toMatchObject([{ kind: "collection", collectionId: "proj-dup" }]);
    expect(state.library.collections.find((c) => c.id === "proj-dup")).toMatchObject({
      spaceId: "dup",
      refIds: ["a", "b"],
    });
  });

  it("deleting a space takes its collections; the last space is never deleted", () => {
    const owned = reducer(base, { type: "collection-copied", id: "arq", newId: "proj", spaceId: "outro" });
    const state = reducer(owned, { type: "deleted", kind: "space", id: "outro" });

    expect(state.library.spaces.map((space) => space.id)).toEqual(["inicio"]);
    expect(state.library.collections.map((c) => c.id)).toEqual(["arq"]);
    expect(reducer(state, { type: "deleted", kind: "space", id: "inicio" })).toBe(state);
  });

  it("undo restores the previous library", () => {
    const state = reducer(base, { type: "refs-removed", collectionId: "arq", refIds: ["a", "b"] });
    expect(reducer(state, { type: "library-restored", library: base.library }).library).toBe(base.library);
  });
});

describe("dots and collections in the map", () => {
  const space = (state: AppState) => state.library.spaces[0];
  const base = run([
    { type: "collection-created", id: "arq", name: "Arquitetura", spaceId: "inicio", at: { x: 0, y: 0 } },
    { type: "collection-created", id: "luz", name: "Luz", spaceId: "inicio", at: { x: 600, y: 0 } },
    { type: "refs-added", refs: [makeRef("a"), makeRef("b")], to: { collectionId: "arq" } },
    { type: "refs-added", refs: [makeRef("c")], to: { spaceId: "inicio", at: { x: 0, y: 500 } } },
  ]);
  const refIdsOf = (state: AppState, id: string) => state.library.collections.find((c) => c.id === id)?.refIds;

  it("a loose reference joining a collection leaves the space and becomes one of its dots", () => {
    const state = reducer(base, { type: "refs-joined", collectionId: "luz", ids: ["r:c"] });

    expect(refIdsOf(state, "luz")).toEqual(["c"]);
    expect(space(state).nodes.some((node) => node.id === "r:c")).toBe(false);
    expect(state.library.refs.c).toBeDefined();
  });

  it("a dot dragged into another collection leaves the first", () => {
    const state = reducer(base, { type: "refs-joined", collectionId: "luz", ids: ["d:arq:a"] });

    expect(refIdsOf(state, "arq")).toEqual(["b"]);
    expect(refIdsOf(state, "luz")).toEqual(["a"]);
  });

  it("a dot released from its collection becomes a loose reference where it was dropped", () => {
    const state = reducer(base, { type: "dot-released", id: "d:arq:a", at: { x: 900, y: 40 } });

    expect(refIdsOf(state, "arq")).toEqual(["b"]);
    expect(space(state).nodes.at(-1)).toEqual({ kind: "ref", id: "r:a", refId: "a", x: 900, y: 40 });
  });

  it("a settled graph stores positions without reordering; what did not move stays the same object", () => {
    const order = space(base).nodes.map((node) => node.id);
    const state = reducer(base, {
      type: "graph-settled",
      spaceId: space(base).id,
      positions: { "c:arq": { x: 40, y: 40 }, "d:arq:a": { x: 7, y: 8 } },
    });

    expect(space(state).nodes.map((node) => node.id)).toEqual(order);
    expect(space(state).nodes.find((node) => node.id === "c:arq")).toMatchObject({ x: 40, y: 40 });
    expect(space(state).places).toEqual({ "d:arq:a": { x: 7, y: 8 } });

    const again = reducer(state, {
      type: "graph-settled",
      spaceId: space(base).id,
      positions: { "c:arq": { x: 40, y: 40 }, "d:arq:a": { x: 7, y: 8 } },
    });
    expect(space(again).places!["d:arq:a"]).toBe(space(state).places!["d:arq:a"]);
    expect(space(again).nodes).toEqual(space(state).nodes);
  });

  it("a palette is stored on the reference and on the running search's approvals", () => {
    const searching = run(
      [...round("luz", ["q"], ["x", "y"], { collectionId: "arq" }), { type: "approval-toggled", ref: makeRef("x") }],
      base,
    );
    const state = reducer(searching, {
      type: "palettes-found",
      palettes: { a: ["#d01e28"], x: ["#1a2a78"], sumida: ["#000000"] },
    });

    expect(state.library.refs.a.palette).toEqual(["#d01e28"]);
    expect(state.library.refs.b.palette).toBeUndefined();
    expect(state.library.refs.sumida).toBeUndefined();
    expect(state.session?.approved[0].palette).toEqual(["#1a2a78"]);
    expect(reducer(state, { type: "concluded" }).library.refs.x.palette).toEqual(["#1a2a78"]);
  });
});

describe("persistence", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    });
  });

  it("the app remembers what was opened last and reopens there, not on the search page", () => {
    const state = run([
      { type: "space-created", id: "outro", name: "Outro" },
      { type: "collection-created", id: "solta", name: "Solta" },
      { type: "view-changed", view: { kind: "collection", id: "solta" } },
      { type: "view-changed", view: { kind: "space", id: "outro" } },
      { type: "view-changed", view: { kind: "home" } },
    ]);
    expect(state.view).toEqual({ kind: "home" });
    expect(state.ui.recent).toEqual(["outro", "solta", "inicio"]);

    expect(stateFrom(persisted(state)).view).toEqual({ kind: "space", id: "outro" });
    expect(reducer(state, { type: "deleted", kind: "space", id: "outro" }).view).toEqual({ kind: "home" });
  });

  it("a space collection opens full screen over its map; the app reopens there", () => {
    const state = run([
      { type: "collection-created", id: "arq", name: "Arquitetura", spaceId: "inicio", at: { x: 0, y: 0 } },
      { type: "view-changed", view: { kind: "collection", id: "arq" } },
      { type: "viewport-changed", viewport: { x: 5, y: 6, scale: 0.5 } },
    ]);
    expect(currentSpace(state)?.id).toBe("inicio");
    expect(state.library.spaces[0].viewport).toEqual({ x: 5, y: 6, scale: 0.5 });

    expect(stateFrom(persisted({ ...state, view: { kind: "home" } })).view).toEqual({ kind: "collection", id: "arq" });
  });

  it("space panes all reopen visible, even if minimized in the previous session", () => {
    const layout = { axis: "column", children: ["map", "board", "catalog"], sizes: [1, 1, 1] } as const;
    const state = run([
      {
        type: "ui-changed",
        ui: {
          panes: { board: false, map: true, catalog: false },
          layout: { ...layout, children: [...layout.children], sizes: [...layout.sizes] },
        },
      },
    ]);
    savePrefs(state.ui);
    expect(stateFrom(persisted(state)).ui).toMatchObject({ panes: { board: true, map: true, catalog: true }, layout });
    storage.set(
      "ganymede:ui",
      JSON.stringify({ sidebar: false, layout: { axis: "row", children: ["map"], sizes: [1] }, panelWidth: 380 }),
    );
    expect(stateFrom(null).ui).toEqual({ ...initialState.ui, sidebar: false });
  });

  it("starts with an empty space when nothing is saved, even with corrupted preferences", () => {
    expect(stateFrom(null)).toEqual(initialState);
    storage.set("ganymede:ui", "{não é json");
    expect(stateFrom(null)).toEqual(initialState);
  });

  it("restores library, view and the running session", () => {
    const state = run([
      { type: "collection-created", id: "c1", name: "", spaceId: "inicio" },
      ...round("cidade medieval", ["q"], ["a", "b"], { spaceId: "inicio", collectionId: "c1" }),
      { type: "approval-toggled", ref: makeRef("a") },
      { type: "concluded" },
      { type: "ui-changed", ui: { sidebar: false } },
      ...round("floresta", ["q2"], ["x", "y"], { spaceId: "inicio", collectionId: "c1" }),
      { type: "approval-toggled", ref: makeRef("y") },
    ]);
    savePrefs(state.ui);

    expect(stateFrom(persisted(state))).toEqual(state);
  });

  it("does not resume a search interrupted before the first result", () => {
    expect(stateFrom(persisted(run([{ type: "search-started", prompt: "cidade medieval" }])))).toMatchObject({
      session: null,
      round: { phase: "idle" },
    });
  });
});
