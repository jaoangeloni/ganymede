export const PAGE_GAP = 28;
const MAX_HEIGHT = 232;
const MIN_HEIGHT = 140;
const NOMINAL_ASPECT = 1.25;
const ASPECT_RANGE = { min: 0.45, max: 2.4 };

const SHAPES = [
  { cols: 4, rows: 4, max: 16 },
  { cols: 4, rows: 3, max: 12 },
  { cols: 3, rows: 3, max: 9 },
];

interface PageBox {
  x: number;
  y: number;
  w: number;
  h: number;
  row: number;
  col: number;
}

export interface PageLayout {
  boxes: PageBox[];
  width: number;
  height: number;
}

export const aspectOf = ({ width, height }: { width: number; height: number }) =>
  width > 0 && height > 0 ? Math.min(ASPECT_RANGE.max, Math.max(ASPECT_RANGE.min, width / height)) : 1;

const rowHeight = (cols: number, rows: number, width: number, height: number) =>
  Math.min(
    MAX_HEIGHT,
    (height - (rows - 1) * PAGE_GAP) / rows,
    (width - (cols - 1) * PAGE_GAP) / (cols * NOMINAL_ASPECT),
  );

export function capacityFor(width: number, height: number): number {
  const fits = SHAPES.find(({ cols, rows }) => rowHeight(cols, rows, width, height) >= MIN_HEIGHT);
  return (fits ?? SHAPES[SHAPES.length - 1]).max;
}

function* cuts(count: number, rows: number, from = 0): Generator<number[]> {
  if (rows === 1) return yield [count];
  for (let end = from + 1; end <= count - (rows - 1); end++)
    for (const rest of cuts(count, rows - 1, end)) yield [end, ...rest];
}

const REFERENCE_WIDTH = 1000;

const spreadOf = (groups: number[][], aspects: number[]) => {
  const heights = groups.map(
    (group) => (REFERENCE_WIDTH - (group.length - 1) * PAGE_GAP) / group.reduce((total, i) => total + aspects[i], 0),
  );
  const mean = heights.reduce((total, h) => total + h, 0) / heights.length;
  return (Math.max(...heights) - Math.min(...heights)) / mean;
};

function evenRows(aspects: number[], rows: number): number[][] {
  const order = aspects.map((_, i) => i);
  let groups: number[][] = [];
  let spread = Infinity;
  for (const ends of cuts(aspects.length, rows)) {
    const next = ends.map((end, r) => order.slice(r ? ends[r - 1] : 0, end));
    const nextSpread = spreadOf(next, aspects);
    if (nextSpread < spread) [groups, spread] = [next, nextSpread];
  }
  const home = new Map(groups.flatMap((group, r) => group.map((i) => [i, r] as const)));
  for (let round = 0; round < 24; round++) {
    let best: { swap: [number, number, number, number]; spread: number } | null = null;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        for (const [ia, i] of groups[a].entries()) {
          for (const [jb, j] of groups[b].entries()) {
            if (Math.abs(b - (home.get(i) ?? a)) > 1 || Math.abs(a - (home.get(j) ?? b)) > 1) continue;
            const swapped = groups.map((group) => [...group]);
            [swapped[a][ia], swapped[b][jb]] = [j, i];
            const next = spreadOf(swapped, aspects);
            if (next < (best?.spread ?? spread) - 1e-9) best = { swap: [a, ia, b, jb], spread: next };
          }
        }
      }
    }
    if (!best) break;
    const {
      swap: [a, ia, b, jb],
      spread: next,
    } = best;
    [groups[a][ia], groups[b][jb]] = [groups[b][jb], groups[a][ia]];
    spread = next;
  }
  return groups.map((group) => [...group].sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
}

export function pageLayout(aspects: number[], width: number, height: number): PageLayout {
  const count = aspects.length;
  if (!count) return { boxes: [], width: 0, height: 0 };
  const shape = [...SHAPES].reverse().find((candidate) => count <= candidate.max) ?? SHAPES[0];
  const groups = evenRows(aspects, Math.min(shape.rows, Math.ceil(count / 3)));
  const sums = groups.map((group) => group.reduce((total, i) => total + aspects[i], 0));
  const gaps = groups.map((group) => (group.length - 1) * PAGE_GAP);
  const fitHeight =
    (height - (groups.length - 1) * PAGE_GAP + gaps.reduce((total, gap, r) => total + gap / sums[r], 0)) /
    sums.reduce((total, sum) => total + 1 / sum, 0);
  const total = Math.max(
    0,
    Math.floor(Math.min(width, fitHeight, ...sums.map((sum, r) => MAX_HEIGHT * sum + gaps[r]))),
  );
  const boxes = new Array<PageBox>(count);
  let y = 0;
  groups.forEach((group, row) => {
    const h = (total - gaps[row]) / sums[row];
    let x = 0;
    group.forEach((index, col) => {
      const w = aspects[index] * h;
      boxes[index] = { x, y, w, h, row, col };
      x += w + PAGE_GAP;
    });
    y += h + PAGE_GAP;
  });
  return { boxes, width: total, height: y - PAGE_GAP };
}
