import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LayoutIn, LayoutOut } from "../src/features/graph/layout.worker";

const LIMIT = { jitter: 0.05, flips: 0.01 };
const SECONDS = 20;
const MIN_SIMILARITY = 0.6;
const SPACING = 50;

const dbPath =
  process.env.GANYMEDE_DB ??
  join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "com.jao.ganymede/ganymede.db");
const db = new Database(dbPath, { readonly: true });
const scope =
  process.argv[2] ??
  (db.query("SELECT scope FROM knn GROUP BY scope ORDER BY count(*) DESC LIMIT 1").get() as { scope: string } | null)
    ?.scope;
if (!scope) throw new Error("no neighbors in the database: open a space in the app once");

const lists = db.query("SELECT id, list FROM knn WHERE scope = ?").all(scope) as { id: string; list: string }[];
const index = new Map(lists.map(({ id }, i) => [id, i]));
const pairs = new Map<string, number>();
for (const { id, list } of lists) {
  const i = index.get(id)!;
  for (const [other, w] of JSON.parse(list) as [string, number][]) {
    const j = index.get(other);
    if (j !== undefined && w >= MIN_SIMILARITY) pairs.set(i < j ? `${i} ${j}` : `${j} ${i}`, w);
  }
}
const n = lists.length;
const positions = new Float32Array(2 * n);
for (let i = 0; i < n; i++) {
  const [radius, angle] = [SPACING * Math.sqrt(i + 0.5), i * Math.PI * (3 - Math.sqrt(5))];
  [positions[2 * i], positions[2 * i + 1]] = [radius * Math.cos(angle), radius * Math.sin(angle)];
}

const worker = new Worker(new URL("../src/features/graph/layout.worker.ts", import.meta.url));
const frames: Float32Array[] = [];
worker.onmessage = ({ data }: MessageEvent<LayoutOut>) => {
  frames.push(Float32Array.from(data.positions));
  worker.postMessage({ type: "give-back", positions: data.positions } satisfies LayoutIn, [data.positions.buffer]);
};
const send = (message: LayoutIn) => worker.postMessage(message);
send({
  type: "load",
  positions,
  radius: new Float32Array(n).fill(20),
  edges: Uint32Array.from([...pairs.keys()].flatMap((key) => key.split(" ").map(Number))),
  weights: Float32Array.from(pairs.values()),
  warm: true,
});
send({ type: "pace", hz: 30, drift: true });
await Bun.sleep(SECONDS * 1000);
worker.terminate();

const tail = frames.slice(Math.floor(frames.length * 0.6));
let [jitter, flips] = [0, 0];
for (let i = 0; i < n; i++) {
  for (let t = 1; t < tail.length - 1; t++) {
    for (const k of [2 * i, 2 * i + 1]) {
      const [a, b, c] = [tail[t - 1][k], tail[t][k], tail[t + 1][k]];
      jitter += (c - 2 * b + a) ** 2;
      if ((b - a) * (c - b) < 0 && Math.abs(c - b) > 0.05) flips++;
    }
  }
}
const samples = 2 * n * Math.max(1, tail.length - 2);
const result = {
  space: scope,
  nodes: n,
  edges: pairs.size,
  ticks: frames.length,
  jitter: +Math.sqrt(jitter / samples).toFixed(4),
  flips: +(flips / samples).toFixed(4),
};
console.log(JSON.stringify(result));
if (result.jitter > LIMIT.jitter || result.flips > LIMIT.flips) {
  console.error(`the graph jitters at rest (limits: jitter ${LIMIT.jitter}, flips ${LIMIT.flips})`);
  process.exit(1);
}
