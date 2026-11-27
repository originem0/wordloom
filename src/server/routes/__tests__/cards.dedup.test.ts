import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { db } from "../../db/index.js";
import { cards } from "../../db/schema.js";
import { cardRoutes } from "../cards.js";

const generate = vi.hoisted(() => vi.fn());
vi.mock("../../services/ai-router.js", () => ({ generateCards: generate, generateDeepLayer: vi.fn(), extractWords: vi.fn() }));

const app = new Hono().route("/cards", cardRoutes);
const post = (words: string[]) => app.request("/cards/generate", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ words }),
});

describe("card generation on SQLite", () => {
  beforeEach(async () => {
    await db.delete(cards);
    await db.insert(cards).values({ word: "birch", coreMeaning: "original", createdAt: 1, updatedAt: 1 });
    generate.mockReset();
  });

  it("returns existing cards without a model call even for case variants", async () => {
    const res = await post(["BIRCH", "birch"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: [{ word: "birch" }], existing: [{ word: "birch" }], failed: [] });
    expect(generate).not.toHaveBeenCalled();
    await expect(db.insert(cards).values({ word: "Birch", createdAt: 2, updatedAt: 2 })).rejects.toThrow();
  });

  it("never replaces birch when the model omits aspen and elm", async () => {
    generate.mockResolvedValue({ success: [{ word: "birch", coreMeaning: "replacement" }], failed: [] });
    const res = await post(["aspen", "elm"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ existing: [], success: [], failed: [
      { word: "aspen", error: "Not returned by AI" }, { word: "elm", error: "Not returned by AI" },
    ] });
    expect(await db.select({ word: cards.word, meaning: cards.coreMeaning }).from(cards)).toEqual([{ word: "birch", meaning: "original" }]);
  });

  it("uses the same Unicode case key across separate requests", async () => {
    generate.mockResolvedValueOnce({ success: [{ word: "café" }], failed: [] });
    expect((await post(["CAFÉ"])).status).toBe(200);
    const res = await post(["café"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ existing: [{ word: "CAFÉ" }], failed: [] });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("accounts for duplicates, existing cards and valid model results individually", async () => {
    generate.mockResolvedValue({ success: [{ word: "aspen" }, { word: "Aspen" }, { word: "ELM", coreMeaning: "tree" }], failed: [] });
    const res = await post(["BIRCH", "aspen", "elm"]);
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledExactlyOnceWith(["aspen", "elm"]);
    expect(await res.json()).toMatchObject({ success: [{ word: "birch" }, { word: "elm" }], existing: [{ word: "birch" }], failed: [{ word: "aspen" }] });
    expect(await db.select({ word: cards.word, meaning: cards.coreMeaning }).from(cards).orderBy(cards.id))
      .toEqual([{ word: "birch", meaning: "original" }, { word: "elm", meaning: "tree" }]);
  });
});
