import type { Collection, Library, Reference, SearchSession, Space, View } from "../types";
import { isTauri, type Key, loadRows, type Row, writeRows } from "./api";

export interface Persisted {
  library: Library;
  view: View;
  session: SearchSession | null;
  recent: string[];
}

export interface Opened {
  saved: Persisted | null;
  persistent: boolean;
}

const BROWSER_STATE = "ganymede:state";

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map((item) => [item.id, item]));

export function diff(prev: Persisted | null, next: Persisted): { upsert: Row[]; remove: Key[] } {
  const upsert: Row[] = [];
  const remove: Key[] = [];
  const records = <T>(
    kind: string,
    scope: string,
    before: Record<string, T> | undefined,
    after: Record<string, T>,
    data: (value: T) => unknown = (value) => value,
  ) => {
    for (const id in after)
      if (before?.[id] !== after[id]) upsert.push([kind, scope, id, JSON.stringify(data(after[id]))]);
    if (before) for (const id in before) if (!(id in after)) remove.push([kind, scope, id]);
  };
  const meta = (id: string, before: unknown, after: unknown) =>
    before !== after && upsert.push(["meta", "", id, JSON.stringify(after)]);

  records("ref", "", prev?.library.refs, next.library.refs);
  records("collection", "", prev ? byId(prev.library.collections) : undefined, byId(next.library.collections));
  const before = prev ? byId(prev.library.spaces) : undefined;
  const after = byId(next.library.spaces);
  records("space", "", before, after, ({ nodes, places: _, ...space }: Space) => ({
    ...space,
    nodeOrder: nodes.map((node) => node.id),
  }));
  for (const id of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
    const was = before?.[id];
    const is = after[id];
    if (was === is) continue;
    if (was?.nodes !== is?.nodes) records("node", id, was && byId(was.nodes), is ? byId(is.nodes) : {});
    if (was?.places !== is?.places) records("place", id, was?.places, is?.places ?? {});
  }
  meta(
    "collections",
    prev?.library.collections.map((c) => c.id).join("\n"),
    next.library.collections.map((c) => c.id).join("\n"),
  );
  meta("view", prev?.view, next.view);
  meta("session", prev?.session, next.session);
  meta("recent", prev?.recent, next.recent);
  return { upsert, remove };
}

export function fromRows(rows: Row[]): Persisted | null {
  if (!rows.length) return null;
  const refs: Record<string, Reference> = {};
  const collections: Record<string, Collection> = {};
  const spaces: (Space & { nodeOrder?: string[] })[] = [];
  const nodes: Record<string, Record<string, Space["nodes"][number]>> = {};
  const places: Record<string, NonNullable<Space["places"]>> = {};
  const meta: Record<string, unknown> = {};
  for (const [kind, scope, id, data] of rows) {
    const value = JSON.parse(data);
    if (kind === "ref") refs[id] = value;
    else if (kind === "collection") collections[id] = value;
    else if (kind === "space") spaces.push(value);
    else if (kind === "node") (nodes[scope] ??= {})[id] = value;
    else if (kind === "place") (places[scope] ??= {})[id] = value;
    else if (kind === "meta") meta[id] = value;
  }
  const order = String(meta.collections ?? "").split("\n");
  const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return {
    library: {
      refs,
      collections: Object.values(collections).sort((a, b) => rank(a.id) - rank(b.id)),
      spaces: spaces.map(({ nodeOrder = [], ...space }) => ({
        ...space,
        nodes: nodeOrder.flatMap((id) => nodes[space.id]?.[id] ?? []),
        places: places[space.id] ?? {},
      })),
    },
    view: meta.view as View,
    session: (meta.session as SearchSession | null) ?? null,
    recent: (meta.recent as string[]) ?? [],
  };
}

let written: Persisted | null = null;

export async function persist(next: Persisted): Promise<void> {
  const { upsert, remove } = diff(written, next);
  if (!upsert.length && !remove.length) return;
  const previous = written;
  written = next;
  await writeRows(upsert, remove).catch((error: unknown) => {
    written = previous;
    console.error("[ganymede] could not save", error);
  });
}

function browserState(): Persisted | null {
  try {
    return JSON.parse(localStorage.getItem(BROWSER_STATE) ?? "null");
  } catch {
    return null;
  }
}

export async function openStore(): Promise<Opened> {
  if (!isTauri()) return { saved: browserState(), persistent: false };
  written = fromRows(await loadRows());
  return { saved: written, persistent: true };
}
