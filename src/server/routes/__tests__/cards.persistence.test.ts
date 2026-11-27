import { describe, it, expect, vi, beforeEach } from "vitest";

// Real app + real (in-memory) SQLite; only the AI call is faked. The previous
// version of this file re-implemented the route's merge inside the test and
// asserted on its own copy, so it could not notice the route changing.
const mockDeep = vi.fn();
vi.mock("../../services/ai-router.js", () => ({
  generateCards: vi.fn(),
  generateDeepLayer: (word: string) => mockDeep(word),
  extractWords: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { cards } from "../../db/schema.js";

const HOST = "localhost";

function postDeep(id: number, query = "") {
  return app.request(`https://${HOST}/api/cards/${id}/deep${query}`, {
    method: "POST",
    headers: { host: HOST, origin: `https://${HOST}` },
  }, { incoming: { socket: { remoteAddress: "127.0.0.1" } } });
}

async function seedCard(word: string) {
  const now = Date.now();
  const [row] = await db
    .insert(cards)
    .values({ word, usageCount: 0, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

const DEEP = {
  familyComparison: [{ word: "hinder", pos: "v", distinction: "d", register: "r", typicalScene: "s" }],
  familyBoundaryNote: "hinder is slower than block",
  schemaAnalysis: { coreSchema: "blockage", metaphoricalExtensions: [], registerVariation: "neutral" },
  boundaryTests: [{ sentence: "The road was ___.", options: [] }],
};

describe("POST /api/cards/:id/deep persistence", () => {
  beforeEach(async () => {
    mockDeep.mockReset();
    await db.delete(cards);
  });

  it("stores familyBoundaryNote inside the schemaAnalysis JSON column", async () => {
    mockDeep.mockResolvedValue(DEEP);
    const card = await seedCard("obstruct");

    const res = await postDeep(card.id);
    expect(res.status).toBe(200);
    expect(mockDeep).toHaveBeenCalledWith("obstruct");

    const row = await db.select().from(cards).where(eq(cards.id, card.id)).get();
    expect(JSON.parse(row!.schemaAnalysis!)).toEqual({
      coreSchema: "blockage",
      metaphoricalExtensions: [],
      registerVariation: "neutral",
      familyBoundaryNote: "hinder is slower than block",
    });
    expect(JSON.parse(row!.familyComparison!)).toEqual(DEEP.familyComparison);
    expect(JSON.parse(row!.boundaryTests!)).toEqual(DEEP.boundaryTests);
  });

  it("returns the decoded deep layer, note included, to the client", async () => {
    const scene = {
      coreSchema: "blockage", coreImageText: "倒下的树挡住了一半车道，车流慢了下来。",
      coreImageExample: "The fallen tree **impeded** traffic.",
    };
    mockDeep.mockResolvedValue({ ...DEEP, schemaAnalysis: scene });
    const card = await seedCard("impede");

    const body = (await (await postDeep(card.id)).json()) as {
      schemaAnalysis: { coreSchema: string; familyBoundaryNote?: string };
      familyComparison: unknown[];
    };
    expect(body.schemaAnalysis.familyBoundaryNote).toBe("hinder is slower than block");
    expect(body.schemaAnalysis).toMatchObject(scene);
    expect(body.familyComparison).toHaveLength(1);
  });

  it("omits the note key when the model did not produce one", async () => {
    mockDeep.mockResolvedValue({ ...DEEP, familyBoundaryNote: undefined });
    const card = await seedCard("block");

    await postDeep(card.id);
    const row = await db.select().from(cards).where(eq(cards.id, card.id)).get();
    expect(JSON.parse(row!.schemaAnalysis!)).not.toHaveProperty("familyBoundaryNote");
  });

  it("stores the family's axes and choice rule beside the note", async () => {
    mockDeep.mockResolvedValue({ ...DEEP, familyAxes: "程度 / 语域", familyChoiceRule: "完全不通 → block" });
    const card = await seedCard("stall");

    const body = (await (await postDeep(card.id)).json()) as { schemaAnalysis: Record<string, unknown> };
    expect(body.schemaAnalysis).toMatchObject({
      familyBoundaryNote: "hinder is slower than block",
      familyAxes: "程度 / 语域",
      familyChoiceRule: "完全不通 → block",
    });
  });

  it("keeps a legacy empty shell retryable after an empty provider result", async () => {
    const card = await seedCard("retryable");
    await db.update(cards).set({ familyComparison: "[]", boundaryTests: "[]", schemaAnalysis: '{"coreSchema":"none"}' }).where(eq(cards.id, card.id));
    mockDeep.mockResolvedValueOnce({}).mockResolvedValueOnce(DEEP);
    expect((await postDeep(card.id)).status).toBe(502);
    expect((await postDeep(card.id)).status).toBe(200);
    expect(mockDeep).toHaveBeenCalledTimes(2);
  });

  it("offers repair when the only family row is a word and the exercise has no answers", async () => {
    const card = await seedCard("hollow");
    await db.update(cards).set({ familyComparison: '[{"word":"hollow"}]', boundaryTests: '[{"sentence":"The tree was ___."}]' }).where(eq(cards.id, card.id));
    const res = await app.request("http://localhost/api/cards/missing-deep", { headers: { host: HOST } }, { incoming: { socket: { remoteAddress: "127.0.0.1" } } });
    expect(await res.json()).toMatchObject({ cards: [{ id: card.id, word: "hollow" }] });
    mockDeep.mockResolvedValue(DEEP);
    expect((await postDeep(card.id)).status).toBe(200);
    expect(mockDeep).toHaveBeenCalledTimes(1);
  });

  it("does not call the model again once a deep layer is stored", async () => {
    mockDeep.mockResolvedValue(DEEP);
    const card = await seedCard("clog");

    await postDeep(card.id);
    const again = await postDeep(card.id);
    expect(again.status).toBe(200);
    expect(mockDeep).toHaveBeenCalledTimes(1);
  });

  it("shares one durable job between simultaneous requests", async () => {
    const card = await seedCard("concurrent");
    let complete!: (result: typeof DEEP) => void;
    mockDeep.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const pair = await Promise.all([postDeep(card.id, "?async=1"), postDeep(card.id, "?async=1")]);
    expect(pair.map((r) => r.status)).toEqual([202, 202]);
    const [a, b] = await Promise.all(pair.map(async (r) => await r.json() as { jobId: string }));
    expect(a.jobId).toEqual(expect.any(String));
    expect(b.jobId).toBe(a.jobId);
    await vi.waitFor(() => expect(mockDeep).toHaveBeenCalledTimes(1));
    complete(DEEP);
    expect((await postDeep(card.id)).status).toBe(200);
    expect(mockDeep).toHaveBeenCalledTimes(1);
  });
});
