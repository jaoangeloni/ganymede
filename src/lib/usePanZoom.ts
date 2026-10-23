import { type RefObject, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Point, Viewport } from "../types";
import { flight, rubber, zoomAt, zoomBetween } from "./camera";
import { reduceMotion } from "./platform";

const WHEEL = { k: 0.0025, pinch: 0.01, ms: 380, fine: 150 };
const BOUNCE_MS = 420;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const FLING = { min: 0.35, max: 2.4, stop: 0.02, ms: 240 };
const FLING_WINDOW_MS = 80;
const REFRESH_MS = 120;
const GLIDE_MS = { min: 450, max: 1300 };
const ANCHOR_MS = 800;

let anchoredUntil = 0;
export const keepCenterOnResize = () => void (anchoredUntil = performance.now() + ANCHOR_MS);

const scrollsInside = ({ target, deltaY }: WheelEvent) => {
  const box = target instanceof Element ? target.closest<HTMLElement>("[data-scroll]") : null;
  if (!box || box.scrollHeight <= box.clientHeight + 1) return false;
  return deltaY < 0 ? box.scrollTop > 0 : box.scrollTop + box.clientHeight < box.scrollHeight - 1;
};

export function usePanZoom(
  surface: RefObject<HTMLElement | null>,
  saved: Viewport,
  onCommit: (view: Viewport) => void,
  onWheel?: () => void,
  paint?: (view: Viewport) => void,
  limit?: (view: Viewport, anchor?: Point) => Viewport,
) {
  const live = useRef<Viewport | null>(null);
  const [, refresh] = useState(0);
  const view = live.current ?? saved;
  const current = useRef({ view, onWheel, paint, limit });
  current.current = { view, onWheel, paint, limit };
  const frame = useRef(0);
  const refreshed = useRef(0);
  const refreshTimer = useRef(0);
  const redraw = () => {
    refreshed.current = performance.now();
    refresh((count) => count + 1);
  };
  const show = (next: Viewport | null) => {
    live.current = next;
    if (next) current.current.view = next;
    const draw = current.current.paint;
    if (!draw || !next) {
      cancelAnimationFrame(frame.current);
      clearTimeout(refreshTimer.current);
      frame.current = refreshTimer.current = 0;
      return redraw();
    }
    frame.current ||= requestAnimationFrame(() => {
      frame.current = 0;
      if (live.current) draw(live.current);
    });
    const wait = REFRESH_MS - (performance.now() - refreshed.current);
    clearTimeout(refreshTimer.current);
    if (wait <= 0) redraw();
    else refreshTimer.current = window.setTimeout(redraw, wait);
  };
  const inertia = useRef(0);
  const flight = useRef<{
    from: Viewport;
    to: Viewport;
    start: number;
    ms: number;
    ease: (t: number) => number;
  } | null>(null);
  const committed = useRef(saved);
  const grabbed = useRef<{ origin: Viewport; view: Viewport; trail: { t: number; x: number; y: number }[] } | null>(
    null,
  );

  const commit = (next: Viewport) => {
    committed.current = next;
    onCommit(next);
    show(null);
  };
  const halt = () => {
    cancelAnimationFrame(inertia.current);
    inertia.current = 0;
    flight.current = null;
  };
  const settle = () => {
    if (!inertia.current) return;
    halt();
    commit(current.current.view);
  };
  const soft = (next: Viewport) => {
    const inside = current.current.limit?.(next);
    if (!inside || inside.scale !== next.scale) return next;
    return { ...inside, x: inside.x + rubber(next.x - inside.x), y: inside.y + rubber(next.y - inside.y) };
  };
  const fly = (to: Viewport, ms: number, ease: (t: number) => number) => {
    const now = performance.now();
    flight.current = { from: current.current.view, to, start: now, ms: reduceMotion() ? 0 : ms, ease };
    if (inertia.current) return;
    const step = (frame: number) => {
      const trip = flight.current;
      if (!trip) return;
      const k = trip.ms ? Math.min(1, (frame - trip.start) / trip.ms) : 1;
      const next = k < 1 ? zoomBetween(trip.from, trip.to, trip.ease(k)) : trip.to;
      current.current.view = next;
      if (k >= 1) {
        inertia.current = 0;
        flight.current = null;
        return commit(next);
      }
      show(next);
      inertia.current = requestAnimationFrame(step);
    };
    inertia.current = requestAnimationFrame(step);
  };
  const rest = (at: Viewport) => {
    const inside = current.current.limit?.(at);
    if (inside && (Math.abs(inside.x - at.x) > 0.5 || Math.abs(inside.y - at.y) > 0.5 || inside.scale !== at.scale)) {
      current.current.view = at;
      fly(inside, BOUNCE_MS, easeOut);
    } else commit(at);
  };

  const adopt = useEffectEvent((next: Viewport) => {
    if (next === committed.current) return;
    committed.current = next;
    halt();
    show(null);
  });
  useEffect(() => adopt(saved), [saved]);

  const wheelAt = useEffectEvent((event: WheelEvent, element: HTMLElement) => {
    if (scrollsInside(event)) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const { limit } = current.current;
    const going = flight.current;
    const from = going?.to ?? current.current.view;
    const zoomed = zoomAt(from, point, Math.exp(-delta * (event.ctrlKey ? WHEEL.pinch : WHEEL.k)));
    const to = limit ? limit(zoomed, point) : zoomed;
    current.current.onWheel?.();
    if (inertia.current && !going) halt();
    const fine = event.ctrlKey || Math.abs(delta) < 40;
    fly(to, fine ? WHEEL.fine : WHEEL.ms, going ? easeOut : easeInOut);
  });
  const recenter = useEffectEvent((dx: number, dy: number) => {
    if (performance.now() > anchoredUntil || grabbed.current || inertia.current) return;
    const { view } = current.current;
    commit({ ...view, x: view.x + dx, y: view.y + dy });
  });
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => wheelAt(event, element);
    element.addEventListener("wheel", wheel, { passive: false });
    let [width, height] = [element.clientWidth, element.clientHeight];
    const observer = new ResizeObserver(() => {
      const [dx, dy] = [(element.clientWidth - width) / 2, (element.clientHeight - height) / 2];
      const measured = width > 0 && height > 0;
      [width, height] = [element.clientWidth, element.clientHeight];
      if (measured && (dx || dy)) recenter(dx, dy);
    });
    observer.observe(element);
    return () => {
      element.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, [surface]);
  useEffect(
    () => () => {
      halt();
      cancelAnimationFrame(frame.current);
      clearTimeout(refreshTimer.current);
    },
    [],
  );

  const grab = () => {
    settle();
    grabbed.current = { origin: current.current.view, view: current.current.view, trail: [] };
  };
  const drag = (event: { clientX: number; clientY: number }, dx: number, dy: number) => {
    const pan = grabbed.current;
    if (!pan) return;
    const now = performance.now();
    pan.view = soft({ ...pan.origin, x: pan.origin.x + dx, y: pan.origin.y + dy });
    pan.trail = [
      ...pan.trail.filter((point) => now - point.t < FLING_WINDOW_MS),
      { t: now, x: event.clientX, y: event.clientY },
    ];
    show(pan.view);
  };
  const release = () => {
    const pan = grabbed.current;
    grabbed.current = null;
    if (!pan?.trail.length) return;
    const now = performance.now();
    const trail = pan.trail.filter((point) => now - point.t < FLING_WINDOW_MS);
    const [first, last] = [trail[0], trail.at(-1)];
    const span = first && last ? last.t - first.t : 0;
    let [vx, vy] = first && last && span > 0 ? [(last.x - first.x) / span, (last.y - first.y) / span] : [0, 0];
    const speed = Math.hypot(vx, vy);
    if (speed < FLING.min || reduceMotion()) return rest(pan.view);
    if (speed > FLING.max) [vx, vy] = [(vx * FLING.max) / speed, (vy * FLING.max) / speed];
    let next = pan.view;
    let time = now;
    current.current.view = next;
    const step = (frame: number) => {
      const dt = Math.min(48, frame - time);
      time = frame;
      next = { ...next, x: next.x + vx * dt, y: next.y + vy * dt };
      const out = soft(next);
      const decay = Math.exp(-dt / (out.x !== next.x || out.y !== next.y ? FLING.ms / 4 : FLING.ms));
      next = out;
      vx *= decay;
      vy *= decay;
      current.current.view = next;
      if (Math.hypot(vx, vy) < FLING.stop) {
        inertia.current = 0;
        return rest(next);
      }
      show(next);
      inertia.current = requestAnimationFrame(step);
    };
    inertia.current = requestAnimationFrame(step);
  };

  return { view, settle, grab, drag, release };
}

export function useGlide(
  target: Viewport,
  gliding: boolean,
  onEnd: () => void,
  paint: (view: Viewport) => void,
  size: { width: number; height: number },
): Viewport {
  const key = `${target.x} ${target.y} ${target.scale}`;
  const onScreen = useRef(target);
  const end = useRef(onEnd);
  end.current = onEnd;
  const glide = useEffectEvent(() => {
    const from = onScreen.current;
    if (!gliding || reduceMotion()) {
      onScreen.current = target;
      if (gliding) end.current();
      return;
    }
    const start = performance.now();
    const path = flight(from, target, size.width ? size : { width: 1, height: 1 });
    const ms = Math.min(GLIDE_MS.max, Math.max(GLIDE_MS.min, path.ms));
    let request = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      const view = t < 1 ? path.at(easeInOut(t)) : target;
      onScreen.current = view;
      paint(view);
      if (t < 1) request = requestAnimationFrame(tick);
      else end.current();
    });
    return () => cancelAnimationFrame(request);
  });
  useEffect(() => glide(), [key, gliding]);
  return gliding ? onScreen.current : target;
}
