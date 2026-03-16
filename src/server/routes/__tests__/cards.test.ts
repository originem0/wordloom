import { describe, it, expect, vi, beforeEach } from "vitest";

// Block db top-level side effects
vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// Block gemini service top-level side effects (imports db)
vi.mock("../../services/gemini.js", () => ({
  generateCards: vi.fn(),
  generateDeepLayer: vi.fn(),
  extractWords: vi.fn(),
}));

import { toCard } from "../cards.js";
import type { cards } from "../../db/schema.js";

type CardRow = typeof cards.$inferSelect;

/** Build a minimal card row with overrides. */
function fakeRow(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: 1,
    word: "test",
    ipa: null,
    pos: null,
    cefr: null,
    cefrConfidence: null,
    coreMeaning: null,
    wad: null,
    wap: null,
    etymology: null,
    collocations: "[]",
    examples: "[]",
    contextLadder: "[]",
    phrases: "[]",
    synonyms: "[]",
    antonyms: "[]",
    minPair: null,
    familyComparison: null,
    schemaAnalysis: null,
    boundaryTests: null,
    usageCount: 0,
    storyId: null,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("toCard — JSON serialization/deserialization", () => {
  it("parses valid JSON strings into objects/arrays", () => {
    const row = fakeRow({
      collocations: '["make a test","run a test"]',
      examples:
        '[{"level":"basic","sentence":"This is a test.","translation":"这是一个测试。"}]',
      schemaAnalysis:
        '{"coreSchema":"core","metaphoricalExtensions":[],"registerVariation":"neutral"}',
    });

    const card = toCard(row);

    expect(card.collocations).toEqual(["make a test", "run a test"]);
    expect(card.examples).toEqual([
      {
        level: "basic",
        sentence: "This is a test.",
        translation: "这是一个测试。",
      },
    ]);
    expect(card.schemaAnalysis).toEqual({
      coreSchema: "core",
      metaphoricalExtensions: [],
      registerVariation: "neutral",
    });
  });

  it("defaults array fields to [] and schemaAnalysis to null on broken JSON", () => {
    const row = fakeRow({
      collocations: "{broken",
      examples: "not json",
      schemaAnalysis: "{{bad",
    });

    const card = toCard(row);

    expect(card.collocations).toEqual([]);
    expect(card.examples).toEqual([]);
    expect(card.schemaAnalysis).toBeNull();
  });

  it("defaults array fields to [] and schemaAnalysis to null when values are null/undefined", () => {
    const row = fakeRow({
      collocations: null as unknown as string,
      examples: null as unknown as string,
      synonyms: undefined as unknown as string,
      schemaAnalysis: null,
    });

    const card = toCard(row);

    expect(card.collocations).toEqual([]);
    expect(card.examples).toEqual([]);
    expect(card.synonyms).toEqual([]);
    expect(card.schemaAnalysis).toBeNull();
  });

  it("handles mixed: some fields valid, some broken", () => {
    const row = fakeRow({
      collocations: '["good"]',
      examples: "broken",
      phrases: '["ok phrase"]',
      schemaAnalysis: "{{nope",
    });

    const card = toCard(row);

    expect(card.collocations).toEqual(["good"]);
    expect(card.examples).toEqual([]);
    expect(card.phrases).toEqual(["ok phrase"]);
    expect(card.schemaAnalysis).toBeNull();
  });
});
