import type { Reference } from "../../../types";
import { fetchBing } from "../../../lib/api";

export const BING_PAGE_SIZE = 35;

export type FilterGroup = "type" | "color" | "layout" | "size";
export type Filters = Partial<Record<FilterGroup, string>>;
type FilterOption = { value: string; label: string; swatch?: string };

export const FILTERS: { group: FilterGroup; label: string; options: FilterOption[] }[] = [
  {
    group: "type",
    label: "Type",
    options: [
      { value: "photo-photo", label: "Photo" },
      { value: "photo-clipart", label: "Illustration" },
      { value: "photo-linedrawing", label: "Line drawing" },
      { value: "photo-transparent", label: "Transparent" },
    ],
  },
  {
    group: "color",
    label: "Color",
    options: [
      { value: "color2-color", label: "Color" },
      { value: "color2-bw", label: "Black and white" },
      ...(
        [
          ["RED", "Red", "#d7373f"],
          ["ORANGE", "Orange", "#ee7a30"],
          ["YELLOW", "Yellow", "#f2c94c"],
          ["GREEN", "Green", "#4caf50"],
          ["TEAL", "Teal", "#2a9d8f"],
          ["BLUE", "Blue", "#3b6fd8"],
          ["PURPLE", "Purple", "#8e5bd8"],
          ["PINK", "Pink", "#e86aa6"],
          ["BROWN", "Brown", "#8a5a3b"],
          ["BLACK", "Black", "#111111"],
          ["GRAY", "Gray", "#8c8c8c"],
          ["WHITE", "White", "#f4f4f4"],
        ] as const
      ).map(([code, label, swatch]) => ({ value: `color2-FGcls_${code}`, label, swatch })),
    ],
  },
  {
    group: "layout",
    label: "Layout",
    options: [
      { value: "aspect-wide", label: "Horizontal" },
      { value: "aspect-tall", label: "Vertical" },
      { value: "aspect-square", label: "Square" },
    ],
  },
  {
    group: "size",
    label: "Size",
    options: [
      { value: "imagesize-large", label: "Large" },
      { value: "imagesize-wallpaper", label: "Extra large" },
    ],
  },
];

export const filterQuery = (filters: Filters) =>
  FILTERS.flatMap(({ group }) => (filters[group] ? [`+filterui:${filters[group]}`] : [])).join("");

interface BingMeta {
  murl?: string;
  purl?: string;
  turl?: string;
  t?: string;
  desc?: string;
}

const NAMED: Record<string, string> = { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">" };

const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|apos|lt|gt);/gi, (entity, name: string) => {
    if (name[0] !== "#") return NAMED[name.toLowerCase()] ?? entity;
    return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  });

const RESULT_LINK = /<a\b(?:[^>"]|"[^"]*")*?\bclass="iusc"(?:[^>"]|"[^"]*")*>/g;

const clean = (text?: string) => text?.replace(/[\uE000\uE001]/g, "").trim() || undefined;

function fromBing(meta: BingMeta, width: number, height: number): Reference | null {
  if (!meta.murl || !meta.purl || !meta.turl) return null;
  const title = clean(meta.t);
  const description = clean(meta.desc);
  return {
    id: `bing:${meta.murl}`,
    source: "bing",
    imageUrl: meta.murl.startsWith("https://") ? meta.murl : meta.turl,
    thumbUrl: meta.turl,
    sourceUrl: meta.purl,
    width,
    height,
    title,
    alt: description !== title ? description : undefined,
  };
}

export function parseBing(html: string): Reference[] {
  const refs: Reference[] = [];
  for (const [tag] of html.matchAll(RESULT_LINK)) {
    const meta = tag.match(/\sm="([^"]*)"/)?.[1];
    if (!meta) continue;
    try {
      const width = Number(tag.match(/[?&;]expw=(\d+)/)?.[1] ?? 0);
      const height = Number(tag.match(/[?&;]exph=(\d+)/)?.[1] ?? 0);
      const ref = fromBing(JSON.parse(decodeEntities(meta)), width, height);
      if (ref) refs.push(ref);
    } catch {}
  }
  return refs;
}

export async function searchBing(text: string, page: number, filters = ""): Promise<Reference[]> {
  const params = new URLSearchParams({
    q: text,
    first: String((page - 1) * BING_PAGE_SIZE),
    count: String(BING_PAGE_SIZE),
    mmasync: "1",
  });
  if (filters) params.set("qft", filters);
  const refs = parseBing(await fetchBing(`https://www.bing.com/images/async?${params}`));
  if (!refs.length) throw new Error("www.bing.com answered without readable results");
  return refs;
}
