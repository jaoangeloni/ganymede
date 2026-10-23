import { type MouseEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useColumnLag } from "./useColumnLag";
import { ContextMenu, type MenuEntry } from "../../components/ContextMenu";
import { Icon } from "../../components/Icon";
import { Picture } from "../../components/Picture";
import { startDrag } from "../../lib/drag";
import { openExternal } from "../../lib/api";
import { balanceColumns, masonry } from "./masonry";
import type { Reference } from "../../types";
import { Credit } from "../../components/Credit";

const GAP = 12;
const STAGGER = { items: 15, ms: 22 };
const ratioOf = (ref: Reference) => ref.width / ref.height;
const WINDOWED = 120;
const OPENING_MS = 700;
const RELAYOUT_MS = 120;

function useBand(frame: RefObject<HTMLDivElement | null>, on: boolean, height: number): [number, number] | null {
  const [band, setBand] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!on) return setBand(null);
    let request = 0;
    const read = () => {
      request = 0;
      const top = frame.current?.getBoundingClientRect().top;
      if (top === undefined) return;
      const step = innerHeight / 2;
      const start = Math.floor((-top - innerHeight) / step) * step;
      const end = Math.ceil((2 * innerHeight - top) / step) * step;
      setBand((current) => (current?.[0] === start && current[1] === end ? current : [start, end]));
    };
    const schedule = () => void (request ||= requestAnimationFrame(read));
    read();
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(request);
      document.removeEventListener("scroll", schedule, { capture: true });
      removeEventListener("resize", schedule);
    };
  }, [frame, on, height]);
  return band;
}

interface Props {
  refs: Reference[];
  minColumn?: number;
  maxColumns?: number;
  selected?: Set<string>;
  onClick(reference: Reference, event: MouseEvent): void;
  dragIds(reference: Reference): string[];
  arriving?: string[] | null;
  menuOf(reference: Reference): MenuEntry[];
}

export function RefGrid({
  refs,
  minColumn = 220,
  maxColumns = Infinity,
  selected,
  onClick,
  dragIds,
  arriving,
  menuOf,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const born = useRef(performance.now());
  const [width, setWidth] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);

  useLayoutEffect(() => {
    const element = frame.current!;
    let [laid, last, timer] = [element.clientWidth, 0, 0];
    setWidth(laid);
    const relayout = () => {
      [laid, last, timer] = [element.clientWidth, performance.now(), 0];
      flushSync(() => setWidth(laid));
      element.style.scale = "";
    };
    const observer = new ResizeObserver(() => {
      const since = performance.now() - last;
      if (since > RELAYOUT_MS) return relayout();
      element.style.scale = String(element.clientWidth / laid);
      timer ||= window.setTimeout(relayout, RELAYOUT_MS - since);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  const columns = Math.max(1, Math.min(maxColumns, Math.floor((width + GAP) / (minColumn + GAP))));
  useColumnLag(frame, columns);
  const ordered = balanceColumns(refs, columns, ratioOf);
  const layout = masonry(ordered.map(ratioOf), columns, (width - GAP * (columns - 1)) / columns, GAP);
  const top = arriving?.length ? (frame.current?.getBoundingClientRect().top ?? 0) : 0;
  const band = useBand(frame, refs.length > WINDOWED, layout.height);
  const opening = performance.now() - born.current < OPENING_MS;

  const stacks = Array.from({ length: columns }, (_, column) =>
    ordered.flatMap((reference, i) => (i % columns === column ? [{ reference, i }] : [])),
  );

  return (
    <div ref={frame} className="relative origin-top-left" style={{ height: layout.height }}>
      {width > 0 &&
        stacks.map((stack, column) => (
          <div
            key={column}
            data-column={column}
            className="pointer-events-none absolute inset-0"
            style={{ willChange: columns > 1 ? "transform" : undefined }}
          >
            {stack.map(({ reference, i }) => {
              const box = layout.boxes[i];
              if (band && (box.y + box.h < band[0] || box.y > band[1])) return null;
              const isSelected = selected?.has(reference.id) ?? false;
              const flight = arriving?.indexOf(reference.id) ?? -1;
              return (
                <div
                  key={reference.id}
                  draggable
                  onDragStart={(event) => startDrag(event, { refIds: dragIds(reference) })}
                  onClick={(event) => onClick(reference, event)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, entries: menuOf(reference) });
                  }}
                  className={`group pointer-events-auto absolute top-0 left-0 cursor-pointer ${flight < 0 && opening ? "animate-appear" : ""} overflow-hidden rounded-md bg-skeleton transition-[filter] duration-200 hover:brightness-[1.04] ${isSelected ? "selected" : ""}`}
                  style={{
                    animationDelay: `${Math.min(i, STAGGER.items) * STAGGER.ms}ms`,
                    translate: `${box.x}px ${box.y}px`,
                    width: box.w,
                    height: box.h,
                    viewTransitionName: flight >= 0 && top + box.y < innerHeight ? `seek-${flight}` : undefined,
                  }}
                >
                  <Picture reference={reference} sharp={false} alt={reference.alt ?? reference.title ?? ""} />
                  <Credit reference={reference} />
                  {isSelected && (
                    <span className="absolute top-2 right-2 grid size-5 animate-pop-in place-items-center rounded-full bg-fg text-bg">
                      <Icon name="check" size={13} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  );
}

export function refMenu(reference: Reference, onPreview: () => void, onDelete: () => void): MenuEntry[] {
  return [
    { label: "Enlarge", icon: "eye", onSelect: onPreview },
    ...(/^https?:/.test(reference.sourceUrl)
      ? [{ label: "Open original page", icon: "external", onSelect: () => openExternal(reference.sourceUrl) } as const]
      : []),
    "separator",
    { label: "Delete from the collection", icon: "trash", onSelect: onDelete },
  ];
}
