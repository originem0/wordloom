import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

// Mock db — return a fake API key so getClient() doesn't throw
import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
beforeEach(async () => {
  await db.delete(settings);
  await db.insert(settings).values({ key: "gemini_api_key", value: "fake-api-key" });
});

// Mock @google/genai — control generateContent responses
const mockGenerateContent = vi.fn();
vi.mock("../gemini-transport.js", async (original) => ({
  ...await original<typeof import("../gemini-transport.js")>(),
  geminiTransport: () => ({ generateContent: mockGenerateContent }),
}));

// Import after mocks
import { geminiGenerateCards as generateCards } from "../gemini.js";

describe("generateCards — Zod validation + partial failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all cards on fully valid response", async () => {
    const validCards = [
      makeValidCard("apple"),
      makeValidCard("banana"),
      makeValidCard("cherry"),
    ];
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(validCards) });

    const result = await generateCards(["apple", "banana", "cherry"]);

    expect(result.success).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.success.map((c) => c.word)).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });

  it("separates valid and invalid cards on partial failure", async () => {
    const cards = [
      makeValidCard("apple"),
      { ...makeValidCard("banana"), cefr: "X9" }, // invalid CEFR
      makeValidCard("cherry"),
    ];
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(cards) });

    const result = await generateCards(["apple", "banana", "cherry"]);

    expect(result.success.map((c) => c.word)).toEqual(["apple", "cherry"]);
    expect(result.failed).toContainEqual({
      word: "banana",
      error: "Validation failed",
    });
  });

  it('marks missing words as "Not returned by AI"', async () => {
    // One valid card + one invalid → triggers per-item validation.
    // "cherry" is absent entirely → should be marked "Not returned by AI".
    const cards = [
      makeValidCard("apple"),
      { ...makeValidCard("banana"), cefr: "X9" }, // invalid
      // "cherry" missing
    ];
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify(cards) });

    const result = await generateCards(["apple", "banana", "cherry"]);

    expect(result.success.map((c) => c.word)).toEqual(["apple"]);
    expect(result.failed).toContainEqual({
      word: "banana",
      error: "Validation failed",
    });
    expect(result.failed).toContainEqual({
      word: "cherry",
      error: "Not returned by AI",
    });
  });

  it("throws on non-JSON response", async () => {
    mockGenerateContent.mockResolvedValue({ text: "not json at all" });

    await expect(generateCards(["apple"])).rejects.toThrow(
      /Failed to parse Gemini JSON response/,
    );
  });
});

// --- Helpers ---

function makeValidCard(word: string) {
  return {
    word,
    ipa: "/test/",
    pos: "noun",
    cefr: "B1",
    cefrConfidence: "high",
    coreMeaning: "测试",
    wad: 3,
    wap: 2,
    etymology: "Latin",
    collocations: ["test collocation"],
    examples: [
      {
        level: "basic",
        sentence: `This is a ${word}.`,
        translation: "这是测试。",
      },
    ],
    contextLadder: [{ level: 1, sentence: `Simple ${word}.`, context: "basic" }],
    phrases: [`${word} phrase`],
    synonyms: ["syn"],
    antonyms: ["ant"],
    minPair: "test",
  };
}
