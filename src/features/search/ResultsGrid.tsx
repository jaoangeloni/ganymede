import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { needsSharp, Picture } from "../../components/Picture";
import { aspectOf, capacityFor, pageLayout } from "./pageGrid";
import type { Round } from "../../state";
import type { Reference, SearchSession } from "../../types";
import { Credit } from "../../components/Credit";

const STRAGGLERS = 2;
const REVEAL_TIMEOUT_MS = 1500;
const STEP_MS = 55;
const PLACEHOLDER = [1.5, 0.75, 1.33, 1, 0.8, 1.6, 0.67, 1.25, 1.5, 1, 0.75, 1.33, 1.78, 0.8, 1.2, 1.5];
const SLIDE_PX = 18;

interface Cell {
  key: string;
  ref?: Reference;
  aspect: number;
  revealed: boolean;
}

interface Props {
  session: SearchSession;
  round: Round;
  page: number;
  direction: 1 | -1;
  approvedIds: Set<string>;
  flight: string[];
  width: number;
  height: number;
  onReveal(results: Reference[], spares: Reference[]): void;
  onFail(reference: Reference): void;
  onToggle(reference: Reference): void;
  onPreview(reference: Reference): void;
  onHover(reference: Reference | null): void;
}

export function ResultsGrid({
  session,
  round,
  page,
  direction,
  approvedIds,
  flight,
  width,
  height,
  onReveal,
  onFail,
  onToggle,
  onPreview,
  onHover,
}: Props) {
  const [loaded, setLoaded] = useState(() => new Set<string>());
  const [failed, setFailed] = useState(() => new Set<string>());

  const capacity = capacityFor(width, height);
  const loading = round.phase === "loading";
  const searching = round.phase === "searching";
  const current = session.iterations.length;

  let fresh: Reference[] = [];
  let spares: Reference[] = [];
  let cells: Cell[];
  if (loading) {
    const pool = round.pool.filter((ref) => !failed.has(ref.id));
    [fresh, spares] = [pool.slice(0, capacity), pool.slice(capacity)];
    cells = fresh.map((ref, i) => ({ key: `${current}:${i}`, ref, aspect: aspectOf(ref), revealed: false }));
  } else if (searching) {
    cells = Array.from({ length: capacity }, (_, i) => ({
      key: `${current}:${i}`,
      aspect: PLACEHOLDER[i % PLACEHOLDER.length],
      revealed: false,
    }));
  } else {
    cells = (session.iterations[page]?.results ?? []).map((ref, i) => ({
      key: `${page}:${i}`,
      ref,
      aspect: aspectOf(ref),
      revealed: true,
    }));
  }
  const layout = pageLayout(
    cells.map((cell) => cell.aspect),
    width,
    height,
  );

  const ready = fresh.filter((ref) => loaded.has(ref.id)).length;
  const prepared = loading && ready >= Math.max(1, fresh.length - STRAGGLERS);
  const latest = useRef({ fresh, spares, onReveal });
  latest.current = { fresh, spares, onReveal };
  const wave = loading ? round.at : 0;
  useEffect(() => {
    if (!loading) return;
    const reveal = () => latest.current.onReveal(latest.current.fresh, latest.current.spares);
    if (prepared) return reveal();
    const timer = setTimeout(reveal, REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [loading, prepared, wave]);

  const mark = (set: typeof setLoaded, id: string) => set((ids) => new Set(ids).add(id));

  return (
    <div
      role="group"
      aria-label="References in this round"
      aria-busy={!cells.every((cell) => cell.revealed)}
      className="relative"
      style={{ width: layout.width, height: Math.ceil(layout.height) }}
    >
      {cells.map((cell, i) => {
        const { key, ref: reference, revealed } = cell;
        const id = reference?.id ?? "";
        const shown = revealed && loaded.has(id);
        const broken = revealed && failed.has(id);
        const approved = revealed && approvedIds.has(id);
        const flies = approved ? flight.indexOf(id) : -1;
        const box = layout.boxes[i];
        const delay = `${(box.row + box.col) * STEP_MS}ms`;
        return (
          <div
            key={key}
            data-ref={id}
            onMouseEnter={() => shown && reference && onHover(reference)}
            onMouseLeave={() => onHover(null)}
            className={`absolute top-0 left-0 animate-cell-in rounded-xl transition-[translate,width,height,box-shadow] duration-[400ms] ease-swift ${approved ? "ring-2 ring-primary-ink" : ""}`}
            style={{
              translate: `${box.x}px ${box.y}px`,
              width: box.w,
              height: box.h,
              animationDelay: delay,
              "--cell-x": `${direction * SLIDE_PX}px`,
              viewTransitionName: flies >= 0 ? `seek-${flies}` : undefined,
            }}
          >
            <div
              className={`group absolute overflow-hidden rounded-lg transition-[inset,scale] duration-300 ease-spring active:scale-[0.97] active:duration-100 ${shown ? "hover:scale-[1.015]" : ""} ${approved ? "inset-1.25" : "inset-0"}`}
            >
              <button
                type="button"
                disabled={!shown}
                aria-pressed={approved}
                aria-label={`Approve: ${reference?.title ?? reference?.alt ?? "reference"}`}
                onClick={() => reference && onToggle(reference)}
                className={`relative block size-full bg-skeleton ${shown || broken ? "" : "animate-breathe"}`}
                style={{ animationDelay: `${box.col * 120}ms` }}
              >
                {reference && !broken && (
                  <span
                    className={`absolute inset-0 transition-[opacity,scale] duration-[600ms] ease-swift ${shown ? "scale-100 opacity-100" : "scale-[1.04] opacity-0"}`}
                    style={{ transitionDelay: shown ? delay : "0ms" }}
                  >
                    <Picture
                      key={id}
                      reference={reference}
                      sharp={shown && needsSharp(reference, box.w * window.devicePixelRatio)}
                      onLoad={() => mark(setLoaded, id)}
                      onError={() => {
                        mark(setFailed, id);
                        if (revealed) onFail(reference);
                      }}
                    />
                  </span>
                )}
                {broken && (
                  <span className="grid size-full place-content-center justify-items-center gap-1 text-xs text-muted">
                    <Icon name="close" size={14} />
                    Image unavailable
                  </span>
                )}
              </button>

              {shown && reference && (
                <>
                  <Credit reference={reference} />
                  <span
                    key={String(approved)}
                    className={`pointer-events-none absolute top-2 right-2 grid size-5 place-items-center rounded-full shadow-[0_0_0_1px_rgb(0_0_0/0.12)] ${
                      approved
                        ? "animate-pop-in bg-primary text-on-primary"
                        : "border-[1.5px] border-white/90 bg-black/20 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                    }`}
                  >
                    {approved && <Icon name="check" size={13} />}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPreview(reference)}
                    aria-label="Enlarge"
                    title="Enlarge (Space)"
                    className="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-black/45 text-white opacity-0 transition-[opacity,background-color] duration-150 group-hover:opacity-100 hover:bg-black/75 focus-visible:opacity-100"
                  >
                    <Icon name="expand" size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
