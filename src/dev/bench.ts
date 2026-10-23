import { clusterRadius } from "../features/graph/geometry";
import type { AppState } from "../state";
import type { Collection, Library, Reference, SpaceNode } from "../types";

export const BENCH_ON = import.meta.env.DEV || import.meta.env.VITE_BENCH === "1";

export function benchSize(): number {
  if (!BENCH_ON) return 0;
  try {
    return Math.max(
      0,
      Math.floor(
        Number(new URLSearchParams(location.search).get("bench") ?? localStorage.getItem("ganymede:bench")) || 0,
      ),
    );
  } catch {
    return 0;
  }
}

export function benchState(saved: AppState, total: number): AppState {
  const library = syntheticLibrary(total, Object.values(saved.library.refs));
  return { ...saved, library, view: { kind: "space", id: SPACE }, session: null, round: { phase: "idle" } };
}

const SPACE = "bench";

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hslHex = (hue: number, s = 0.6, l = 0.55) => {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};

function swatch(i: number): Reference {
  const hue = (i * 137.5) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="hsl(${hue} 60% 55%)"/></svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  return {
    id: "",
    source: "url",
    imageUrl: url,
    thumbUrl: url,
    sourceUrl: url,
    width: 120,
    height: 120,
    title: `Amostra ${i}`,
    palette: [hslHex(hue)],
  };
}

function syntheticLibrary(total: number, pool: Reference[]): Library {
  const random = mulberry32(total);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  const bust = (url: string, i: number) => (url.startsWith("/") ? `${url}${url.includes("?") ? "&" : "?"}b=${i}` : url);
  const refs: Record<string, Reference> = {};
  let next = 0;
  const take = (count: number) =>
    Array.from({ length: count }, () => {
      const i = next++;
      const base = pool.length ? pool[i % pool.length] : swatch(i);
      const id = `bench:${i}`;
      refs[id] = {
        ...base,
        id,
        thumbUrl: bust(base.thumbUrl, i),
        imageUrl: bust(base.imageUrl, i),
        palette: base.palette ?? [hslHex((i * 137.5) % 360)],
      };
      return id;
    });

  const loose = Math.min(60, Math.round(total * 0.01));
  const collections: Collection[] = [];
  const nodes: SpaceNode[] = [];
  let area = 0;
  const place = (r: number) => {
    const k = nodes.length;
    const reach = k ? Math.sqrt(area / Math.PI) * 1.2 : 0;
    area += (2 * r + 120) ** 2;
    return { x: Math.cos(k * 2.39996) * reach, y: Math.sin(k * 2.39996) * reach };
  };
  while (next < total - loose) {
    const left = total - loose - next;
    const size = Math.min(left, Math.max(3, Math.min(1500, Math.round(Math.exp(Math.log(60) + gauss())))));
    const id = `bench-${collections.length}`;
    collections.push({ id, name: `Collection ${nodes.length + 1}`, refIds: take(size), spaceId: SPACE });
    nodes.push({ id: `c:${id}`, kind: "collection", collectionId: id, ...place(clusterRadius(size)) });
  }
  const edge = Math.sqrt(area / Math.PI) * 1.3 + 400;
  for (const refId of take(total - next)) {
    const angle = random() * 2 * Math.PI;
    nodes.push({
      id: `r:${refId}`,
      kind: "ref",
      refId,
      x: Math.cos(angle) * edge * (1 + random() * 0.2),
      y: Math.sin(angle) * edge * (1 + random() * 0.2),
    });
  }

  const space = {
    id: SPACE,
    name: `Bench ${total.toLocaleString("en")}`,
    viewport: { x: 600, y: 400, scale: 0.1 },
    nodes,
    board: { viewport: { x: 0, y: 0, scale: 1 }, pins: [] },
  };
  return { refs, collections, spaces: [space] };
}

export function benchEdges(refIds: string[]): [number, number, number][] {
  const random = mulberry32(refIds.length);
  return refIds.flatMap((_, i) =>
    [1, 3, 7].flatMap((step) =>
      i + step < refIds.length && random() < 0.6
        ? [[i, i + step, 0.7 + random() * 0.25] as [number, number, number]]
        : [],
    ),
  );
}
