import { pinGrid } from "./features/board/pins";
import { boundsOf, clusterRadius, looseExtent, nextTo, placeLoose } from "./features/graph/geometry";
import { addRefs, collectionName, dropOrphans, mapCollection, mapSpace, union } from "./lib/library";
import { DEFAULT_LAYOUT, type Tile, validLayout } from "./features/shell/layout";
import type { Persisted } from "./lib/store";
import { dotId, parseDot } from "./lib/dots";
import type {
  Board,
  BoardLink,
  BoardNote,
  Collection,
  Library,
  Pin,
  Point,
  Reference,
  SearchSession,
  SearchTarget,
  SearchWave,
  Space,
  SpaceNode,
  View,
  Viewport,
} from "./types";

export type ArrivedWave = SearchWave & { at: number };

export type Round =
  | { phase: "idle" }
  | { phase: "searching" }
  | ({ phase: "loading" } & ArrivedWave)
  | { phase: "ready"; spares: Reference[] }
  | { phase: "error"; reason: FailureReason };

export type FailureReason = "empty" | "exhausted" | "offline";

export type Pane = "board" | "map" | "catalog";

export interface Ui {
  sidebar: boolean;
  panes: Record<Pane, boolean>;
  layout: Tile;
  recent: string[];
}

export interface AppState {
  library: Library;
  view: View;
  session: SearchSession | null;
  round: Round;
  ui: Ui;
}

export type Destination = { collectionId: string } | { spaceId: string; at?: Point };

type Kind = "space" | "collection";
export type Action =
  | { type: "search-started"; prompt: string; target?: SearchTarget; seed?: Reference[] }
  | { type: "wave-arrived"; wave: ArrivedWave }
  | { type: "search-failed"; reason: FailureReason }
  | { type: "revealed"; results: Reference[]; spares: Reference[] }
  | { type: "result-failed"; id: string }
  | { type: "approval-toggled"; ref: Reference }
  | { type: "concluded" }
  | { type: "search-cancelled" }
  | { type: "session-resumed"; session: SearchSession }
  | { type: "view-changed"; view: View }
  | { type: "ui-changed"; ui: Partial<Ui> }
  | { type: "space-created"; id: string; name: string }
  | { type: "collection-created"; id: string; name: string; spaceId?: string; at?: Point }
  | { type: "renamed"; kind: Kind; id: string; name: string }
  | { type: "duplicated"; kind: Kind; id: string; newId: string }
  | { type: "collection-copied"; id: string; newId: string; spaceId?: string; at?: Point }
  | { type: "deleted"; kind: Kind; id: string }
  | { type: "refs-added"; refs: Reference[]; to: Destination }
  | { type: "refs-removed"; collectionId: string; refIds: string[] }
  | { type: "library-restored"; library: Library }
  | { type: "selection-collected"; id: string; nodeIds: string[] }
  | { type: "graph-settled"; spaceId: string; positions: Record<string, Point> }
  | { type: "nodes-removed"; ids: string[] }
  | { type: "viewport-changed"; viewport: Viewport }
  | { type: "refs-joined"; collectionId: string; ids: string[] }
  | { type: "dot-released"; id: string; at: Point }
  | { type: "pinned"; refs: Reference[]; at: Point }
  | { type: "pins-changed"; pins: Pin[] }
  | { type: "note-added"; note: BoardNote }
  | { type: "notes-changed"; notes: BoardNote[] }
  | { type: "board-linked"; link: BoardLink }
  | { type: "unpinned"; ids: string[] }
  | { type: "board-viewport-changed"; viewport: Viewport }
  | { type: "palettes-found"; palettes: Record<string, string[]> };

const emptyBoard: Board = { viewport: { x: 0, y: 0, scale: 1 }, pins: [] };
const firstSpace: Space = {
  id: "inicio",
  name: "My space",
  viewport: { x: 0, y: 0, scale: 1 },
  nodes: [],
  board: emptyBoard,
};

export const initialState: AppState = {
  library: { refs: {}, collections: [], spaces: [firstSpace] },
  view: { kind: "space", id: firstSpace.id },
  session: null,
  round: { phase: "idle" },
  ui: { sidebar: true, panes: { board: true, map: true, catalog: true }, layout: DEFAULT_LAYOUT, recent: [] },
};

const RECENT_MAX = 24;

export const shownReferences = (session: SearchSession | null) =>
  session?.iterations.flatMap((iteration) => iteration.results) ?? [];

export const searchedPlans = (session: SearchSession | null) => session?.iterations.map(({ plan }) => plan) ?? [];

export const currentSpace = ({ library, view }: Pick<AppState, "library" | "view">) => {
  const id =
    view.kind === "space"
      ? view.id
      : view.kind === "collection"
        ? library.collections.find((collection) => collection.id === view.id)?.spaceId
        : undefined;
  return library.spaces.find((space) => space.id === id);
};

function placeCluster(library: Library, spaceId: string, collectionId: string, at?: Point) {
  return mapSpace(library, spaceId, (space) => {
    const r = clusterRadius(
      library.collections.find((collection) => collection.id === collectionId)?.refIds.length ?? 0,
    );
    const next = nextTo(space.nodes, library);
    const node: SpaceNode = {
      kind: "collection",
      id: `c:${collectionId}`,
      collectionId,
      ...(at ?? { x: next.x + r, y: next.y + r }),
    };
    return { ...space, nodes: [...space.nodes, node] };
  });
}

function placeRefs(library: Library, spaceId: string, refs: Reference[], at?: Point) {
  return mapSpace(library, spaceId, (space) => {
    const fresh = refs.filter((ref) => !space.nodes.some((node) => node.id === `r:${ref.id}`));
    const extent = looseExtent(fresh.length);
    const next = nextTo(space.nodes, library);
    return {
      ...space,
      nodes: [...space.nodes, ...placeLoose(fresh, at ?? { x: next.x + extent, y: next.y + extent })],
    };
  });
}

function deleteCollections(library: Library, ids: Set<string>): Library {
  const gone = (collection: Collection) => ids.has(collection.id);
  return dropOrphans({
    ...library,
    collections: library.collections.filter((collection) => !gone(collection)),
    spaces: library.spaces.map((space) => ({
      ...space,
      nodes: space.nodes.filter((node) => node.kind !== "collection" || !ids.has(node.collectionId)),
    })),
  });
}

function copyOf(library: Library, id: string, newId: string, spaceId?: string): Collection | null {
  const original = library.collections.find((collection) => collection.id === id);
  if (!original) return null;
  const { spaceId: _, ...rest } = original;
  return { ...rest, id: newId, ...(spaceId && { spaceId }) };
}

function libraryReducer(library: Library, action: Action, view: View): Library {
  const spaceId = currentSpace({ library, view })?.id ?? "";
  const inSpace = (update: (space: Space) => Space) => mapSpace(library, spaceId, update);

  switch (action.type) {
    case "space-created":
      return { ...library, spaces: [...library.spaces, { ...firstSpace, id: action.id, name: action.name }] };

    case "collection-created": {
      const collection: Collection = {
        id: action.id,
        name: action.name,
        refIds: [],
        ...(action.spaceId && { spaceId: action.spaceId }),
      };
      const created = { ...library, collections: [...library.collections, collection] };
      return action.spaceId ? placeCluster(created, action.spaceId, action.id, action.at) : created;
    }

    case "renamed":
      return action.kind === "space"
        ? mapSpace(library, action.id, (space) => ({ ...space, name: action.name }))
        : mapCollection(library, action.id, (collection) => ({ ...collection, name: action.name }));

    case "duplicated": {
      if (action.kind === "collection") {
        const copy = copyOf(library, action.id, action.newId);
        return copy
          ? {
              ...library,
              collections: [...library.collections, { ...copy, name: `${copy.name || "Collection"} (copy)` }],
            }
          : library;
      }
      const original = library.spaces.find((space) => space.id === action.id);
      if (!original) return library;
      const copyId = (collectionId: string) => `${collectionId}-${action.newId}`;
      const nodes = original.nodes.map((node) =>
        node.kind === "collection"
          ? { ...node, id: `c:${copyId(node.collectionId)}`, collectionId: copyId(node.collectionId) }
          : node,
      );
      const owned = library.collections.filter((collection) => collection.spaceId === original.id);
      const collections = owned.map((collection) => ({
        ...collection,
        id: copyId(collection.id),
        spaceId: action.newId,
      }));
      const renames = new Map(
        owned.flatMap((collection) => [
          [`c:${collection.id}`, `c:${copyId(collection.id)}`] as const,
          ...collection.refIds.map(
            (refId) => [dotId(collection.id, refId), dotId(copyId(collection.id), refId)] as const,
          ),
        ]),
      );
      const places = Object.fromEntries(
        Object.entries(original.places ?? {}).map(([id, at]) => [renames.get(id) ?? id, at]),
      );
      return {
        ...library,
        collections: [...library.collections, ...collections],
        spaces: [...library.spaces, { ...original, id: action.newId, name: `${original.name} (copy)`, nodes, places }],
      };
    }

    case "collection-copied": {
      const copy = copyOf(library, action.id, action.newId, action.spaceId);
      if (!copy) return library;
      const copied = { ...library, collections: [...library.collections, copy] };
      return action.spaceId ? placeCluster(copied, action.spaceId, action.newId, action.at) : copied;
    }

    case "deleted": {
      if (action.kind === "collection") return deleteCollections(library, new Set([action.id]));
      if (library.spaces.length < 2) return library;
      const owned = library.collections
        .filter((collection) => collection.spaceId === action.id)
        .map((collection) => collection.id);
      return deleteCollections(
        { ...library, spaces: library.spaces.filter((space) => space.id !== action.id) },
        new Set(owned),
      );
    }

    case "refs-added": {
      const added = addRefs(library, action.refs);
      const ids = action.refs.map((ref) => ref.id);
      if ("collectionId" in action.to)
        return mapCollection(added, action.to.collectionId, (c) => ({ ...c, refIds: union(c.refIds, ids) }));
      return placeRefs(added, action.to.spaceId, action.refs, action.to.at);
    }

    case "refs-removed":
      return dropOrphans(
        mapCollection(library, action.collectionId, (c) => ({
          ...c,
          refIds: c.refIds.filter((id) => !action.refIds.includes(id)),
        })),
      );

    case "library-restored":
      return action.library;

    case "selection-collected": {
      const space = library.spaces.find((other) => other.id === spaceId);
      const picked = space?.nodes.filter((node) => node.kind === "ref" && action.nodeIds.includes(node.id)) ?? [];
      if (!picked.length) return library;
      const refIds = picked.map((node) => (node.kind === "ref" ? node.refId : ""));
      const area = boundsOf(picked, library)!;
      const collection: Collection = { id: action.id, name: "", refIds, spaceId };
      const cleared = mapSpace({ ...library, collections: [...library.collections, collection] }, spaceId, (s) => ({
        ...s,
        nodes: s.nodes.filter((node) => !picked.includes(node)),
      }));
      return placeCluster(cleared, spaceId, action.id, { x: area.x + area.w / 2, y: area.y + area.h / 2 });
    }

    case "refs-joined": {
      const space = library.spaces.find((other) => other.id === spaceId);
      const target = library.collections.find(
        (collection) => collection.id === action.collectionId && collection.spaceId === spaceId,
      );
      if (!space || !target) return library;
      const renames = new Map<string, string>();
      const leaving = new Map<string, string[]>();
      for (const id of action.ids) {
        const node = space.nodes.find((other) => other.id === id);
        const dot = parseDot(id);
        const refId = node?.kind === "ref" ? node.refId : dot && dot.collectionId !== target.id ? dot.refId : null;
        if (!refId || !library.refs[refId]) continue;
        renames.set(id, dotId(target.id, refId));
        if (dot) leaving.set(dot.collectionId, [...(leaving.get(dot.collectionId) ?? []), refId]);
      }
      if (!renames.size) return library;
      const refIds = [...renames.values()].map((id) => parseDot(id)!.refId);
      const collections = library.collections.map((collection) => {
        if (collection.id === target.id) return { ...collection, refIds: union(collection.refIds, refIds) };
        const gone = leaving.get(collection.id);
        return gone
          ? { ...collection, refIds: collection.refIds.filter((refId) => !gone.includes(refId)) }
          : collection;
      });
      return mapSpace({ ...library, collections }, spaceId, (s) => ({
        ...s,
        nodes: s.nodes.filter((node) => !renames.has(node.id)),
      }));
    }

    case "dot-released": {
      const dot = parseDot(action.id);
      const space = library.spaces.find((other) => other.id === spaceId);
      if (!dot || !space || !library.refs[dot.refId]) return library;
      const looseId = `r:${dot.refId}`;
      const left = mapCollection(library, dot.collectionId, (c) => ({
        ...c,
        refIds: c.refIds.filter((refId) => refId !== dot.refId),
      }));
      return mapSpace(left, spaceId, (s) => ({
        ...s,
        nodes: [
          ...s.nodes.filter((node) => node.id !== looseId),
          { kind: "ref", id: looseId, refId: dot.refId, x: Math.round(action.at.x), y: Math.round(action.at.y) },
        ],
      }));
    }

    case "nodes-removed": {
      const space = library.spaces.find((other) => other.id === spaceId);
      const collectionIds = space?.nodes.flatMap((node) =>
        node.kind === "collection" && action.ids.includes(node.id) ? [node.collectionId] : [],
      );
      const removed = inSpace((s) => ({ ...s, nodes: s.nodes.filter((node) => !action.ids.includes(node.id)) }));
      return deleteCollections(removed, new Set(collectionIds));
    }

    case "graph-settled":
      return mapSpace(library, action.spaceId, (space) => {
        const at = (id: string, before?: Point) => {
          const next = action.positions[id];
          return !next || (before && before.x === next.x && before.y === next.y) ? before : next;
        };
        const places: Record<string, Point> = {};
        for (const id in action.positions) if (id.startsWith("d:")) places[id] = at(id, space.places?.[id])!;
        return {
          ...space,
          places,
          nodes: space.nodes.map((node) => {
            const next = at(node.id, node);
            return next === node || !next ? node : { ...node, x: next.x, y: next.y };
          }),
        };
      });

    case "viewport-changed":
      return inSpace((space) => ({ ...space, viewport: action.viewport }));

    case "pinned": {
      if (!action.refs.length) return library;
      const ids = new Set(action.refs.map((ref) => ref.id));
      return mapSpace(addRefs(library, action.refs), spaceId, (space) => ({
        ...space,
        board: {
          ...space.board,
          pins: [...space.board.pins.filter((pin) => !ids.has(pin.refId)), ...pinGrid(action.refs, action.at)],
        },
      }));
    }

    case "pins-changed": {
      const changed = new Map(action.pins.map((pin) => [pin.refId, pin]));
      return inSpace((space) => ({
        ...space,
        board: {
          ...space.board,
          pins: [...space.board.pins.filter((pin) => !changed.has(pin.refId)), ...changed.values()],
        },
      }));
    }

    case "note-added":
      return inSpace((space) => ({
        ...space,
        board: { ...space.board, notes: [...(space.board.notes ?? []), action.note] },
      }));

    case "notes-changed": {
      const changed = new Map(action.notes.map((note) => [note.id, note]));
      return inSpace((space) => ({
        ...space,
        board: {
          ...space.board,
          notes: [...(space.board.notes ?? []).filter((note) => !changed.has(note.id)), ...changed.values()],
        },
      }));
    }

    case "board-linked": {
      const { from, to } = action.link;
      return inSpace((space) =>
        from === to || space.board.links?.some((link) => link.from === from && link.to === to)
          ? space
          : { ...space, board: { ...space.board, links: [...(space.board.links ?? []), action.link] } },
      );
    }

    case "unpinned":
      return dropOrphans(
        inSpace((space) => ({
          ...space,
          board: {
            ...space.board,
            pins: space.board.pins.filter((pin) => !action.ids.includes(pin.refId)),
            notes: space.board.notes?.filter((note) => !action.ids.includes(note.id)),
            links: space.board.links?.filter(
              (link) => ![link.id, link.from, link.to].some((id) => action.ids.includes(id)),
            ),
          },
        })),
      );

    case "board-viewport-changed":
      return inSpace((space) => ({ ...space, board: { ...space.board, viewport: action.viewport } }));

    default:
      return library;
  }
}

function validView(library: Library, view: View): View {
  if (view.kind === "home") return view;
  const exists = (view.kind === "space" ? library.spaces : library.collections).some((item) => item.id === view.id);
  return exists || !library.spaces[0] ? view : { kind: "space", id: library.spaces[0].id };
}

function openingView(library: Library, view: View | undefined, recent: string[]): View {
  if (view && view.kind !== "home") return validView(library, view);
  for (const id of recent) {
    if (library.spaces.some((space) => space.id === id)) return { kind: "space", id };
    if (library.collections.some((collection) => collection.id === id)) return { kind: "collection", id };
  }
  return validView(library, initialState.view);
}

export function reducer(state: AppState, action: Action): AppState {
  const { session } = state;

  switch (action.type) {
    case "search-started":
      return {
        ...state,
        session: session
          ? { ...session, prompt: action.prompt }
          : {
              prompt: action.prompt,
              iterations: [],
              approved: [],
              target: action.target ?? {},
              seed: action.seed ?? [],
            },
        round: { phase: "searching" },
      };

    case "wave-arrived":
      return state.round.phase === "searching" ? { ...state, round: { phase: "loading", ...action.wave } } : state;

    case "search-failed":
      return { ...state, round: { phase: "error", reason: action.reason } };

    case "revealed": {
      const { round } = state;
      if (!session || round.phase !== "loading") return state;
      const iteration = { plan: round.plan, results: action.results };
      return {
        ...state,
        session: { ...session, iterations: [...session.iterations, iteration] },
        round: { phase: "ready", spares: action.spares },
      };
    }

    case "result-failed": {
      if (!session || state.round.phase !== "ready") return state;
      const [replacement, ...spares] = state.round.spares;
      const current = session.iterations.at(-1);
      if (!replacement || !current) return state;
      const results = current.results.map((ref) => (ref.id === action.id ? replacement : ref));
      return {
        ...state,
        session: { ...session, iterations: [...session.iterations.slice(0, -1), { ...current, results }] },
        round: { ...state.round, spares },
      };
    }

    case "approval-toggled": {
      if (!session) return state;
      const { ref } = action;
      const approved = session.approved.some((other) => other.id === ref.id)
        ? session.approved.filter((other) => other.id !== ref.id)
        : [...session.approved, ref];
      return { ...state, session: { ...session, approved } };
    }

    case "concluded": {
      if (!session) return state;
      const { approved, target, prompt } = session;
      const ids = approved.map((ref) => ref.id);
      const library =
        ids.length && target.collectionId
          ? mapCollection(addRefs(state.library, approved), target.collectionId, (c) => ({
              ...c,
              name: c.name || collectionName(prompt),
              refIds: union(c.refIds, ids),
              prompt,
            }))
          : state.library;
      return { ...state, library, session: null, round: { phase: "idle" } };
    }

    case "search-cancelled":
      return session ? { ...state, session: null, round: { phase: "idle" } } : state;

    case "session-resumed":
      return { ...state, session: action.session, round: { phase: "ready", spares: [] } };

    case "palettes-found": {
      const paint = (ref: Reference) => (action.palettes[ref.id] ? { ...ref, palette: action.palettes[ref.id] } : ref);
      return {
        ...state,
        library: {
          ...state.library,
          refs: Object.fromEntries(Object.entries(state.library.refs).map(([id, ref]) => [id, paint(ref)])),
        },
        session: session && { ...session, approved: session.approved.map(paint) },
      };
    }

    case "view-changed": {
      const visited = [action.view, state.view].flatMap((view) => (view.kind === "home" ? [] : [view.id]));
      return {
        ...state,
        view: action.view,
        ui: { ...state.ui, recent: [...new Set([...visited, ...state.ui.recent])].slice(0, RECENT_MAX) },
      };
    }

    case "ui-changed":
      return { ...state, ui: { ...state.ui, ...action.ui } };

    default: {
      const library = libraryReducer(state.library, action, state.view);
      return library === state.library ? state : { ...state, library, view: validView(library, state.view) };
    }
  }
}

const UI_KEY = "ganymede:ui";

export function stateFrom(saved: Persisted | null): AppState {
  let prefs: Partial<Ui> = {};
  try {
    prefs = JSON.parse(localStorage.getItem(UI_KEY) ?? "{}");
  } catch {}
  const ui: Ui = {
    ...initialState.ui,
    sidebar: typeof prefs.sidebar === "boolean" ? prefs.sidebar : initialState.ui.sidebar,
    layout: validLayout(prefs.layout) ? prefs.layout : DEFAULT_LAYOUT,
    recent: saved?.recent ?? [],
  };
  if (!saved) return { ...initialState, ui };
  const session = saved.session?.iterations.length ? saved.session : null;
  return {
    library: saved.library,
    view: openingView(saved.library, saved.view, ui.recent),
    session,
    round: session ? { phase: "ready", spares: [] } : { phase: "idle" },
    ui,
  };
}

export function savePrefs({ sidebar, layout }: Pick<Ui, "sidebar" | "layout">): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ sidebar, layout }));
  } catch {}
}
