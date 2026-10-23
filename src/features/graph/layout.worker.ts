import {
  forceCollide,
  type ForceLink,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { type Adjacency, adjacency, otherEnd } from "./scene";

interface Body extends SimulationNodeDatum {
  r: number;
  phase: number;
}

type Edge = SimulationLinkDatum<Body> & { w: number };

export type LayoutIn =
  | {
      type: "load";
      positions: Float32Array;
      radius: Float32Array;
      edges: Uint32Array;
      weights: Float32Array;
      warm: boolean;
    }
  | { type: "edges"; edges: Uint32Array; weights: Float32Array }
  | { type: "hold"; indices: number[]; positions: number[] }
  | { type: "let-go"; indices: number[] }
  | { type: "hover"; index: number }
  | { type: "pace"; hz: number; drift: boolean }
  | { type: "give-back"; positions: Float32Array<ArrayBuffer> };

export type LayoutOut = { type: "tick"; positions: Float32Array<ArrayBuffer>; first: boolean; calm: boolean };

const FORCES = { charge: -70, link: 2, near: 60, far: 130, gap: 9, collide: 0.7, gravity: 0.02, velocity: 0.4 };
const HEAT = { rest: 0.012, held: 0.12, edges: 0.12, load: 0.08 };
const WARM = { ms: 300, alpha: 0.05 };
const CALM = 0.05;
const DRIFT = { force: 0.07, period: 9000, hz: 30 };
const PULL = { strength: 0.03, ring: 1.6, spread: 0.9, tau: 85 };

let bodies: Body[] = [];
let pairs: Uint32Array = new Uint32Array(0);
let degree = new Uint32Array(0);
let graph: Adjacency = adjacency(0, pairs);
let simulation: Simulation<Body, Edge> | null = null;
let spares: Float32Array<ArrayBuffer>[] = [];
let hz = 30;
let drift = true;
let timer = 0;
let held = 0;
let calmed = false;
const pull = { index: -1, level: 0, target: 0, at: 0 };

function drifting() {
  if (!drift) return;
  const t = (performance.now() * 2 * Math.PI) / DRIFT.period;
  const force = DRIFT.force * (DRIFT.hz / Math.max(hz, 1));
  for (const body of bodies) {
    body.vx! += force * Math.sin(t + body.phase);
    body.vy! += force * Math.cos(0.83 * t + 1.7 * body.phase);
  }
}

function pulling() {
  const now = performance.now();
  pull.level += (pull.target - pull.level) * (1 - Math.exp(-(now - pull.at) / PULL.tau));
  pull.at = now;
  const center = bodies[pull.index];
  if (!center || pull.level < 0.01) return;
  for (let e = graph.start[pull.index]; e < graph.start[pull.index + 1]; e++) {
    const body = bodies[otherEnd(pairs, graph.edges[e], pull.index)];
    if (body.fx != null) continue;
    const [dx, dy] = [center.x! - body.x!, center.y! - body.y!];
    const distance = Math.hypot(dx, dy) || 1;
    const ring = (center.r + body.r) * Math.max(PULL.ring, PULL.spread * Math.sqrt(degree[pull.index]));
    const k = (Math.max(0, distance - ring) / distance) * PULL.strength * pull.level;
    body.vx! += dx * k;
    body.vy! += dy * k;
  }
}

const heat = () => (held ? HEAT.held : HEAT.rest);

function post(first: boolean, calm = false) {
  const positions = spares.pop() ?? (first || calm ? new Float32Array(bodies.length * 2) : null);
  if (!positions) return;
  for (let i = 0; i < bodies.length; i++) {
    positions[2 * i] = bodies[i].x!;
    positions[2 * i + 1] = bodies[i].y!;
  }
  postMessage({ type: "tick", positions, first, calm } satisfies LayoutOut, { transfer: [positions.buffer] });
}

function loop() {
  clearTimeout(timer);
  if (!simulation || !hz) return;
  const started = performance.now();
  simulation.alphaTarget(heat()).tick();
  const calm = !calmed && simulation.alpha() < CALM;
  calmed ||= calm;
  post(false, calm);
  timer = self.setTimeout(loop, Math.max(0, 1000 / hz - (performance.now() - started)));
}

function linksOf(edges: Uint32Array, weights: Float32Array): Edge[] {
  degree = new Uint32Array(bodies.length);
  for (const i of edges) degree[i]++;
  return Array.from(weights, (w, k) => ({ source: edges[2 * k], target: edges[2 * k + 1], w }));
}

const strengthOf = (link: Edge) =>
  (FORCES.link * link.w) / Math.min(degree[(link.source as Body).index!], degree[(link.target as Body).index!]);

const distanceOf = (link: Edge) =>
  FORCES.near + (FORCES.far - FORCES.near) * Math.min(1, Math.max(0, (1 - link.w) / 0.4));

function load({ positions, radius, edges, weights, warm }: Extract<LayoutIn, { type: "load" }>) {
  clearTimeout(timer);
  spares = [new Float32Array(radius.length * 2), new Float32Array(radius.length * 2)];
  pairs = edges;
  graph = adjacency(radius.length, edges);
  pull.index = -1;
  pull.level = pull.target = 0;
  held = 0;
  calmed = false;
  bodies = Array.from(radius, (r, i) => {
    const [x, y] = [positions[2 * i], positions[2 * i + 1]];
    const known = Number.isFinite(x) && Number.isFinite(y);
    return { index: i, r, phase: Math.random() * 2 * Math.PI, ...(known && { x, y }) };
  });
  simulation = forceSimulation(bodies)
    .stop()
    .alpha(warm ? 1 : HEAT.load)
    .alphaTarget(HEAT.rest)
    .velocityDecay(FORCES.velocity)
    .force("charge", forceManyBody<Body>().strength(FORCES.charge).theta(0.9))
    .force("link", forceLink<Body, Edge>(linksOf(edges, weights)).distance(distanceOf).strength(strengthOf))
    .force(
      "collide",
      forceCollide<Body>((body) => body.r + FORCES.gap)
        .strength(FORCES.collide)
        .iterations(1),
    )
    .force("x", forceX<Body>(0).strength(FORCES.gravity))
    .force("y", forceY<Body>(0).strength(FORCES.gravity))
    .force("drift", drifting)
    .force("pull", pulling);
  if (warm) {
    const start = performance.now();
    while (simulation.alpha() > WARM.alpha && performance.now() - start < WARM.ms) simulation.tick();
  }
  post(true);
  loop();
}

self.onmessage = ({ data }: MessageEvent<LayoutIn>) => {
  if (data.type === "load") return load(data);
  if (data.type === "give-back") {
    if (data.positions.length === bodies.length * 2 && spares.length < 2) spares.push(data.positions);
    return;
  }
  if (data.type === "pace") {
    const resume = !hz && data.hz;
    [hz, drift] = [data.hz, data.drift];
    if (resume) loop();
    return;
  }
  if (!simulation) return;
  if (data.type === "edges") {
    pairs = data.edges;
    graph = adjacency(bodies.length, data.edges);
    simulation.force<ForceLink<Body, Edge>>("link")!.links(linksOf(data.edges, data.weights));
    simulation.alpha(Math.max(simulation.alpha(), HEAT.edges));
    return;
  }
  if (data.type === "hover") {
    if (data.index !== pull.index && data.index >= 0) pull.level = 0;
    if (data.index >= 0) pull.index = data.index;
    pull.target = data.index >= 0 ? 1 : 0;
    pull.at = performance.now();
    return;
  }
  if (data.type === "hold") {
    held = data.indices.length;
    data.indices.forEach((i, k) => {
      bodies[i].fx = data.positions[2 * k];
      bodies[i].fy = data.positions[2 * k + 1];
    });
    simulation.alpha(Math.max(simulation.alpha(), HEAT.held));
    return;
  }
  held = 0;
  for (const i of data.indices) {
    const body = bodies[i];
    if (body) body.fx = body.fy = null;
  }
};
