import type { Collection, Space } from "../types";

export const dotId = (collectionId: string, refId: string) => `d:${collectionId}:${refId}`;

export function parseDot(id: string): { collectionId: string; refId: string } | null {
  const separator = id.indexOf(":", 2);
  return id.startsWith("d:") && separator > 2
    ? { collectionId: id.slice(2, separator), refId: id.slice(separator + 1) }
    : null;
}

export function endpointsOf(space: Pick<Space, "id" | "nodes">, collections: Collection[]): Set<string> {
  const ids = new Set(space.nodes.map((node) => node.id));
  for (const collection of collections) {
    if (collection.spaceId === space.id) for (const refId of collection.refIds) ids.add(dotId(collection.id, refId));
  }
  return ids;
}
