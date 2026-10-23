import { useEffect, useRef } from "react";
import { reduceMotion } from "../../lib/platform";

const STEP = 22;
const DOT = 0.85;
const FRAME_MS = 1000 / 30;
const BUCKETS = 12;
const PING = { every: 6500, first: 500, speed: 0.2, width: 80, lift: 1.5, push: 4, glow: 0.55 };
const TYPED = { strength: 0.32, gap: 140 };
const LENS = { radius: 150, lift: 1.1, push: 6, glow: 0.45, follow: 0.2 };

type Ping = { at: number; strength: number };

function readInk() {
  const match = getComputedStyle(document.documentElement)
    .getPropertyValue("--grid-dot")
    .match(/[\d.]+/g);
  const [r, g, b, a] = (match ?? ["0", "0", "0", "0.2"]).map(Number);
  return { rgb: `${r} ${g} ${b}`, alpha: a ?? 1 };
}

const bump = (x: number) => (Math.abs(x) >= 1 ? 0 : (1 + Math.cos(Math.PI * x)) / 2);

export function DotField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current!;
    const host = element.parentElement!;
    const context = element.getContext("2d")!;
    const still = reduceMotion();
    let ink = readInk();
    let [width, height, origin] = [0, 0, { x: 0, y: 0 }];
    const pings: Ping[] = [{ at: performance.now() + PING.first, strength: 1 }];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0, presence: 0, inside: false };
    let [frame, last, typed] = [0, 0, 0];

    const base = document.createElement("canvas");
    let paper = "";
    let ratio = 1;
    const grid = () => {
      const [x0, y0] = [((width / 2) % STEP) - STEP, ((height / 2) % STEP) - STEP];
      const corner = Math.hypot(width / 2, height / 2);
      const dots: { x: number; y: number; alpha: number }[] = [];
      for (let y = y0; y < height + STEP; y += STEP)
        for (let x = x0; x < width + STEP; x += STEP)
          dots.push({
            x,
            y,
            alpha: ink.alpha * (1 - 0.55 * (Math.hypot(x - width / 2, y - height / 2) / corner) ** 2),
          });
      return dots;
    };
    let dots = grid();
    const bucketsOf = () => Array.from({ length: BUCKETS }, () => new Path2D());
    const fillBuckets = (target: CanvasRenderingContext2D, paths: Path2D[]) => {
      target.fillStyle = `rgb(${ink.rgb})`;
      paths.forEach((path, i) => {
        if (!i) return;
        target.globalAlpha = i / (BUCKETS - 1);
        target.fill(path);
      });
      target.globalAlpha = 1;
    };
    const bucket = (alpha: number) => Math.min(BUCKETS - 1, Math.round(Math.min(1, alpha) * (BUCKETS - 1)));
    const paintBase = () => {
      dots = grid();
      paper = getComputedStyle(host).backgroundColor;
      [base.width, base.height] = [element.width, element.height];
      const target = base.getContext("2d")!;
      target.setTransform(ratio, 0, 0, ratio, 0, 0);
      const paths = bucketsOf();
      for (const { x, y, alpha } of dots) {
        paths[bucket(alpha)].moveTo(x + DOT, y);
        paths[bucket(alpha)].arc(x, y, DOT, 0, 2 * Math.PI);
      }
      fillBuckets(target, paths);
    };

    const measure = () => {
      ratio = Math.min(2, devicePixelRatio || 1);
      [width, height] = [host.clientWidth, host.clientHeight];
      [element.width, element.height] = [Math.round(width * ratio), Math.round(height * ratio)];
      const prompt = host.querySelector("[data-prompt]")?.getBoundingClientRect();
      const box = host.getBoundingClientRect();
      origin = prompt
        ? { x: prompt.left - box.left + prompt.width / 2, y: prompt.top - box.top + prompt.height / 2 }
        : { x: width / 2, y: height / 2 };
      paintBase();
    };

    let idle = false;
    const draw = (now: number) => {
      const reach =
        Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y)) + PING.width;
      while (pings.length && (now - pings[0].at) * PING.speed > reach) pings.shift();
      pointer.x += (pointer.tx - pointer.x) * LENS.follow;
      pointer.y += (pointer.ty - pointer.y) * LENS.follow;
      pointer.presence += ((pointer.inside ? 1 : 0) - pointer.presence) * 0.12;
      const rings = pings.flatMap(({ at, strength }) =>
        now < at
          ? []
          : [{ r: (now - at) * PING.speed, strength: strength * (1 - ((now - at) * PING.speed) / reach) ** 1.3 }],
      );
      const quiet = !rings.length && pointer.presence < 0.01;
      if (quiet && idle) return;
      idle = quiet;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element.width, element.height);
      context.drawImage(base, 0, 0);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (quiet) return;
      const erase = new Path2D();
      const paths = bucketsOf();
      const lensReach = LENS.radius * pointer.presence;
      for (const { x, y, alpha: rest } of dots) {
        const [ox, oy] = [x - origin.x, y - origin.y];
        const distance = Math.sqrt(ox * ox + oy * oy) || 1;
        let wave = 0;
        for (const ring of rings) wave += ring.strength * bump((distance - ring.r) / PING.width);
        const [px, py] = [x - pointer.x, y - pointer.y];
        const near =
          Math.abs(px) < lensReach && Math.abs(py) < lensReach ? Math.sqrt(px * px + py * py) || 1 : Infinity;
        const lens = pointer.presence * Math.max(0, 1 - near / LENS.radius) ** 2;
        if (wave < 0.01 && lens < 0.01) continue;
        const [dx, dy] = [
          (ox / distance) * wave * PING.push + (px / near) * lens * LENS.push,
          (oy / distance) * wave * PING.push + (py / near) * lens * LENS.push,
        ];
        const radius = DOT + wave * PING.lift + lens * LENS.lift;
        const path = paths[bucket(rest + wave * PING.glow * ink.alpha * 2 + lens * LENS.glow)];
        erase.moveTo(x + DOT + 0.6, y);
        erase.arc(x, y, DOT + 0.6, 0, 2 * Math.PI);
        path.moveTo(x + dx + radius, y + dy);
        path.arc(x + dx, y + dy, radius, 0, 2 * Math.PI);
      }
      context.fillStyle = paper;
      context.fill(erase);
      fillBuckets(context, paths);
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS - 2) return;
      last = now;
      const latest = pings.at(-1)?.at ?? 0;
      if (now - latest > PING.every) pings.push({ at: now, strength: 1 });
      draw(now);
    };

    const ping = (strength: number) => {
      const now = performance.now();
      if (still || now - typed < TYPED.gap) return;
      typed = now;
      pings.push({ at: now, strength });
    };
    const onInput = () => ping(TYPED.strength);
    const onSubmit = () => ping(1.6);
    const onMove = (event: PointerEvent) => {
      const box = host.getBoundingClientRect();
      [pointer.tx, pointer.ty] = [event.clientX - box.left, event.clientY - box.top];
      if (!pointer.inside) [pointer.x, pointer.y] = [pointer.tx, pointer.ty];
      pointer.inside = true;
    };
    const onLeave = () => (pointer.inside = false);
    const resize = new ResizeObserver(() => {
      measure();
      idle = false;
      if (still) draw(performance.now());
    });
    const theme = new MutationObserver(() => {
      ink = readInk();
      paintBase();
      idle = false;
      if (still) draw(performance.now());
    });

    measure();
    resize.observe(host);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    host.addEventListener("input", onInput);
    host.addEventListener("submit", onSubmit, true);
    if (still) draw(performance.now());
    else {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
      frame = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      theme.disconnect();
      host.removeEventListener("input", onInput);
      host.removeEventListener("submit", onSubmit, true);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 size-full" />;
}
