import type { Reference } from "../../../types";
import type { Signature } from "../../../lib/api";
import { siteOf } from "../../../lib/library";
import { jaccard, referenceTokens, tokenize } from "./text";

interface Candidate {
  ref: Reference;
  tokens: Set<string>;
  site: string;
  hits: { query: string; rank: number }[];
  score: number;
  signature?: Signature;
}

export interface RankedList {
  query: string;
  refs: Reference[];
  offset?: number;
}

const MIN_SIDE = 400;
const MIN_RATIO = 0.4;
const MAX_RATIO = 2.5;
const RRF_K = 10;
const WEIGHTS = { relevance: 0.54, consensus: 0.23, preference: 0.23, avoid: 0.3, stock: 0.15 };
const IGNORED_WEIGHT = 0.25;
const REDUNDANCY = { similar: 0.3, author: 0.2, site: 0.1, shape: 0.05 };
const NEAR_DUPLICATE_BITS = 6;
const VISUAL_SIMILAR_FROM = 0.75;
const CONSENSUS = { from: 0.5, damping: 0.85, iterations: 20, min: 4 };

const SYNTHETIC_SITES =
  /(^|\.)(craiyon\.com|shedevrum\.ai|idyllic\.app|stockcake\.com|openart\.ai|lexica\.art|playground\.com|nightcafe\.studio|civitai\.com|prompthero\.com|pixai\.art|tensor\.art|seaart\.ai|starryai\.com|getimg\.ai|krea\.ai|leonardo\.ai|ideogram\.ai|imagine\.art|perchance\.org|deepai\.org|hotpot\.ai|artbreeder\.com|neural\.love|mage\.space)$/;
const SYNTHETIC_TEXT =
  /\b(ai[\s-]?generated|generated (with|by) ai|generative ai|ai[\s-](image|art|artwork|illustration|photo)|midjourney|stable diffusion|dall[\s-]?e)\b/i;
const STOCK_SITES =
  /(^|\.)(shutterstock|dreamstime|alamy|istockphoto|gettyimages|depositphotos|123rf|freepik|vecteezy|canstockphoto|bigstockphoto|agefotostock|pond5|colourbox|megapixl|featurepics|mostphotos|pngtree|lovepik|pikbest)\.|(^|\.)stock\.adobe\.com$/;

function dot(a: ArrayLike<number>, b: ArrayLike<number>) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export const wantsSynthetic = (prompt: string) => /\b(ia|ai|midjourney|stable diffusion)\b/i.test(prompt);

export function isUsable(ref: Reference): boolean {
  const ratio = ref.width / ref.height;
  return (
    ref.thumbUrl.startsWith("https://") &&
    /^https?:\/\//.test(ref.sourceUrl) &&
    Math.min(ref.width, ref.height) >= MIN_SIDE &&
    ratio >= MIN_RATIO &&
    ratio <= MAX_RATIO
  );
}

export const urlKey = (url: string) =>
  url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.)/, "")
    .replace(/[?&]utm_[^&]*/g, "")
    .replace(/(\.(?:jpe?g|png|webp|gif))\?.*$/, "$1")
    .replace(/_[a-z]\.jpg$/, ".jpg")
    .replace(/^i\.pinimg\.com\/(?:\d+x\d*|originals)\//, "i.pinimg.com/")
    .replace(/^(?:upload|thumb)\.wikimedia\.org\/(\w+\/\w+)\/thumb\/(.+?)\/\d+px-[^/]+$/, "upload.wikimedia.org/$1/$2")
    .replace(/-\d{2,4}x\d{2,4}(\.\w+)$/, "$1")
    .replace(/\/$/, "");

const identityKeys = (ref: Reference) => [ref.id, urlKey(ref.imageUrl), urlKey(ref.sourceUrl)];

function seriesKey(ref: Reference): string | null {
  const words = tokenize(ref.title ?? "");
  return ref.author && words.length >= 2 ? `${ref.author.toLowerCase()}|${words.join(" ")}` : null;
}

export function mergeCandidates(lists: RankedList[], seen: Reference[] = []): Candidate[] {
  const blocked = new Set(seen.flatMap(identityKeys));
  const byKey = new Map<string, Candidate>();
  const series = new Set<string>();
  const candidates: Candidate[] = [];

  for (const { query, refs, offset = 0 } of lists) {
    refs.forEach((ref, index) => {
      const rank = offset + index;
      const keys = identityKeys(ref);
      if (!isUsable(ref) || keys.some((key) => blocked.has(key))) return;
      const known = keys.map((key) => byKey.get(key)).find(Boolean);
      if (known) {
        if (!known.hits.some((hit) => hit.query === query && hit.rank === rank)) known.hits.push({ query, rank });
        return;
      }
      const serie = seriesKey(ref);
      if (serie && series.has(serie)) return;
      if (serie) series.add(serie);
      const candidate = { ref, tokens: referenceTokens(ref), site: siteOf(ref), hits: [{ query, rank }], score: 0 };
      keys.forEach((key) => byKey.set(key, candidate));
      candidates.push(candidate);
    });
  }
  for (const candidate of candidates) candidate.hits.sort((a, b) => a.rank - b.rank);
  return candidates;
}

function tokenShare(refs: Reference[]): Map<string, number> {
  const share = new Map<string, number>();
  for (const ref of refs) {
    for (const token of referenceTokens(ref)) share.set(token, (share.get(token) ?? 0) + 1 / refs.length);
  }
  return share;
}

export function consensus(embeddings: (ArrayLike<number> | null | undefined)[]): (number | undefined)[] {
  const present = embeddings.flatMap((embedding, i) => (embedding ? [i] : []));
  const result: (number | undefined)[] = embeddings.map(() => undefined);
  const n = present.length;
  if (n < CONSENSUS.min) return result;
  const weights = new Float64Array(n * n);
  const columns = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const w = Math.max(0, dot(embeddings[present[i]]!, embeddings[present[j]]!) - CONSENSUS.from);
      weights[i * n + j] = weights[j * n + i] = w;
      columns[i] += w;
      columns[j] += w;
    }
  }
  let rank = new Float64Array(n).fill(1 / n);
  for (let step = 0; step < CONSENSUS.iterations; step++) {
    const next = new Float64Array(n).fill((1 - CONSENSUS.damping) / n);
    for (let j = 0; j < n; j++) {
      if (!columns[j]) continue;
      const share = (CONSENSUS.damping * rank[j]) / columns[j];
      for (let i = 0; i < n; i++) next[i] += share * weights[i * n + j];
    }
    rank = next;
  }
  const min = Math.min(...rank);
  const range = Math.max(...rank) - min;
  present.forEach((index, i) => (result[index] = range ? (rank[i] - min) / range : 0.5));
  return result;
}

const spread = (values: (number | undefined)[]) => {
  const known = values.filter((value) => value !== undefined);
  const min = Math.min(...known);
  const range = Math.max(...known) - min;
  return (value: number | undefined) => (value === undefined || !range ? undefined : (value - min) / range);
};

interface RankContext {
  avoid: string[];
  synthetic?: boolean;
  approved: Reference[];
  ignored: Reference[];
  liked?: number[];
  passed?: number[];
}

export function scoreCandidates(
  candidates: Candidate[],
  { avoid, synthetic, approved, ignored, liked: likedLook, passed: passedLook }: RankContext,
): void {
  const unwanted = avoid.map(tokenize).filter((tokens) => tokens.length);
  const liked = tokenShare(approved);
  const passed = tokenShare(ignored);

  const relevance = candidates.map((c) => c.hits.reduce((sum, hit) => sum + 1 / (RRF_K + hit.rank), 0));
  const affinityRaw = candidates.map((c) => {
    if (!approved.length && !ignored.length) return undefined;
    let sum = 0;
    for (const token of c.tokens) sum += (liked.get(token) ?? 0) - IGNORED_WEIGHT * (passed.get(token) ?? 0);
    return c.tokens.size ? sum / Math.sqrt(c.tokens.size) : 0;
  });
  const lookRaw = candidates.map((c) => {
    const embedding = c.signature?.embedding;
    if (!embedding || !likedLook) return undefined;
    return dot(embedding, likedLook) - (passedLook ? IGNORED_WEIGHT * dot(embedding, passedLook) : 0);
  });
  const affinity = spread(affinityRaw);
  const look = spread(lookRaw);
  const central = consensus(candidates.map((c) => c.signature?.embedding));
  const centralKnown = central.filter((value) => value !== undefined);
  const centralMean = centralKnown.length
    ? centralKnown.reduce((sum, value) => sum + value, 0) / centralKnown.length
    : 0;
  const maxRelevance = Math.max(...relevance);

  candidates.forEach((c, i) => {
    const visible = new Set([...c.tokens, ...tokenize(c.site)]);
    const avoided =
      unwanted.some((tokens) => tokens.every((token) => visible.has(token))) ||
      (!synthetic && (SYNTHETIC_SITES.test(c.site) || SYNTHETIC_TEXT.test([c.ref.title, c.ref.alt].join(" "))));
    const feedback = [affinity(affinityRaw[i]), look(lookRaw[i])].filter((value) => value !== undefined);
    const preference = feedback.length ? feedback.reduce((sum, value) => sum + value, 0) / feedback.length : 0;
    c.score =
      WEIGHTS.relevance * (relevance[i] / maxRelevance) +
      WEIGHTS.consensus * (central[i] ?? centralMean) +
      WEIGHTS.preference * preference -
      (avoided ? WEIGHTS.avoid : 0) -
      (STOCK_SITES.test(c.site) ? WEIGHTS.stock : 0);
  });
}

export function dropNearDuplicates(candidates: Candidate[], seen: Signature[] = []): Candidate[] {
  const hashes = seen.map((signature) => signature.hash);
  return [...candidates]
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const hash = candidate.signature?.hash;
      if (!hash) return true;
      if (hashes.some((other) => hamming(hash, other) <= NEAR_DUPLICATE_BITS)) return false;
      hashes.push(hash);
      return true;
    });
}

function lookAlike(a?: Signature, b?: Signature): number {
  if (!a?.embedding || !b?.embedding) return 0;
  return Math.max(0, (dot(a.embedding, b.embedding) - VISUAL_SIMILAR_FROM) / (1 - VISUAL_SIMILAR_FROM));
}

const shape = ({ width, height }: Reference) =>
  width / height > 1.2 ? "landscape" : width / height < 0.85 ? "portrait" : "square";

function redundancy(candidate: Candidate, picked: Candidate[]): number {
  if (!picked.length) return 0;
  let similar = 0;
  let sameAuthor = false;
  let sameSite = 0;
  let sameShape = 0;
  for (const other of picked) {
    similar = Math.max(
      similar,
      jaccard(candidate.tokens, other.tokens),
      lookAlike(candidate.signature, other.signature),
    );
    if (candidate.ref.author && candidate.ref.author === other.ref.author) sameAuthor = true;
    if (candidate.site === other.site) sameSite++;
    if (shape(candidate.ref) === shape(other.ref)) sameShape++;
  }
  return (
    REDUNDANCY.similar * similar +
    (sameAuthor ? REDUNDANCY.author : 0) +
    (REDUNDANCY.site * sameSite + REDUNDANCY.shape * sameShape) / picked.length
  );
}

export function selectDiverse(candidates: Candidate[], count: number): Candidate[] {
  const rest = [...candidates];
  const picked: Candidate[] = [];
  while (picked.length < count && rest.length) {
    let best = 0;
    let bestValue = -Infinity;
    rest.forEach((candidate, i) => {
      const value = candidate.score - redundancy(candidate, picked);
      if (value > bestValue) [best, bestValue] = [i, value];
    });
    picked.push(...rest.splice(best, 1));
  }
  return picked;
}

export function centroid(embeddings: number[][]): number[] | undefined {
  if (!embeddings.length) return undefined;
  const sum = embeddings[0].map((_, i) => embeddings.reduce((total, embedding) => total + embedding[i], 0));
  const norm = Math.hypot(...sum) || 1;
  return sum.map((value) => value / norm);
}

const popcount = (n: number) => {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

const hamming = (a: string, b: string) =>
  popcount(parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) +
  popcount(parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16));
