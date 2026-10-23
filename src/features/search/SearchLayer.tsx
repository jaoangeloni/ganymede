import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { FailureReason, Round } from "../../state";
import type { Reference, SearchSession } from "../../types";
import { ResultsGrid } from "./ResultsGrid";

const FAILURES: Record<FailureReason, { title: string; hint: string }> = {
  empty: {
    title: "Nothing found for this prompt",
    hint: "Try describing the idea in other words.",
  },
  exhausted: {
    title: "No new references here",
    hint: "Edit the prompt to explore another direction.",
  },
  offline: {
    title: "Could not search for references",
    hint: "Check the connection and try again.",
  },
};

const ARROW = 48;
const SIDE = 28;
const RAIL = 96;
const FOOTER = 104;

const arrow =
  "grid shrink-0 place-items-center rounded-full border transition-[opacity,background-color,color,scale] duration-200 ease-swift disabled:opacity-25 enabled:active:scale-95";

interface Props {
  session: SearchSession;
  flying: boolean;
  round: Round;
  onReveal(results: Reference[], spares: Reference[]): void;
  onFail(reference: Reference): void;
  onToggle(reference: Reference): void;
  onMore(): void;
  onConclude(): void;
  onPreview(reference: Reference): void;
  onHover(reference: Reference | null): void;
}

export function SearchLayer({
  session,
  flying,
  round,
  onReveal,
  onFail,
  onToggle,
  onMore,
  onConclude,
  onPreview,
  onHover,
}: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const count = session.iterations.length;
  const [view, setView] = useState<{ count: number; page: number; direction: 1 | -1 }>({
    count,
    page: count - 1,
    direction: 1,
  });
  if (view.count !== count) setView({ count, page: count - 1, direction: 1 });
  const page = Math.max(0, Math.min(view.page, count - 1));

  const approvedIds = useMemo(() => new Set(session.approved.map((ref) => ref.id)), [session.approved]);
  const approvedCount = session.approved.length;
  const busy = round.phase === "searching" || round.phase === "loading";
  const latest = page >= count - 1;
  const failure = round.phase === "error" ? { ...FAILURES[round.reason], retry: round.reason === "offline" } : null;
  const nothing = failure && !count;

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () =>
      setSize((current) =>
        current.width === element.clientWidth && current.height === element.clientHeight
          ? current
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [nothing]);

  const go = (step: 1 | -1) => setView({ count, page: page + step, direction: step });
  const caption = count > 1 ? `Round ${page + 1} of ${count}` : "";

  return (
    <div className="absolute inset-0 z-10 animate-fade-in overflow-hidden rounded-xl border border-line bg-bg">
      {nothing ? (
        <div className="grid h-full animate-fade-in place-content-center justify-items-center gap-1 pb-28 text-center">
          <p className="text-base">{failure.title}</p>
          <p className="text-muted">{failure.hint}</p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onConclude}
              className="h-9 rounded-full px-4 text-muted transition-colors hover:bg-skeleton hover:text-fg"
            >
              Close
            </button>
            {failure.retry && (
              <button
                type="button"
                onClick={onMore}
                className="h-9 rounded-full border border-line px-4 hover:bg-skeleton"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          ref={stage}
          className="absolute inset-x-0 top-28 bottom-28 flex flex-col items-center justify-center gap-8"
          style={{ paddingInline: RAIL }}
        >
          {size.width > 0 && (
            <div className="flex items-center" style={{ gap: SIDE }}>
              <button
                type="button"
                disabled={busy || page < 1}
                onClick={() => go(-1)}
                aria-label="Previous round"
                title="Previous round"
                className={`${arrow} border-line bg-surface text-fg enabled:hover:bg-skeleton`}
                style={{ width: ARROW, height: ARROW }}
              >
                <Icon name="left" size={20} />
              </button>
              <ResultsGrid
                session={session}
                round={round}
                page={page}
                direction={view.direction}
                approvedIds={approvedIds}
                flight={flying ? session.approved.map((ref) => ref.id) : []}
                width={size.width - 2 * (RAIL + SIDE + ARROW)}
                height={size.height - FOOTER}
                onReveal={onReveal}
                onFail={onFail}
                onToggle={onToggle}
                onPreview={onPreview}
                onHover={onHover}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => (latest ? onMore() : go(1))}
                aria-label={latest ? "Search more" : "Next round"}
                title={latest ? "Search more from the approved ones (Enter)" : "Next round"}
                className={`${arrow} ${latest ? "border-transparent bg-fg text-bg enabled:hover:opacity-85" : "border-line bg-surface text-fg enabled:hover:bg-skeleton"} ${busy ? "animate-breathe" : ""}`}
                style={{ width: ARROW, height: ARROW }}
              >
                <Icon name="right" size={20} />
              </button>
            </div>
          )}

          <div className="flex flex-col items-center gap-3 text-center">
            {failure ? (
              <div className="flex animate-fade-in items-center gap-3 text-xs text-muted">
                <span>
                  {failure.title}. {failure.hint}
                </span>
                {failure.retry && (
                  <button
                    type="button"
                    onClick={onMore}
                    className="h-7 rounded-full border border-line px-3 text-fg transition-colors hover:bg-skeleton"
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : busy ? (
              <p className="animate-breathe text-xs text-muted">
                {count ? "Searching for more references…" : "Searching for references…"}
              </p>
            ) : (
              caption && (
                <p key={caption} className="animate-fade-in text-xs text-muted">
                  {caption}
                </p>
              )
            )}
            <button
              type="button"
              onClick={onConclude}
              title={approvedCount ? "Take the approved ones to the collection (Esc)" : "Close the search (Esc)"}
              className={`flex h-10 items-center gap-2 rounded-full px-5 whitespace-nowrap transition-[opacity,background-color,color,filter,scale] duration-200 active:scale-95 ${
                approvedCount
                  ? "bg-primary text-on-primary hover:brightness-105"
                  : "border border-line text-muted hover:bg-skeleton hover:text-fg"
              }`}
            >
              <Icon name="save" size={15} />
              Save references
              {approvedCount > 0 && (
                <span
                  key={approvedCount}
                  className="grid h-5 min-w-5 animate-bump place-items-center rounded-full bg-on-primary/15 px-1.5 text-xs tabular-nums"
                >
                  {approvedCount}
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
