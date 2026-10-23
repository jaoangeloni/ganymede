import type { Box } from "../../types";

export function masonry(ratios: number[], columns: number, columnWidth: number, gap: number) {
  const heights = new Array<number>(columns).fill(0);
  const boxes: Box[] = ratios.map((ratio, i) => {
    const column = i % columns;
    const h = Math.round(columnWidth / ratio);
    const box = { x: column * (columnWidth + gap), y: heights[column], w: columnWidth, h };
    heights[column] += h + gap;
    return box;
  });
  return {
    boxes,
    width: columns * columnWidth + (columns - 1) * gap,
    height: Math.max(0, Math.max(...heights) - gap),
  };
}

export function balanceColumns<T>(items: T[], columns: number, ratioOf: (item: T) => number): T[] {
  const stacks = Array.from({ length: columns }, (_, column) => ({
    height: 0,
    items: [] as T[],
    capacity: Math.floor(items.length / columns) + (column < items.length % columns ? 1 : 0),
  }));
  for (const item of items) {
    const open = stacks.filter((stack) => stack.items.length < stack.capacity);
    const target = open.reduce((lowest, stack) => (stack.height < lowest.height ? stack : lowest));
    target.items.push(item);
    target.height += 1 / ratioOf(item);
  }
  return items.map((_, i) => stacks[i % columns].items[Math.floor(i / columns)]);
}
