import { describe, it, expect } from "vitest";
import { aiDeepLayerSchema } from "../validation.js";

describe("Scenario 1: AI Data Schema Validation Resilience", () => {
  it("rejects payload missing critical fields", () => {
    // Missing required coreSchema
    const badData = {
      schemaAnalysis: {
        metaphoricalExtensions: ["ext1"],
        registerVariation: "formal",
        // coreSchema is missing
      },
    };

    const result = aiDeepLayerSchema.safeParse(badData);
    expect(result.success).toBe(false);
  });

  it("adds default arrays when AI returns undefined or ignores arrays", () => {
    const aiResponse = {
      // AI didn't return familyComparison or boundaryTests
      schemaAnalysis: {
        coreSchema: "blockage",
        metaphoricalExtensions: [],
        registerVariation: "formal",
      },
    };

    const parsed = aiDeepLayerSchema.parse(aiResponse);
    expect(parsed.familyComparison).toEqual([]); // defaulted
    expect(parsed.boundaryTests).toEqual([]); // defaulted
  });

  it("accepts full new prototype structure alongside legacy fallback", () => {
    const fullData = {
      familyComparison: [
        { word: "a", pos: "n", distinction: "d", register: "r", typicalScene: "s" },
      ],
      schemaAnalysis: {
        coreSchema: "blockage",
        coreImageText: "A blocking image",
        metaphoricalExtensions: ["mental block"],
        registerVariation: "neutral",
        etymologyChain: ["stage1", "stage2"],
        sceneActivation: [
          { title: "T", description: "D", example: "E", associatedWords: ["W"] },
        ],
      },
      boundaryTests: [
        {
          sentence: "It's a ______",
          options: [{ verdict: "yes", word: "test", reason: "because" }],
        },
      ],
      familyBoundaryNote: "A comparison note",
    };

    const result = aiDeepLayerSchema.safeParse(fullData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boundaryTests[0].options?.[0].verdict).toBe("yes");
      expect(result.data.familyBoundaryNote).toBe("A comparison note");
    }
  });

  it("accepts older legacy structure without crashing", () => {
    const legacyData = {
      familyComparison: [],
      schemaAnalysis: {
        coreSchema: "path",
        metaphoricalExtensions: [],
        registerVariation: "neutral",
      },
      boundaryTests: [
        {
          scenario: "Old scenario",
          answer: "yes",
          explanation: "Old explanation",
        },
      ],
    };

    const result = aiDeepLayerSchema.safeParse(legacyData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.boundaryTests[0].scenario).toBe("Old scenario");
    }
  });
});
