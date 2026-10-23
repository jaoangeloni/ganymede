import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Board, type BoardTool } from "./features/board/Board";
import { clusterRadius, freeSpot, LABEL_HEIGHT } from "./features/graph/geometry";
import { Graph, type MapTool } from "./features/graph/Graph";
import { SelectionBar } from "./features/graph/SelectionBar";
import { Welcome } from "./features/graph/Welcome";
import { CollectionCatalog, CollectionSwitch } from "./features/library/Catalog";
import { LibraryView } from "./features/library/LibraryView";
import { Preview } from "./features/preview/Preview";
import { ApprovedRail } from "./features/search/ApprovedRail";
import { PromptBar } from "./features/search/PromptBar";
import { SearchLayer } from "./features/search/SearchLayer";
import { SearchPage } from "./features/search/SearchPage";
import { type Arrival, type SearchStart, useSearchRound } from "./features/search/useSearchRound";
import { type Confirmation, ConfirmDialog } from "./features/shell/ConfirmDialog";
import { Sidebar } from "./features/shell/Sidebar";
import { Toast, type ToastMessage } from "./features/shell/Toast";
import { CarryGhost } from "./features/shell/CarryGhost";
import { PANES, paneLabel, Workspace } from "./features/shell/Workspace";
import type { Filters } from "./features/search/pipeline/bing";
import { BENCH_ON, benchSize, benchState } from "./dev/bench";
import { FrameHud } from "./dev/FrameHud";
import { closeWindow, focusWindow, isTauri, onMediaReady, openWindow } from "./lib/api";
import { listen, type Message, post, windowLabel, windowUrl } from "./lib/windows";
import { fitBounds, zoomAt } from "./lib/camera";
import { collectionTint, readPalettes } from "./lib/color";
import { endpointsOf, parseDot } from "./lib/dots";
import { acknowledge, followDrag, markDropTarget, payloadOf } from "./lib/drag";
import { importAll, pickImages, readTransfer } from "./lib/images";
import { displayName, newId, refsOf } from "./lib/library";
import { closest, isEditable } from "./lib/platform";
import { type Opened, persist } from "./lib/store";
import { keepCenterOnResize } from "./lib/usePanZoom";
import { morphing, reflow } from "./lib/viewTransition";
import {
  type Action,
  type AppState,
  currentSpace,
  type Destination,
  type Pane,
  reducer,
  savePrefs,
  stateFrom,
} from "./state";
import type { Box, Collection, Point, Reference, Space, View, Viewport } from "./types";

const SAVE_DELAY_MS = 300;
const BENCH = BENCH_ON ? benchSize() : 0;
const PALETTE_BATCH = 24;
const VIEW_MARGIN = { left: 32, right: 32 };

type Stage = "home" | "canvas" | "main";
type PreviewFrom = "round" | { collectionId: string } | { spaceId: string } | { boardOf: string };

function toWorld(point: Point, surface: HTMLElement, view: Viewport): Point {
  const rect = surface.getBoundingClientRect();
  return { x: (point.x - rect.left - view.x) / view.scale, y: (point.y - rect.top - view.y) / view.scale };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max).replace(/[\s,;.]+\S*$/, "")}…` : text;

interface Solo {
  pane: Pane;
  state: AppState;
  selection: string[];
}

export default function App({ opened, solo }: { opened: Opened; solo?: Solo }) {
  const [state, apply] = useReducer(reducer, undefined, () =>
    solo ? solo.state : BENCH ? benchState(stateFrom(opened.saved), BENCH) : stateFrom(opened.saved),
  );
  // ponytail: no sequencer, two windows acting in the same millisecond may apply in different orders; a
  // version counter with a resync from the main window would fix it if it ever shows
  const dispatch = useCallback((action: Action) => {
    apply(action);
    post({ kind: "action", action });
  }, []);
  const { library, view, session, round, ui } = state;
  const space = currentSpace(state);
  const [kept, setKept] = useState(space);
  if (solo && space && space !== kept) setKept(space);
  const paneSpace = solo ? (space ?? kept) : space;
  const collection = view.kind === "collection" ? library.collections.find((other) => other.id === view.id) : undefined;
  const onCanvas = view.kind === "space" && space !== undefined;
  const [selection, setSelection] = useState<string[]>(solo?.selection ?? []);
  const heard = useRef(solo?.selection);
  useEffect(() => {
    if (selection !== heard.current) post({ kind: "selection", selection });
  }, [selection]);
  const selectedCollection =
    onCanvas && selection.length === 1 && selection[0].startsWith("c:")
      ? library.collections.find((other) => `c:${other.id}` === selection[0])
      : undefined;
  const [catalogId, setCatalogId] = useState<string | null>(null);
  if (selectedCollection && selectedCollection.id !== catalogId) setCatalogId(selectedCollection.id);
  const owned = paneSpace ? library.collections.filter((other) => other.spaceId === paneSpace.id) : [];
  const catalogCollection = selectedCollection ?? owned.find((other) => other.id === catalogId) ?? owned[0];
  const [pane, setPane] = useState<Pane>(solo?.pane ?? "map");
  const [maximized, setMaximized] = useState<Pane | null>(null);
  const [detached, setDetached] = useState<Pane[]>([]);
  const [carried, setCarried] = useState<string[] | null>(null);
  const docked = PANES.filter((which) => ui.panes[which] && !detached.includes(which));
  const expanded = maximized && docked.includes(maximized) && docked.length > 1 ? maximized : null;
  const [mapTool, setMapTool] = useState<MapTool>("hand");
  const [boardTool, setBoardTool] = useState<BoardTool>("hand");
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ refs: Reference[]; index: number; from: PreviewFrom } | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const hovered = useRef<Reference | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = (message: string, undo?: () => void) => setToast({ id: performance.now(), message, undo });
  const [catalogFocus, setCatalogFocus] = useState(0);
  const [gliding, setGliding] = useState(false);
  const [entrance, setEntrance] = useState<Stage | null>(null);
  const [arriving, setArriving] = useState<Arrival>(null);
  const [draft, setDraft] = useState(session?.prompt ?? "");
  const main = useRef<HTMLDivElement>(null);
  const centering = useRef<string | null>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);

  const { recent, sidebar, layout } = ui;
  useEffect(() => {
    if (BENCH || !opened.persistent) return;
    const timer = setTimeout(() => void persist({ library, view, session, recent }), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [library, view, session, recent, opened.persistent]);
  useEffect(() => {
    if (!solo) savePrefs({ sidebar, layout });
  }, [sidebar, layout, solo]);

  const paletteTried = useRef(new Set<string>());
  const [mediaTick, setMediaTick] = useState(0);
  useEffect(
    () =>
      onMediaReady((ids) => {
        ids.forEach((id) => paletteTried.current.delete(id));
        setMediaTick((tick) => tick + 1);
      }),
    [],
  );
  useEffect(() => {
    if (solo) return;
    const missing = [...Object.values(library.refs), ...(session?.approved ?? [])]
      .filter((ref) => !ref.palette && !paletteTried.current.has(ref.id))
      .slice(0, PALETTE_BATCH);
    if (!missing.length) return;
    missing.forEach((ref) => paletteTried.current.add(ref.id));
    void readPalettes(missing).then(
      (palettes) => Object.keys(palettes).length && dispatch({ type: "palettes-found", palettes }),
    );
  }, [library.refs, session?.approved, mediaTick, solo, dispatch]);

  const spaceNodes = onCanvas ? space.nodes : undefined;
  const spaceId = space?.id;
  const collectionRefIds = collection?.refIds;
  const { collections } = library;
  const present = useMemo(
    () =>
      (spaceNodes && spaceId
        ? [...endpointsOf({ id: spaceId, nodes: spaceNodes }, collections)]
        : (collectionRefIds ?? [])
      ).join("\n"),
    [spaceNodes, spaceId, collections, collectionRefIds],
  );
  useEffect(() => {
    const ids = new Set(present.split("\n"));
    setSelection((current) => (current.every((id) => ids.has(id)) ? current : current.filter((id) => ids.has(id))));
  }, [present]);

  const sessionOpen = useRef(session !== null);
  sessionOpen.current = session !== null;
  useEffect(() => {
    if (!sessionOpen.current) setDraft("");
  }, [collection?.id, catalogCollection?.id]);

  const placeOf = (id: string) => {
    const node = space?.nodes.find((other) => other.id === (parseDot(id) ? `c:${parseDot(id)!.collectionId}` : id));
    return node ? `${Math.round(node.x)},${Math.round(node.y)}` : "";
  };
  const shown = selectedCollection
    ? `c:${selectedCollection.id}\n${selectedCollection.refIds.length}\n${placeOf(`c:${selectedCollection.id}`)}`
    : "";
  const keepCollectionInView = useEffectEvent(() => {
    if (!space || !main.current || !selectedCollection) return;
    const node = space.nodes.find((other) => other.id === `c:${selectedCollection.id}`);
    if (!node) return;
    const r = clusterRadius(selectedCollection.refIds.length);
    const { x, scale } = space.viewport;
    const width = main.current.clientWidth;
    const left = (node.x - r) * scale + x;
    const right = (node.x + r) * scale + x;
    const shift =
      right > width - VIEW_MARGIN.right
        ? Math.max(width - VIEW_MARGIN.right - right, VIEW_MARGIN.left - left)
        : left < VIEW_MARGIN.left
          ? VIEW_MARGIN.left - left
          : 0;
    if (!shift) return;
    setGliding(true);
    dispatch({ type: "viewport-changed", viewport: { ...space.viewport, x: x + shift } });
  });
  useLayoutEffect(() => keepCollectionInView(), [shown, ui.panes.catalog, ui.sidebar]);
  useLayoutEffect(() => {
    const node = space?.nodes.find((other) => other.id === centering.current);
    if (!node || !main.current) return;
    centering.current = null;
    const { scale } = space!.viewport;
    dispatch({
      type: "viewport-changed",
      viewport: {
        scale,
        x: main.current.clientWidth / 2 - node.x * scale,
        y: main.current.clientHeight * 0.45 - node.y * scale,
      },
    });
  });

  const nameOf = (kind: "space" | "collection", id: string) => {
    if (kind === "space") return library.spaces.find((item) => item.id === id)?.name ?? "";
    const found = library.collections.find((item) => item.id === id);
    return found ? displayName(found) : "";
  };
  const navigate = (next: View) => {
    setSelection([]);
    setPreview(null);
    dispatch({ type: "view-changed", view: next });
  };
  const travel = (named: boolean, from: Stage, to: Stage, update: () => void) => {
    if (named) flushSync(() => setEntrance(from));
    void morphing(
      from === "home" || to === "home",
      () => {
        setEntrance(named ? to : null);
        update();
      },
      () => setEntrance(null),
    );
  };
  const [searchFrom, setSearchFrom] = useState<string | null>(null);
  const goSearch = (from?: string) => {
    setSearchFrom(from ?? collection?.id ?? selectedCollection?.id ?? null);
    travel(false, "main", "home", () => navigate({ kind: "home" }));
  };
  const openCollection = (id: string) => travel(true, "canvas", "main", () => navigate({ kind: "collection", id }));
  const backToSpace = (owned: Collection) => {
    const spaceId = owned.spaceId;
    if (spaceId) travel(true, "main", "canvas", () => navigate({ kind: "space", id: spaceId }));
  };

  const withUndo = (message: string, actions: Action | Action[]) => {
    const before = library;
    notify(message, () => dispatch({ type: "library-restored", library: before }));
    for (const action of [actions].flat()) dispatch(action);
  };

  const searchContext = (from = collection): SearchStart | null => {
    if (!from) return null;
    const refs = refsOf(library, from.id);
    const picked = from === collection ? selection.flatMap((id) => library.refs[id] ?? []) : [];
    return {
      target: { spaceId: from.spaceId, collectionId: from.id },
      seed: picked.length ? picked : refs,
      fallback: from.prompt || (refs.length ? from.name : ""),
    };
  };

  const {
    filters,
    setFilters,
    run: runSearch,
    reveal,
    conclude,
    cancel: cancelSearch,
  } = useSearchRound({
    state,
    dispatch,
    draft,
    setDraft,
    context: () => searchContext(),
    searchable: !solo && Boolean(session || collection),
    hovered,
    onArrive: setArriving,
    onCancelled: (left, resume) =>
      notify(`Search cancelled: ${plural(left.approved.length, "approval discarded", "approvals discarded")}`, resume),
  });

  const centerOf = (target: Space) => {
    const { x, y, scale } = target.viewport;
    return {
      x: ((main.current?.clientWidth ?? 800) / 2 - x) / scale,
      y: ((main.current?.clientHeight ?? 600) * 0.45 - y) / scale,
    };
  };

  const clusterSpot = (target: Space, count: number) => {
    const r = clusterRadius(count);
    const spot = freeSpot(target.nodes, library, centerOf(target), { w: 2 * r, h: 2 * r + LABEL_HEIGHT });
    return { x: spot.x + r, y: spot.y + r };
  };

  const startSearch = (prompt: string, collectionId: string | null) => {
    const existing = library.collections.find((other) => other.id === collectionId);
    if (existing) {
      const target = { spaceId: existing.spaceId, collectionId: existing.id };
      return void runSearch(prompt, { target, seed: refsOf(library, existing.id) }, () =>
        navigate({ kind: "collection", id: existing.id }),
      );
    }
    const id = newId();
    const target =
      ui.recent.flatMap((recent) => library.spaces.find((other) => other.id === recent) ?? [])[0] ?? library.spaces[0];
    dispatch(
      target
        ? { type: "collection-created", id, name: "", spaceId: target.id, at: clusterSpot(target, 0) }
        : { type: "collection-created", id, name: "" },
    );
    void runSearch(prompt, { target: { spaceId: target?.id, collectionId: id }, seed: [] }, () =>
      navigate({ kind: "collection", id }),
    );
  };

  const searchCatalog = (prompt = draft, from: Collection | null = catalogCollection ?? null, using?: Filters) => {
    if (solo) {
      post({ kind: "search", collectionId: from?.id, prompt, filters });
      return setDraft("");
    }
    if (from) return void runSearch(prompt, searchContext(from)!, () => {}, using);
    if (!space || !prompt.trim()) return;
    const id = newId();
    dispatch({ type: "collection-created", id, name: "", spaceId: space.id, at: clusterSpot(space, 0) });
    void runSearch(prompt, { target: { spaceId: space.id, collectionId: id }, seed: [] }, () => {}, using);
  };

  const newCollection = (spaceId: string) => {
    const target = library.spaces.find((other) => other.id === spaceId);
    if (!target) return;
    const id = newId();
    dispatch({ type: "collection-created", id, name: "", spaceId, at: clusterSpot(target, 0) });
    if (!onCanvas || space?.id !== spaceId) navigate({ kind: "space", id: spaceId });
    setSelection([`c:${id}`]);
    focusPane("catalog");
    setCatalogFocus((tick) => tick + 1);
  };

  const importImages = (collectionId?: string) =>
    void pickImages().then((added) => {
      if (!added.length) return;
      if (collectionId) dispatch({ type: "refs-added", refs: added, to: { collectionId } });
      else addRefs(added, null);
    });

  const copyToSpace = (collectionId: string, spaceId: string, at?: Point) => {
    const target = library.spaces.find((other) => other.id === spaceId);
    if (!target) return;
    const id = newId();
    const count = library.collections.find((other) => other.id === collectionId)?.refIds.length ?? 0;
    const spot = at ?? clusterSpot(target, count);
    dispatch({ type: "collection-copied", id: collectionId, newId: id, spaceId, at: spot });
    if (spaceId !== space?.id) navigate({ kind: "space", id: spaceId });
    setSelection([`c:${id}`]);
  };

  const addRefs = (refs: Reference[], target: HTMLElement | null, point?: Point) => {
    if (!refs.length) return;
    const [kind, id] = (target?.dataset.drop ?? "").split(":");
    if (kind === "board" && space && target && point)
      return dispatch({ type: "pinned", refs, at: toWorld(point, target, space.board.viewport) });
    let to: Destination | null = null;
    if (kind === "collection") to = { collectionId: id };
    else if (kind === "space") to = { spaceId: id };
    else if (kind === "canvas" && space && target && point)
      to = { spaceId: space.id, at: toWorld(point, target, space.viewport) };
    else if (collection) to = { collectionId: collection.id };
    else if (space && pane === "board" && ui.panes.board) {
      const board = document.querySelector<HTMLElement>('[data-pane="board"] [data-drop="board"]');
      const middle = board?.getBoundingClientRect();
      if (board && middle)
        return dispatch({
          type: "pinned",
          refs,
          at: toWorld(
            { x: middle.left + middle.width / 2, y: middle.top + middle.height / 2 },
            board,
            space.board.viewport,
          ),
        });
    } else if (space && pane === "catalog" && ui.panes.catalog && catalogCollection)
      to = { collectionId: catalogCollection.id };
    else if (space) to = { spaceId: space.id, at: centerOf(space) };
    if (!to) return;
    dispatch({ type: "refs-added", refs, to });
    if (target?.closest("nav")) {
      acknowledge(target);
      notify(
        `${refs.length === 1 ? "Added" : `${refs.length} added`} to ${nameOf(kind === "space" ? "space" : "collection", id)}`,
      );
    }
  };

  const dropCollection = (collectionId: string, target: HTMLElement, point: Point) => {
    const [kind, id] = (target.dataset.drop ?? "").split(":");
    if (kind === "board") return addRefs(refsOf(library, collectionId), target, point);
    if (kind === "space" && id !== space?.id) {
      const destination = library.spaces.find((other) => other.id === id);
      if (!destination) return;
      const count = library.collections.find((other) => other.id === collectionId)?.refIds.length ?? 0;
      dispatch({
        type: "collection-copied",
        id: collectionId,
        newId: newId(),
        spaceId: id,
        at: clusterSpot(destination, count),
      });
      acknowledge(target);
      notify(`Collection copied to ${destination.name}`);
    } else if (space && (kind === "canvas" || kind === "space")) {
      copyToSpace(collectionId, space.id, kind === "canvas" ? toWorld(point, target, space.viewport) : undefined);
    }
  };

  const lostBody = (doomed: Collection[]) => {
    const count = doomed.reduce((total, other) => total + other.refIds.length, 0);
    const one = doomed.length === 1;
    if (!count) return one ? "The collection is empty." : "The collections are empty.";
    return `${one ? "The collection" : `The ${doomed.length} collections`} and ${plural(count, "reference", "references")} will be lost.`;
  };

  const removeNodes = (ids: string[]) => {
    if (!space || !ids.length) return;
    const dots = ids.flatMap((id) => parseDot(id) ?? []);
    if (dots.length) {
      const nodes = ids.filter((id) => !id.startsWith("d:"));
      const byCollection = new Map<string, string[]>();
      for (const dot of dots)
        byCollection.set(dot.collectionId, [...(byCollection.get(dot.collectionId) ?? []), dot.refId]);
      const removals: Action[] = [...byCollection].map(([collectionId, refIds]) => ({
        type: "refs-removed",
        collectionId,
        refIds,
      }));
      return setConfirm({
        title: `Delete ${dots.length === 1 ? "the reference" : plural(dots.length, "reference", "references")}${nodes.length ? ` and ${plural(nodes.length, "item", "items")}` : ""}?`,
        body: `${dots.length === 1 ? "It leaves its collection and will be lost" : "They leave their collections and will be lost"}.`,
        action: "Delete",
        onConfirm: () =>
          withUndo(
            nodes.length
              ? plural(dots.length + nodes.length, "item deleted", "items deleted")
              : plural(dots.length, "reference deleted", "references deleted"),
            nodes.length ? [...removals, { type: "nodes-removed", ids: nodes }] : removals,
          ),
      });
    }
    const doomed = space.nodes.flatMap((node) =>
      node.kind === "collection" && ids.includes(node.id)
        ? library.collections.filter((other) => other.id === node.collectionId)
        : [],
    );
    const only = ids.length === 1 && doomed.length === 1 ? doomed[0] : undefined;
    const run = () =>
      withUndo(
        only ? `Collection “${displayName(only)}” deleted` : plural(ids.length, "item deleted", "items deleted"),
        { type: "nodes-removed", ids },
      );
    if (!doomed.length) return run();
    setConfirm({
      title: only ? `Delete “${displayName(only)}”?` : `Delete ${plural(ids.length, "item", "items")}?`,
      body: lostBody(doomed),
      action: "Delete",
      onConfirm: run,
    });
  };

  const deleteCollection = (target: Collection) =>
    setConfirm({
      title: `Delete “${displayName(target)}”?`,
      body: lostBody([target]),
      action: "Delete",
      onConfirm: () =>
        withUndo(`Collection “${displayName(target)}” deleted`, { type: "deleted", kind: "collection", id: target.id }),
    });

  const deleteSpace = (id: string) => {
    const owned = library.collections.filter((other) => other.spaceId === id);
    setConfirm({
      title: `Delete the space “${nameOf("space", id)}”?`,
      body: `Everything in it will be lost${owned.length ? `, including ${plural(owned.length, "collection", "collections")}` : ""}.`,
      action: "Delete",
      onConfirm: () => withUndo(`Space “${nameOf("space", id)}” deleted`, { type: "deleted", kind: "space", id }),
    });
  };

  const deleteRefs = (collectionId: string, refIds: string[], done?: () => void) => {
    if (!refIds.length) return;
    const one = refIds.length === 1;
    setConfirm({
      title: `Delete ${one ? "the reference" : plural(refIds.length, "reference", "references")}?`,
      body: `${one ? "It leaves" : "They leave"} “${nameOf("collection", collectionId)}” and will be lost.`,
      action: "Delete",
      onConfirm: () => {
        withUndo(plural(refIds.length, "reference deleted", "references deleted"), {
          type: "refs-removed",
          collectionId,
          refIds,
        });
        done?.();
      },
    });
  };

  const removeSelection = () => {
    if (!selection.length) return;
    if (onCanvas) removeNodes(selection);
    else if (collection) deleteRefs(collection.id, selection, () => setSelection([]));
  };

  const showPreview = (refs: Reference[], refId: string, from: PreviewFrom) =>
    setPreview({
      refs,
      index: Math.max(
        0,
        refs.findIndex((ref) => ref.id === refId),
      ),
      from,
    });
  const openPreview = (refIds: string[], refId: string, from: PreviewFrom) =>
    showPreview(
      refIds.flatMap((id) => library.refs[id] ?? []),
      refId,
      from,
    );
  const openRoundPreview = (reference: Reference) =>
    showPreview(
      session?.iterations.find((iteration) => iteration.results.some((result) => result.id === reference.id))
        ?.results ?? [],
      reference.id,
      "round",
    );
  const dropFromPreview = (reference: Reference) =>
    setPreview((current) => {
      const refs = current?.refs.filter((ref) => ref.id !== reference.id) ?? [];
      return refs.length ? { ...current!, refs, index: Math.min(current!.index, refs.length - 1) } : null;
    });
  const removeFromPreview = (from: Exclude<PreviewFrom, "round">, reference: Reference) => {
    if ("collectionId" in from) return deleteRefs(from.collectionId, [reference.id], () => dropFromPreview(reference));
    if ("boardOf" in from) {
      withUndo("Removed from the board", { type: "unpinned", ids: [reference.id] });
      return dropFromPreview(reference);
    }
    const owner = library.collections.find(
      (other) => other.spaceId === from.spaceId && other.refIds.includes(reference.id),
    );
    const loose = library.spaces.some(
      (other) => other.id === from.spaceId && other.nodes.some((node) => node.id === `r:${reference.id}`),
    );
    if (!loose && owner) return deleteRefs(owner.id, [reference.id], () => dropFromPreview(reference));
    withUndo("Reference deleted", { type: "nodes-removed", ids: [`r:${reference.id}`] });
    dropFromPreview(reference);
  };
  const from = preview?.from;
  const previewRemove =
    from && from !== "round" ? (reference: Reference) => removeFromPreview(from, reference) : undefined;

  const showPane = (pane: Pane) => {
    if (detached.includes(pane)) return focusWindow(windowLabel(pane));
    if (ui.panes[pane] && (!expanded || expanded === pane)) return;
    reflow(() => {
      dispatch({ type: "ui-changed", ui: { panes: { ...ui.panes, [pane]: true } } });
      setMaximized(null);
    });
  };
  const togglePane = (which: Pane) => {
    const panes = { ...ui.panes, [which]: !ui.panes[which] };
    const next = (["map", "board", "catalog"] satisfies Pane[]).find(
      (other) => panes[other] && !detached.includes(other),
    );
    if (!next) return;
    reflow(() => {
      dispatch({ type: "ui-changed", ui: { panes } });
      setMaximized(null);
      setPane(panes[which] ? which : pane === which ? next : pane);
    });
  };
  const expand = (which: Pane | null) => {
    keepCenterOnResize();
    reflow(() => {
      setMaximized(which);
      if (which) setPane(which);
    });
  };
  const focusPane = (which: Pane) => {
    showPane(which);
    if (!detached.includes(which)) setPane(which);
  };
  const dock = (which: Pane) => {
    closeWindow(windowLabel(which));
    keepCenterOnResize();
    reflow(() => {
      setDetached((current) => current.filter((other) => other !== which));
      setPane(which);
    });
  };
  const detach = (which: Pane) => {
    if (docked.length < 2 || !docked.includes(which)) return;
    openWindow(windowLabel(which), windowUrl(which), `${paneLabel(which)} · Ganymede`, () => dock(which));
    keepCenterOnResize();
    reflow(() => {
      setDetached((current) => [...current, which]);
      setMaximized(null);
      if (pane === which) setPane(docked.find((other) => other !== which)!);
    });
  };

  const onMessage = useEffectEvent((message: Message) => {
    if (message.kind === "action") return apply(message.action);
    if (message.kind === "selection") {
      heard.current = message.selection;
      return setSelection(message.selection);
    }
    if (message.kind === "carry") return setCarried(message.refIds);
    if (solo) return;
    if (message.kind === "hello") return post({ kind: "state", pane: message.pane, state, selection });
    if (message.kind === "dock") return dock(message.pane);
    if (message.kind !== "search") return;
    focusWindow();
    const from = library.collections.find((other) => other.id === message.collectionId) ?? null;
    if (message.prompt === undefined) return goSearch(from?.id);
    if (message.filters) setFilters(message.filters);
    searchCatalog(message.prompt, from, message.filters);
  });
  useEffect(() => listen(onMessage), []);

  const focusPrompt = () => {
    if (promptInput.current) promptInput.current.focus();
    else if (onCanvas) {
      focusPane("catalog");
      setCatalogFocus((tick) => tick + 1);
    } else return false;
    return true;
  };

  const shortcut = (key: string): boolean => {
    const visible = docked.length;
    const run: Record<string, (() => void) | false> = {
      b: !solo && (() => reflow(() => dispatch({ type: "ui-changed", ui: { sidebar: !ui.sidebar } }))),
      z:
        !!toast?.undo &&
        (() => {
          toast.undo?.();
          setToast(null);
        }),
      f: !!(session || collection || onCanvas) && (() => focusPrompt()),
    };
    if (!session && collection) {
      run.o = () => importImages(collection.id);
      run.a = () => setSelection(collection.refIds);
    }
    if (!session && onCanvas && space && !solo) {
      run["1"] = () => focusPane("board");
      run["2"] = () => focusPane("map");
      run["3"] = () => focusPane("catalog");
      run.m = visible > 1 && (() => togglePane(pane));
      run.enter = visible > 1 && (() => expand(expanded ? null : pane));
    }
    if (!session && onCanvas && space) {
      if (pane !== "board") {
        run.n = () => newCollection(space.id);
        run.o = () => importImages(pane === "catalog" ? catalogCollection?.id : undefined);
      }
      if (pane === "map")
        run.a = () => setSelection([...endpointsOf(space, library.collections)].filter((id) => !id.startsWith("c:")));
    }
    const action = run[key];
    if (action) action();
    return !!action;
  };
  const openPanel = (collectionId: string) => {
    setSelection([`c:${collectionId}`]);
    showPane("catalog");
  };
  const pickCollection = (id: string) => {
    const picked = library.collections.find((other) => other.id === id);
    const target = library.spaces.find((other) => other.id === picked?.spaceId);
    const node = target?.nodes.find((other) => other.id === `c:${id}`);
    if (!picked || !target || !node) return;
    const same = space?.id === target.id && onCanvas;
    if (!same) navigate({ kind: "space", id: target.id });
    setSelection([node.id]);
    setGliding(same);
    centering.current = node.id;
    showPane("catalog");
  };

  const copyOut = (owned: Collection) => {
    dispatch({ type: "collection-copied", id: owned.id, newId: newId() });
    notify(`“${displayName(owned)}” copied to Collections`);
  };

  const dropNodes = (target: HTMLElement, nodeIds: string[], point: Point) => {
    const [kind, id] = (target.dataset.drop ?? "").split(":");
    const owned = kind === "collection" && library.collections.find((other) => other.id === id)?.spaceId === space?.id;
    const images = nodeIds.filter((nodeId) => nodeId.startsWith("r:") || parseDot(nodeId));
    if (owned) return dispatch({ type: "refs-joined", collectionId: id, ids: images });
    const refIds = nodeIds.flatMap((nodeId) =>
      nodeId.startsWith("r:")
        ? [nodeId.slice(2)]
        : nodeId.startsWith("c:") && kind === "board"
          ? refsOf(library, nodeId.slice(2)).map((ref) => ref.id)
          : (parseDot(nodeId)?.refId ?? []),
    );
    addRefs(
      [...new Set(refIds)].flatMap((refId) => library.refs[refId] ?? []),
      target,
      point,
    );
  };

  const keys = {
    onCanvas,
    back: collection?.spaceId && !selection.length ? () => backToSpace(collection) : undefined,
    open:
      onCanvas && selection.length === 1 && selection[0].startsWith("c:")
        ? () => openCollection(selection[0].slice(2))
        : undefined,
    search: view.kind !== "home" && !session ? goSearch : undefined,
  };

  const targetOf = (event: Event) =>
    event.target instanceof Element ? event.target.closest<HTMLElement>("[data-drop]") : null;
  const onDragOver = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    const target = targetOf(event);
    if (event.dataTransfer) event.dataTransfer.dropEffect = target ? "copy" : "none";
    markDropTarget(target);
  });
  const onDrop = useEffectEvent((event: DragEvent) => {
    event.preventDefault();
    markDropTarget(null);
    const target = targetOf(event);
    if (!target || !event.dataTransfer) return;
    const point = { x: event.clientX, y: event.clientY };
    const payload = payloadOf(event.dataTransfer);
    if (payload && "collectionId" in payload) return dropCollection(payload.collectionId, target, point);
    if (payload && "nodeIds" in payload) return dropNodes(target, payload.nodeIds, point);
    if (payload)
      return addRefs(
        payload.refIds.flatMap((id) => library.refs[id] ?? []),
        target,
        point,
      );
    void importAll(readTransfer(event.dataTransfer)).then((added) =>
      added.length ? addRefs(added, target, point) : notify("Drop image files or direct image links"),
    );
  });
  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    if (!event.clipboardData || session) return;
    const transfer = readTransfer(event.clipboardData);
    const prompt = promptInput.current;
    const urlInPrompt = event.target === prompt && !prompt?.value.trim() && transfer.urls.length > 0;
    if (isEditable(event.target) && !transfer.files.length && !urlInPrompt) return;
    if (!transfer.files.length && !transfer.urls.length) return;
    event.preventDefault();
    void importAll(transfer).then((added) =>
      added.length ? addRefs(added, null) : notify("Paste an image or a direct image link"),
    );
  });
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (preview || confirm) return;
    const mapKeys = !keys.onCanvas || pane === "map";
    const mod = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
    if (mod && event.key.toLowerCase() === "k") {
      event.preventDefault();
      return keys.search?.();
    }
    if (event.key === "Escape" && session) return conclude();
    if (isEditable(event.target)) return;
    if (mod && shortcut(event.key.toLowerCase())) return event.preventDefault();
    if (event.key === "Escape" && keys.back) return keys.back();
    if (event.key === "Enter" && keys.open && mapKeys && !session && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      return keys.open();
    }
    const single = !event.ctrlKey && !event.metaKey && !event.altKey;
    const key = event.key.toLowerCase();
    if (single && !session && keys.onCanvas && (pane === "map" || pane === "board") && (key === "h" || key === "s")) {
      event.preventDefault();
      return (pane === "board" ? setBoardTool : setMapTool)(key === "h" ? "hand" : "select");
    }
    const onGrid =
      event.target === document.body || (event.target instanceof Element && event.target.closest("[aria-pressed]"));
    if (session && onGrid && event.key === "Enter") {
      event.preventDefault();
      return void runSearch();
    }
    if (session && event.key === " " && hovered.current) {
      event.preventDefault();
      return openRoundPreview(hovered.current);
    }
    if (event.key === "Escape" && mapKeys) return setSelection([]);
    if ((event.key === "Delete" || event.key === "Backspace") && !session && mapKeys) return removeSelection();
    const typing = event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (typing && (!keys.onCanvas || pane === "catalog")) promptInput.current?.focus();
  });
  useEffect(() => {
    const dragOver = (event: DragEvent) => onDragOver(event);
    const drop = (event: DragEvent) => onDrop(event);
    const paste = (event: ClipboardEvent) => onPaste(event);
    const keyDown = (event: KeyboardEvent) => onKeyDown(event);
    const clear = () => markDropTarget(null);
    const contextMenu = (event: MouseEvent) => !isEditable(event.target) && event.preventDefault();
    window.addEventListener("contextmenu", contextMenu);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", keyDown);
    const unfollow = followDrag(dragOver, clear);
    return () => {
      unfollow();
      window.removeEventListener("contextmenu", contextMenu);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
      window.removeEventListener("keydown", keyDown);
    };
  }, []);

  const target = session?.target.collectionId;
  const placeholderOf = (from: Collection | undefined) => {
    const fallback = searchContext(from)?.fallback;
    return from?.prompt
      ? `Enter to search more: ${clip(from.prompt, from.refIds.length ? 34 : 52)}`
      : from?.name
        ? `What should we search for ${from.name}?`
        : fallback
          ? `Enter to search for ${clip(fallback, 48)}`
          : "Describe what you are looking for";
  };
  const placeholder = session ? "What are you looking for?" : placeholderOf(collection);
  const frame = (bounds: Box | null) => {
    if (!space || !main.current || !bounds) return;
    setGliding(true);
    dispatch({
      type: "viewport-changed",
      viewport: fitBounds(bounds, { width: main.current.clientWidth, height: main.current.clientHeight }),
    });
  };
  const zoomMap = (factor?: number) => {
    if (!space || !main.current) return;
    setGliding(true);
    const center = { x: main.current.clientWidth / 2, y: main.current.clientHeight / 2 };
    dispatch({
      type: "viewport-changed",
      viewport: zoomAt(space.viewport, center, factor ?? 1 / space.viewport.scale),
    });
  };

  const catalog = paneSpace && (
    <>
      {catalogCollection ? (
        <CollectionCatalog
          key={catalogCollection.id}
          collection={catalogCollection}
          refs={refsOf(library, catalogCollection.id)}
          onPreview={(refIds, refId, collectionId) => openPreview(refIds, refId, { collectionId })}
          onDeleteRefs={(refIds, done) => deleteRefs(catalogCollection.id, refIds, done)}
        />
      ) : (
        <p className="px-10 pt-24 text-center text-balance text-muted">
          This space's collections show up here, one at a time. Describe below what to search for to create one.
        </p>
      )}
      {(solo ? space !== undefined : onCanvas) && !session && (
        <PromptBar
          inputRef={promptInput}
          value={draft}
          onChange={setDraft}
          filters={filters}
          onFilters={setFilters}
          onSubmit={() => searchCatalog()}
          onDismiss={() => promptInput.current?.blur()}
          onImport={catalogCollection && (() => importImages(catalogCollection.id))}
          placeholder={placeholderOf(catalogCollection)}
          focusKey={catalogFocus ? `catalog:${catalogFocus}` : undefined}
          className="bottom-3 w-[min(720px,calc(100%-1.5rem))]"
        />
      )}
    </>
  );

  return (
    <div className="flex h-full gap-2 p-2">
      {!solo && (
        <div
          className="flex"
          onPointerDownCapture={(event) => session && !closest(event.target, "[data-stay]") && cancelSearch()}
        >
          <Sidebar
            library={library}
            view={view}
            dispatch={dispatch}
            onNavigate={navigate}
            onDelete={(kind, id) => {
              const target = library.collections.find((other) => other.id === id);
              if (kind === "space") deleteSpace(id);
              else if (target) deleteCollection(target);
            }}
            onAddToSpace={(collectionId) => space && copyToSpace(collectionId, space.id)}
            onCopyOut={(collectionId) => {
              const target = library.collections.find((other) => other.id === collectionId);
              if (target) copyOut(target);
            }}
            onSearch={() => goSearch()}
            onNewCollection={newCollection}
            onPick={pickCollection}
            onHover={setSpotlight}
            picked={onCanvas ? (catalogCollection?.id ?? null) : null}
            collapsed={!ui.sidebar}
            onCollapse={() => reflow(() => dispatch({ type: "ui-changed", ui: { sidebar: !ui.sidebar } }))}
          />
        </div>
      )}

      <div
        className="relative min-w-0 flex-1"
        style={{ viewTransitionName: entrance === "main" ? "world" : undefined }}
      >
        {view.kind === "home" && !solo && (
          <div className="absolute inset-0 overflow-hidden rounded-xl border border-line bg-bg">
            <SearchPage
              library={library}
              initial={searchFrom}
              filters={filters}
              onFilters={setFilters}
              onStart={startSearch}
            />
          </div>
        )}
        {paneSpace && (solo || view.kind !== "home") && (
          <Workspace
            space={paneSpace}
            panes={solo ? { ...ui.panes, [solo.pane]: true } : ui.panes}
            layout={solo ? solo.pane : ui.layout}
            onLayout={(layout) => dispatch({ type: "ui-changed", ui: { layout } })}
            active={pane}
            onActivate={setPane}
            onToggle={togglePane}
            expanded={expanded}
            onExpand={expand}
            covered={solo ? !space : !onCanvas || session !== null}
            detached={solo ? PANES.filter((other) => other !== solo.pane) : detached}
            onDetach={solo || !isTauri() ? undefined : detach}
            onDock={solo && (() => post({ kind: "dock", pane: solo.pane }))}
            board={
              <Board
                key={paneSpace.id}
                space={paneSpace}
                refs={library.refs}
                dispatch={dispatch}
                inert={solo ? !space : session !== null || !onCanvas || (expanded !== null && expanded !== "board")}
                active={pane === "board"}
                tool={boardTool}
                onTool={setBoardTool}
                onPreview={(refIds, refId) => openPreview(refIds, refId, { boardOf: paneSpace.id })}
                onUnpin={(ids) => {
                  const items = ids.filter((id) => !id.startsWith("link:")).length;
                  const message = items
                    ? items === 1
                      ? "Removed from the board"
                      : `${items} removed from the board`
                    : ids.length === 1
                      ? "Connection removed"
                      : `${ids.length} connections removed`;
                  withUndo(message, { type: "unpinned", ids });
                }}
              />
            }
            map={
              <div ref={main} className="absolute inset-0">
                <Graph
                  key={paneSpace.id}
                  space={paneSpace}
                  library={library}
                  selection={onCanvas || solo ? selection : []}
                  onSelect={setSelection}
                  dispatch={dispatch}
                  onOpenCollection={openCollection}
                  onOpenPanel={openPanel}
                  gliding={gliding}
                  onGlideEnd={() => setGliding(false)}
                  inert={solo ? !space : session !== null || !onCanvas}
                  hidden={!solo && (!onCanvas || (expanded !== null && expanded !== "map"))}
                  onPreview={(refIds, refId) => openPreview(refIds, refId, { spaceId: paneSpace.id })}
                  onRemove={removeNodes}
                  spotlight={onCanvas && !solo ? spotlight : null}
                  tool={mapTool}
                  onTool={setMapTool}
                  active={pane === "map"}
                  onFit={frame}
                  onZoom={zoomMap}
                />
                {(solo ? space !== undefined : onCanvas && !session) && !paneSpace.nodes.length && (
                  <Welcome onSearch={() => (solo ? post({ kind: "search" }) : goSearch())} />
                )}
                {(solo || (onCanvas && !session)) && selection.some((id) => !id.startsWith("c:")) && (
                  <SelectionBar count={selection.length} onRemove={removeSelection} onClear={() => setSelection([])} />
                )}
              </div>
            }
            catalog={catalog}
            catalogTitle={
              catalogCollection && (
                <CollectionSwitch
                  collection={catalogCollection}
                  others={owned}
                  tintOf={(id) => collectionTint(id, refsOf(library, id))}
                  onSwitch={pickCollection}
                />
              )
            }
          />
        )}
        {collection && !solo && (
          <div className="absolute inset-0 z-1 overflow-hidden rounded-xl border border-line bg-bg">
            <LibraryView
              key={collection.id}
              collection={collection}
              refs={refsOf(library, collection.id)}
              selection={selection}
              onSelect={setSelection}
              onPreview={(refIds, refId) => openPreview(refIds, refId, { collectionId: collection.id })}
              onRename={(name) => dispatch({ type: "renamed", kind: "collection", id: collection.id, name })}
              arriving={arriving?.collectionId === collection.id ? arriving.refIds : null}
              onDeleteRefs={(refIds, done) => deleteRefs(collection.id, refIds, done)}
              within={
                space && collection.spaceId ? { space: space.name, onSpace: () => backToSpace(collection) } : undefined
              }
            />
          </div>
        )}
        {(session || collection) && !solo && (
          <PromptBar
            inputRef={promptInput}
            value={draft}
            onChange={setDraft}
            filters={filters}
            onFilters={setFilters}
            onSubmit={() => runSearch()}
            onDismiss={() => {
              if (session) return;
              if (collection?.spaceId && !draft.trim()) backToSpace(collection);
              else promptInput.current?.blur();
            }}
            onImport={collection && !session ? () => importImages(collection.id) : undefined}
            placeholder={placeholder}
            focusKey={`${session ? "session" : ""}:${collection?.id ?? ""}`}
          />
        )}
        {toast && (
          <Toast
            key={toast.id}
            toast={toast}
            raised={!solo && Boolean(session || collection)}
            onDismiss={() => setToast(null)}
          />
        )}
        {session && !solo && (
          <SearchLayer
            session={session}
            flying={target !== undefined}
            round={round}
            onReveal={reveal}
            onFail={(ref) => dispatch({ type: "result-failed", id: ref.id })}
            onToggle={(ref) => dispatch({ type: "approval-toggled", ref })}
            onMore={() => runSearch()}
            onConclude={conclude}
            onPreview={openRoundPreview}
            onHover={(ref) => (hovered.current = ref)}
          />
        )}
        {session && !solo && (
          <ApprovedRail
            approved={session.approved}
            onRemove={(ref) => dispatch({ type: "approval-toggled", ref })}
            onOpen={(ref) => showPreview(session.approved, ref.id, "round")}
          />
        )}
      </div>

      {preview && (
        <Preview
          refs={preview.refs}
          index={preview.index}
          onIndex={(index) => setPreview((current) => current && { ...current, index })}
          onClose={() => setPreview(null)}
          onRemove={previewRemove}
          approval={
            preview.from === "round" && session
              ? {
                  approved: new Set(session.approved.map((ref) => ref.id)),
                  onToggle: (ref) => dispatch({ type: "approval-toggled", ref }),
                }
              : undefined
          }
        />
      )}
      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
      {carried && <CarryGhost refs={carried.flatMap((id) => library.refs[id] ?? [])} />}
      {BENCH_ON && <FrameHud />}
    </div>
  );
}
