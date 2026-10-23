import { describe, expect, it } from "vitest";
import { readPrompt } from "./query";

describe("readPrompt", () => {
  it("the typed text goes to Bing as is", () => {
    expect(readPrompt("Uma floresta de pinheiros na neblina")).toEqual({
      query: "Uma floresta de pinheiros na neblina",
      avoid: [],
    });
    expect(readPrompt("  Frutiger aero\n aesthetic  ")).toEqual({ query: "Frutiger aero aesthetic", avoid: [] });
  });

  it("the negated part is not searched and becomes terms to avoid", () => {
    expect(readPrompt("roupas femininas dos anos 1970, fotografia editorial, sem fantasia")).toEqual({
      query: "roupas femininas dos anos 1970, fotografia editorial",
      avoid: ["fantasia"],
    });
    expect(readPrompt("vila medieval com casas de pedra, mas sem parecer cenário de jogo")).toEqual({
      query: "vila medieval com casas de pedra",
      avoid: ["cenário", "jogo"],
    });
    expect(readPrompt("brutalismo, nada de renders")).toEqual({ query: "brutalismo", avoid: ["renders"] });
  });

  it("'no' negates only in English; in Portuguese it is a preposition", () => {
    expect(readPrompt("forest at dawn, no people")).toEqual({ query: "forest at dawn", avoid: ["people"] });
    expect(readPrompt("casa de campo no inverno")).toEqual({ query: "casa de campo no inverno", avoid: [] });
  });

  it("an empty prompt produces no query", () => {
    expect(readPrompt("  , ")).toEqual({ query: "", avoid: [] });
  });
});
