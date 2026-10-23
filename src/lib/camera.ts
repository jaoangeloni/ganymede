import type { Box, Point, Viewport } from "../types";

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;

export const LIMITS = { margin: 0.25, stretch: 140 };
const FIT_PADDING = { side: 72, bottom: 136 };

interface Size {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const pixelDensity = (scale: number) => 2 ** (Math.ceil(Math.log2(scale * window.devicePixelRatio) * 2) / 2);

export function zoomAt(viewport: Viewport, point: Point, factor: number, min = MIN_SCALE, max = MAX_SCALE): Viewport {
  const scale = clamp(viewport.scale * factor, min, max);
  const k = scale / viewport.scale;
  return { scale, x: point.x - (point.x - viewport.x) * k, y: point.y - (point.y - viewport.y) * k };
}

export function fitBounds(bounds: Box, size: Size, min = MIN_SCALE): Viewport {
  const width = size.width - FIT_PADDING.side * 2;
  const height = size.height - FIT_PADDING.side - FIT_PADDING.bottom;
  const scale = clamp(Math.min(width / bounds.w, height / bounds.h), min, 1);
  return {
    scale,
    x: FIT_PADDING.side + (width - bounds.w * scale) / 2 - bounds.x * scale,
    y: FIT_PADDING.side + (height - bounds.h * scale) / 2 - bounds.y * scale,
  };
}

export function limitView(
  view: Viewport,
  content: Box | null,
  size: Size,
  anchor = { x: size.width / 2, y: size.height / 2 },
): Viewport {
  if (!content || !size.width || !size.height) return view;
  const scale = clamp(view.scale, MIN_SCALE, MAX_SCALE);
  const zoomed = scale === view.scale ? view : zoomAt(view, anchor, scale / view.scale);
  const margin = (LIMITS.margin * Math.min(size.width, size.height)) / scale;
  const cx = clamp((size.width / 2 - zoomed.x) / scale, content.x - margin, content.x + content.w + margin);
  const cy = clamp((size.height / 2 - zoomed.y) / scale, content.y - margin, content.y + content.h + margin);
  return { scale, x: size.width / 2 - cx * scale, y: size.height / 2 - cy * scale };
}

export const rubber = (over: number) =>
  Math.sign(over) * LIMITS.stretch * (1 - 1 / (1 + Math.abs(over) / LIMITS.stretch));

export function zoomBetween(a: Viewport, b: Viewport, k: number): Viewport {
  const ratio = b.scale / a.scale;
  if (Math.abs(ratio - 1) < 1e-6)
    return { scale: a.scale + (b.scale - a.scale) * k, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  const [fx, fy] = [(b.x - a.x * ratio) / (1 - ratio), (b.y - a.y * ratio) / (1 - ratio)];
  const s = ratio ** k;
  return { scale: a.scale * s, x: fx - (fx - a.x) * s, y: fy - (fy - a.y) * s };
}

// Van Wijk & Nuij, "Smooth and efficient zooming and panning" (2003).
export function flight(a: Viewport, b: Viewport, size: Size): { at(t: number): Viewport; ms: number } {
  const rho = Math.SQRT2;
  const [w0, w1] = [size.width / a.scale, size.width / b.scale];
  const [ux0, uy0] = [(size.width / 2 - a.x) / a.scale, (size.height / 2 - a.y) / a.scale];
  const [dx, dy] = [(size.width / 2 - b.x) / b.scale - ux0, (size.height / 2 - b.y) / b.scale - uy0];
  const view = (u: number, w: number): Viewport => {
    const scale = size.width / w;
    return { scale, x: size.width / 2 - (ux0 + u * dx) * scale, y: size.height / 2 - (uy0 + u * dy) * scale };
  };
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-12) {
    const S = Math.log(w1 / w0) / rho;
    return { at: (t) => view(t, w0 * Math.exp(rho * t * S)), ms: (Math.abs(S) * 1000 * rho) / Math.SQRT2 };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho ** 4 * d2) / (2 * w0 * rho ** 2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho ** 4 * d2) / (2 * w1 * rho ** 2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho;
  return {
    at: (t) => {
      const s = t * S;
      const u = (w0 / (rho ** 2 * d1)) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return view(u, (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0));
    },
    ms: (Math.abs(S) * 1000 * rho) / Math.SQRT2,
  };
}
