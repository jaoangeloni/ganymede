import type { Reference } from "../types";
import { analyzeImages, isTauri, type Signature, visionRate } from "./api";

const BATCH = 8;
const CAPACITY = { min: 8, max: 40, unknown: 24 };
let rate: number | null = null;

const known = new Map<string, Signature>();
const running = new Map<string, Promise<void>>();

const ready = (ref: Reference, embed: boolean) => {
  const signature = known.get(ref.thumbUrl);
  return signature && (!embed || signature.embedding) ? signature : undefined;
};

function collect(refs: Reference[]): Map<string, Signature> {
  const found = new Map<string, Signature>();
  for (const ref of refs) {
    const signature = known.get(ref.thumbUrl);
    if (signature) found.set(ref.id, signature);
  }
  return found;
}

function request(urls: string[], embed: boolean): Promise<void> {
  const job = analyzeImages(urls, embed)
    .then((signatures) =>
      signatures.forEach((signature, i) => {
        if (signature) known.set(urls[i], signature);
      }),
    )
    .catch(() => {})
    .finally(() => urls.forEach((url) => running.get(`${embed}|${url}`) === job && running.delete(`${embed}|${url}`)));
  urls.forEach((url) => running.set(`${embed}|${url}`, job));
  return job;
}

export const vision = {
  async analyze(
    refs: Reference[],
    { embed, budgetMs }: { embed: boolean; budgetMs?: number },
  ): Promise<Map<string, Signature>> {
    if (!isTauri()) return new Map();
    const missing = [...new Set(refs.filter((ref) => !ready(ref, embed)).map((ref) => ref.thumbUrl))];
    const jobs = missing.map((url) => running.get(`${embed}|${url}`));
    const fresh = missing.filter((_, i) => !jobs[i]);
    for (let i = 0; i < fresh.length; i += BATCH) jobs.push(request(fresh.slice(i, i + BATCH), embed));
    const all = Promise.all(jobs);
    await (budgetMs === undefined ? all : Promise.race([all, new Promise((resolve) => setTimeout(resolve, budgetMs))]));
    return collect(refs);
  },
  peek: collect,
  async capacity(budgetMs: number): Promise<number> {
    if (rate === null && isTauri()) rate = await visionRate().catch(() => null);
    return rate
      ? Math.round(Math.min(CAPACITY.max, Math.max(CAPACITY.min, (rate * budgetMs) / 1000)))
      : CAPACITY.unknown;
  },
};

export type Vision = typeof vision;
