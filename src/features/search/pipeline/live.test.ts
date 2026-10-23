import { describe, expect, it } from "vitest";
import { searchBing } from "./bing";

describe.runIf(import.meta.env.MODE === "live")("live Bing", { timeout: 15_000 }, () => {
  it("returns a full page with original dimensions and https previews", async () => {
    const refs = await searchBing("abandoned train station overgrown", 1);

    expect(refs.length).toBeGreaterThanOrEqual(30);
    expect(refs.filter((ref) => ref.width > 0 && ref.height > 0).length).toBeGreaterThanOrEqual(30);
    expect(refs.every((ref) => ref.thumbUrl.startsWith("https://"))).toBe(true);
    expect(new Set(refs.map((ref) => new URL(ref.sourceUrl).hostname)).size).toBeGreaterThan(5);
  });
});
