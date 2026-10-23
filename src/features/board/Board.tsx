import {
  type Dispatch,
  memo,
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
import { Icon } from "../../components/Icon";
import { needsSharp, Picture } from "../../components/Picture";
import { Toolbar, viewShortcut } from "../../components/Toolbar";
import { carry, dropTargetAt, endCarry, followDrag, markDropTarget } from "../../lib/drag";
import { newId, toggle } from "../../lib/library";
import { pickImages } from "../../lib/images";
import { openExternal } from "../../lib/api";
import { fitBounds, MIN_SCALE, pixelDensity, zoomAt } from "../../lib/camera";
import { closest, isEditable, MOD } from "../../lib/platform";
import type { Action } from "../../state";
import type { Box, BoardLink, BoardNote, Pin, Point, Reference, Space, Viewport } from "../../types";
import { usePanZoom } from "../../lib/usePanZoom";
import { landing, linkPath, NOTE, PIN, pinHeight, restingTilt, tiltFromId } from "./pins";

export type BoardTool = "hand" | "select";
const BOARD_TOOLS = [
  { id: "hand", icon: "hand", label: "Move", keys: "H" },
  { id: "select", icon: "marquee", label: "Select area", keys: "S" },
] as const satisfies { id: BoardTool; icon: string; label: string; keys: string }[];

const DRAG_THRESHOLD = 3;
const TRASH_REACH = 12;
const MAX_ZOOM = 1;
const LINK_MARGIN = 160;
const ARROW_HEAD = 8;
const HANDLES = [
  { left: "50%", top: 0 },
  { left: "100%", top: "50%" },
  { left: "50%", top: "100%" },
  { left: 0, top: "50%" },
];

type Item = { id: string; x: number; y: number; w: number; h: number; angle: number } & (
  { kind: "pin"; source: Pin } | { kind: "note"; source: BoardNote }
);

type Grip = "move" | "resize";

type Gesture =
  | { kind: "pan"; startX: number; startY: number; moved: boolean }
  | { kind: "place"; startX: number; startY: number; moved: boolean }
  | {
      kind: "move";
      startX: number;
      startY: number;
      moved: boolean;
      origins: Item[];
      pick?: string;
      native?: boolean;
    }
  | { kind: "resize"; startX: number; startY: number; moved: boolean; origin: Item }
  | { kind: "marquee"; startX: number; startY: number; moved: boolean; base: string[] }
  | { kind: "link"; startX: number; startY: number; moved: boolean; from: string };

interface Props {
  space: Space;
  refs: Record<string, Reference>;
  dispatch: Dispatch<Action>;
  inert: boolean;
  active: boolean;
  tool: BoardTool;
  onTool(tool: BoardTool): void;
  onPreview(refIds: string[], refId: string): void;
  onUnpin(ids: string[]): void;
}

const roundTenth = (value: number) => Math.round(value * 10) / 10;
const radians = (angle: number) => (angle * Math.PI) / 180;

const withinZoom = (view: Viewport, anchor: Point = { x: 0, y: 0 }) =>
  view.scale > MAX_ZOOM
    ? zoomAt(view, anchor, MAX_ZOOM / view.scale, MIN_SCALE, MAX_ZOOM)
    : view.scale < MIN_SCALE
      ? zoomAt(view, anchor, MIN_SCALE / view.scale)
      : view;

const placementOf = ({ x, y, w, angle }: Item) => ({ x, y, w, angle: roundTenth(angle) });

function extentOf({ x, y, w, h, angle }: Item) {
  const [c, s] = [Math.abs(Math.cos(radians(angle))), Math.abs(Math.sin(radians(angle)))];
  const [ex, ey] = [(w * c + h * s) / 2, (w * s + h * c) / 2];
  const [cx, cy] = [x + w / 2, y + h / 2];
  return { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey };
}

function frameOf(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((box) => box.x)) - LINK_MARGIN;
  const y = Math.min(...boxes.map((box) => box.y)) - LINK_MARGIN;
  return {
    x,
    y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) + LINK_MARGIN - x,
    h: Math.max(...boxes.map((box) => box.y + box.h)) + LINK_MARGIN - y,
  };
}

type Spot = { clientX: number; clientY: number; target: EventTarget | null };
type Release = { clientX: number; clientY: number; type: string; shiftKey: boolean };

export function Board({ space, refs, dispatch, inert, active, tool, onTool, onPreview, onUnpin }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const camera = usePanZoom(
    surface,
    space.board.viewport,
    (viewport: Viewport) => dispatch({ type: "board-viewport-changed", viewport }),
    undefined,
    undefined,
    withinZoom,
  );
  const view = camera.view;
  useEffect(() => {
    const inside = withinZoom(space.board.viewport);
    if (inside !== space.board.viewport) dispatch({ type: "board-viewport-changed", viewport: inside });
  }, [space.board.viewport, dispatch]);
  const gesture = useRef<Gesture | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [live, setLive] = useState<Map<string, Item> | null>(null);
  const [grip, setGrip] = useState<Grip | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ refIds: string[]; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [trashing, setTrashing] = useState<"off" | "armed" | "over">("off");
  const trash = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [linking, setLinking] = useState<{ from: string; to: string | null; at: Point } | null>(null);
  const [placing, setPlacing] = useState<{ tool: BoardTool; at: Point | null } | null>(null);
  if (placing && (placing.tool !== tool || !active)) setPlacing(null);
  const pointer = useRef<Point | null>(null);

  const items = useMemo<Item[]>(
    () => [
      ...space.board.pins.flatMap((pin): Item[] =>
        refs[pin.refId]
          ? [
              {
                id: pin.refId,
                kind: "pin",
                x: pin.x,
                y: pin.y,
                w: pin.w,
                h: pinHeight(pin.w, refs[pin.refId]),
                angle: restingTilt(pin.angle),
                source: pin,
              },
            ]
          : [],
      ),
      ...(space.board.notes ?? []).map((note): Item => ({
        id: note.id,
        kind: "note",
        x: note.x,
        y: note.y,
        w: note.w,
        h: note.w,
        angle: restingTilt(note.angle),
        source: note,
      })),
    ],
    [space.board.pins, space.board.notes, refs],
  );
  const stacking = useMemo(() => new Map(items.map((item, i) => [item.id, i])), [items]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const drawn = useMemo(() => [...items].sort((a, b) => (a.id < b.id ? -1 : 1)), [items]);
  const pinItems = items.filter((item) => item.kind === "pin");
  const itemOf = (id: string) => byId.get(id);
  const links = space.board.links ?? [];

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!active || isEditable(event.target)) return;
    if (event.ctrlKey || event.metaKey) {
      if (!event.altKey && !document.querySelector("[role=dialog], dialog[open]") && shortcut(event.key.toLowerCase()))
        event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      setSelection([]);
      setPlacing(null);
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selection.length) {
      onUnpin(selection);
      setSelection([]);
    }
  });
  useEffect(() => {
    const key = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const present = [...items, ...links].map((item) => item.id).join("\n");
  useEffect(() => setSelection((current) => current.filter((id) => present.split("\n").includes(id))), [present]);

  const commit = (changed: Item[]) => {
    const pins = changed.flatMap((item) => (item.kind === "pin" ? [{ ...item.source, ...placementOf(item) }] : []));
    // the drag began before the textarea blurred, so the gesture holds the note's text from before the edit
    const notes = changed.flatMap((item) => {
      const note = item.kind === "note" && space.board.notes?.find((other) => other.id === item.id);
      return note ? [{ ...note, ...placementOf(item) }] : [];
    });
    if (pins.length) dispatch({ type: "pins-changed", pins });
    if (notes.length) dispatch({ type: "notes-changed", notes });
  };

  const notes = useRef(space.board.notes);
  notes.current = space.board.notes;
  const finishNote = useCallback(
    (id: string, text: string) => {
      setEditing(null);
      const note = notes.current?.find((other) => other.id === id);
      if (note && text !== note.text) dispatch({ type: "notes-changed", notes: [{ ...note, text }] });
    },
    [dispatch],
  );

  const worldOf = (event: { clientX: number; clientY: number }): Point => {
    const rect = surface.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - view.x) / view.scale,
      y: (event.clientY - rect.top - view.y) / view.scale,
    };
  };

  const addNote = (center: Point) => {
    const id = `note:${newId()}`;
    dispatch({
      type: "note-added",
      note: {
        id,
        x: Math.round(center.x - NOTE.w / 2),
        y: Math.round(center.y - NOTE.w / 2),
        w: NOTE.w,
        text: "",
        angle: tiltFromId(id),
      },
    });
    setSelection([id]);
    setEditing(id);
    setPlacing(null);
  };

  const outside = (event: { clientX: number; clientY: number }) =>
    dropTargetAt(event.clientX, event.clientY, (element) => surface.current!.contains(element));

  const linkTarget = (event: { clientX: number; clientY: number }, from: string) => {
    const id = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-pin]")?.dataset.pin;
    return id && id !== from ? id : null;
  };

  const overTrash = (event: { clientX: number; clientY: number }) => {
    const box = trash.current?.getBoundingClientRect();
    return (
      !!box &&
      event.clientX >= box.left - TRASH_REACH &&
      event.clientX <= box.right + TRASH_REACH &&
      event.clientY >= box.top - TRASH_REACH &&
      event.clientY <= box.bottom + TRASH_REACH
    );
  };

  const resized = (origin: Item, w: number): Item => {
    const h = origin.kind === "pin" ? pinHeight(w, refs[origin.id]) : w;
    const [cos, sin] = [Math.cos(radians(origin.angle)), Math.sin(radians(origin.angle))];
    const [dw, dh] = [(w - origin.w) / 2, (h - origin.h) / 2];
    const [cx, cy] = [origin.x + origin.w / 2 + dw * cos - dh * sin, origin.y + origin.h / 2 + dw * sin + dh * cos];
    return { ...origin, w, h, x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) };
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.button !== 0 && event.button !== 1) || closest(event.target, "button, textarea, [role=toolbar]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    camera.settle();
    const corner = closest(event.target, "[data-corner]")?.dataset.corner;
    const handle = closest(event.target, "[data-handle]")?.dataset.handle;
    const link = closest<SVGElement>(event.target, "[data-link]")?.dataset.link;
    const id = closest(event.target, "[data-pin]")?.dataset.pin;
    const start = { startX: event.clientX, startY: event.clientY, moved: false };
    if (placing && event.button === 0) {
      gesture.current = { kind: "place", ...start };
      camera.grab();
    } else if (handle && event.button === 0) {
      gesture.current = { kind: "link", ...start, from: handle };
    } else if (link && event.button === 0) {
      setSelection(event.shiftKey ? toggle(selection, link) : [link]);
    } else if (!id && event.button === 0 && (tool === "select" || event.shiftKey)) {
      const rect = surface.current!.getBoundingClientRect();
      gesture.current = {
        kind: "marquee",
        ...start,
        startX: event.clientX - rect.left,
        startY: event.clientY - rect.top,
        base: event.shiftKey ? selection : [],
      };
    } else if (event.button === 1 || !id) {
      gesture.current = { kind: "pan", ...start };
      camera.grab();
      setPanning(true);
    } else if (corner) {
      gesture.current = { kind: "resize", ...start, origin: itemOf(corner)! };
    } else {
      const picked = event.shiftKey ? toggle(selection, id) : selection.includes(id) ? selection : [id];
      setSelection(picked);
      gesture.current = picked.includes(id)
        ? {
            kind: "move",
            ...start,
            origins: picked.flatMap((other) => itemOf(other) ?? []),
            pick: event.shiftKey ? undefined : id,
          }
        : null;
    }
  };

  const onPointerMove = (event: Spot) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    if (placing) setPlacing({ ...placing, at: closest(event.target, "[role=toolbar]") ? null : worldOf(event) });
    const drag = gesture.current;
    if (!drag) return;
    if (drag.kind === "marquee") {
      const rect = surface.current!.getBoundingClientRect();
      const [x, y] = [event.clientX - rect.left, event.clientY - rect.top];
      if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      const box = {
        x: Math.min(drag.startX, x),
        y: Math.min(drag.startY, y),
        w: Math.abs(x - drag.startX),
        h: Math.abs(y - drag.startY),
      };
      setMarquee(box);
      const hits = items.filter((item) => {
        const { x0, y0, x1, y1 } = extentOf(item);
        const [left, top, right, bottom] = [
          view.x + x0 * view.scale,
          view.y + y0 * view.scale,
          view.x + x1 * view.scale,
          view.y + y1 * view.scale,
        ];
        return left < box.x + box.w && right > box.x && top < box.y + box.h && bottom > box.y;
      });
      return setSelection([...new Set([...drag.base, ...hits.map((item) => item.id)])]);
    }
    const [dx, dy] = [event.clientX - drag.startX, event.clientY - drag.startY];
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    if (drag.kind === "pan" || drag.kind === "place") return camera.drag(event, dx, dy);
    if (drag.kind === "link")
      return setLinking({ from: drag.from, to: linkTarget(event, drag.from), at: worldOf(event) });
    setGrip(drag.kind);
    if (drag.kind === "resize") {
      const { origin } = drag;
      const [cos, sin] = [Math.cos(radians(origin.angle)), Math.sin(radians(origin.angle))];
      const [lx, ly] = [dx * cos + dy * sin, -dx * sin + dy * cos];
      const w = Math.max(
        origin.kind === "pin" ? PIN.min : NOTE.min,
        origin.w + (lx + ly / (origin.h / origin.w)) / 2 / view.scale,
      );
      return setLive(new Map([[origin.id, resized(origin, Math.round(w))]]));
    }
    const doomed = overTrash(event);
    setTrashing(doomed ? "over" : "armed");
    const pinsHeld = drag.origins.filter((item) => item.kind === "pin");
    const away = doomed || !pinsHeld.length ? null : outside(event);
    markDropTarget(away);
    setGhost(away ? { refIds: pinsHeld.map((item) => item.id), x: event.clientX, y: event.clientY } : null);
    setLive(
      away
        ? null
        : new Map(
            drag.origins.map((item) => [
              item.id,
              { ...item, x: Math.round(item.x + dx / view.scale), y: Math.round(item.y + dy / view.scale) },
            ]),
          ),
    );
  };

  const reset = () => {
    gesture.current = null;
    setLive(null);
    setGhost(null);
    setPanning(false);
    setMarquee(null);
    setTrashing("off");
    setGrip(null);
    setLinking(null);
    markDropTarget(null);
  };

  const onPointerUp = (event: Release) => {
    const drag = gesture.current;
    const moved = live;
    reset();
    if (!drag) return;
    if (drag.kind === "place") {
      if (!drag.moved && event.type === "pointerup") addNote(worldOf(event));
      return camera.release();
    }
    if (drag.kind === "link") {
      const to = event.type === "pointerup" ? linkTarget(event, drag.from) : null;
      if (to) dispatch({ type: "board-linked", link: { id: `link:${newId()}`, from: drag.from, to } });
      return;
    }
    if (drag.kind === "marquee") return !drag.moved && !event.shiftKey && setSelection([]);
    if (drag.kind === "pan") {
      if (!drag.moved && !event.shiftKey) setSelection([]);
      return camera.release();
    }
    if (!drag.moved) {
      if (drag.kind === "move" && drag.pick) setSelection([drag.pick]);
      return;
    }
    if (drag.kind === "move" && event.type === "pointerup" && overTrash(event)) {
      setSelection([]);
      return onUnpin(drag.origins.map((item) => item.id));
    }
    if (!moved) return;
    commit([...moved.values()].map((item) => (drag.kind === "move" ? { ...item, angle: landing() } : item)));
  };

  const carrying = () => gesture.current?.kind === "move" && gesture.current.native === true;
  const onDragStart = (event: React.DragEvent) => {
    const drag = gesture.current;
    const pins = drag?.kind === "move" ? drag.origins.filter((item) => item.kind === "pin") : [];
    if (drag?.kind !== "move" || !pins.length) return event.preventDefault();
    drag.native = true;
    const refIds = pins.map((item) => item.id);
    carry(event, { refIds }, refIds);
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
    onPointerUp({ clientX: event.clientX, clientY: event.clientY, type: "pointerup", shiftKey: event.shiftKey });
  };
  const onDragEnd = () => {
    endCarry();
    if (carrying()) reset();
  };
  const dragElsewhere = useEffectEvent((event: DragEvent) => carrying() && onPointerMove(event));
  const dragGone = useEffectEvent(() => {
    if (!carrying()) return;
    setLive(null);
    setGhost(null);
    setTrashing("armed");
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

  const onDoubleClick = (event: React.MouseEvent) => {
    if (closest(event.target, "textarea, button, [role=toolbar], [data-link], [data-handle]")) return;
    const id = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-pin]")?.dataset.pin;
    const item = id ? itemOf(id) : undefined;
    if (!item) return;
    if (item.kind === "note") return setEditing(item.id);
    onPreview(
      pinItems.map((pin) => pin.id),
      item.id,
    );
  };

  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    if (closest(event.target, "[role=toolbar]")) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const link = hit?.closest<SVGElement>("[data-link]")?.dataset.link;
    const id = hit?.closest<HTMLElement>("[data-pin]")?.dataset.pin;
    const item = id ? itemOf(id) : undefined;
    const at = { x: event.clientX, y: event.clientY };
    if (link) {
      setSelection([link]);
      return setMenu({
        ...at,
        entries: [{ label: "Remove connection", icon: "trash", hint: "Del", onSelect: () => onUnpin([link]) }],
      });
    }
    if (!item) {
      const point = worldOf(event);
      return setMenu({
        ...at,
        entries: [{ label: "New note here", icon: "note", hint: `${MOD}N`, onSelect: () => addNote(point) }],
      });
    }
    const picked = selection.includes(item.id) ? selection : [item.id];
    if (!selection.includes(item.id)) setSelection([item.id]);
    const reference = refs[item.id];
    setMenu({
      ...at,
      entries: [
        item.kind === "note"
          ? { label: "Edit", icon: "pencil", hint: "Double-click", onSelect: () => setEditing(item.id) }
          : {
              label: "Enlarge",
              icon: "eye",
              hint: "Double-click",
              onSelect: () =>
                onPreview(
                  pinItems.map((pin) => pin.id),
                  item.id,
                ),
            },
        ...(item.kind === "pin" && /^https?:/.test(reference.sourceUrl)
          ? [
              {
                label: "Open original page",
                icon: "external",
                onSelect: () => openExternal(reference.sourceUrl),
              } satisfies MenuEntry,
            ]
          : []),
        "separator",
        {
          label: picked.length > 1 ? `Remove ${picked.length} from the board` : "Remove from the board",
          icon: "trash",
          hint: "Del",
          onSelect: () => onUnpin(picked),
        },
      ],
    });
  };

  const fit = () => {
    const chosen = selection.length ? items.filter((item) => selection.includes(item.id)) : items;
    const box = surface.current;
    if (!chosen.length || !box) return;
    const extents = chosen.map(extentOf);
    const x = Math.min(...extents.map((e) => e.x0));
    const y = Math.min(...extents.map((e) => e.y0));
    const w = Math.max(...extents.map((e) => e.x1)) - x;
    const h = Math.max(...extents.map((e) => e.y1)) - y;
    dispatch({
      type: "board-viewport-changed",
      viewport: fitBounds({ x, y, w, h }, { width: box.clientWidth, height: box.clientHeight }),
    });
  };
  const zoom = (factor?: number) => {
    const box = surface.current;
    if (box)
      dispatch({
        type: "board-viewport-changed",
        viewport: zoomAt(
          view,
          { x: box.clientWidth / 2, y: box.clientHeight / 2 },
          factor ?? 1 / view.scale,
          MIN_SCALE,
          MAX_ZOOM,
        ),
      });
  };
  const centerOfView = (): Point => {
    const box = surface.current;
    return {
      x: ((box?.clientWidth ?? 0) / 2 - view.x) / view.scale,
      y: ((box?.clientHeight ?? 0) / 2 - view.y) / view.scale,
    };
  };
  const importHere = () =>
    void pickImages().then((added) => added.length && dispatch({ type: "pinned", refs: added, at: centerOfView() }));

  const shortcut = (key: string) => {
    if (key === "n")
      addNote(pointer.current ? worldOf({ clientX: pointer.current.x, clientY: pointer.current.y }) : centerOfView());
    else if (key === "o") importHere();
    else if (key === "a") setSelection(items.map((item) => item.id));
    else return viewShortcut(key, fit, zoom);
    return true;
  };

  const pixels = pixelDensity(view.scale);
  const picked = new Set(selection);
  const head = ARROW_HEAD / view.scale;
  const boxOf = (id: string) => live?.get(id) ?? itemOf(id);
  const drawnLinks = links.flatMap((link) => {
    const [a, b] = [boxOf(link.from), boxOf(link.to)];
    return a && b ? [{ link, a, b }] : [];
  });
  const source = linking && boxOf(linking.from);
  const reach: Box | null = linking && ((linking.to && boxOf(linking.to)) || { ...linking.at, w: 0, h: 0 });

  return (
    <div
      ref={surface}
      data-drop="board"
      inert={inert}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onPointerLeave={() => {
        pointer.current = null;
        if (placing) setPlacing({ ...placing, at: null });
      }}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      className={`absolute inset-0 touch-none overflow-hidden ${panning ? "cursor-grabbing" : linking || placing ? "cursor-crosshair" : tool === "hand" ? "cursor-grab" : ""}`}
    >
      <div className="absolute top-0 left-0" style={{ translate: `${view.x}px ${view.y}px` }}>
        <div className="relative origin-top-left" style={{ scale: view.scale, "--zoom": view.scale }}>
          {drawnLinks.length > 0 && (
            <LinkLayer frame={frameOf(drawnLinks.flatMap(({ a, b }) => [a, b]))} z={-1}>
              {drawnLinks.map(({ link, a, b }) => (
                <LinkPath key={link.id} link={link} d={linkPath(a, b, head)} selected={picked.has(link.id)} />
              ))}
            </LinkLayer>
          )}
          {drawn.map((original) => {
            const item = live?.get(original.id) ?? original;
            const held = live?.has(original.id) ?? false;
            const level = stacking.get(original.id)!;
            return (
              <ItemNode
                key={original.id}
                item={item}
                reference={refs[original.id]}
                z={held ? items.length + level : level}
                selected={picked.has(original.id)}
                lifted={held && grip === "move"}
                doomed={held && grip === "move" && trashing === "over"}
                instant={grip === "resize"}
                editing={editing === original.id}
                target={linking?.to === original.id}
                pixels={pixels}
                onText={finishNote}
              />
            );
          })}
          {source && reach && (
            <LinkLayer frame={frameOf([source, reach])} z={2 * items.length + 1}>
              <path
                d={linkPath(source, reach, head)}
                className="fill-none stroke-fg"
                style={{ strokeWidth: "calc(1.75px / var(--zoom))" }}
              />
            </LinkLayer>
          )}
          {placing?.at && (
            <div
              aria-hidden
              className="note-paper pointer-events-none absolute top-0 left-0 animate-fade-in opacity-60"
              style={{
                translate: `${placing.at.x - NOTE.w / 2}px ${placing.at.y - NOTE.w / 2}px`,
                width: NOTE.w,
                height: NOTE.w,
                zIndex: 2 * items.length + 2,
                borderRadius: PIN.radius,
                "--fold": `${Math.round(NOTE.w * NOTE.fold)}px`,
              }}
            >
              <div className="note-sheet absolute inset-0" style={{ padding: PIN.frame }}>
                <div className="note-card size-full" />
              </div>
            </div>
          )}
        </div>
      </div>
      {!items.length && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 animate-fade-in px-10 text-center text-balance text-muted">
          Drag your references here.
        </p>
      )}
      {marquee && (
        <div
          className="pointer-events-none absolute top-0 left-0 rounded-sm border border-fg/40 bg-fg/5"
          style={{ translate: `${marquee.x}px ${marquee.y}px`, width: marquee.w, height: marquee.h }}
        />
      )}
      {!inert && (
        <Toolbar
          active={active && !placing}
          tools={BOARD_TOOLS}
          tool={tool}
          onTool={onTool}
          actions={[
            {
              icon: "note",
              label: "New note",
              keys: `${MOD}N`,
              pressed: !!placing,
              onClick: () => setPlacing(placing ? null : { tool, at: null }),
            },
            { icon: "image", label: "Images from your computer", keys: `${MOD}O`, onClick: importHere },
          ]}
          zoom={{
            scale: view.scale,
            range: [MIN_SCALE, MAX_ZOOM],
            onFit: fit,
            fitLabel: selection.length ? "Fit selection" : "Fit all",
            onActual: () => zoom(),
          }}
        />
      )}
      {!inert && (
        <div
          ref={trash}
          aria-hidden
          onPointerDown={(event) => event.stopPropagation()}
          className={`pointer-events-none absolute right-3 bottom-3 z-30 grid size-11 place-items-center rounded-xl border shadow-float transition-[opacity,scale,translate,background-color,color,border-color] duration-200 ease-swift ${
            trashing === "over"
              ? "scale-125 animate-wiggle border-transparent bg-danger text-white opacity-100"
              : trashing === "armed"
                ? "border-danger/60 bg-surface text-danger opacity-100"
                : "translate-y-2 scale-75 border-line bg-surface text-danger opacity-0"
          }`}
        >
          <Icon name="trash" size={18} />
        </div>
      )}
      {ghost && <DragGhost refs={ghost.refIds.flatMap((id) => refs[id] ?? [])} x={ghost.x} y={ghost.y} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  );
}

function LinkLayer({ frame, z, children }: { frame: Box; z: number; children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute overflow-visible text-fg/45"
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, zIndex: z }}
      viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
    >
      {children}
    </svg>
  );
}

function LinkPath({ link, d, selected }: { link: BoardLink; d: string; selected: boolean }) {
  return (
    <g
      data-link={link.id}
      className={`pointer-events-auto cursor-pointer transition-colors duration-150 ${selected ? "text-fg" : "hover:text-fg/75"}`}
    >
      <path d={d} className="fill-none stroke-transparent" style={{ strokeWidth: "calc(14px / var(--zoom))" }} />
      <path
        d={d}
        className="fill-none stroke-current"
        style={{
          strokeWidth: `calc(${selected ? 2.25 : 1.5}px / var(--zoom))`,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }}
      />
    </g>
  );
}

interface NodeProps {
  item: Item;
  reference: Reference | undefined;
  z: number;
  selected: boolean;
  lifted: boolean;
  doomed: boolean;
  instant: boolean;
  editing: boolean;
  target: boolean;
  pixels: number;
  onText(id: string, text: string): void;
}

const ItemNode = memo(function ItemNode({
  item,
  reference,
  z,
  selected,
  lifted,
  doomed,
  instant,
  editing,
  target,
  pixels,
  onText,
}: NodeProps) {
  const note = item.kind === "note" ? item.source : null;
  return (
    <div
      data-pin={item.id}
      draggable={item.kind === "pin"}
      className="group absolute top-0 left-0 animate-place"
      style={{
        translate: `${item.x}px ${item.y}px`,
        width: item.w,
        height: item.h,
        zIndex: z,
        // the stagger is for the board opening; a note just placed lands at once
        animationDelay: editing ? undefined : `${Math.min(z, 12) * 18}ms`,
      }}
    >
      <div
        data-lifted={lifted ? "" : undefined}
        className={`absolute inset-0 ${note ? "note-paper" : "pin-paper"} ${selected ? "selected" : target ? "link-target" : ""} ${
          instant ? "" : "transition-[translate,scale,rotate,opacity,box-shadow,filter] duration-[380ms] ease-spring"
        } ${doomed ? "scale-90 opacity-60" : lifted ? "-translate-y-1.5 scale-[1.04]" : ""}`}
        style={{
          rotate: `${item.angle}deg`,
          padding: note ? undefined : PIN.frame,
          borderRadius: PIN.radius,
          "--fold": `${Math.round(item.w * NOTE.fold)}px`,
        }}
      >
        {note ? (
          <div className="note-sheet absolute inset-0" style={{ padding: PIN.frame }}>
            <div className="note-card size-full overflow-hidden">
              {editing ? (
                <textarea
                  autoFocus
                  data-scroll
                  defaultValue={note.text}
                  placeholder="Write…"
                  onBlur={(event) => onText(item.id, event.currentTarget.value)}
                  onKeyDown={(event) => event.key === "Escape" && event.currentTarget.blur()}
                  className="note-scroll note-text block size-full resize-none bg-transparent outline-none select-text placeholder:text-(--note-ink)/45"
                />
              ) : (
                <div
                  data-scroll
                  className="note-scroll note-text size-full overflow-y-auto break-words whitespace-pre-wrap"
                >
                  {note.text || <span className="opacity-45">Empty note</span>}
                </div>
              )}
            </div>
          </div>
        ) : (
          reference && (
            <div className="relative size-full overflow-hidden rounded-[4px] bg-skeleton">
              <Picture
                reference={reference}
                sharp={needsSharp(reference, (item.w - 2 * PIN.frame) * pixels)}
                alt={reference.alt ?? reference.title ?? ""}
              />
            </div>
          )
        )}
        <div
          data-corner={item.id}
          title="Resize"
          className={`absolute right-0 bottom-0 cursor-nwse-resize rounded-full border-[1.5px] border-fg/60 bg-surface transition-opacity duration-150 ${
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          style={{
            width: "calc(12px / var(--zoom))",
            height: "calc(12px / var(--zoom))",
            translate: "50% 50%",
            borderWidth: "calc(1.5px / var(--zoom))",
          }}
        />
      </div>
      {!lifted &&
        HANDLES.map((at, i) => (
          <div
            key={i}
            data-handle={item.id}
            title="Drag to another item to connect"
            className="group/handle absolute grid cursor-crosshair place-items-center opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            style={{
              ...at,
              width: "calc(24px / var(--zoom))",
              height: "calc(24px / var(--zoom))",
              translate: "-50% -50%",
            }}
          >
            <span
              className="rounded-full border-fg/60 bg-surface transition-[scale,background-color,border-color] duration-200 ease-spring group-hover/handle:scale-150 group-hover/handle:border-primary-ink group-hover/handle:bg-primary"
              style={{
                width: "calc(9px / var(--zoom))",
                height: "calc(9px / var(--zoom))",
                borderWidth: "calc(1.5px / var(--zoom))",
              }}
            />
          </div>
        ))}
    </div>
  );
});
