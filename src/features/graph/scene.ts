import { accentOf, collectionTint } from "../../lib/color";
import { parseDot } from "../../lib/dots";
import type { Library, Point, Space } from "../../types";
import { spiralAt } from "./geometry";

interface GraphNode {
  id: string;
  kind: "dot" | "loose";
  refId: string;
  collectionId: string | null;
  r: number;
  aspect: number;
  color: string;
}

interface GraphCollection {
  id: string;
  color: string;
  members: number[];
}

export interface Scene {
  nodes: GraphNode[];
  index: Map<string, number>;
  collections: GraphCollection[];
  start: Float32Array<ArrayBuffer>;
  fresh: number;
  key: string;
}

export interface Adjacency {
  start: Uint32Array;
  edges: Uint32Array;
}

export const NODE_SIZE = 40;
const SPACING = 1.5 * NODE_SIZE;
const SCATTER = 1.25 * NODE_SIZE;
const SHUFFLE = 7919;

export const refOf = (id: string) => (id.startsWith("r:") ? id.slice(2) : (parseDot(id)?.refId ?? null));

const aspectOf = (ref: { width: number; height: number }) =>
  ref.width > 0 && ref.height > 0 ? Math.min(3, Math.max(1 / 3, ref.width / ref.height)) : 1;

export function sceneOf(
  space: Pick<Space, "id" | "nodes" | "places">,
  library: Pick<Library, "collections" | "refs">,
  live: Map<string, Point>,
): Scene {
  const nodes: GraphNode[] = [];
  const known: (Point | undefined)[] = [];
  const carried = new Map<string, Point>();
  for (const [id, at] of live) {
    const refId = refOf(id);
    if (refId) carried.set(refId, at);
  }
  const collections: GraphCollection[] = [];
  const anchors = new Map(
    space.nodes.flatMap((node) =>
      node.kind === "collection" ? [[node.collectionId, { x: node.x, y: node.y }] as const] : [],
    ),
  );
  for (const collection of library.collections) {
    if (collection.spaceId !== space.id) continue;
    const refs = collection.refIds.flatMap((refId) => library.refs[refId] ?? []);
    const group: GraphCollection = { id: collection.id, color: collectionTint(collection.id, refs), members: [] };
    collections.push(group);
    for (const ref of refs) {
      const id = `d:${collection.id}:${ref.id}`;
      group.members.push(nodes.length);
      nodes.push({
        id,
        kind: "dot",
        refId: ref.id,
        collectionId: collection.id,
        r: NODE_SIZE / 2,
        aspect: aspectOf(ref),
        color: group.color,
      });
      known.push(live.get(id) ?? space.places?.[id] ?? carried.get(ref.id));
    }
  }
  for (const node of space.nodes) {
    const ref = node.kind === "ref" ? library.refs[node.refId] : undefined;
    if (ref) {
      nodes.push({
        id: node.id,
        kind: "loose",
        refId: ref.id,
        collectionId: null,
        r: NODE_SIZE / 2,
        aspect: aspectOf(ref),
        color: accentOf(ref),
      });
      known.push(live.get(node.id) ?? carried.get(ref.id) ?? { x: node.x, y: node.y });
    }
  }
  const fresh = known.filter((at) => !at).length;
  const scatter = fresh > nodes.length / 2;
  const start = new Float32Array(nodes.length * 2);
  const placed = new Map<string, number>();
  nodes.forEach((node, i) => {
    let at = known[i];
    if (!at && scatter) at = spiralAt((i * SHUFFLE) % nodes.length, SCATTER);
    else if (!at) {
      const group = node.collectionId ? collections.find((other) => other.id === node.collectionId) : undefined;
      const sibling = group?.members.find((j) => known[j]);
      const k = placed.get(node.collectionId ?? "") ?? 0;
      placed.set(node.collectionId ?? "", k + 1);
      const offset = spiralAt(k + 1, SPACING);
      const base = (sibling !== undefined && known[sibling]) || anchors.get(node.collectionId ?? "") || { x: 0, y: 0 };
      at = { x: base.x + offset.x, y: base.y + offset.y };
    }
    start[2 * i] = at.x;
    start[2 * i + 1] = at.y;
  });
  return {
    nodes,
    index: new Map(nodes.map((node, i) => [node.id, i])),
    collections,
    start,
    fresh,
    key: nodes.map((node) => node.id).join("\n"),
  };
}

export function adjacency(count: number, pairs: Uint32Array): Adjacency {
  const start = new Uint32Array(count + 1);
  for (let k = 0; k < pairs.length; k++) start[pairs[k] + 1]++;
  for (let i = 0; i < count; i++) start[i + 1] += start[i];
  const fill = start.slice(0, count);
  const edges = new Uint32Array(pairs.length);
  for (let k = 0; k < pairs.length; k++) edges[fill[pairs[k]]++] = k >> 1;
  return { start, edges };
}

export const otherEnd = (pairs: Uint32Array, edge: number, i: number) =>
  pairs[2 * edge] === i ? pairs[2 * edge + 1] : pairs[2 * edge];

export function centers(scene: Scene, positions: Float32Array): Map<string, Point> {
  const out = new Map<string, Point>();
  for (const group of scene.collections) {
    if (!group.members.length) continue;
    let [x, y] = [0, 0];
    for (const i of group.members) [x, y] = [x + positions[2 * i], y + positions[2 * i + 1]];
    out.set(group.id, { x: x / group.members.length, y: y / group.members.length });
  }
  return out;
}
