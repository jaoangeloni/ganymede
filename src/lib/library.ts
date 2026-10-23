import type { Collection, Library, Reference, Space } from "../types";

export const newId = () => crypto.randomUUID().slice(0, 8);

export const refsOf = (library: Library, collectionId: string): Reference[] =>
  (library.collections.find((collection) => collection.id === collectionId)?.refIds ?? [])
    .map((id) => library.refs[id])
    .filter((ref) => ref !== undefined);

export const UNNAMED = "New collection";
export const displayName = (collection: Collection) => collection.name || UNNAMED;

export function collectionName(prompt: string): string {
  const first = prompt.split(/[,.;\n]/)[0].trim();
  const name = first.length > 40 ? `${first.slice(0, 40).replace(/\s+\S*$/, "")}…` : first;
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "Collection";
}

export const mapSpace = (library: Library, id: string, update: (space: Space) => Space): Library => ({
  ...library,
  spaces: library.spaces.map((space) => (space.id === id ? update(space) : space)),
});

export const mapCollection = (
  library: Library,
  id: string,
  update: (collection: Collection) => Collection,
): Library => ({
  ...library,
  collections: library.collections.map((collection) => (collection.id === id ? update(collection) : collection)),
});

export const addRefs = (library: Library, refs: Reference[]): Library => ({
  ...library,
  refs: { ...library.refs, ...Object.fromEntries(refs.map((ref) => [ref.id, ref])) },
});

export function dropOrphans(library: Library): Library {
  const used = new Set(library.collections.flatMap((collection) => collection.refIds));
  for (const space of library.spaces) {
    for (const node of space.nodes) if (node.kind === "ref") used.add(node.refId);
    for (const pin of space.board.pins) used.add(pin.refId);
  }
  const ids = Object.keys(library.refs);
  if (ids.every((id) => used.has(id))) return library;
  return { ...library, refs: Object.fromEntries(ids.filter((id) => used.has(id)).map((id) => [id, library.refs[id]])) };
}

export const union = (ids: string[], more: string[]) => [...new Set([...ids, ...more])];

export function siteOf(ref: Reference): string {
  try {
    return new URL(ref.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
