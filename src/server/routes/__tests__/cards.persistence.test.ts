import { describe, it, expect, vi, beforeEach } from "vitest";

// Real app + real (in-memory) SQLite; only the AI call is faked. The previous
// version of this file re-implemented the route's merge inside the test and
// asserted on its own copy, so it could not notice the route changing.
const mockDeep = vi.fn();
vi.mock("../../services/ai-router.js", () => ({
  generateStory: vi.fn(),
  generateTTS: vi.fn(),
  translateText: vi.fn(),
  generateCards: vi.fn(),
  generateDeepLayer: (word: string) => mockDeep(word),
  extractWords: vi.fn(),
  generateChunk: vi.fn(),
  generatePracticeImage: vi.fn(),
  generatePracticeBrief: vi.fn(),
  gradePracticeDescription: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { cards } from "../../db/schema.js";

const HOST = "wordloom.test";

function postDeep(id: number) {
  return app.request(`/api/cards/${id}/deep`, {
    method: "POST",
    headers: { host: HOST, origin: `https://${HOST}`, "x-real-ip": "203.0.113.9" },
  });
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
    mockDeep.mockResolvedValue(DEEP);
    const card = await seedCard("impede");

    const body = (await (await postDeep(card.id)).json()) as {
      schemaAnalysis: { coreSchema: string; familyBoundaryNote?: string };
      familyComparison: unknown[];
    };
    expect(body.schemaAnalysis.familyBoundaryNote).toBe("hinder is slower than block");
    expect(body.schemaAnalysis.coreSchema).toBe("blockage");
    expect(body.familyComparison).toHaveLength(1);
  });

  it("omits the note key when the model did not produce one", async () => {
    mockDeep.mockResolvedValue({ ...DEEP, familyBoundaryNote: undefined });
    const card = await seedCard("block");

    await postDeep(card.id);
    const row = await db.select().from(cards).where(eq(cards.id, card.id)).get();
    expect(JSON.parse(row!.schemaAnalysis!)).not.toHaveProperty("familyBoundaryNote");
  });

  it("does not call the model again once a deep layer is stored", async () => {
    mockDeep.mockResolvedValue(DEEP);
    const card = await seedCard("clog");

    await postDeep(card.id);
    const again = await postDeep(card.id);
    expect(again.status).toBe(200);
    expect(mockDeep).toHaveBeenCalledTimes(1);
  });
});
