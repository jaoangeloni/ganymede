import type { Reference } from "./types";

export function makeRef(id: string, overrides: Partial<Reference> = {}): Reference {
  return {
    id,
    source: "bing",
    imageUrl: `https://img.example/${id}/large.jpg`,
    thumbUrl: `https://img.example/${id}/thumb.jpg`,
    sourceUrl: `https://example.org/photo/${id}`,
    width: 1200,
    height: 800,
    ...overrides,
  };
}
