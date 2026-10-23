type Source = "bing" | "local" | "url";

export interface Reference {
  id: string;
  source: Source;
  imageUrl: string;
  thumbUrl: string;
  sourceUrl: string;
  width: number;
  height: number;
  author?: string;
  title?: string;
  alt?: string;
  palette?: string[];
}

export interface WaveTimings {
  waitMs: number;
  rankMs: number;
  visionMs: number;
  candidates: number;
}

export interface SearchWave {
  plan: SearchPlan;
  pool: Reference[];
  timings: WaveTimings;
}

export interface SearchPlan {
  queries: string[];
  avoid: string[];
  filters?: string;
}

interface SearchIteration {
  plan: SearchPlan;
  results: Reference[];
}

export interface SearchSession {
  prompt: string;
  iterations: SearchIteration[];
  approved: Reference[];
  target: SearchTarget;
  seed: Reference[];
}

export interface SearchTarget {
  spaceId?: string;
  collectionId?: string;
}

export interface Collection {
  id: string;
  name: string;
  refIds: string[];
  prompt?: string;
  spaceId?: string;
}

interface Placed {
  id: string;
  x: number;
  y: number;
}

export type SpaceNode =
  (Placed & { kind: "ref"; refId: string }) | (Placed & { kind: "collection"; collectionId: string });

export interface Pin {
  refId: string;
  x: number;
  y: number;
  w: number;
  angle?: number;
}

export interface BoardNote {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
  angle?: number;
}

export interface BoardLink {
  id: string;
  from: string;
  to: string;
}

export interface Board {
  viewport: Viewport;
  pins: Pin[];
  notes?: BoardNote[];
  links?: BoardLink[];
}

export interface Space {
  id: string;
  name: string;
  viewport: Viewport;
  nodes: SpaceNode[];
  board: Board;
  places?: Record<string, Point>;
}

export interface Library {
  refs: Record<string, Reference>;
  collections: Collection[];
  spaces: Space[];
}

export type View = { kind: "space"; id: string } | { kind: "collection"; id: string } | { kind: "home" };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}
