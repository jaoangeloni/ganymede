import { cssRgb, type Rgb } from "../../lib/color";
import type { Viewport } from "../../types";
import { type Adjacency, NODE_SIZE } from "./scene";

export interface SceneData {
  count: number;
  ids: string[];
  refs: string[];
  urls: (string | null)[];
  colors: string[];
  fills: string[];
  aspect: Float32Array;
  titles: string[];
  edges: Uint32Array;
  weights: Float32Array;
  graph: Adjacency;
}

export interface Look {
  bg: Rgb;
  fg: Rgb;
  primary: Rgb;
  font: string;
}

interface Frame {
  view: Viewport;
  width: number;
  height: number;
  now: number;
}

interface Thumb {
  bitmap: ImageBitmap;
  w: number;
  h: number;
  bytes: number;
  used: number;
}

type Slot = Thumb | "loading" | "failed" | undefined;

interface Ghost {
  x: number;
  y: number;
  w: number;
  h: number;
  thumb: Thumb | null;
  fill: string;
  at: number;
}

const TIERS = [32, 64, 128, 256];
const SIZE = { floor: 18, ceil: 150, power: 0.7 };
const MEMORY_CAP = 80 * 2 ** 20;
const LOADS = { flight: 24, perFrame: 16 };
const BORDER_PX = 1.75;
const BORDER_SHRINK = 4 / 3;
const CORNER = 0.12;
const EDGE = { width: 0.75, alpha: 0.3, litWidth: 1.25, litAlpha: 0.7 };
const FADE_MS = 80;
const GROW = { hover: 1.12, stiffness: 385, damping: 21.6 };
const ENTER_MS = 320;
const EXIT_MS = 260;
const DIM = 0.15;
const LABEL = { size: 80, max: 80, chars: 34 };

export const displaySize = (scale: number) =>
  Math.min(SIZE.ceil, Math.max(SIZE.floor, NODE_SIZE * scale ** SIZE.power));
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const tierOf = (px: number) => TIERS.findIndex((tier) => tier >= px) + 1 || TIERS.length;

export class Renderer {
  private context: CanvasRenderingContext2D;
  private scratch = document.createElement("canvas");
  private scene: SceneData | null = null;
  private positions: Float32Array = new Float32Array(0);
  private slots: Slot[][] = [];
  private store = new Map<string, Slot[]>();
  private bytes = 0;
  private flight = 0;
  private frameNo = 0;
  private visible = new Int32Array(0);
  private visibleCount = 0;
  private wants = new Int32Array(64);
  private wantCount = 0;
  private halfW = new Float32Array(0);
  private halfH = new Float32Array(0);
  private alpha = new Float32Array(0);
  private grow = new Float32Array(0);
  private growV = new Float32Array(0);
  private born = new Float64Array(0);
  private ghosts: Ghost[] = [];
  private dying: { slots: Slot[]; at: number }[] = [];
  private lit: Uint8Array | null = null;
  private selected: Uint8Array = new Uint8Array(0);
  private hovered = -1;
  private veil = "";
  private last = 0;
  private edgesShown = 0;
  private statsAt = 0;
  private cost = { edges: 0, nodes: 0, rest: 0 };
  private look: Look = { bg: [0, 0, 0], fg: [1, 1, 1], primary: [0.95, 0.85, 0.54], font: "sans-serif" };
  private dpr = 1;
  quality = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private onImage: () => void,
  ) {
    this.context = canvas.getContext("2d")!;
  }

  setLook(look: Look) {
    this.look = look;
  }

  setScene(scene: SceneData) {
    const now = performance.now();
    const store = new Map<string, Slot[]>();
    const previousSlots = this.slots;
    this.slots = scene.ids.map((_, i) => {
      const id = `${scene.urls[i]}|${scene.colors[i]}`;
      const slots = store.get(id) ?? this.store.get(id) ?? Array<Slot>(TIERS.length).fill(undefined);
      store.set(id, slots);
      return slots;
    });
    for (const [id, slots] of this.store) if (!store.has(id)) this.dying.push({ slots, at: now });
    this.store = store;
    const previous = this.scene;
    const alpha = new Float32Array(scene.count).fill(1);
    const grow = new Float32Array(scene.count).fill(1);
    const growV = new Float32Array(scene.count);
    const born = new Float64Array(scene.count).fill(previous ? now : 0);
    if (previous) {
      const before = new Map(previous.ids.map((id, i) => [id, i]));
      scene.ids.forEach((id, j) => {
        const i = before.get(id);
        if (i === undefined || i >= this.alpha.length) return;
        [alpha[j], grow[j], growV[j], born[j]] = [this.alpha[i], this.grow[i], this.growV[i], this.born[i]];
        before.delete(id);
      });
      for (const i of before.values()) this.bury(previous, previousSlots[i], i, now);
    }
    this.scene = scene;
    [this.alpha, this.grow, this.growV, this.born] = [alpha, grow, growV, born];
    this.visible = new Int32Array(scene.count);
    this.halfW = new Float32Array(scene.count);
    this.halfH = new Float32Array(scene.count);
    if (this.selected.length !== scene.count) this.selected = new Uint8Array(scene.count);
  }

  private bury(previous: SceneData, slots: Slot[] | undefined, i: number, now: number) {
    if (!this.halfW[i] || this.positions.length !== previous.count * 2) return;
    const thumb = slots?.find((slot): slot is Thumb => typeof slot === "object") ?? null;
    this.ghosts.push({
      x: this.positions[2 * i],
      y: this.positions[2 * i + 1],
      w: 2 * this.halfW[i],
      h: 2 * this.halfH[i],
      thumb,
      fill: previous.fills[i],
      at: now,
    });
  }

  setPositions(positions: Float32Array) {
    this.positions = positions;
  }

  setFocus(lit: Uint8Array | null, hovered: number, selected: Uint8Array) {
    [this.lit, this.hovered, this.selected] = [lit, hovered, selected];
  }

  retry(refIds: Set<string>) {
    this.scene?.refs.forEach((refId, i) => {
      if (!refIds.has(refId)) return;
      const slots = this.slots[i];
      slots.forEach((slot, t) => slot === "failed" && (slots[t] = undefined));
    });
  }

  hit(x: number, y: number): number {
    const p = this.positions;
    const view = this.view;
    let best = -1;
    let distance = Infinity;
    for (let k = 0; k < this.visibleCount; k++) {
      const i = this.visible[k];
      const [dx, dy] = [Math.abs(p[2 * i] * view.scale + view.x - x), Math.abs(p[2 * i + 1] * view.scale + view.y - y)];
      if (dx > this.halfW[i] || dy > this.halfH[i]) continue;
      const d = dx * dx + dy * dy - (this.selected[i] || i === this.hovered ? 1e4 : 0);
      if (d < distance) [best, distance] = [i, d];
    }
    return best;
  }

  private view: Viewport = { x: 0, y: 0, scale: 1 };

  draw(frame: Frame): boolean {
    const scene = this.scene;
    const context = this.context;
    this.frameNo++;
    this.view = frame.view;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const [width, height] = [Math.round(frame.width * dpr), Math.round(frame.height * dpr)];
    if (this.canvas.width !== width || this.canvas.height !== height || this.dpr !== dpr)
      [this.canvas.width, this.canvas.height, this.dpr] = [width, height, dpr];
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!scene || this.positions.length !== scene.count * 2) return false;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dt = this.last ? Math.min(100, frame.now - this.last) : 16;
    this.last = frame.now;
    const t0 = performance.now();
    const animating = this.animate(dt, frame.now);
    this.cull(frame);
    this.drawEdges(frame);
    const t1 = performance.now();
    this.drawNodes(frame);
    this.drawGhosts(frame);
    const t2 = performance.now();
    this.drawLabels(frame);
    this.load();
    const t3 = performance.now();
    this.cost.edges += (t1 - t0 - this.cost.edges) * 0.1;
    this.cost.nodes += (t2 - t1 - this.cost.nodes) * 0.1;
    this.cost.rest += (t3 - t2 - this.cost.rest) * 0.1;
    this.stats(frame.now);
    return animating || this.hovered >= 0;
  }

  private animate(dt: number, now: number): boolean {
    const k = 1 - Math.exp(-dt / FADE_MS);
    const step = Math.min(dt, 33) / 1000;
    let moving = false;
    for (let i = 0; i < this.alpha.length; i++) {
      const target = !this.lit || this.lit[i] ? 1 : DIM;
      const delta = target - this.alpha[i];
      if (Math.abs(delta) < 0.004) this.alpha[i] = target;
      else {
        this.alpha[i] += delta * k;
        moving = true;
      }
      const size = i === this.hovered ? GROW.hover : 1;
      if (this.grow[i] !== size || this.growV[i]) {
        this.growV[i] += (-GROW.stiffness * (this.grow[i] - size) - GROW.damping * this.growV[i]) * step;
        this.grow[i] += this.growV[i] * step;
        if (Math.abs(this.grow[i] - size) < 0.001 && Math.abs(this.growV[i]) < 0.01)
          [this.grow[i], this.growV[i]] = [size, 0];
        moving = true;
      }
      if (now - this.born[i] < ENTER_MS) moving = true;
    }
    while (this.dying.length && now - this.dying[0].at > EXIT_MS) this.drop(this.dying.shift()!.slots);
    this.ghosts = this.ghosts.filter((ghost) => now - ghost.at < EXIT_MS);
    return moving || this.ghosts.length > 0;
  }

  private cull({ view, width, height }: Frame) {
    const scene = this.scene!;
    const p = this.positions;
    const half = displaySize(view.scale) * 0.6;
    this.visibleCount = 0;
    for (let i = 0; i < scene.count; i++) {
      const [x, y] = [p[2 * i] * view.scale + view.x, p[2 * i + 1] * view.scale + view.y];
      if (x < -half || y < -half || x > width + half || y > height + half) continue;
      this.visible[this.visibleCount++] = i;
    }
  }

  private edgeLit(e: number): boolean {
    const scene = this.scene!;
    const [a, b] = [scene.edges[2 * e], scene.edges[2 * e + 1]];
    if (this.hovered >= 0) return a === this.hovered || b === this.hovered;
    return !!this.lit && !!this.lit[a] && !!this.lit[b];
  }

  private drawEdges({ view, width, height }: Frame) {
    const scene = this.scene!;
    const context = this.context;
    const p = this.positions;
    const focused = this.hovered >= 0 || !!this.lit;
    context.lineCap = "round";
    this.edgesShown = 0;
    for (const lit of focused ? [false, true] : [false]) {
      context.beginPath();
      for (let e = 0; e < scene.weights.length; e++) {
        if (lit !== (focused && this.edgeLit(e))) continue;
        const [a, b] = [scene.edges[2 * e], scene.edges[2 * e + 1]];
        const [ax, ay, bx, by] = [
          p[2 * a] * view.scale + view.x,
          p[2 * a + 1] * view.scale + view.y,
          p[2 * b] * view.scale + view.x,
          p[2 * b + 1] * view.scale + view.y,
        ];
        if ((ax < 0 && bx < 0) || (ay < 0 && by < 0) || (ax > width && bx > width) || (ay > height && by > height))
          continue;
        context.moveTo(ax, ay);
        context.lineTo(bx, by);
        this.edgesShown++;
      }
      context.lineWidth = lit ? EDGE.litWidth : EDGE.width;
      context.strokeStyle = cssRgb(this.look.fg, lit ? EDGE.litAlpha : EDGE.alpha * (focused ? DIM * 1.5 : 1));
      context.stroke();
    }
  }

  private drawNodes(frame: Frame) {
    const size = displaySize(frame.view.scale);
    this.veil = cssRgb(this.look.bg);
    this.wantCount = 0;
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < this.visibleCount; k++) {
        const i = this.visible[k];
        const top = i === this.hovered ? 2 : this.selected[i] || (this.lit && this.lit[i]) ? 1 : 0;
        if (top === pass) this.drawNode(i, size, frame);
      }
    }
    this.context.globalAlpha = 1;
  }

  private drawNode(i: number, size: number, { view, now }: Frame) {
    const scene = this.scene!;
    const context = this.context;
    const enter = easeOut(Math.min(1, (now - this.born[i]) / ENTER_MS));
    const px = size * this.grow[i] * (0.7 + 0.3 * enter);
    const want = tierOf(px * this.dpr * (this.selected[i] || i === this.hovered ? 1.5 : 1)) - 1;
    const slots = this.slots[i];
    let thumb: Thumb | null = null;
    const exact = slots[want];
    if (typeof exact === "object") thumb = exact;
    else {
      for (let d = 1; d < TIERS.length && !thumb; d++) {
        const lower = slots[want - d];
        const upper = slots[want + d];
        if (typeof upper === "object") thumb = upper;
        else if (typeof lower === "object") thumb = lower;
      }
      if (exact === undefined && scene.urls[i] && this.wantCount < this.wants.length)
        this.wants[this.wantCount++] = i * TIERS.length + want;
    }
    const aspect = thumb ? thumb.w / thumb.h : scene.aspect[i];
    const [w, h] = aspect >= 1 ? [px, px / aspect] : [px * aspect, px];
    const [x, y] = [this.positions[2 * i] * view.scale + view.x, this.positions[2 * i + 1] * view.scale + view.y];
    this.halfW[i] = w / 2;
    this.halfH[i] = h / 2;
    context.globalAlpha = enter;
    if (thumb) {
      thumb.used = this.frameNo;
      context.drawImage(thumb.bitmap, x - w / 2, y - h / 2, w, h);
    } else {
      context.fillStyle = scene.fills[i] || cssRgb(this.look.fg, 0.12);
      context.fillRect(x - w / 2, y - h / 2, w, h);
    }
    const dim = 1 - this.alpha[i];
    if (dim > 0.004) {
      context.globalAlpha = dim * enter;
      context.fillStyle = this.veil;
      context.fillRect(x - w / 2, y - h / 2, w, h);
    }
    if (this.selected[i]) {
      context.globalAlpha = 1;
      context.lineWidth = 2;
      context.strokeStyle = cssRgb(this.look.primary);
      context.beginPath();
      context.roundRect(x - w / 2 - 3.5, y - h / 2 - 3.5, w + 7, h + 7, Math.min(w, h) * CORNER + 3);
      context.stroke();
    }
  }

  private drawGhosts({ view, now }: Frame) {
    const context = this.context;
    for (const ghost of this.ghosts) {
      const t = easeOut(Math.min(1, (now - ghost.at) / EXIT_MS));
      const [w, h] = [ghost.w * (1 - 0.15 * t), ghost.h * (1 - 0.15 * t)];
      const [x, y] = [ghost.x * view.scale + view.x - w / 2, ghost.y * view.scale + view.y - h / 2];
      context.globalAlpha = 1 - t;
      if (ghost.thumb) {
        ghost.thumb.used = this.frameNo;
        context.drawImage(ghost.thumb.bitmap, x, y, w, h);
      } else {
        context.fillStyle = ghost.fill || cssRgb(this.look.fg, 0.12);
        context.fillRect(x, y, w, h);
      }
    }
    context.globalAlpha = 1;
  }

  private drawLabels({ view }: Frame) {
    const scene = this.scene!;
    const context = this.context;
    const all = displaySize(view.scale) >= LABEL.size;
    let shown = 0;
    context.font = `500 12px ${this.look.font}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.lineJoin = "round";
    for (let k = 0; k < this.visibleCount && shown < LABEL.max; k++) {
      const i = this.visible[k];
      if (!all && i !== this.hovered && !this.selected[i]) continue;
      const title = scene.titles[i];
      if (!title) continue;
      const text = title.length > LABEL.chars ? `${title.slice(0, LABEL.chars - 1)}…` : title;
      const [x, y] = [
        this.positions[2 * i] * view.scale + view.x,
        this.positions[2 * i + 1] * view.scale + view.y + this.halfH[i] + 6,
      ];
      context.globalAlpha = this.alpha[i];
      context.lineWidth = 3;
      context.strokeStyle = cssRgb(this.look.bg, 0.9);
      context.strokeText(text, x, y);
      context.fillStyle = cssRgb(this.look.fg, 0.85);
      context.fillText(text, x, y);
      shown++;
    }
    context.globalAlpha = 1;
  }

  private load() {
    const scene = this.scene!;
    let started = 0;
    for (let k = 0; k < this.wantCount && this.flight < LOADS.flight && started < LOADS.perFrame; k++) {
      const [i, tier] = [Math.floor(this.wants[k] / TIERS.length), this.wants[k] % TIERS.length];
      const slots = this.slots[i];
      if (slots[tier] !== undefined) continue;
      slots[tier] = "loading";
      this.flight++;
      started++;
      this.bake(scene.urls[i]!, TIERS[tier], scene.colors[i]).then(
        (thumb) => {
          this.flight--;
          if (slots[tier] !== "loading") return thumb.bitmap.close();
          slots[tier] = thumb;
          this.bytes += thumb.bytes;
          this.evict();
          this.onImage();
        },
        () => {
          this.flight--;
          if (slots[tier] === "loading") slots[tier] = "failed";
        },
      );
    }
  }

  private async bake(url: string, side: number, color: string): Promise<Thumb> {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const natural = image.naturalWidth / image.naturalHeight || 1;
    const aspect = Math.min(3, Math.max(1 / 3, natural));
    const [w, h] =
      aspect >= 1 ? [side, Math.max(1, Math.round(side / aspect))] : [Math.max(1, Math.round(side * aspect)), side];
    const [sw, sh] =
      natural > aspect
        ? [image.naturalHeight * aspect, image.naturalHeight]
        : [image.naturalWidth, image.naturalWidth / aspect];
    const canvas = this.scratch;
    [canvas.width, canvas.height] = [w, h];
    const context = canvas.getContext("2d")!;
    const radius = Math.min(w, h) * CORNER;
    context.save();
    context.beginPath();
    context.roundRect(0, 0, w, h, radius);
    context.clip();
    context.imageSmoothingQuality = "high";
    context.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
    context.restore();
    if (color) {
      const line = BORDER_PX * this.dpr * BORDER_SHRINK;
      context.lineWidth = line;
      context.globalAlpha = 0.85;
      context.strokeStyle = color;
      context.beginPath();
      context.roundRect(line / 2, line / 2, w - line, h - line, Math.max(0, radius - line / 2));
      context.stroke();
      context.globalAlpha = 1;
    }
    const bitmap = await createImageBitmap(canvas);
    return { bitmap, w, h, bytes: w * h * 4, used: this.frameNo };
  }

  private evict() {
    if (this.bytes <= MEMORY_CAP) return;
    const all: [Slot[], number, Thumb][] = [];
    for (const slots of this.store.values())
      slots.forEach((slot, t) => typeof slot === "object" && slot.used < this.frameNo && all.push([slots, t, slot]));
    all.sort((a, b) => a[2].used - b[2].used);
    for (const [slots, t, thumb] of all) {
      if (this.bytes <= MEMORY_CAP * 0.9) break;
      thumb.bitmap.close();
      slots[t] = undefined;
      this.bytes -= thumb.bytes;
    }
  }

  private drop(slots: Slot[]) {
    slots.forEach((slot, t) => {
      if (typeof slot !== "object") return;
      slot.bitmap.close();
      this.bytes -= slot.bytes;
      slots[t] = undefined;
    });
  }

  private stats(now: number) {
    if (now - this.statsAt < 500 || !this.canvas.isConnected) return;
    this.statsAt = now;
    const ms = (value: number) => value.toFixed(1);
    this.canvas.dataset.stats = [
      `map  ${this.visibleCount}/${this.scene?.count ?? 0} nodes  ${this.edgesShown} edges  bitmaps ${(this.bytes / 2 ** 20).toFixed(1)} MB  quality ${this.quality}`,
      `draw  edges ${ms(this.cost.edges)}  nodes ${ms(this.cost.nodes)}  rest ${ms(this.cost.rest)} ms`,
    ].join("\n");
  }

  destroy() {
    for (const slots of this.store.values()) this.drop(slots);
    for (const { slots } of this.dying) this.drop(slots);
    this.store.clear();
    this.dying = [];
  }
}
