import { describe, expect, it } from "vitest";
import { dotId, parseDot } from "./dots";

describe("dot ids", () => {
  it("a dot id keeps collection and reference, even with ':' in the reference id", () => {
    const id = dotId("arq", "url:https://img.example/a.jpg");
    expect(parseDot(id)).toEqual({ collectionId: "arq", refId: "url:https://img.example/a.jpg" });
    expect(parseDot("r:abc")).toBeNull();
  });
});
