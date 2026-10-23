import {
  type Dispatch,
  type PointerEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { ContextMenu, type MenuEntry } from "../../components/ContextMenu";
import { DragGhost } from "../../components/DragGhost";
import { Picture } from "../../components/Picture";
import { Toolbar, viewShortcut } from "../../components/Toolbar";
import { BENCH_ON, benchEdges } from "../../dev/bench";
import { type Edge, graphEdges, isTauri, mediaUrl, onMediaReady } from "../../lib/api";
import { fitBounds, limitView, MAX_SCALE, MIN_SCALE, zoomAt } from "../../lib/camera";
import { cssRgb, rgbOf } from "../../lib/color";
import { carry, dropTargetAt, endCarry, followDrag, markDropTarget } from "../../lib/drag";
import { srcOf } from "../../lib/images";
import { newId, toggle } from "../../lib/library";
import { closest, isEditable } from "../../lib/platform";
import { useGlide, usePanZoom } from "../../lib/usePanZoom";
import { watchFocus } from "../../lib/windows";
import type { Action } from "../../state";
import type { Box, Library, Point, Space, Viewport } from "../../types";
import { dotGrid } from "./geometry";
import type { LayoutIn, LayoutOut } from "./layout.worker";
import { displaySize, type Look, Renderer, type SceneData } from "./render";
import { adjacency, centers, NODE_SIZE, otherEnd, refOf, type Scene, sceneOf } from "./scene";

export type MapTool = "hand" | "select";

const MAP_TOOLS = [
  { id: "hand" as const, icon: "hand" as const, label: "Move", keys: "H" },
  { id: "select" as const, icon: "marquee" as const, label: "Select area", keys: "S" },
];

const DRAG_THRESHOLD = 4;
const HOVER_MS = 60;
const PEEK_MS = 1000;
const EDGES_DEBOUNCE_MS = 600;
const PERSIST_MS = 1500;
const PLACEHOLDER_ALPHA = 0.22;
const PACE = { idle: 30, active: 60, linger: 1200 };
const SLOW = { ms: 18, fast: 13, window: 1000, recover: 3000, levels: 2 };

type Gesture = { startX: number; startY: number; moved: boolean } & (
  | { kind: "pan" }
  | { kind: "marquee"; base: string[] }
  | { kind: "nodes"; indices: number[]; origin: Float32Array; pick: string | null; native?: boolean }
);
type Spot = { clientX: number; clientY: number; target: EventTarget | null };
type Release = { clientX: number; clientY: number; shiftKey: boolean };

interface Props {
  space: Space;
  library: Library;
  selection: string[];
  onSelect(ids: string[]): void;
  dispatch: Dispatch<Action>;
  onOpenCollection(collectionId: string): void;
  onOpenPanel(collectionId: string): void;
  gliding: boolean;
  onGlideEnd(): void;
  inert: boolean;
  hidden: boolean;
  onPreview(refIds: string[], refId: string): void;
  onRemove(ids: string[]): void;
  spotlight: string | null;
  tool: MapTool;
  onTool(tool: MapTool): void;
  active: boolean;
  onFit(bounds: Box | null): void;
  onZoom(factor?: number): void;
}

const readLook = (): Look & { ink: number } => {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: rgbOf(read("--bg", "#101010")),
    fg: rgbOf(read("--fg", "#ececec")),
    primary: rgbOf(read("--primary-ink", "#f2d98a")),
    font: getComputedStyle(document.body).fontFamily || "sans-serif",
    ink: Number(read("--ink-light", "1")) || 1,
  };
};

function useLook() {
  const [look, setLook] = useState(readLook);
  useEffect(() => {
    const observer = new MutationObserver(() => setLook(readLook()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return look;
}

export function Graph({
  space,
  library,
  selection,
  onSelect,
  dispatch,
  onOpenCollection,
  onOpenPanel,
  gliding,
  onGlideEnd,
  inert,
  hidden,
  onPreview,
  onRemove,
  spotlight,
  tool,
  onTool,
  active,
  onFit,
  onZoom,
}: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const worker = useRef<Worker | null>(null);
  const positions = useRef<Float32Array<ArrayBuffer>>(new Float32Array(0));
  const sceneRef = useRef<Scene | null>(null);
  const dataRef = useRef<SceneData | null>(null);
  const look = useLook();
  const sizeRef = useRef({ width: 0, height: 0 });
  const [peek, setPeek] = useState(-1);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [ghost, setGhost] = useState<{ ids: string[]; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [knn, setKnn] = useState<{ key: string; pairs: Edge[] }>({ key: "", pairs: [] });
  const [mediaTick, setMediaTick] = useState(0);

  const hovered = useRef(-1);
  const candidate = useRef(-1);
  const hoverTimer = useRef(0);
  const peekTimer = useRef(0);
  const selectedFlags = useRef(new Uint8Array(0));
  const spotlighted = useRef<string | null>(null);
  const warming = useRef(false);
  const scattered = useRef(false);
  const touched = useRef(false);
  const refit = useRef(false);
  const onFitRef = useRef(onFit);
  onFitRef.current = onFit;
  const view = useRef<Viewport>(space.viewport);
  const engine = useRef({
    raf: 0,
    last: 0,
    once: false,
    activeUntil: 0,
    animating: false,
    paused: true,
    hz: -1,
    drift: true,
    quality: 0,
    slowSince: 0,
    fastSince: 0,
    frames: 0,
    total: 0,
  });

  const pace = (hz: number, drift: boolean) => {
    const state = engine.current;
    if (state.hz === hz && state.drift === drift) return;
    [state.hz, state.drift] = [hz, drift];
    worker.current?.postMessage({ type: "pace", hz, drift } satisfies LayoutIn);
  };

  const adapt = (now: number, interval: number) => {
    const state = engine.current;
    state.frames++;
    state.total += interval;
    if (state.total < SLOW.window) return;
    const mean = state.total / state.frames;
    [state.frames, state.total] = [0, 0];
    if (mean > SLOW.ms && state.quality < SLOW.levels) {
      state.quality++;
      state.fastSince = 0;
    } else if (mean < SLOW.fast && state.quality > 0) {
      state.fastSince ||= now;
      if (now - state.fastSince >= SLOW.recover) {
        state.quality--;
        state.fastSince = now;
      }
    } else state.fastSince = 0;
    if (renderer.current) renderer.current.quality = state.quality;
  };

  const drawRef = useRef<(now: number) => boolean>(() => false);
  const tick = useCallback((now: number) => {
    const state = engine.current;
    state.raf = 0;
    const busy = now < state.activeUntil || state.animating || !!gestureRef.current;
    if (state.paused && !state.once) return;
    const interval = now - state.last;
    if (state.once || busy || interval >= 1000 / PACE.idle - 4) {
      if (busy && !state.once && state.last) adapt(now, Math.min(interval, 250));
      state.once = false;
      state.animating = drawRef.current(now);
      state.last = now;
    }
    if (state.paused) return pace(0, false);
    const hz = (busy ? PACE.active : PACE.idle) / (state.quality >= 1 ? 2 : 1);
    pace(hz, state.quality < 2);
    state.raf = requestAnimationFrame(tick);
  }, []);
  const requestDraw = useCallback(() => {
    engine.current.once = true;
    engine.current.raf ||= requestAnimationFrame(tick);
  }, [tick]);
  const wake = useCallback(() => {
    engine.current.activeUntil = performance.now() + PACE.linger;
    requestDraw();
  }, [requestDraw]);

  const paint = useCallback(
    (next: Viewport) => {
      view.current = next;
      const dots = dotGrid(next);
      const style = surface.current?.style;
      style?.setProperty("--dot-step", String(dots.step));
      style?.setProperty("--dot-x", String(dots.x));
      style?.setProperty("--dot-y", String(dots.y));
      style?.setProperty("--dot-fade", String(dots.fade));
      wake();
    },
    [wake],
  );
  const camera = usePanZoom(
    surface,
    space.viewport,
    (viewport: Viewport) => dispatch({ type: "viewport-changed", viewport }),
    onGlideEnd,
    paint,
    (next: Viewport, anchor?: Point) => limitView(next, boundsOf(), sizeRef.current, anchor),
  );
  const shownView = useGlide(camera.view, gliding, onGlideEnd, paint, sizeRef.current);
  useEffect(() => {
    const inside = zoomAt(space.viewport, { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }, 1);
    if (inside.scale !== space.viewport.scale) dispatch({ type: "viewport-changed", viewport: inside });
  }, [space.viewport, dispatch]);
  const { x: shownX, y: shownY, scale: shownScale } = shownView;
  useEffect(() => paint({ x: shownX, y: shownY, scale: shownScale }), [paint, shownX, shownY, shownScale]);

  useEffect(() => {
    const element = surface.current!;
    const observer = new ResizeObserver(() => {
      sizeRef.current = { width: element.clientWidth, height: element.clientHeight };
      drawRef.current(performance.now());
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { id: spaceId, nodes: spaceNodes, places } = space;
  const { collections, refs } = library;
  const scene = useMemo(() => {
    const previous = sceneRef.current;
    const live = new Map<string, Point>();
    if (previous && positions.current.length === previous.nodes.length * 2) {
      previous.nodes.forEach(
        (node, i) =>
          Number.isFinite(positions.current[2 * i]) &&
          live.set(node.id, { x: positions.current[2 * i], y: positions.current[2 * i + 1] }),
      );
    }
    return sceneOf({ id: spaceId, nodes: spaceNodes, places }, { collections, refs }, live);
  }, [spaceId, spaceNodes, places, collections, refs]);

  const refKey = useMemo(() => [...new Set(scene.nodes.map((node) => node.refId))].join("\n"), [scene.nodes]);
  useEffect(() => {
    const refIds = refKey ? refKey.split("\n") : [];
    if (!refIds.length) return setKnn({ key: refKey, pairs: [] });
    if (!isTauri()) return setKnn({ key: refKey, pairs: BENCH_ON ? benchEdges(refIds) : [] });
    let alive = true;
    const timer = setTimeout(
      () => {
        void graphEdges(spaceId, refIds).then(
          (pairs) => alive && setKnn({ key: refKey, pairs }),
          () => alive && setKnn((current) => (current.key === refKey ? current : { key: refKey, pairs: [] })),
        );
      },
      mediaTick ? EDGES_DEBOUNCE_MS : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [refKey, mediaTick, spaceId]);
  useEffect(
    () =>
      onMediaReady((ids) => {
        renderer.current?.retry(new Set(ids));
        setMediaTick((count) => count + 1);
        requestDraw();
      }),
    [requestDraw],
  );

  const sceneKey = scene.key;
  const edges = useMemo(() => {
    const nodesOf = new Map<string, number[]>();
    sceneKey.split("\n").forEach((id, i) => {
      const refId = refOf(id);
      if (refId) nodesOf.set(refId, [...(nodesOf.get(refId) ?? []), i]);
    });
    const ids = knn.key.split("\n");
    const pairs: number[] = [];
    const weights: number[] = [];
    for (const [a, b, w] of knn.pairs) {
      for (const i of nodesOf.get(ids[a]) ?? []) {
        for (const j of nodesOf.get(ids[b]) ?? []) {
          pairs.push(i, j);
          weights.push(w);
        }
      }
    }
    return { pairs: new Uint32Array(pairs), weights: new Float32Array(weights) };
  }, [knn, sceneKey]);

  const data = useMemo<SceneData>(() => {
    const tones = new Map<string, [string, string]>();
    const tone = (color: string) => {
      const known = tones.get(color);
      if (known) return known;
      const rgb = rgbOf(color, look.ink);
      return tones.set(color, [cssRgb(rgb), cssRgb(rgb, PLACEHOLDER_ALPHA)]).get(color)!;
    };
    const urlOf = (refId: string) => {
      if (isTauri()) return mediaUrl("thumb", refId);
      return srcOf(refs[refId]?.thumbUrl ?? "") || null;
    };
    return {
      count: scene.nodes.length,
      ids: scene.nodes.map((node) => node.id),
      refs: scene.nodes.map((node) => node.refId),
      urls: scene.nodes.map((node) => urlOf(node.refId)),
      colors: scene.nodes.map((node) => tone(node.color)[0]),
      fills: scene.nodes.map((node) => tone(node.color)[1]),
      aspect: Float32Array.from(scene.nodes, (node) => node.aspect),
      titles: scene.nodes.map((node) => refs[node.refId]?.title ?? refs[node.refId]?.alt ?? ""),
      edges: edges.pairs,
      weights: edges.weights,
      graph: adjacency(scene.nodes.length, edges.pairs),
    };
  }, [scene, edges, look, refs]);

  const persist = () => {
    const current = sceneRef.current;
    const p = positions.current;
    if (!current || p.length !== current.nodes.length * 2 || warming.current) return;
    const at: Record<string, Point> = {};
    current.nodes.forEach((node, i) => {
      if (Number.isFinite(p[2 * i])) at[node.id] = { x: Math.round(p[2 * i]), y: Math.round(p[2 * i + 1]) };
    });
    for (const [id, center] of centers(current, p))
      at[`c:${id}`] = { x: Math.round(center.x), y: Math.round(center.y) };
    dispatch({ type: "graph-settled", spaceId: space.id, positions: at });
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const persistTimer = useRef(0);
  const persistSoon = () => {
    clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => persistRef.current(), PERSIST_MS);
  };
  useEffect(
    () => () => {
      clearTimeout(persistTimer.current);
      persistRef.current();
    },
    [],
  );

  const boundsOf = (indices?: number[]): Box | null => {
    const current = sceneRef.current;
    const p = positions.current;
    if (!current || p.length !== current.nodes.length * 2) return null;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (i: number) => {
      const [x, y] = [p[2 * i], p[2 * i + 1]];
      if (!Number.isFinite(x)) return;
      [x0, y0, x1, y1] = [
        Math.min(x0, x - NODE_SIZE),
        Math.min(y0, y - NODE_SIZE),
        Math.max(x1, x + NODE_SIZE),
        Math.max(y1, y + NODE_SIZE),
      ];
    };
    if (indices?.length) indices.forEach(add);
    else for (let i = 0; i < current.nodes.length; i++) add(i);
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  useEffect(() => {
    const made = new Renderer(canvas.current!, requestDraw);
    renderer.current = made;
    return () => made.destroy();
  }, [requestDraw]);

  const loaded = useRef<{ key: string; edges: SceneData["edges"] | null }>({ key: "", edges: null });
  useEffect(() => {
    const made = new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
    made.onmessage = ({ data: message }: MessageEvent<LayoutOut>) => {
      const next = message.positions;
      if (next.length !== (sceneRef.current?.nodes.length ?? -1) * 2) return;
      const held = gestureRef.current;
      if (held?.kind === "nodes" && held.moved && positions.current.length === next.length) {
        for (const i of held.indices)
          [next[2 * i], next[2 * i + 1]] = [positions.current[2 * i], positions.current[2 * i + 1]];
      }
      const previous = positions.current;
      positions.current = next;
      renderer.current?.setPositions(next);
      if (previous.length === next.length)
        made.postMessage({ type: "give-back", positions: previous } satisfies LayoutIn, [previous.buffer]);
      if (message.first && warming.current) {
        warming.current = false;
        const box = boundsOf();
        const { width, height } = sizeRef.current;
        if (box && width) dispatch({ type: "viewport-changed", viewport: fitBounds(box, { width, height }) });
        if (canvas.current) canvas.current.style.opacity = "1";
        touched.current = false;
        refit.current = true;
        persistSoon();
      }
      if (message.calm && refit.current) {
        refit.current = false;
        if (!touched.current) onFitRef.current(boundsOf());
        persistSoon();
      }
      if (message.first) requestDraw();
    };
    worker.current = made;
    engine.current.hz = -1;
    return () => {
      made.terminate();
      worker.current = null;
      loaded.current = { key: "", edges: null };
    };
  }, [dispatch, requestDraw]);

  const syncScene = useEffectEvent(() => {
    const same = sceneRef.current?.key === scene.key;
    sceneRef.current = scene;
    dataRef.current = data;
    if (!same) {
      positions.current = Float32Array.from(scene.start);
      hovered.current = candidate.current = -1;
      scattered.current = scene.fresh > scene.nodes.length / 2;
    }
    if (selectedFlags.current.length !== scene.nodes.length) selectedFlags.current = new Uint8Array(scene.nodes.length);
    renderer.current?.setScene(data);
    renderer.current?.setPositions(positions.current);
    const warm = scattered.current;
    if (loaded.current.key !== scene.key && warm && knn.key !== refKey) {
      if (canvas.current) canvas.current.style.opacity = "0";
    } else if (loaded.current.key !== scene.key) {
      warming.current = warm;
      if (warm && canvas.current) canvas.current.style.opacity = "0";
      loaded.current = { key: scene.key, edges: data.edges };
      worker.current?.postMessage({
        type: "load",
        positions: positions.current,
        radius: Float32Array.from(scene.nodes, (node) => node.r),
        edges: data.edges,
        weights: data.weights,
        warm,
      } satisfies LayoutIn);
    } else if (loaded.current.edges !== data.edges) {
      loaded.current.edges = data.edges;
      worker.current?.postMessage({ type: "edges", edges: data.edges, weights: data.weights } satisfies LayoutIn);
      persistSoon();
    }
    updateFocus();
    requestDraw();
  });
  useEffect(() => syncScene(), [data]);

  useEffect(() => {
    renderer.current?.setLook(look);
    requestDraw();
  }, [look, requestDraw]);

  const updateFocus = useCallback(() => {
    const current = sceneRef.current;
    const graph = dataRef.current;
    if (!current || !graph) return;
    let lit: Uint8Array | null = null;
    const mark = (i: number) => ((lit ??= new Uint8Array(current.nodes.length))[i] = 1);
    const h = hovered.current;
    const collection = spotlighted.current;
    if (h >= 0 && h < current.nodes.length) {
      mark(h);
      for (let e = graph.graph.start[h]; e < graph.graph.start[h + 1]; e++)
        mark(otherEnd(graph.edges, graph.graph.edges[e], h));
    } else if (collection) current.collections.find((group) => group.id === collection)?.members.forEach(mark);
    renderer.current?.setFocus(lit, h, selectedFlags.current);
    wake();
  }, [wake]);

  useEffect(() => {
    const flags = new Uint8Array(scene.nodes.length);
    for (const id of selection) {
      const i = scene.index.get(id);
      if (i !== undefined) flags[i] = 1;
    }
    selectedFlags.current = flags;
    updateFocus();
  }, [selection, scene, updateFocus]);

  useEffect(() => {
    spotlighted.current = spotlight;
    updateFocus();
  }, [spotlight, updateFocus]);

  useEffect(() => {
    const state = engine.current;
    let focused = true;
    const update = () => {
      const paused = hidden || inert || document.hidden || !focused;
      if (paused === state.paused) return;
      state.paused = paused;
      if (paused) pace(0, false);
      else wake();
    };
    const stop = watchFocus((next) => {
      focused = next;
      update();
    });
    document.addEventListener("visibilitychange", update);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", update);
    };
  }, [hidden, inert, wake]);
  useEffect(
    () => () => {
      cancelAnimationFrame(engine.current.raf);
      engine.current.raf = 0;
    },
    [],
  );

  drawRef.current = (now) => {
    const { width, height } = sizeRef.current;
    if (!renderer.current || !width) return false;
    return renderer.current.draw({ view: view.current, width, height, now });
  };

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const toWorld = (point: Point) => ({
    x: (point.x - view.current.x) / view.current.scale,
    y: (point.y - view.current.y) / view.current.scale,
  });
  const pointOf = (i: number): Point => ({ x: positions.current[2 * i], y: positions.current[2 * i + 1] });
  const outside = (event: { clientX: number; clientY: number }) =>
    dropTargetAt(event.clientX, event.clientY, (element) => surface.current!.contains(element));
  const nodeAt = (event: { clientX: number; clientY: number }) => {
    const { x, y } = local(event);
    return renderer.current?.hit(x, y) ?? -1;
  };
  const idAt = (event: { clientX: number; clientY: number }) => {
    const i = nodeAt(event);
    return i >= 0 ? scene.nodes[i].id : null;
  };

  const collectLoose = () => {
    const id = newId();
    dispatch({
      type: "selection-collected",
      id,
      nodeIds: selection.filter((nodeId) => nodeId.startsWith("r:")),
    });
    onSelect([`c:${id}`]);
  };

  const peekSoon = (i: number) => {
    clearTimeout(peekTimer.current);
    setPeek(-1);
    if (i >= 0 && sceneRef.current?.nodes[i]) peekTimer.current = window.setTimeout(() => setPeek(i), PEEK_MS);
  };
  const setHover = (i: number) => {
    clearTimeout(hoverTimer.current);
    candidate.current = i;
    if (hovered.current === i) return;
    hovered.current = i;
    worker.current?.postMessage({ type: "hover", index: i } satisfies LayoutIn);
    if (surface.current) surface.current.dataset.pointing = String(i >= 0);
    peekSoon(i);
    updateFocus();
  };

  const begin = (next: Gesture | null) => {
    gestureRef.current = next;
    if (surface.current) surface.current.draggable = next?.kind === "nodes";
    setGesture(next);
    wake();
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      (event.button !== 0 && event.button !== 1) ||
      closest(event.target, "button, textarea, input, [role=toolbar], [role=menu]")
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    touched.current = true;
    camera.settle();
    peekSoon(-1);
    const start = { startX: event.clientX, startY: event.clientY, moved: false };
    const id = idAt(event);
    if (event.button === 1 || spaceHeld || (!id && tool === "hand" && !event.shiftKey)) {
      camera.grab();
      setPanning(true);
      return begin({ kind: "pan", ...start });
    }
    if (!id) return begin({ kind: "marquee", ...start, base: event.shiftKey ? selection : [] });
    const chosen = selection.includes(id) ? selection.filter((other) => scene.index.has(other)) : [id];
    const indices = chosen.map((other) => scene.index.get(other)!);
    begin({
      kind: "nodes",
      ...start,
      indices,
      origin: Float32Array.from(indices.flatMap((i) => [positions.current[2 * i], positions.current[2 * i + 1]])),
      pick: event.shiftKey ? null : id,
    });
    if (event.shiftKey) onSelect(toggle(selection, id));
  };

  const hoverAt = (event: Spot) => {
    const element = event.target instanceof Element ? event.target : null;
    const i = element?.closest("[role=toolbar]") ? -1 : nodeAt(event);
    if (i !== candidate.current) {
      candidate.current = i;
      clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(() => setHover(i), HOVER_MS);
    } else if (i === hovered.current) clearTimeout(hoverTimer.current);
  };

  const onPointerMove = (event: Spot) => {
    const drag = gestureRef.current;
    if (!drag) return hoverAt(event);
    const [dx, dy] = [event.clientX - drag.startX, event.clientY - drag.startY];
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      setGesture({ ...drag });
      if (drag.kind === "nodes") setHover(drag.indices[0]);
    }
    wake();
    if (drag.kind === "pan") return camera.drag(event, dx, dy);
    if (drag.kind === "marquee") {
      const rect = surface.current!.getBoundingClientRect();
      const [x0, y0] = [drag.startX - rect.left, drag.startY - rect.top];
      const [x1, y1] = [event.clientX - rect.left, event.clientY - rect.top];
      const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      setMarquee(box);
      const [a, b] = [toWorld({ x: box.x, y: box.y }), toWorld({ x: box.x + box.w, y: box.y + box.h })];
      const hits = scene.nodes.filter((_, i) => {
        const [x, y] = [positions.current[2 * i], positions.current[2 * i + 1]];
        return x >= a.x && x <= b.x && y >= a.y && y <= b.y;
      });
      return onSelect([...new Set([...drag.base, ...hits.map((node) => node.id)])]);
    }
    const away = outside(event);
    markDropTarget(away);
    setGhost(away ? { ids: drag.indices.map((i) => scene.nodes[i].id), x: event.clientX, y: event.clientY } : null);
    const [wx, wy] = [dx / view.current.scale, dy / view.current.scale];
    const moved: number[] = [];
    drag.indices.forEach((i, k) => {
      positions.current[2 * i] = drag.origin[2 * k] + wx;
      positions.current[2 * i + 1] = drag.origin[2 * k + 1] + wy;
      moved.push(positions.current[2 * i], positions.current[2 * i + 1]);
    });
    worker.current?.postMessage({ type: "hold", indices: drag.indices, positions: moved } satisfies LayoutIn);
  };

  const endGesture = (event: Release) => {
    const drag = gestureRef.current;
    begin(null);
    setPanning(false);
    setMarquee(null);
    setGhost(null);
    markDropTarget(null);
    if (!drag) return;
    if (drag.kind === "pan") {
      if (!drag.moved && !event.shiftKey) onSelect([]);
      return camera.release();
    }
    if (drag.kind === "marquee") {
      if (!drag.moved && !event.shiftKey) onSelect([]);
      return;
    }
    if (!drag.moved) {
      const i = drag.pick ? scene.index.get(drag.pick) : undefined;
      if (i !== undefined) previewNode(i);
      return;
    }
    setHover(nodeAt(event));
    peekSoon(hovered.current);
    worker.current?.postMessage({ type: "let-go", indices: drag.indices } satisfies LayoutIn);
    persistSoon();
  };

  const carrying = () => {
    const drag = gestureRef.current;
    return drag?.kind === "nodes" && drag.native ? drag : null;
  };
  const onDragStart = (event: React.DragEvent) => {
    const drag = gestureRef.current;
    if (drag?.kind !== "nodes") return event.preventDefault();
    drag.native = true;
    const ids = drag.indices.map((i) => scene.nodes[i].id);
    carry(
      event,
      { nodeIds: ids },
      ids.flatMap((id) => refOf(id) ?? []),
    );
  };
  const onDragOver = (event: React.DragEvent) => {
    if (!carrying()) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    onPointerMove(event);
  };
  const onDrop = (event: React.DragEvent) => {
    if (!carrying()) return;
    event.preventDefault();
    event.stopPropagation();
    endGesture(event);
  };
  const onDragEnd = () => {
    endCarry();
    const drag = carrying();
    if (!drag) return;
    begin(null);
    setGhost(null);
    markDropTarget(null);
    setHover(-1);
    const back: number[] = [];
    drag.indices.forEach((i, k) => {
      [positions.current[2 * i], positions.current[2 * i + 1]] = [drag.origin[2 * k], drag.origin[2 * k + 1]];
      back.push(drag.origin[2 * k], drag.origin[2 * k + 1]);
    });
    worker.current?.postMessage({ type: "hold", indices: drag.indices, positions: back } satisfies LayoutIn);
    worker.current?.postMessage({ type: "let-go", indices: drag.indices } satisfies LayoutIn);
  };
  const dragElsewhere = useEffectEvent((event: DragEvent) => carrying() && onPointerMove(event));
  const dragGone = useEffectEvent(() => {
    if (!carrying()) return;
    setGhost(null);
    markDropTarget(null);
  });
  useEffect(
    () =>
      followDrag(
        (event) => dragElsewhere(event),
        () => dragGone(),
      ),
    [],
  );

  const previewNode = (i: number) => {
    const node = scene.nodes[i];
    const group = node.collectionId ? scene.collections.find((other) => other.id === node.collectionId) : null;
    const members = group ? group.members : scene.nodes.flatMap((other, j) => (other.kind === "loose" ? [j] : []));
    onPreview(
      members.map((j) => scene.nodes[j].refId),
      node.refId,
    );
  };

  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (inert || closest(event.target, "[role=toolbar]")) return;
    const remove = (id: string): MenuEntry => ({
      label: "Delete",
      icon: "trash",
      hint: "Del",
      onSelect: () => onRemove([id]),
    });
    const id = idAt(event);
    const i = id === null ? undefined : scene.index.get(id);
    if (id === null || i === undefined) return;
    const { collectionId } = scene.nodes[i];
    const loose = selection.includes(id) ? selection.filter((other) => other.startsWith("r:")) : [];
    const entries: MenuEntry[] = [{ label: "Enlarge", icon: "eye", onSelect: () => previewNode(i) }];
    if (collectionId)
      entries.push(
        { label: "Open the collection", icon: "grid", onSelect: () => onOpenPanel(collectionId) },
        { label: "Collection full screen", icon: "expand", onSelect: () => onOpenCollection(collectionId) },
        {
          label: "Take out of the collection",
          icon: "release",
          onSelect: () => dispatch({ type: "dot-released", id, at: pointOf(i) }),
        },
      );
    if (loose.length > 1)
      entries.push({ label: `Group the ${loose.length} into a collection`, icon: "cluster", onSelect: collectLoose });
    entries.push("separator", remove(id));
    setHover(-1);
    setMenu({ x: event.clientX, y: event.clientY, entries });
  };

  const viewKeys = useRef({ fit: () => {}, zoom: onZoom });
  useEffect(() => {
    if (inert || !active) return;
    const down = (event: KeyboardEvent) => {
      if (event.key === " " && !isEditable(event.target) && !(event.target instanceof HTMLButtonElement))
        setSpaceHeld(true);
      if (
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        isEditable(event.target) ||
        document.querySelector("[role=dialog], dialog[open]")
      )
        return;
      if (viewShortcut(event.key.toLowerCase(), viewKeys.current.fit, viewKeys.current.zoom)) event.preventDefault();
    };
    const up = (event: KeyboardEvent) => event.key === " " && setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [inert, active]);

  const peekNode = peek >= 0 && peek === hovered.current && !gesture?.moved ? scene.nodes[peek] : null;
  const peekRef = peekNode?.refId ? library.refs[peekNode.refId] : undefined;
  const peekAt = peekNode
    ? {
        x: positions.current[2 * peek] * shownView.scale + shownView.x,
        y: positions.current[2 * peek + 1] * shownView.scale + shownView.y,
        r: (displaySize(shownView.scale) / 2) * 1.12,
      }
    : null;
  const selectedIndices = () => selection.flatMap((id) => scene.index.get(id) ?? []);
  viewKeys.current = { fit: () => onFit(boundsOf(selectedIndices())), zoom: onZoom };

  return (
    <div
      ref={surface}
      data-drop="canvas"
      inert={inert}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerLeave={() => !carrying() && setHover(-1)}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onWheel={() => (touched.current = true)}
      onContextMenu={onContextMenu}
      className={`absolute inset-0 touch-none overflow-hidden select-none ${
        panning
          ? "cursor-grabbing"
          : !inert && tool === "hand"
            ? "cursor-grab data-[pointing=true]:cursor-pointer"
            : "data-[pointing=true]:cursor-pointer"
      }`}
      style={{ visibility: hidden ? "hidden" : undefined }}
    >
      <div className="map-dots" />
      <canvas
        ref={canvas}
        className="pointer-events-none absolute inset-0 size-full transition-opacity duration-500 ease-out"
      />
      {peekRef && peekAt && (
        <div
          key={peek}
          className="pointer-events-none absolute z-20 w-56 origin-left animate-peek overflow-hidden rounded-xl bg-surface shadow-float"
          style={{ left: peekAt.x + peekAt.r + 12, top: peekAt.y - 80 }}
        >
          <div className="relative w-full" style={{ aspectRatio: `${peekRef.width || 4} / ${peekRef.height || 3}` }}>
            <Picture reference={peekRef} sharp={false} />
          </div>
          {(peekRef.title || peekRef.alt) && (
            <p className="truncate px-3 py-2 text-xs text-muted">{peekRef.title ?? peekRef.alt}</p>
          )}
        </div>
      )}
      {marquee && (
        <div
          className="pointer-events-none absolute rounded-sm border border-primary-ink bg-primary/10"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}
      {ghost && (
        <DragGhost
          refs={ghost.ids.flatMap((id) => {
            const refId = refOf(id);
            return refId && library.refs[refId] ? [library.refs[refId]] : [];
          })}
          x={ghost.x}
          y={ghost.y}
        />
      )}
      {!inert && (
        <Toolbar
          active={active}
          tools={MAP_TOOLS}
          tool={tool}
          onTool={onTool}
          actions={[]}
          zoom={{
            scale: shownView.scale,
            range: [MIN_SCALE, MAX_SCALE],
            onFit: viewKeys.current.fit,
            fitLabel: selection.length ? "Fit selection" : "Fit all",
            onActual: () => onZoom(),
          }}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  );
}
