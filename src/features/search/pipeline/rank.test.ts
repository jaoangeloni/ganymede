import { describe, expect, it } from "vitest";
import { makeRef } from "../../../testing";
import {
  consensus,
  dropNearDuplicates,
  isUsable,
  mergeCandidates,
  scoreCandidates,
  selectDiverse,
  urlKey,
  wantsSynthetic,
} from "./rank";

const noFeedback = { avoid: [], approved: [], ignored: [] };

describe("isUsable", () => {
  it("accepts a reference with valid dimensions and URLs", () => {
    expect(isUsable(makeRef("a"))).toBe(true);
  });

  it("drops images without dimensions, too small or with extreme ratios", () => {
    expect(isUsable(makeRef("a", { width: 0, height: 0 }))).toBe(false);
    expect(isUsable(makeRef("b", { width: 300, height: 200 }))).toBe(false);
    expect(isUsable(makeRef("c", { width: 4000, height: 600 }))).toBe(false);
  });

  it("drops non-https URLs", () => {
    expect(isUsable(makeRef("a", { thumbUrl: "http://img.example/a.jpg" }))).toBe(false);
  });
});

describe("mergeCandidates", () => {
  it("merges the same image from different queries and records each hit", () => {
    const candidates = mergeCandidates([
      { query: "q0", refs: [makeRef("a"), makeRef("b")] },
      { query: "q1", refs: [makeRef("c"), makeRef("c2"), makeRef("a")] },
    ]);

    expect(candidates.map((c) => c.ref.id)).toEqual(["a", "b", "c", "c2"]);
    expect(candidates[0].hits).toEqual([
      { query: "q0", rank: 0 },
      { query: "q1", rank: 2 },
    ]);
  });

  it("recognizes the same image from different sources by URL", () => {
    const fromOpenverse = makeRef("openverse:1", {
      imageUrl: "https://live.staticflickr.com/1/23_ab_b.jpg",
      sourceUrl: "https://www.flickr.com/photos/x/23",
    });
    const sameFile = makeRef("other:9", { imageUrl: "https://live.staticflickr.com/1/23_ab_z.jpg" });
    const samePage = makeRef("other:10", { sourceUrl: "https://www.flickr.com/photos/x/23/" });

    const candidates = mergeCandidates([{ query: "q0", refs: [fromOpenverse, sameFile, samePage] }]);

    expect(candidates.map((c) => c.ref.id)).toEqual(["openverse:1"]);
  });

  it("recognizes the same web image at different sizes", () => {
    expect(urlKey("https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg")).toBe(
      urlKey("https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg"),
    );
    expect(urlKey("https://blog.example/wp-content/uploads/2020/05/ruin-1024x683.jpg")).toBe(
      urlKey("https://blog.example/wp-content/uploads/2020/05/ruin.jpg"),
    );
    expect(urlKey("https://cdn.example/a/ruin.jpg?w=800&q=80")).toBe(urlKey("http://www.cdn.example/a/ruin.jpg"));
    expect(
      urlKey("https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/Stari_grad.jpg/1280px-Stari_grad.jpg"),
    ).toBe(urlKey("https://upload.wikimedia.org/wikipedia/commons/a/aa/Stari_grad.jpg"));
    expect(urlKey("https://example.com/image.php?id=1")).not.toBe(urlKey("https://example.com/image.php?id=2"));
  });

  it("never returns what was already seen", () => {
    const candidates = mergeCandidates([{ query: "q0", refs: [makeRef("a"), makeRef("b")] }], [makeRef("a")]);
    expect(candidates.map((c) => c.ref.id)).toEqual(["b"]);
  });

  it("keeps a single photo of each series by the same author", () => {
    const refs = [
      makeRef("a", { author: "Ana", title: "Cochem, Reichsburg -- 2015 -- 7619" }),
      makeRef("b", { author: "Ana", title: "Cochem, Reichsburg -- 2018 -- 0029" }),
      makeRef("c", { author: "Bruno", title: "Cochem, Reichsburg" }),
    ];
    expect(mergeCandidates([{ query: "q0", refs }]).map((c) => c.ref.id)).toEqual(["a", "c"]);
  });
});

describe("scoreCandidates", () => {
  it("favors what ranks well in more than one query", () => {
    const candidates = mergeCandidates([
      { query: "q0", refs: [makeRef("only-first"), makeRef("both")] },
      { query: "q1", refs: [makeRef("both")] },
    ]);
    scoreCandidates(candidates, noFeedback);

    const score = (id: string) => candidates.find((c) => c.ref.id === id)!.score;
    expect(score("both")).toBeGreaterThan(score("only-first"));
  });

  it("position counts from the first page: the top of page 2 ranks behind the top of page 1", () => {
    const candidates = mergeCandidates([
      { query: "q0", refs: [makeRef("page-1")], offset: 0 },
      { query: "q0", refs: [makeRef("page-2")], offset: 35 },
    ]);
    scoreCandidates(candidates, noFeedback);

    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
  });

  it("AI-generated images and watermarked stock rank behind real photos", () => {
    const at = (id: string, sourceUrl: string, title: string) => makeRef(id, { sourceUrl, title });
    const candidates = mergeCandidates([
      {
        query: "web",
        refs: [
          at(
            "ai-label",
            "https://www.freepik.com/premium-ai-image/house_1.htm",
            "Premium AI Image | Old house covered in moss",
          ),
          at("generator", "https://www.craiyon.com/image/abc", "Old abandoned house in the forest"),
          at("stock", "https://www.dreamstime.com/house-photo-123", "Old Abandoned House in the Forest Stock Photo"),
          at("real", "https://abandoned-places.net/cottages", "Abandoned cottages lost in a forest"),
        ],
      },
    ]);
    scoreCandidates(candidates, noFeedback);
    const score = (id: string) => candidates.find((c) => c.ref.id === id)!.score;

    expect(score("real")).toBeGreaterThan(score("stock"));
    expect(score("stock")).toBeGreaterThan(score("generator"));
    expect(score("generator")).toBeGreaterThan(score("ai-label"));
  });

  it("does not penalize AI images when the prompt asks for them", () => {
    const make = () =>
      mergeCandidates([
        { query: "web", refs: [makeRef("a", { sourceUrl: "https://lexica.art/prompt/1", title: "Castle" })] },
      ]);
    const penalized = make();
    const allowed = make();
    scoreCandidates(penalized, noFeedback);
    scoreCandidates(allowed, { ...noFeedback, synthetic: wantsSynthetic("castelo estilo midjourney, arte de IA") });

    expect(allowed[0].score).toBeGreaterThan(penalized[0].score);
    expect(wantsSynthetic("casa abandonada na floresta")).toBe(false);
  });

  it("penalizes what the prompt excludes, including by source site", () => {
    const candidates = mergeCandidates([
      {
        query: "q1",
        refs: [
          makeRef("concept", { title: "Medieval village concept art" }),
          makeRef("artstation", { title: "Medieval village", sourceUrl: "https://www.artstation.com/artwork/x" }),
          makeRef("photo", { title: "Medieval village in the rain" }),
        ],
      },
    ]);
    scoreCandidates(candidates, { ...noFeedback, avoid: ["concept art", "artstation"] });

    const [concept, artstation, photo] = candidates.map((c) => c.score);
    expect(photo).toBeGreaterThan(concept);
    expect(photo).toBeGreaterThan(artstation);
  });

  it("a term to avoid counts only whole: 'concept art' does not penalize 'art museum'", () => {
    const candidates = mergeCandidates([
      {
        query: "q1",
        refs: [makeRef("museum", { title: "Art museum hall" }), makeRef("hall", { title: "Grand hall" })],
      },
    ]);
    scoreCandidates(candidates, { ...noFeedback, avoid: ["concept art"] });

    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
  });

  it("pulls toward approvals and away from ignored results", () => {
    const candidates = mergeCandidates([
      { query: "q1", refs: [makeRef("castle", { title: "castle aerial sunny" })] },
      { query: "q2", refs: [makeRef("alley", { title: "alley rain cobblestone" })] },
    ]);
    scoreCandidates(candidates, {
      ...noFeedback,
      approved: [makeRef("x", { title: "rain alley street" }), makeRef("y", { title: "rain cobblestone" })],
      ignored: [makeRef("z", { title: "castle aerial" })],
    });

    expect(candidates[1].score).toBeGreaterThan(candidates[0].score);
  });
});

describe("selectDiverse", () => {
  it("does not fill the selection with one author when a close alternative exists", () => {
    const candidates = mergeCandidates([
      {
        query: "q0",
        refs: [
          makeRef("a1", { author: "Ana", title: "Old town gate" }),
          makeRef("a2", { author: "Ana", title: "Market square at dusk" }),
          makeRef("b1", { author: "Bruno", title: "Harbour crane" }),
        ],
      },
    ]);
    scoreCandidates(candidates, noFeedback);

    expect(selectDiverse(candidates, 2).map((c) => c.ref.id)).toEqual(["a1", "b1"]);
  });

  it("alternates source sites when scores are close", () => {
    const commons = (id: string) => makeRef(id, { sourceUrl: `https://commons.wikimedia.org/wiki/${id}` });
    const candidates = mergeCandidates([
      { query: "q0", refs: [makeRef("ov-1"), makeRef("ov-2"), makeRef("ov-3")] },
      { query: "q0", refs: [commons("wm-1"), commons("wm-2")] },
    ]);
    scoreCandidates(candidates, noFeedback);

    const picked = selectDiverse(candidates, 4).map((c) => c.site);
    expect(picked.filter((site) => site === "commons.wikimedia.org")).toHaveLength(2);
  });

  it("the same search engine is not a repeated source; the site is what counts", () => {
    const web = (id: string, site: string) => makeRef(id, { source: "bing", sourceUrl: `https://${site}/${id}` });
    const candidates = mergeCandidates([
      { query: "q0", refs: [web("a", "pinterest.com"), web("b", "pinterest.com"), web("c", "archdaily.com")] },
    ]);
    scoreCandidates(candidates, noFeedback);

    expect(selectDiverse(candidates, 2).map((c) => c.ref.id)).toEqual(["a", "c"]);
  });

  it("does not trade relevance for diversity: a much worse candidate stays last", () => {
    const refs = [
      makeRef("strong-1", { author: "Ana" }),
      makeRef("strong-2", { author: "Ana" }),
      makeRef("strong-3", { author: "Ana" }),
      makeRef("weak", { author: "Bruno" }),
    ];
    const candidates = mergeCandidates([{ query: "q0", refs }]);
    candidates.forEach((c) => (c.score = c.ref.id === "weak" ? 0.1 : 0.9));

    expect(
      selectDiverse(candidates, 4)
        .map((c) => c.ref.id)
        .at(-1),
    ).toBe("weak");
  });

  it("returns at most what exists", () => {
    const candidates = mergeCandidates([{ query: "q0", refs: [makeRef("a"), makeRef("b")] }]);
    expect(selectDiverse(candidates, 16)).toHaveLength(2);
  });
});

describe("visual signals", () => {
  const look = (x: number, y: number, z: number) => {
    const norm = Math.hypot(x, y, z);
    return [x / norm, y / norm, z / norm];
  };
  const withSignature = (hash: string, embedding?: number[]) => (c: ReturnType<typeof mergeCandidates>[number]) =>
    Object.assign(c, { signature: { hash, embedding } });

  it("drops copies of what was seen and repeats among candidates, keeping the best score", () => {
    const candidates = mergeCandidates([
      { query: "q0", refs: [makeRef("a"), makeRef("b"), makeRef("c"), makeRef("d")] },
    ]);
    candidates.forEach((c, i) => (c.score = 1 - i / 10));
    withSignature("ffff0000ffff0000")(candidates[0]);
    withSignature("ffff0000ffff0001")(candidates[1]);
    withSignature("0123456789abcdef")(candidates[2]);

    const kept = dropNearDuplicates(candidates, [{ hash: "0123456789abcdee" }]).map((c) => c.ref.id);

    expect(kept).toEqual(["a", "d"]);
  });

  it("from the second round on, look-alikes of approvals rank up", () => {
    const candidates = mergeCandidates([{ query: "q0", refs: [makeRef("unlike"), makeRef("alike")] }]);
    withSignature("0000000000000001", look(0, 1, 0))(candidates[0]);
    withSignature("0000000000000002", look(1, 0.1, 0))(candidates[1]);

    scoreCandidates(candidates, noFeedback);
    expect(candidates[0].score).toBeGreaterThan(candidates[1].score);

    scoreCandidates(candidates, { ...noFeedback, liked: look(1, 0, 0), passed: look(0, 1, 0) });
    expect(candidates[1].score).toBeGreaterThan(candidates[0].score);
  });

  it("for diversity, very similar images count as redundant even with different titles", () => {
    const refs = [
      makeRef("a", { title: "red barn" }),
      makeRef("b", { title: "farm building" }),
      makeRef("c", { title: "pine forest" }),
    ];
    const candidates = mergeCandidates([{ query: "q0", refs }]);
    candidates.forEach((c, i) => (c.score = [0.9, 0.85, 0.8][i]));
    withSignature("1", look(1, 0, 0))(candidates[0]);
    withSignature("2", look(1, 0.05, 0))(candidates[1]);
    withSignature("3", look(0, 0, 1))(candidates[2]);

    expect(selectDiverse(candidates, 2).map((c) => c.ref.id)).toEqual(["a", "c"]);
  });

  it("visual consensus: an image many others resemble ranks up, an outlier ranks down", () => {
    const central = consensus([
      look(1, 0.1, 0),
      look(1, 0, 0.1),
      look(1, 0.05, 0.05),
      look(0.9, 0.2, 0),
      look(0, 0, 1),
      undefined,
    ]);

    expect(central[5]).toBeUndefined();
    expect(central[4]).toBe(0);
    expect(Math.min(...central.slice(0, 4).map((value) => value!))).toBeGreaterThan(0.5);
    expect(consensus([look(1, 0, 0), look(0, 1, 0)])).toEqual([undefined, undefined]);
  });
});
