import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRef } from "../../../testing";
import type { Reference } from "../../../types";
import type { Signature } from "../../../lib/api";
import type { Vision } from "../../../lib/vision";
import { clearCache } from "./cache";
import { type Fetch, search, type SearchInput, wake } from ".";

const input = (overrides: Partial<SearchInput> = {}): SearchInput => ({
  prompt: "castelo medieval",
  approved: [],
  shown: [],
  owned: [],
  searched: [],
  ...overrides,
});

function fakeBing(respond: (text: string, page: number) => Reference[] | Promise<Reference[]>) {
  const calls: { text: string; page: number; filters: string }[] = [];
  const fetch: Fetch = async (text, page, filters) => {
    calls.push({ text, page, filters });
    return respond(text, page);
  };
  return { fetch, calls };
}

const TITLES = [
  "Medieval fortress gate",
  "Old fortress wall",
  "Stone keep at dusk",
  "Castle wall and gate",
  "Village square",
];

const batch = (count: number, page = 1, tag = "") =>
  Array.from({ length: count }, (_, i) =>
    makeRef(`bing:${tag}p${page}-${i}`, {
      sourceUrl: `https://site${i % 9}.example/${tag}${page}-${i}`,
      title: `${TITLES[i % TITLES.length]} ${tag}${page}${i}`,
    }),
  );

function fakeVision(signatures: Record<string, Signature> = {}) {
  const calls: { ids: string[]; embed: boolean; budgetMs?: number }[] = [];
  const known = (refs: Reference[]) =>
    new Map(refs.flatMap((ref) => (signatures[ref.id] ? [[ref.id, signatures[ref.id]] as const] : [])));
  const vision: Vision = {
    analyze: async (refs, options) => {
      calls.push({ ids: refs.map((ref) => ref.id), ...options });
      return known(refs);
    },
    peek: known,
    capacity: async () => 24,
  };
  return { vision, calls };
}

beforeEach(() => {
  clearCache();
  wake();
});
afterEach(() => vi.useRealTimers());

describe("search", () => {
  it("searches Bing for the typed text, pages 1 and 2, and returns a pool without repeats", async () => {
    const bing = fakeBing((_, page) => batch(35, page));
    const outcome = await search(input(), bing.fetch, fakeVision().vision);

    expect(bing.calls).toEqual([
      { text: "castelo medieval", page: 1, filters: "" },
      { text: "castelo medieval", page: 2, filters: "" },
    ]);
    expect(outcome.plan.queries[0]).toBe("castelo medieval");
    expect(new Set(outcome.pool.map((ref) => ref.id)).size).toBe(outcome.pool.length);
    expect(outcome.pool.length).toBeGreaterThan(32);
  });

  it("the negated part is not searched; it becomes a term to avoid that ranks matches down", async () => {
    const position = async (prompt: string) => {
      clearCache();
      const bing = fakeBing(() => [makeRef("bing:fantasia", { title: "Fantasia anos 70" }), ...batch(20)]);
      const outcome = await search(input({ prompt }), bing.fetch, fakeVision().vision);
      return {
        first: bing.calls[0].text,
        avoid: outcome.plan.avoid,
        at: outcome.pool.findIndex((ref) => ref.id === "bing:fantasia"),
      };
    };
    const excluded = await position("moda feminina anos 70, roupas reais, sem fantasia");
    const wanted = await position("moda feminina anos 70, roupas reais, fantasia");

    expect(excluded).toMatchObject({ first: "moda feminina anos 70, roupas reais", avoid: ["fantasia"] });
    expect(excluded.at).toBeGreaterThan(wanted.at);
  });

  it("an empty prompt does not query Bing", async () => {
    const bing = fakeBing(() => batch(20));
    const outcome = await search(input({ prompt: "   " }), bing.fetch, fakeVision().vision);

    expect(bing.calls).toHaveLength(0);
    expect(outcome).toMatchObject({ pool: [], offline: false });
  });

  it("when Bing is down it reports offline and rests before the next query", async () => {
    const bing = fakeBing(() => Promise.reject(new Error("503")));
    expect((await search(input(), bing.fetch, fakeVision().vision)).offline).toBe(true);
    const calls = bing.calls.length;

    expect((await search(input({ prompt: "ponte de pedra" }), bing.fetch, fakeVision().vision)).offline).toBe(true);
    expect(bing.calls).toHaveLength(calls);
  });

  it("a slow page does not hold the round", async () => {
    vi.useFakeTimers();
    const bing = fakeBing((_, page) => (page === 2 ? new Promise<Reference[]>(() => {}) : batch(35, page)));
    const pending = search(input(), bing.fetch, fakeVision().vision);
    await vi.advanceTimersByTimeAsync(4100);
    const outcome = await pending;

    expect(outcome.pool.length).toBeGreaterThan(12);
    expect(outcome.offline).toBe(false);
  });

  it("never shows again what the session showed or what the space already has", async () => {
    const refs = batch(20);
    const bing = fakeBing((_, page) => (page === 1 ? refs : []));
    const outcome = await search(
      input({ shown: refs.slice(0, 8), owned: refs.slice(8, 10) }),
      bing.fetch,
      fakeVision().vision,
    );

    expect(outcome.pool.map((ref) => ref.id).sort()).toEqual(
      refs
        .slice(10)
        .map((ref) => ref.id)
        .sort(),
    );
  });

  it("a repeated query advances pages, and repeating the same search uses the cache", async () => {
    const bing = fakeBing((_, page) => batch(20, page));
    const searched = [{ queries: ["castelo medieval"], avoid: [] }];
    await search(input({ searched }), bing.fetch, fakeVision().vision);
    expect(bing.calls.slice(0, 2).map((call) => call.page)).toEqual([3, 4]);

    const calls = bing.calls.length;
    await search(input({ searched }), bing.fetch, fakeVision().vision);
    expect(bing.calls).toHaveLength(calls);
  });

  it("filters go to Bing, and changing them restarts from the first page", async () => {
    const bing = fakeBing((_, page) => batch(20, page));
    const outcome = await search(
      input({
        filters: { color: "color2-bw", layout: "aspect-tall" },
        searched: [{ queries: ["castelo medieval"], avoid: [] }],
      }),
      bing.fetch,
      fakeVision().vision,
    );

    expect(bing.calls[0]).toEqual({
      text: "castelo medieval",
      page: 1,
      filters: "+filterui:color2-bw+filterui:aspect-tall",
    });
    expect(outcome.plan.filters).toBe("+filterui:color2-bw+filterui:aspect-tall");
  });
});

describe("search per round", () => {
  it("one page per round, already ranked by CLIP: embeddings of the best come first", async () => {
    const bing = fakeBing((_, page) => batch(35, page));
    const { vision, calls } = fakeVision();
    const waves: { size: number; analyses: number }[] = [];
    await search(
      input({ onWave: (wave) => waves.push({ size: wave.pool.length, analyses: calls.length }) }),
      bing.fetch,
      vision,
    );

    expect(waves).toHaveLength(1);
    expect(waves[0].analyses).toBe(1);
    expect(calls[0]).toMatchObject({ embed: true, budgetMs: 1000 });
    expect(calls[0].ids).toHaveLength(24);
  });

  it("with session spares, the page comes from them and Bing only refills the spares", async () => {
    const bing = fakeBing((_, page) => batch(35, page, "novo"));
    const known = [{ query: "castelo medieval", refs: batch(35, 9, "reserva") }];
    const firsts: string[][] = [];
    await search(
      input({ known, onWave: (wave) => firsts.push(wave.pool.map((ref) => ref.id)) && void 0 }),
      bing.fetch,
      fakeVision().vision,
    );

    expect(firsts).toHaveLength(1);
    expect(firsts[0].every((id) => id.includes("reserva"))).toBe(true);
    expect(bing.calls).toHaveLength(2);
  });

  it("approvals do not rewrite the query: only the typed text goes to Bing", async () => {
    const bing = fakeBing((_, page) => batch(35, page));
    const approved = [
      makeRef("a", { title: "Kominka with tatami room" }),
      makeRef("b", { title: "Tatami and shoji at dusk" }),
    ];
    const outcome = await search(
      input({ prompt: "casa japonesa antiga", approved, shown: approved }),
      bing.fetch,
      fakeVision().vision,
    );

    expect(outcome.plan.queries).toEqual(["casa japonesa antiga"]);
    expect(new Set(bing.calls.map((call) => call.text))).toEqual(new Set(["casa japonesa antiga"]));
  });

  it("after the round, the next page is fetched as spares", async () => {
    vi.useFakeTimers();
    const bing = fakeBing((_, page) => batch(35, page));
    const lists: { query: string; page: number }[] = [];
    const pending = search(
      input({
        onList: (list) => lists.push({ query: list.query, page: Number(list.refs[0].id.match(/p(\d+)-/)![1]) }),
      }),
      bing.fetch,
      fakeVision().vision,
    );
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    await vi.advanceTimersByTimeAsync(1600);

    expect(lists).toContainEqual({ query: "castelo medieval", page: 3 });
  });
});

describe("search with visual signals", () => {
  it("a copy of something already shown leaves the pool by dHash", async () => {
    const shown = makeRef("bing:visto");
    const refs = batch(20);
    const bing = fakeBing((_, page) => (page === 1 ? refs : []));
    const { vision } = fakeVision({
      "bing:visto": { hash: "00000000000000ff" },
      [refs[3].id]: { hash: "00000000000000fe" },
    });
    const outcome = await search(input({ shown: [shown] }), bing.fetch, vision);

    expect(outcome.pool.map((ref) => ref.id)).not.toContain(refs[3].id);
  });

  it("after approvals it asks for embeddings and ranks look-alikes first", async () => {
    const approved = makeRef("bing:aprovada");
    const refs = batch(20);
    const bing = fakeBing((_, page) => (page === 1 ? refs : []));
    const signatures: Record<string, Signature> = { "bing:aprovada": { hash: "aa".repeat(8), embedding: [1, 0] } };
    refs.forEach(
      (ref, i) =>
        (signatures[ref.id] = { hash: i.toString(16).padStart(16, "0"), embedding: i === 19 ? [1, 0] : [0, 1] }),
    );
    const { vision, calls } = fakeVision(signatures);
    const outcome = await search(input({ approved: [approved], shown: [approved] }), bing.fetch, vision);

    expect(calls.some((call) => call.embed && call.ids[0] === "bing:aprovada")).toBe(true);
    expect(outcome.pool.findIndex((ref) => ref.id === refs[19].id)).toBeLessThan(5);
  });
});
