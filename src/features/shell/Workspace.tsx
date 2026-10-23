import { type CSSProperties, type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { arrange, dock, type Edge, even, type Gap, minAlong, type Rect, resized, splitAt, type Tile } from "./layout";
import { MOD } from "../../lib/platform";
import type { Pane, Ui } from "../../state";
import { keepCenterOnResize } from "../../lib/usePanZoom";

const DRAG_THRESHOLD = 4;
const ROOT_REACH = 28;
const EDGE_REACH = 0.3;
const SETTLE_MS = 240;

const PANE_INFO: { pane: Pane; label: string; icon: IconName }[] = [
  { pane: "board", label: "Board", icon: "board" },
  { pane: "map", label: "Map", icon: "map" },
  { pane: "catalog", label: "Collection", icon: "grid" },
];
export const PANES = PANE_INFO.map((item) => item.pane);
export const paneLabel = (pane: Pane) => PANE_INFO.find((item) => item.pane === pane)!.label;

const same = (a: Tile, b: Tile) => JSON.stringify(a) === JSON.stringify(b);
const clamp = (value: number, min: number, max: number) =>
  min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value));
const inside = (rect: Rect, x: number, y: number) =>
  x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
const place = (rect: Rect): CSSProperties => ({ left: rect.x, top: rect.y, width: rect.w, height: rect.h });

function nearest(rect: Rect, x: number, y: number, relative = true): { edge: Edge; distance: number } {
  const [w, h] = relative ? [rect.w, rect.h] : [1, 1];
  const sides: [Edge, number][] = [
    ["left", (x - rect.x) / w],
    ["right", (rect.x + rect.w - x) / w],
    ["top", (y - rect.y) / h],
    ["bottom", (rect.y + rect.h - y) / h],
  ];
  const [edge, distance] = sides.reduce((best, side) => (side[1] < best[1] ? side : best));
  return { edge, distance };
}

interface Props {
  space: { id: string; name: string };
  panes: Ui["panes"];
  layout: Tile;
  onLayout(layout: Tile): void;
  active: Pane;
  onActivate(pane: Pane): void;
  onToggle(pane: Pane): void;
  expanded: Pane | null;
  onExpand(pane: Pane | null): void;
  covered: boolean;
  detached: Pane[];
  onDetach?(pane: Pane): void;
  onDock?(): void;
  board: ReactNode;
  map: ReactNode;
  catalog: ReactNode;
  catalogTitle?: ReactNode;
}

type Dragging = { pane: Pane; x: number; y: number; layout: Tile };

export function Workspace({
  space,
  panes,
  layout,
  onLayout,
  active,
  onActivate,
  onToggle,
  expanded,
  onExpand,
  covered,
  detached,
  onDetach,
  onDock,
  board,
  map,
  catalog,
  catalogTitle,
}: Props) {
  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<Tile | null>(null);
  const [drag, setDrag] = useState<Dragging | null>(null);
  const [moving, setMoving] = useState(false);
  const shown = (pane: Pane) => panes[pane] && !detached.includes(pane);
  const count = PANE_INFO.filter((item) => shown(item.pane)).length;
  const box = { x: 0, y: 0, w: size.w, h: size.h };
  const { panes: rects, gaps } = arrange(drag?.layout ?? live ?? layout, shown, box);

  useLayoutEffect(() => {
    const element = area.current!;
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const resize = (gap: Gap) => (event: PointerEvent<HTMLDivElement>) => {
    const split = splitAt(layout, gap.path);
    if (!split) return;
    const gutter = event.currentTarget;
    gutter.setPointerCapture(event.pointerId);
    const row = gap.axis === "row";
    const start = row ? event.clientX : event.clientY;
    const [a, b] = [split.sizes[gap.before], split.sizes[gap.after]];
    const low = minAlong(split.children[gap.before], gap.axis, shown) / gap.unit;
    const high = a + b - minAlong(split.children[gap.after], gap.axis, shown) / gap.unit;
    let next: Tile | null = null;
    gutter.onpointermove = (move) => {
      const before = clamp(a + ((row ? move.clientX : move.clientY) - start) / gap.unit, low, high);
      next = resized(layout, gap.path, { [gap.before]: before, [gap.after]: a + b - before });
      setLive(next);
    };
    gutter.onpointerup = gutter.onpointercancel = () => {
      gutter.onpointermove = gutter.onpointerup = gutter.onpointercancel = null;
      setLive(null);
      if (next) onLayout(next);
    };
  };

  const arrangeAt = (
    pane: Pane,
    clientX: number,
    clientY: number,
    placed: Partial<Record<Pane, Rect>>,
  ): Tile | null => {
    const bounds = area.current!.getBoundingClientRect();
    const [x, y] = [clientX - bounds.left, clientY - bounds.top];
    if (!inside(box, x, y)) return null;
    const outer = nearest(box, x, y, false);
    if (outer.distance <= ROOT_REACH) return even(dock(layout, pane, { target: null, edge: outer.edge }));
    const over = PANE_INFO.find((item) => placed[item.pane] && inside(placed[item.pane]!, x, y))?.pane;
    if (!over) return null;
    if (over === pane) return layout;
    const side = nearest(placed[over]!, x, y);
    return even(dock(layout, pane, { target: over, edge: side.distance <= EDGE_REACH ? side.edge : "center" }));
  };

  const grab = (pane: Pane) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);
    const [x0, y0] = [event.clientX, event.clientY];
    const placed = arrange(layout, shown, box).panes;
    let moved = false;
    let candidate = layout;
    const finish = (commit: boolean) => {
      grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
      window.removeEventListener("keydown", escape, true);
      setDrag(null);
      window.setTimeout(() => setMoving(false), SETTLE_MS);
      if (same(candidate, layout)) return;
      keepCenterOnResize();
      if (commit) onLayout(candidate);
    };
    const escape = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.stopPropagation();
      finish(false);
    };
    window.addEventListener("keydown", escape, true);
    grip.onpointermove = (move) => {
      if (!moved && Math.hypot(move.clientX - x0, move.clientY - y0) < DRAG_THRESHOLD) return;
      if (!moved) setMoving(true);
      moved = true;
      const next = arrangeAt(pane, move.clientX, move.clientY, placed);
      if (next && !same(next, candidate)) {
        candidate = next;
        keepCenterOnResize();
      }
      setDrag({ pane, x: move.clientX, y: move.clientY, layout: candidate });
    };
    grip.onpointerup = () => finish(true);
    grip.onpointercancel = () => finish(false);
  };

  const content = { board, map, catalog };
  const dragged = drag && PANE_INFO.find((item) => item.pane === drag.pane);
  const minimized = PANE_INFO.filter((item) => !panes[item.pane] && !detached.includes(item.pane));

  return (
    <div className="flex size-full flex-col">
      <div ref={area} className="relative min-h-0 flex-1">
        {PANE_INFO.map(
          ({ pane }) =>
            shown(pane) &&
            rects[pane] && (
              <Card
                key={pane}
                pane={pane}
                place={space.name}
                title={pane === "catalog" ? catalogTitle : undefined}
                rect={expanded === pane ? box : rects[pane]}
                active={count > 1 && !expanded && active === pane && !covered}
                single={count === 1}
                chrome={!covered}
                expanded={expanded === pane}
                behind={expanded !== null && expanded !== pane}
                lifted={drag?.pane === pane}
                moving={moving}
                onActivate={onActivate}
                onMinimize={onToggle}
                onExpand={onExpand}
                onDetach={onDetach}
                onDock={onDock}
                onGrab={grab(pane)}
              >
                {content[pane]}
              </Card>
            ),
        )}
        {!expanded &&
          !drag &&
          gaps.map((gap) => (
            <Gutter key={`${gap.path.join(".")}:${gap.before}`} gap={gap} onPointerDown={resize(gap)} />
          ))}
        {drag && rects[drag.pane] && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-30 animate-fade-in rounded-xl border-[1.5px] border-(--focus-ring) bg-(--focus-ring)/10 transition-[left,top,width,height] duration-200 ease-swift"
            style={place(rects[drag.pane]!)}
          />
        )}
      </div>
      {minimized.length > 0 && (
        <div role="toolbar" aria-label="Minimized panels" className="flex h-10 shrink-0 items-end gap-1.5">
          {minimized.map(({ pane, label, icon }) => (
            <button
              key={pane}
              type="button"
              data-dock={pane}
              onClick={() => onToggle(pane)}
              title={`Restore ${label.toLowerCase()} (${MOD}${PANE_INFO.findIndex((item) => item.pane === pane) + 1})`}
              className="group/dock flex h-8 items-center gap-1.5 rounded-lg border border-line bg-bg pr-2 pl-2.5 text-xs font-medium text-muted transition-[color,translate,scale,border-color] duration-200 ease-spring hover:-translate-y-0.5 hover:border-fg/25 hover:text-fg active:scale-95"
            >
              <Icon name={icon} size={13} />
              {label}
              <span className="ml-0.5 grid transition-transform duration-200 ease-spring group-hover/dock:-translate-y-0.5">
                <Icon name="up" size={12} />
              </span>
            </button>
          ))}
        </div>
      )}
      {drag && dragged && (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-50 flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-fg shadow-float"
          style={{ translate: `${drag.x + 14}px ${drag.y + 10}px` }}
        >
          <Icon name={dragged.icon} size={14} />
          {dragged.label}
        </div>
      )}
    </div>
  );
}

interface CardProps {
  pane: Pane;
  place: string;
  title?: ReactNode;
  rect: Rect;
  active: boolean;
  single: boolean;
  chrome: boolean;
  expanded: boolean;
  behind: boolean;
  lifted: boolean;
  moving: boolean;
  onActivate(pane: Pane): void;
  onMinimize(pane: Pane): void;
  onExpand(pane: Pane | null): void;
  onDetach?(pane: Pane): void;
  onDock?(): void;
  onGrab(event: PointerEvent<HTMLButtonElement>): void;
  children: ReactNode;
}

const paneButton =
  "pointer-events-auto grid size-7 place-items-center rounded-md bg-bg text-muted transition-[opacity,color,background-color,scale] duration-150 group-hover/pane:opacity-100 hover:bg-skeleton hover:text-fg active:scale-90";

function Card({
  pane,
  place: where,
  title,
  rect,
  active,
  single,
  chrome,
  expanded,
  behind,
  lifted,
  moving,
  onActivate,
  onMinimize,
  onExpand,
  onDetach,
  onDock,
  onGrab,
  children,
}: CardProps) {
  const { label, icon } = PANE_INFO.find((item) => item.pane === pane)!;
  const name = label.toLowerCase();
  return (
    <section
      data-pane={pane}
      data-active={active ? "" : undefined}
      aria-label={label}
      inert={behind}
      onPointerDownCapture={() => onActivate(pane)}
      className={`group/pane absolute overflow-hidden rounded-xl border border-line bg-bg duration-200 ${
        moving
          ? "transition-[left,top,width,height,box-shadow,border-color,opacity] ease-swift"
          : "transition-[box-shadow,border-color,opacity]"
      } ${expanded ? "z-20" : behind ? "invisible" : ""} ${lifted ? "opacity-50" : ""}`}
      style={{
        ...place(rect),
        boxShadow: active ? "0 0 0 1px var(--focus-ring)" : undefined,
        borderColor: active ? "var(--focus-ring)" : undefined,
      }}
    >
      {children}
      {chrome && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex h-11 items-center justify-between gap-2 pr-2 pl-2">
          <span
            className={`flex h-6 min-w-0 items-center gap-1.5 rounded-md bg-bg pr-1.5 text-xs font-medium transition-colors duration-200 ${single || expanded ? "pl-1.5" : "pl-0.5"} ${active || expanded ? "text-fg" : "text-muted"}`}
          >
            {!single && !expanded && (
              <button
                type="button"
                onPointerDown={onGrab}
                aria-label={`Move ${name}`}
                title="Drag to move"
                className="pointer-events-auto grid h-6 w-4 cursor-grab touch-none place-items-center rounded text-muted transition-colors duration-150 hover:bg-skeleton hover:text-fg active:cursor-grabbing"
              >
                <Icon name="grip" size={14} />
              </button>
            )}
            {expanded && (
              <span className="flex animate-slide-in items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onExpand(null)}
                  title={`Back to ${where}`}
                  className="pointer-events-auto max-w-56 truncate rounded px-0.5 text-muted transition-colors duration-150 hover:text-fg"
                >
                  {where}
                </button>
                <span className="text-muted">
                  <Icon name="right" size={12} />
                </span>
              </span>
            )}
            <span className="flex shrink-0 items-center gap-1.5">
              <Icon name={icon} size={13} />
              {label}
            </span>
            {title && (
              <>
                <span className="shrink-0 text-muted">
                  <Icon name="right" size={12} />
                </span>
                {title}
              </>
            )}
            <span
              className={`size-1.5 shrink-0 rounded-full bg-primary-ink transition-[opacity,scale] duration-200 ${active ? "opacity-100" : "scale-0 opacity-0"}`}
            />
          </span>
          {onDock && (
            <button
              type="button"
              onClick={onDock}
              aria-label={`Return ${name} to the main window`}
              title="Back to the main window"
              className={`${paneButton} opacity-60`}
            >
              <Icon name="dock" size={14} />
            </button>
          )}
          {!single && (
            <span
              className={`flex shrink-0 gap-0.5 ${expanded ? "" : "opacity-60 group-hover/pane:opacity-100"} transition-opacity duration-150`}
            >
              {!expanded && onDetach && (
                <button
                  type="button"
                  onClick={() => onDetach(pane)}
                  aria-label={`Open ${name} in its own window`}
                  title="Open in a new window"
                  className={paneButton}
                >
                  <Icon name="popout" size={14} />
                </button>
              )}
              {!expanded && (
                <button
                  type="button"
                  onClick={() => onMinimize(pane)}
                  aria-label={`Minimize ${name}`}
                  title={`Minimize (${MOD}M)`}
                  className={paneButton}
                >
                  <Icon name="minimize" size={15} />
                </button>
              )}
              <button
                type="button"
                onClick={() => onExpand(expanded ? null : pane)}
                aria-label={expanded ? `Restore ${name}` : `${label} full screen`}
                title={`${expanded ? "Restore" : "Full screen"} (${MOD}Enter)`}
                className={paneButton}
              >
                <Icon name={expanded ? "restore" : "maximize"} size={14} />
              </button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}

function Gutter({ gap, onPointerDown }: { gap: Gap; onPointerDown(event: PointerEvent<HTMLDivElement>): void }) {
  const row = gap.axis === "row";
  return (
    <div
      onPointerDown={onPointerDown}
      className={`group absolute touch-none ${row ? "cursor-col-resize" : "cursor-row-resize"}`}
      style={place(gap.rect)}
    >
      <span
        className={`absolute rounded-full transition-colors duration-150 group-hover:bg-fg/20 group-active:bg-fg/35 ${
          row ? "inset-y-[38%] left-1/2 w-0.5 -translate-x-1/2" : "inset-x-[38%] top-1/2 h-0.5 -translate-y-1/2"
        }`}
      />
    </div>
  );
}
