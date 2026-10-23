import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { paletteOf } from "../src/lib/color";
import { type Fetch, search } from "../src/features/search/pipeline";
import { searchBing } from "../src/features/search/pipeline/bing";
import type { RankedList } from "../src/features/search/pipeline/rank";
import type { Reference, SearchPlan } from "../src/types";

interface Plan {
  id: string;
  name: string;
  collections: { name: string; prompt: string; size: number }[];
}

const PROJECTS: Plan[] = [
  {
    id: "seed-serra",
    name: "Casa na serra",
    collections: [
      { name: "Concreto e madeira", prompt: "casa de concreto aparente e madeira na montanha", size: 120 },
      { name: "Luz da manhã", prompt: "interior com luz natural da manhã entrando pela janela", size: 90 },
      { name: "Cozinhas", prompt: "cozinha minimalista de madeira clara", size: 80 },
      { name: "Varandas", prompt: "varanda com vista para montanha e neblina", size: 65 },
      { name: "Texturas", prompt: "textura de pedra e madeira rústica", size: 55 },
      { name: "Lareiras", prompt: "lareira moderna em sala de estar", size: 50 },
      { name: "Jardins secos", prompt: "jardim com plantas nativas e pedras", size: 40 },
    ],
  },
];

const BOARD = {
  pins: [
    [0, 0, -520, -260],
    [0, 3, -280, -300],
    [1, 0, -40, -250],
    [1, 4, 220, -290],
    [2, 1, -500, 60],
    [3, 0, -250, 40],
    [4, 2, 20, 70],
    [5, 0, 260, 30],
  ],
  notes: [
    { x: 520, y: -280, text: "Concreto aparente por fora, madeira clara por dentro." },
    { x: 520, y: 40, text: "Luz baixa de manhã entrando pela cozinha." },
  ],
  links: [
    [0, 1],
    [1, 2],
    [2, "n0"],
    [5, 6],
    [6, "n1"],
  ],
} as const;
const LOOSE = 6;

const APPROVE = 0.8;
const PACE = { request: 400, round: 2500, offline: 30_000 };
const RESERVES = 120;
const PASSES = 3;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const CACHE = option("--cache") ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ganymede-seed");
const APP = option("--dir") ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "com.jao.ganymede");
const MANIFEST = join(CACHE, "manifest.json");
mkdirSync(join(CACHE, "bing"), { recursive: true });

interface Manifest {
  refs: Record<string, Reference>;
  collections: Record<string, string[]>;
  failed: string[];
}

const manifest: Manifest = {
  refs: {},
  collections: {},
  failed: [],
  ...(existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {}),
};
const save = () => writeFileSync(MANIFEST, JSON.stringify(manifest));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const collectionId = (project: Plan, k: number) => `${project.id}-c${k}`;

let lastRequest = 0;
let requests = 0;
const fetcher: Fetch = async (query, page) => {
  const file = join(CACHE, "bing", `${Bun.hash(`${query}|${page}`).toString(16)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const wait = lastRequest + PACE.request - Date.now();
  lastRequest = Math.max(Date.now(), lastRequest + PACE.request);
  if (wait > 0) await sleep(wait);
  requests++;
  const refs = await searchBing(query, page);
  writeFileSync(file, JSON.stringify(refs));
  return refs;
};

async function fill(project: Plan, k: number) {
  const { prompt, size, name } = project.collections[k];
  const id = collectionId(project, k);
  const ids = (manifest.collections[id] ??= []);
  const others = project.collections.flatMap((_, j) =>
    j === k ? [] : (manifest.collections[collectionId(project, j)] ?? []),
  );
  const owned = others.map((refId) => manifest.refs[refId]);
  const approved = ids.map((refId) => manifest.refs[refId]);
  const shown = [...approved, ...manifest.failed.map((refId) => manifest.refs[refId])];
  const searched: SearchPlan[] = [];
  const reserves: RankedList[] = [];
  let offline = 0;
  while (ids.length < size) {
    const outcome = await search(
      {
        prompt,
        approved,
        shown,
        owned,
        searched,
        known: reserves.slice(-RESERVES),
        onList: (list) => reserves.push(list),
      },
      fetcher,
    );
    if (outcome.offline) {
      if (++offline > 1)
        throw new Error(
          `Bing stopped answering on "${name}": nothing was worked around; run again later (what came is cached)`,
        );
      console.warn(`  Bing is not answering; waiting ${PACE.offline / 1000} s`);
      await sleep(PACE.offline);
      continue;
    }
    offline = 0;
    if (!outcome.pool.length) break;
    const take = outcome.pool.slice(0, Math.ceil(outcome.pool.length * APPROVE)).slice(0, size - ids.length);
    shown.push(...outcome.pool);
    approved.push(...take);
    for (const ref of take) {
      manifest.refs[ref.id] = ref;
      ids.push(ref.id);
    }
    searched.push(outcome.plan);
    save();
    console.log(`  ${name}: ${ids.length}/${size} (${requests} Bing requests so far)`);
    await sleep(PACE.round);
  }
}

const usedIds = () => [
  ...new Set(
    PROJECTS.flatMap((project) =>
      project.collections.flatMap((_, k) => manifest.collections[collectionId(project, k)] ?? []),
    ),
  ),
];

if (flag("--reset"))
  for (const file of ["ganymede.db", "ganymede.db-wal", "ganymede.db-shm", "originals"])
    rmSync(join(APP, file), { recursive: true, force: true });
mkdirSync(APP, { recursive: true });
let pixels: Record<string, string> = {};
for (let pass = 0; pass < PASSES; pass++) {
  if (!flag("--offline")) {
    for (const project of PROJECTS) {
      console.log(project.name);
      for (let k = 0; k < project.collections.length; k++) await fill(project, k);
    }
  }
  const ids = usedIds();
  writeFileSync(join(CACHE, "images.json"), JSON.stringify(ids.map((id) => ({ id, url: manifest.refs[id].thumbUrl }))));
  const media = Bun.spawnSync(
    [
      "cargo",
      "run",
      "--quiet",
      "--example",
      "seed",
      "--",
      "--images",
      join(CACHE, "images.json"),
      "--cache",
      CACHE,
      "--dir",
      APP,
    ],
    {
      cwd: join(import.meta.dir, "../src-tauri"),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (media.exitCode !== 0) throw new Error("the image step (examples/seed.rs) failed");
  pixels = JSON.parse(readFileSync(join(CACHE, "pixels.json"), "utf8"));
  const missing = new Set(ids.filter((id) => !pixels[id]));
  if (!missing.size || flag("--offline")) break;
  console.log(`${missing.size} without an image: searching replacements`);
  manifest.failed.push(...missing);
  for (const id in manifest.collections)
    manifest.collections[id] = manifest.collections[id].filter((refId) => !missing.has(refId));
  save();
}
const unique = usedIds();

const db = new Database(join(APP, "ganymede.db"));
const put = db.prepare(
  "INSERT INTO items (kind, scope, id, data) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (kind, scope, id) DO UPDATE SET data = excluded.data",
);
const viewport = { x: 0, y: 0, scale: 1 };
const tilt = (i: number) => Math.round((i % 2 ? 1 : -1) * (0.3 + ((i * 7) % 10) / 11) * 10) / 10;
const order: string[] = [];
let kept = 0;
db.transaction(() => {
  for (const project of PROJECTS) {
    const nodes: string[] = [];
    const members: string[][] = [];
    project.collections.forEach(({ name, prompt }, k) => {
      const id = collectionId(project, k);
      const all = (manifest.collections[id] ?? []).filter((refId) => pixels[refId]);
      const refIds = k === project.collections.length - 1 ? all.slice(0, -LOOSE) : all;
      for (const refId of all) {
        const palette = paletteOf(Buffer.from(pixels[refId], "hex"), 3);
        put.run("ref", "", refId, JSON.stringify({ ...manifest.refs[refId], palette }));
      }
      kept += all.length;
      members.push(refIds);
      put.run("collection", "", id, JSON.stringify({ id, name, refIds, prompt, spaceId: project.id }));
      put.run(
        "node",
        project.id,
        `c:${id}`,
        JSON.stringify({ id: `c:${id}`, kind: "collection", collectionId: id, x: 0, y: 0 }),
      );
      nodes.push(`c:${id}`);
      order.push(id);
      if (all.length > refIds.length)
        all.slice(refIds.length).forEach((refId, i) => {
          const node = { id: `r:${refId}`, kind: "ref", refId, x: 600 + 60 * i, y: 400 };
          put.run("node", project.id, node.id, JSON.stringify(node));
          nodes.push(node.id);
        });
    });
    const pinned = BOARD.pins.flatMap(([k, i, x, y], n) =>
      members[k]?.[i] ? [{ refId: members[k][i], x, y, w: 220, angle: tilt(n) }] : [],
    );
    const notes = BOARD.notes.map((note, n) => ({ id: `note:seed${n}`, w: 200, angle: tilt(n + 3), ...note }));
    const end = (at: number | string) => (typeof at === "string" ? notes[Number(at.slice(1))]?.id : pinned[at]?.refId);
    const links = BOARD.links.flatMap(([a, b], n) =>
      end(a) && end(b) ? [{ id: `link:seed${n}`, from: end(a), to: end(b) }] : [],
    );
    const board = { viewport: { x: 700, y: 420, scale: 0.8 }, pins: pinned, notes, links };
    put.run(
      "space",
      "",
      project.id,
      JSON.stringify({ id: project.id, name: project.name, viewport, board, nodeOrder: nodes }),
    );
    db.prepare("DELETE FROM knn WHERE scope = ?").run(project.id);
    db.prepare("DELETE FROM items WHERE kind = 'place' AND scope = ?").run(project.id);
  }
  put.run("meta", "", "collections", JSON.stringify(order.join("\n")));
  put.run("meta", "", "view", JSON.stringify({ kind: "space", id: PROJECTS[0].id }));
  put.run("meta", "", "session", "null");
  put.run("meta", "", "recent", JSON.stringify([PROJECTS[0].id]));
})();
console.log(
  `${kept} references in ${PROJECTS.length} space(s) (${unique.length - Object.keys(pixels).length} without an image, dropped); ${requests} Bing requests in this run`,
);
