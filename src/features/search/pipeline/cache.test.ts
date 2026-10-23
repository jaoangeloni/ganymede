import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearCache } from "./cache";

beforeEach(clearCache);
afterEach(() => vi.useRealTimers());

describe("cached", () => {
  it("reuses the result for the same key", async () => {
    const load = vi.fn().mockResolvedValue(["a"]);

    expect(await cached("openverse|castle|1", load)).toEqual(["a"]);
    expect(await cached("openverse|castle|1", load)).toEqual(["a"]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("shares identical requests still in flight", async () => {
    const load = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve("ok"), 5)));

    await Promise.all([cached("key", load), cached("key", load)]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("does not keep failures", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValue(["a"]);

    await expect(cached("key", load)).rejects.toThrow("429");
    expect(await cached("key", load)).toEqual(["a"]);
  });

  it("expires after 30 minutes", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue(["a"]);

    await cached("key", load);
    vi.advanceTimersByTime(31 * 60_000);
    await cached("key", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
