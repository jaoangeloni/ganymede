import type { Reference, SearchPlan, SearchWave, WaveTimings } from "../../../types";
import type { Signature } from "../../../lib/api";
import { vision as defaultVision, type Vision } from "../../../lib/vision";
import { BING_PAGE_SIZE, type Filters, filterQuery, searchBing } from "./bing";
import { cached } from "./cache";
import { readPrompt } from "./query";
import {
  centroid,
  dropNearDuplicates,
  mergeCandidates,
  type RankedList,
  scoreCandidates,
  selectDiverse,
  wantsSynthetic,
} from "./rank";

const POOL_SIZE = 64;
const MIN_WAVE = 12;
const PAGES = 2;
const REQUEST_TIMEOUT_MS = 4000;
const COOLDOWN_MS = 30_000;
const VISION_BUDGET_MS = 1000;
const FEEDBACK_LOOKS = 16;
const BACKGROUND_DELAY_MS = 2000;
const PREFETCH_DELAY_MS = 1500;

export type Fetch = (text: string, page: number, filters: string) => Promise<Reference[]>;

let restingUntil = 0;
export const wake = () => void (restingUntil = 0);

export interface SearchInput {
  prompt: string;
  filters?: Filters;
  approved: Reference[];
  shown: Reference[];
  owned: Reference[];
  searched: SearchPlan[];
  known?: RankedList[];
  onWave?(wave: SearchWave): void;
  onList?(list: RankedList): void;
}

interface SearchOutcome {
  plan: SearchPlan;
  pool: Reference[];
  offline: boolean;
  timings: WaveTimings;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function fetchList(fetch: Fetch, query: string, page: number, filters: string): Promise<RankedList | null> {
  if (Date.now() < restingUntil) return Promise.resolve(null);
  const request = cached(`bing|${filters}|${query}|${page}`, () => fetch(query, page, filters));
  return Promise.race([request, sleep(REQUEST_TIMEOUT_MS).then(() => Promise.reject(new Error("timed out")))]).then(
    (refs) => ({ query, refs, offset: (page - 1) * BING_PAGE_SIZE }),
    () => null,
  );
}

const looks = (refs: Reference[], known: Map<string, Signature>) =>
  refs.flatMap((ref) => {
    const embedding = known.get(ref.id)?.embedding;
    return embedding ? [embedding] : [];
  });

export async function search(
  input: SearchInput,
  fetch: Fetch = searchBing,
  vision: Vision = defaultVision,
): Promise<SearchOutcome> {
  const start = performance.now();
  const approvedIds = new Set(input.approved.map((ref) => ref.id));
  const ignored = input.shown.filter((ref) => !approvedIds.has(ref.id));
  const liked = input.approved.slice(-FEEDBACK_LOOKS);
  const passed = ignored.slice(-FEEDBACK_LOOKS);
  const seen = [...input.shown, ...input.owned];
  const capacity = vision.capacity(VISION_BUDGET_MS);
  const { query, avoid } = readPrompt(input.prompt);
  const filters = filterQuery(input.filters ?? {});
  const plan: SearchPlan = { queries: query ? [query] : [], avoid, filters };
  const context = { avoid, synthetic: wantsSynthetic(input.prompt), approved: input.approved, ignored };
  const lists: RankedList[] = [];
  const offered: Reference[] = [];
  let timings: WaveTimings = { waitMs: 0, rankMs: 0, visionMs: 0, candidates: 0 };

  const rounds = input.searched.filter(
    (used) => (used.filters ?? "") === filters && used.queries.includes(query),
  ).length;
  const pageOf = (page: number) => 1 + page + PAGES * rounds;
  const run = async (pages: number[]) => {
    const results = await Promise.all(pages.map((page) => fetchList(fetch, query, page, filters)));
    const arrived = results.filter((list) => list !== null);
    for (const list of arrived) {
      lists.push(list);
      input.onList?.(list);
    }
    if (pages.length && !arrived.length) restingUntil = Date.now() + COOLDOWN_MS;
  };

  const offer = async (source: RankedList[], min: number) => {
    const ranking = performance.now();
    const candidates = mergeCandidates(source, seen);
    scoreCandidates(candidates, context);
    const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, await capacity);
    const visionStart = performance.now();
    await vision.analyze([...liked, ...top.map((candidate) => candidate.ref), ...passed], {
      embed: true,
      budgetMs: VISION_BUDGET_MS,
    });
    const visionMs = performance.now() - visionStart;
    const signatures = vision.peek([...liked, ...candidates.map((candidate) => candidate.ref), ...passed]);
    for (const candidate of candidates) candidate.signature = signatures.get(candidate.ref.id);
    const fresh = dropNearDuplicates(candidates, [...vision.peek(seen).values()]);
    scoreCandidates(fresh, {
      ...context,
      liked: centroid(looks(liked, signatures)),
      passed: centroid(looks(passed, signatures)),
    });
    const pool = selectDiverse(fresh, POOL_SIZE).map((candidate) => candidate.ref);
    if (!pool.length || pool.length < min) return false;
    timings = {
      waitMs: Math.round(ranking - start),
      rankMs: Math.round(performance.now() - ranking - visionMs),
      visionMs: Math.round(visionMs),
      candidates: candidates.length,
    };
    offered.push(...pool);
    input.onWave?.({ plan, pool, timings });
    return true;
  };

  if (query) {
    const fetching = run([pageOf(0), pageOf(1)]);
    const fromReserves = !!input.known?.length && (await offer(input.known, MIN_WAVE));
    await fetching;
    if (!fromReserves) await offer([...(input.known ?? []), ...lists], 1);

    setTimeout(() => void vision.analyze(offered, { embed: true }), BACKGROUND_DELAY_MS);
    if (input.onList)
      setTimeout(
        () => void fetchList(fetch, query, pageOf(PAGES), filters).then((list) => list && input.onList?.(list)),
        PREFETCH_DELAY_MS,
      );
  }

  return { plan, pool: offered, offline: !!query && !lists.length, timings };
}
