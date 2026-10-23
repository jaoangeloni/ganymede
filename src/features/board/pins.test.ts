import { describe, expect, it } from "vitest";
import { makeRef } from "../../testing";
import { landing, linkPath, PIN, pinGrid, pinHeight, restingTilt, tiltFromId, tiltOf } from "./pins";

describe("board", () => {
  it("the frame counts in the height: the inner image keeps its original ratio", () => {
    const ref = makeRef("a", { width: 800, height: 400 });
    const inner = PIN.w - 2 * PIN.frame;

    expect(pinHeight(PIN.w, ref)).toBe(inner / 2 + 2 * PIN.frame);
  });

  it("the landing tilt is subtle: between 0.3° and 1.2°, either way", () => {
    const angles = Array.from({ length: 200 }, (_, i) => tiltOf(i / 200));

    expect(Math.min(...angles.map(Math.abs))).toBeGreaterThanOrEqual(0.3);
    expect(Math.max(...angles.map(Math.abs))).toBeLessThanOrEqual(1.2);
    expect(angles.some((angle) => angle < 0) && angles.some((angle) => angle > 0)).toBe(true);
  });

  it("an arriving image always gets the same tilt for the same id", () => {
    expect(tiltFromId("bing:https://a.com/x.jpg")).toBe(tiltFromId("bing:https://a.com/x.jpg"));
    expect(new Set(["a", "b", "c", "d", "e", "f"].map(tiltFromId)).size).toBeGreaterThan(3);
  });

  it("landing re-rolls the tilt, and larger old angles show at the limit", () => {
    expect(Math.abs(landing())).toBeGreaterThanOrEqual(0.3);
    expect(Math.abs(landing())).toBeLessThanOrEqual(1.2);
    expect(restingTilt(45)).toBe(1.2);
    expect(restingTilt(-4.5)).toBe(-1.2);
    expect(restingTilt(0.8)).toBe(0.8);
    expect(restingTilt(undefined)).toBe(0);
  });

  it("an arrow leaves the middle of the side facing the other item and reaches the middle of the opposite side", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const ends = (d: string) => d.match(/^M([\d.,-]+)C.* ([\d.,-]+)M/)!.slice(1);

    expect(ends(linkPath(a, { x: 300, y: 20, w: 100, h: 100 }, 8))).toEqual(["100,50", "300,70"]);
    expect(ends(linkPath(a, { x: 20, y: -400, w: 100, h: 100 }, 8))).toEqual(["50,0", "70,-300"]);
    expect(ends(linkPath(a, { x: -200, y: 40, w: 0, h: 0 }, 8))).toEqual(["0,50", "-200,40"]);
  });

  it("an arriving grid is already tilted and does not overlap", () => {
    const refs = ["a", "b", "c", "d"].map((id) => makeRef(id, { width: 600, height: 800 }));
    const pins = pinGrid(refs, { x: 0, y: 0 });

    expect(pins.every((pin) => pin.angle !== undefined && pin.angle !== 0)).toBe(true);
    for (const a of pins) {
      for (const b of pins) {
        if (a === b) continue;
        const [ha, hb] = [pinHeight(a.w, refs[0]), pinHeight(b.w, refs[0])];
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + ha <= b.y || b.y + hb <= a.y).toBe(true);
      }
    }
  });
});
