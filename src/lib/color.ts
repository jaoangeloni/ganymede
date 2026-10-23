import type { Reference } from "../types";
import { isTauri, mediaUrl } from "./api";
import { vision } from "./vision";

type Lab = [number, number, number];

const CLUSTERS = 6;
const ITERATIONS = 10;
const MIN_SHARE = 0.03;
const SAME_COLOR = 0.06;
const PALETTE_SIZE = 3;
const SAMPLE_SIDE = 16;

const linear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function oklab(r: number, g: number, b: number): Lab {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

const labs = new Map<string, Lab>();

function labOf(color: string): Lab {
  let lab = labs.get(color);
  if (!lab) {
    const n = parseInt(color.slice(1), 16);
    lab = oklab((n >> 16) & 255, (n >> 8) & 255, n & 255);
    labs.set(color, lab);
  }
  return lab;
}

const distance = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const colorDistance = (a: string, b: string) => distance(labOf(a), labOf(b));

export function polar(color: string) {
  const [lightness, a, b] = labOf(color);
  return { lightness, chroma: Math.hypot(a, b), hue: Math.atan2(b, a) };
}

const salience = (share: number, lab: Lab) => share * (0.2 + Math.min(1, Math.hypot(lab[1], lab[2]) / 0.1));

export function paletteOf(pixels: ArrayLike<number>, channels: 3 | 4 = 3): string[] {
  const rgb: [number, number, number][] = [];
  for (let i = 0; i + channels - 1 < pixels.length; i += channels) {
    if (channels === 4 && pixels[i + 3] < 128) continue;
    rgb.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }
  if (!rgb.length) return [];
  const labs = rgb.map(([r, g, b]) => oklab(r, g, b));

  const mean = labs.reduce<Lab>(
    (sum, lab) => [sum[0] + lab[0] / labs.length, sum[1] + lab[1] / labs.length, sum[2] + lab[2] / labs.length],
    [0, 0, 0],
  );
  const nearest = (lab: Lab, centers: Lab[]) =>
    centers.reduce((best, center, i) => (distance(lab, center) < distance(lab, centers[best]) ? i : best), 0);
  const centers: Lab[] = [labs[nearest(mean, labs)]];
  while (centers.length < Math.min(CLUSTERS, labs.length)) {
    const far = labs.reduce(
      (best, lab, i) =>
        distance(lab, centers[nearest(lab, centers)]) > distance(labs[best], centers[nearest(labs[best], centers)])
          ? i
          : best,
      0,
    );
    if (distance(labs[far], centers[nearest(labs[far], centers)]) < 1e-6) break;
    centers.push(labs[far]);
  }

  let owner = labs.map((lab) => nearest(lab, centers));
  for (let round = 0; round < ITERATIONS; round++) {
    centers.forEach((_, k) => {
      const members = labs.filter((_, i) => owner[i] === k);
      if (!members.length) return;
      const mean = (axis: number) => members.reduce((sum, lab) => sum + lab[axis], 0) / members.length;
      centers[k] = [mean(0), mean(1), mean(2)];
    });
    const next = labs.map((lab) => nearest(lab, centers));
    if (next.every((k, i) => k === owner[i])) break;
    owner = next;
  }

  const groups = centers
    .map((lab, k) => {
      const members = rgb.filter((_, i) => owner[i] === k);
      const share = members.length / rgb.length;
      const avg = [0, 1, 2].map((c) => members.reduce((sum, pixel) => sum + pixel[c], 0) / (members.length || 1));
      return { lab, share, color: hex(avg[0], avg[1], avg[2]) };
    })
    .filter((group) => group.share >= MIN_SHARE)
    .sort((a, b) => salience(b.share, b.lab) - salience(a.share, a.lab));

  const picked: typeof groups = [];
  for (const group of groups) {
    if (picked.length < PALETTE_SIZE && picked.every((other) => distance(other.lab, group.lab) >= SAME_COLOR))
      picked.push(group);
  }
  return picked.map((group) => group.color);
}

const TINT = { lightness: [0.74, 0.84], chroma: [0.09, 0.13] } as const;
const YELLOWS = [70, 130] as const;
const YELLOW_LIGHTNESS = 0.86;
const HINT_CHROMA = 0.02;
const HUE_BIN = 15;

const clampTo = (value: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, value));
const degreesOf = (radians: number) => ((radians * 180) / Math.PI + 360) % 360;

function pastel(hue: number, lightness: number, chroma: number) {
  const yellow = hue >= YELLOWS[0] && hue <= YELLOWS[1];
  const l = clampTo(lightness, [
    yellow ? YELLOW_LIGHTNESS : TINT.lightness[0],
    yellow ? YELLOW_LIGHTNESS + 0.04 : TINT.lightness[1],
  ]);
  return `oklch(${l.toFixed(3)} ${clampTo(chroma * 1.5, TINT.chroma).toFixed(3)} ${hue.toFixed(1)})`;
}

function hueFrom(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(hash) * 137.508) % 360;
}

export function vibrantOf(palettes: (string[] | undefined)[], seed = ""): string {
  const bins = new Float64Array(360 / HUE_BIN);
  const colors: { hue: number; lightness: number; chroma: number; weight: number }[] = [];
  for (const palette of palettes) {
    palette?.forEach((color, i) => {
      const { lightness, chroma, hue } = polar(color);
      if (chroma < HINT_CHROMA) return;
      const weight = (1 / 2 ** i) * Math.min(1, chroma / 0.12) ** 1.5;
      const degrees = degreesOf(hue);
      colors.push({ hue: degrees, lightness, chroma, weight });
      const bin = Math.floor(degrees / HUE_BIN);
      bins[bin] += weight;
      bins[(bin + 1) % bins.length] += weight / 2;
      bins[(bin - 1 + bins.length) % bins.length] += weight / 2;
    });
  }
  if (!colors.length) return pastel(hueFrom(seed), 0.78, TINT.chroma[0]);
  const peak = (bins.indexOf(Math.max(...bins)) + 0.5) * HUE_BIN;
  const near = colors.filter((color) => Math.abs(((color.hue - peak + 540) % 360) - 180) <= HUE_BIN * 1.5);
  const total = near.reduce((sum, color) => sum + color.weight, 0);
  const x = near.reduce((sum, color) => sum + Math.cos((color.hue * Math.PI) / 180) * color.weight, 0);
  const y = near.reduce((sum, color) => sum + Math.sin((color.hue * Math.PI) / 180) * color.weight, 0);
  const average = (key: "lightness" | "chroma") =>
    near.reduce((sum, color) => sum + color[key] * color.weight, 0) / total;
  return pastel(
    degreesOf(Math.atan2(y, x)),
    average("lightness"),
    Math.max(...near.map((color) => color.chroma), average("chroma")),
  );
}

export const accentOf = (ref: Pick<Reference, "id" | "palette">) => vibrantOf([ref.palette], ref.id);

export const collectionTint = (id: string, refs: (Reference | undefined)[]) =>
  vibrantOf(
    refs.map((ref) => ref?.palette),
    id,
  );

async function sample(source: ImageBitmapSource): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(source);
  const canvas = new OffscreenCanvas(SAMPLE_SIDE, SAMPLE_SIDE);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
  bitmap.close();
  return context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data;
}

function sampleRemote(url: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.onload = () => sample(image).then(resolve, reject);
    image.onerror = reject;
    image.src = url;
  });
}

export async function readPalettes(refs: Reference[]): Promise<Record<string, string[]>> {
  const found: Record<string, string[]> = {};
  const keep = (id: string, palette: string[]) => palette.length && (found[id] = palette);
  const local = refs.filter((ref) => ref.thumbUrl.startsWith("local:"));
  const remote = refs.filter((ref) => !ref.thumbUrl.startsWith("local:"));

  await Promise.all(
    local.map((ref) =>
      sampleRemote(mediaUrl("thumb", ref.id)).then(
        (pixels) => keep(ref.id, paletteOf(pixels, 4)),
        () => {},
      ),
    ),
  );
  if (isTauri()) {
    const signatures = await vision.analyze(remote, { embed: false });
    for (const ref of remote) {
      const pixels = signatures.get(ref.id)?.pixels;
      if (pixels) keep(ref.id, paletteOf(pixels, 3));
    }
  } else {
    await Promise.all(
      remote.map((ref) =>
        sampleRemote(ref.thumbUrl).then(
          (pixels) => keep(ref.id, paletteOf(pixels, 4)),
          () => {},
        ),
      ),
    );
  }
  return found;
}

export const ink = (color: string) => `oklch(from ${color} calc(l * var(--ink-light)) c h)`;
export type Rgb = [number, number, number];

const encode = (value: number) => {
  const x = Math.min(1, Math.max(0, value));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

export function rgbOf(color: string, lightness = 1): Rgb {
  const oklch = color
    .match(/oklch\(([^)]+)\)/)?.[1]
    ?.trim()
    .split(/\s+/)
    .map(Number);
  const [l, a, b] = oklch
    ? [oklch[0], oklch[1] * Math.cos((oklch[2] * Math.PI) / 180), oklch[1] * Math.sin((oklch[2] * Math.PI) / 180)]
    : labOf(color);
  const L = l * lightness;
  const [x, y, z] = [
    L + 0.3963377774 * a + 0.2158037573 * b,
    L - 0.1055613458 * a - 0.0638541728 * b,
    L - 0.0894841775 * a - 1.291485548 * b,
  ].map((v) => v ** 3);
  return [
    encode(4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z),
    encode(-1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z),
    encode(-0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z),
  ];
}

export const cssRgb = ([r, g, b]: Rgb, alpha = 1) =>
  `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${alpha})`;
