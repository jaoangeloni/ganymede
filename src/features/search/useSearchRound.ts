import { type Dispatch, type RefObject, useEffect, useRef, useState } from "react";
import { warmBing } from "../../lib/api";
import { crossfade, morphing } from "../../lib/viewTransition";
import { type Action, type AppState, searchedPlans, shownReferences } from "../../state";
import type { Reference, SearchSession } from "../../types";
import { search } from "./pipeline";
import { type Filters, filterQuery } from "./pipeline/bing";
import type { RankedList } from "./pipeline/rank";

const MAX_SEED = 12;
const MAX_RESERVE_LISTS = 120;
const PREPARE_DELAY_MS = 400;

export interface SearchStart {
  target: { spaceId?: string; collectionId: string };
  seed: Reference[];
  fallback?: string;
}

export type Arrival = { collectionId: string; refIds: string[] } | null;

interface Options {
  state: Pick<AppState, "library" | "session" | "round">;
  dispatch: Dispatch<Action>;
  draft: string;
  setDraft(text: string): void;
  context(): SearchStart | null;
  searchable: boolean;
  hovered: RefObject<Reference | null>;
  onArrive(arrival: Arrival): void;
  onCancelled(left: SearchSession, resume: () => void): void;
}

export function useSearchRound({
  state,
  dispatch,
  draft,
  setDraft,
  context,
  searchable,
  hovered,
  onArrive,
  onCancelled,
}: Options) {
  const { library, session, round } = state;
  const [filters, setFilters] = useState<Filters>({});
  const roundId = useRef(0);
  const roundStart = useRef(0);
  const reserves = useRef<{ key: string; lists: RankedList[] }>({ key: "", lists: [] });
  const busy = round.phase === "searching" || round.phase === "loading";

  const prepare = searchable && !busy;
  useEffect(() => {
    if (!prepare) return;
    const timer = setTimeout(warmBing, PREPARE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [prepare]);

  const run = async (text = draft, fresh?: SearchStart, enter?: () => void, using = filters) => {
    const start = session ? null : (fresh ?? context());
    if (!session && !start) return;
    const prompt = text.trim() || session?.prompt || start?.fallback || "";
    if (!prompt || (busy && prompt === session?.prompt)) return;
    setDraft(prompt);
    hovered.current = null;
    const seed = session?.seed ?? start?.seed.slice(-MAX_SEED) ?? [];
    const id = ++roundId.current;
    const current = () => id === roundId.current;
    roundStart.current = performance.now();
    const key = `${prompt}|${filterQuery(using)}`;
    if (!session || reserves.current.key !== key) reserves.current = { key, lists: [] };
    const store = reserves.current;
    let begin = () => {};
    const begun = new Promise<void>((resolve) => (begin = resolve));
    let waves = 0;
    const pending = search({
      prompt,
      filters: using,
      approved: [...seed, ...(session?.approved ?? [])],
      shown: shownReferences(session),
      owned: Object.values(library.refs),
      searched: searchedPlans(session),
      known: store.lists.length ? [...store.lists] : undefined,
      onWave: (wave) => {
        waves++;
        const at = performance.now();
        void begun.then(() => current() && dispatch({ type: "wave-arrived", wave: { ...wave, at } }));
      },
      onList: (list) => {
        if (reserves.current !== store) return;
        store.lists.push(list);
        if (store.lists.length > MAX_RESERVE_LISTS) store.lists.shift();
      },
    }).catch(() => null);
    await morphing(enter !== undefined, () => {
      enter?.();
      dispatch({ type: "search-started", prompt, target: start?.target, seed });
    });
    begin();

    const outcome = await pending;
    await begun;
    if (!current() || waves) return;
    const reason = !outcome || outcome.offline ? "offline" : session?.iterations.length ? "exhausted" : "empty";
    dispatch({ type: "search-failed", reason });
  };

  const reveal = (results: Reference[], spares: Reference[]) => {
    if (round.phase !== "loading") return;
    if (!results.length) return dispatch({ type: "search-failed", reason: "offline" });
    dispatch({ type: "revealed", results, spares });
    if (import.meta.env.DEV) {
      const now = performance.now();
      const timings = {
        ...round.timings,
        imagesMs: Math.round(now - round.at),
        totalMs: Math.round(now - roundStart.current),
      };
      console.info("[ganymede] wave", JSON.stringify({ count: results.length, ...timings }));
    }
  };

  const conclude = () => {
    roundId.current++;
    reserves.current = { key: "", lists: [] };
    const target = session?.target.collectionId;
    const arrival =
      target && session?.approved.length
        ? { collectionId: target, refIds: session.approved.map((ref) => ref.id) }
        : null;
    void crossfade(
      () => {
        onArrive(arrival);
        setDraft("");
        dispatch({ type: "concluded" });
      },
      () => onArrive(null),
    );
  };

  const cancel = () => {
    if (!session) return;
    roundId.current++;
    reserves.current = { key: "", lists: [] };
    const left = session;
    setDraft("");
    dispatch({ type: "search-cancelled" });
    if (left.approved.length)
      onCancelled(left, () => {
        setDraft(left.prompt);
        dispatch({ type: "session-resumed", session: left });
      });
  };

  return { filters, setFilters, run, reveal, conclude, cancel };
}
