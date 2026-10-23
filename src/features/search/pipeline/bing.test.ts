import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBing, searchBing } from "./bing";
import layoutA from "./fixtures/bing-layout-a.html?raw";
import layoutB from "./fixtures/bing-layout-b.html?raw";

describe("Bing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["A (li data-idx = N)", layoutA],
    ['B (li data-idx="N")', layoutB],
  ])("reads results and original dimensions in layout %s", (_, html) => {
    const refs = parseBing(html);

    expect(refs).toHaveLength(3);
    for (const ref of refs) {
      expect(ref.source).toBe("bing");
      expect(ref.thumbUrl).toMatch(/^https:\/\/[\w.]+\.bing\.net\//);
      expect(`${ref.title}${ref.alt ?? ""}`).not.toMatch(/[]/);
      expect(ref.sourceUrl).toMatch(/^https?:\/\//);
      expect(ref.width).toBeGreaterThan(0);
      expect(ref.height).toBeGreaterThan(0);
      expect(ref.title).toBeTruthy();
    }
  });

  it("normalizes image, source page, preview, dimensions and title (without highlight marks)", () => {
    expect(parseBing(layoutA)[0]).toEqual({
      id: "bing:https://www.oldphotosjapan.com/images/ls-1024/1387.jpg",
      source: "bing",
      imageUrl: "https://www.oldphotosjapan.com/images/ls-1024/1387.jpg",
      thumbUrl: "https://ts2.mm.bing.net/th?id=OIP.bBqgsvaOjm1ecjgpqQyYQQHaE7&pid=15.1",
      sourceUrl: "https://www.oldphotosjapan.com/photos/931/traditional-japanese-minka-house-floor-plan",
      width: 1024,
      height: 681,
      title: "Minka Floor Plan | OLD PHOTOS of JAPAN",
    });
  });

  it("decodes entities, swaps an http original for the preview and drops incomplete results", () => {
    const meta = (json: object) =>
      JSON.stringify(json).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/>/g, "&gt;");
    const html = `
      <a class="iusc" m="${meta({ murl: "http://a.com/x.jpg", purl: "https://a.com/p", turl: "https://tse1.mm.bing.net/th?id=1", t: "Café & bar > noite" })}"
         href="/images/search?view=detailV2&amp;expw=800&amp;exph=600">
      <a class="iusc" m="${meta({ purl: "https://b.com/p" })}" href="/images/search?expw=800&amp;exph=600">`;

    expect(parseBing(html)).toEqual([
      {
        id: "bing:http://a.com/x.jpg",
        source: "bing",
        imageUrl: "https://tse1.mm.bing.net/th?id=1",
        thumbUrl: "https://tse1.mm.bing.net/th?id=1",
        sourceUrl: "https://a.com/p",
        width: 800,
        height: 600,
        title: "Café & bar > noite",
      },
    ]);
  });

  it("pages by 35 and treats a page without readable results as a failure", async () => {
    const fetch = vi.fn(async (_url: string) => new Response("<html><body>Verify you are human</body></html>"));
    vi.stubGlobal("fetch", fetch);

    await expect(searchBing("casa japonesa", 2)).rejects.toThrow(/without readable results/);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("q")).toBe("casa japonesa");
    expect(url.searchParams.get("first")).toBe("35");
    expect(url.searchParams.get("count")).toBe("35");
  });
});
