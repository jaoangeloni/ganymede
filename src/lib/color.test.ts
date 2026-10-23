import { describe, expect, it } from "vitest";
import { colorDistance, paletteOf, polar, vibrantOf } from "./color";

function image(main: number[], share: number, rest: number[]): number[] {
  return Array.from({ length: 256 }, (_, i) => (i < 256 * share ? main : rest)).flat();
}

const red = [220, 30, 40];
const white = [250, 250, 248];
const navy = [20, 40, 120];

describe("paletteOf", () => {
  it("the striking color comes first even when it covers less area than the background", () => {
    const palette = paletteOf(image(red, 0.3, white));

    expect(palette).toHaveLength(2);
    expect(colorDistance(palette[0], "#dc1e28")).toBeLessThan(0.02);
    expect(colorDistance(palette[1], "#fafaf8")).toBeLessThan(0.02);
  });

  it("a neutral image keeps its own color without inventing others", () => {
    const palette = paletteOf(image([120, 120, 118], 1, white));

    expect(palette).toHaveLength(1);
    expect(polar(palette[0]).chroma).toBeLessThan(0.01);
  });

  it("separates different vivid colors and ignores tiny details", () => {
    const pixels = image(red, 0.5, navy);
    pixels.splice(0, 3, 0, 255, 0);
    const palette = paletteOf(pixels);

    expect(palette).toHaveLength(2);
    expect(palette.some((color) => colorDistance(color, "#00ff00") < 0.1)).toBe(false);
  });

  it("transparent pixels do not count", () => {
    const rgba = Array.from({ length: 256 }, (_, i) => (i < 128 ? [...navy, 255] : [255, 255, 255, 0])).flat();
    expect(paletteOf(rgba, 4)).toHaveLength(1);
    expect(paletteOf([], 3)).toEqual([]);
  });
});

describe("vibrantOf", () => {
  const hueOf = (tint: string) => Number(tint.match(/oklch\(\S+ \S+ (\S+)\)/)![1]);

  it("a collection's color is the recurring vivid one, not a rare detail", () => {
    const palettes = [["#c8384a", "#f3e1e8"], ["#b0263c"], ["#9b2d5a", "#2b1520"], ["#808080"], ["#2050d0"]];
    const tint = vibrantOf(palettes);

    expect(tint).toMatch(/^oklch\(/);
    expect(Math.abs(hueOf(tint) - (polar("#b0263c").hue * 180) / Math.PI)).toBeLessThan(25);
  });

  it("tones of the same hue add up: a forest's different greens paint the collection green", () => {
    const palettes = [
      ["#449c5d", "#53bcd6"],
      ["#525e38", "#789347"],
      ["#27383c", "#3f5231", "#53662c"],
      ["#7c829a", "#3e67ab", "#70954a"],
      ["#142129", "#3f4f35"],
    ];
    const hue = hueOf(vibrantOf(palettes));

    expect(hue).toBeGreaterThan(110);
    expect(hue).toBeLessThan(160);
  });

  it("always saturated: dull tones get their hue boosted; with no hue at all, a stable one from the id", () => {
    const chromaOf = (tint: string) => Number(tint.match(/oklch\(\S+ (\S+)/)![1]);
    const concrete = vibrantOf([["#8a8072"], ["#b4a996", "#6f675c"]]);
    expect(chromaOf(concrete)).toBeGreaterThanOrEqual(0.09);
    expect(Math.abs(hueOf(concrete) - (polar("#8a8072").hue * 180) / Math.PI)).toBeLessThan(25);

    expect(
      Math.abs(
        hueOf(vibrantOf([["#808080"], ["#c9c6bf"], ["#30302e"], ["#e46a2c"]])) - (polar("#e46a2c").hue * 180) / Math.PI,
      ),
    ).toBeLessThan(10);

    const gray = vibrantOf([["#808080"], ["#30302e"]], "a1");
    expect(chromaOf(gray)).toBeGreaterThanOrEqual(0.09);
    expect(vibrantOf([], "a1")).toBe(gray);
    expect(vibrantOf([], "b2")).not.toBe(gray);
  });

  it("the accent stays in a lightness and chroma band that works in both themes", () => {
    const [lightness, chroma] = vibrantOf([["#2b0a10"]])
      .match(/[\d.]+/g)!
      .map(Number);

    expect(lightness).toBeGreaterThanOrEqual(0.74);
    expect(chroma).toBeGreaterThanOrEqual(0.09);
  });
});
