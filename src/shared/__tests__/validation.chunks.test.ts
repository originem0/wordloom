import { describe, it, expect } from "vitest";
import {
  generateChunkRequestSchema,
  aiChunkResponseSchema,
  aiChunkPayloadSchema,
  updateChunkSchema,
} from "../validation.js";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    form: "attach importance to X",
    category: "verb-collocation",
    coreMeaning: "consider something important",
    register: "formal",
    frequency: "mid",
    slots: [
      { placeholder: "X", type: "abstract noun", fillers: ["education", "honesty"] },
    ],
    examples: [
      { sentence: "He attaches great importance to family.", register: "neutral" },
      { sentence: "The policy attaches considerable importance to data privacy.", register: "academic" },
    ],
    pitfall: "Common L1 error: 'attach importance on'.",
    contrast: [{ form: "place emphasis on X", diff: "more natural in everyday English" }],
    theoreticalAnchors: ["idiom-principle"],
    ...overrides,
  };
}

function validResponse(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "chunk",
    confidence: 0.92,
    reason: "Fixed pattern with locked preposition.",
    payload: validPayload(),
    ...overrides,
  };
}

describe("generateChunkRequestSchema", () => {
  it("accepts a normal input string", () => {
    const r = generateChunkRequestSchema.safeParse({ input: "attach importance to" });
    expect(r.success).toBe(true);
  });

  it("rejects empty string (min length 1)", () => {
    const r = generateChunkRequestSchema.safeParse({ input: "" });
    expect(r.success).toBe(false);
  });

  it("rejects missing input field", () => {
    const r = generateChunkRequestSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects input > 200 chars", () => {
    const r = generateChunkRequestSchema.safeParse({ input: "a".repeat(201) });
    expect(r.success).toBe(false);
  });

  it("accepts input exactly at 200 chars", () => {
    const r = generateChunkRequestSchema.safeParse({ input: "a".repeat(200) });
    expect(r.success).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(generateChunkRequestSchema.safeParse({ input: 42 }).success).toBe(false);
    expect(generateChunkRequestSchema.safeParse({ input: null }).success).toBe(false);
    expect(generateChunkRequestSchema.safeParse({ input: ["a"] }).success).toBe(false);
  });
});

describe("aiChunkResponseSchema — happy paths", () => {
  it("accepts a fully valid chunk response with all payload fields", () => {
    const r = aiChunkResponseSchema.safeParse(validResponse());
    expect(r.success).toBe(true);
  });

  it("accepts borderline verdict with payload", () => {
    const r = aiChunkResponseSchema.safeParse(validResponse({ verdict: "borderline" }));
    expect(r.success).toBe(true);
  });

  it("accepts not_chunk with payload=null", () => {
    const r = aiChunkResponseSchema.safeParse({
      verdict: "not_chunk",
      confidence: 0.99,
      reason: "Single dictionary headword.",
      payload: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts payload with optional fields absent (nullable / optional pass through)", () => {
    const minimal = validPayload({
      slots: [],
      pitfall: null,
      contrast: null,
      theoreticalAnchors: null,
    });
    const r = aiChunkResponseSchema.safeParse(validResponse({ payload: minimal }));
    expect(r.success).toBe(true);
  });

  it("accepts payload with coreMechanic + coreMeaningZh present", () => {
    const r = aiChunkResponseSchema.safeParse(
      validResponse({
        payload: validPayload({
          coreMechanic: "把价值锚定到对象上",
          coreMeaningZh: "认为某事很重要",
        }),
      }),
    );
    expect(r.success).toBe(true);
  });

  it("accepts payload with coreMechanic / coreMeaningZh null or absent", () => {
    expect(
      aiChunkResponseSchema.safeParse(
        validResponse({
          payload: validPayload({ coreMechanic: null, coreMeaningZh: null }),
        }),
      ).success,
    ).toBe(true);
    const p = validPayload();
    delete (p as Record<string, unknown>).coreMechanic;
    delete (p as Record<string, unknown>).coreMeaningZh;
    expect(
      aiChunkResponseSchema.safeParse(validResponse({ payload: p })).success,
    ).toBe(true);
  });
});

describe("aiChunkResponseSchema — top-level rejects", () => {
  it("rejects unknown verdict value", () => {
    const r = aiChunkResponseSchema.safeParse(validResponse({ verdict: "definitely" }));
    expect(r.success).toBe(false);
  });

  it("rejects confidence > 1", () => {
    const r = aiChunkResponseSchema.safeParse(validResponse({ confidence: 1.5 }));
    expect(r.success).toBe(false);
  });

  it("rejects confidence < 0", () => {
    const r = aiChunkResponseSchema.safeParse(validResponse({ confidence: -0.2 }));
    expect(r.success).toBe(false);
  });

  it("rejects missing reason", () => {
    const bad = validResponse();
    delete (bad as Record<string, unknown>).reason;
    expect(aiChunkResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe("aiChunkPayloadSchema — required fields", () => {
  const required = ["form", "category", "coreMeaning", "register", "frequency", "examples"] as const;

  for (const field of required) {
    it(`rejects payload missing ${field}`, () => {
      const p = validPayload();
      delete (p as Record<string, unknown>)[field];
      expect(aiChunkPayloadSchema.safeParse(p).success).toBe(false);
    });
  }

  it("rejects empty examples array", () => {
    const r = aiChunkPayloadSchema.safeParse(validPayload({ examples: [] }));
    expect(r.success).toBe(false);
  });

  it("rejects example missing sentence", () => {
    const r = aiChunkPayloadSchema.safeParse(
      validPayload({ examples: [{ register: "neutral" }] }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects example with unknown register", () => {
    const r = aiChunkPayloadSchema.safeParse(
      validPayload({
        examples: [{ sentence: "x", register: "made-up-register" }],
      }),
    );
    expect(r.success).toBe(false);
  });
});

describe("aiChunkPayloadSchema — enum validation", () => {
  it("rejects unknown category", () => {
    const r = aiChunkPayloadSchema.safeParse(validPayload({ category: "idiom" }));
    expect(r.success).toBe(false);
  });

  it("rejects unknown register", () => {
    const r = aiChunkPayloadSchema.safeParse(validPayload({ register: "casual" }));
    expect(r.success).toBe(false);
  });

  it("rejects unknown frequency", () => {
    const r = aiChunkPayloadSchema.safeParse(validPayload({ frequency: "ultra" }));
    expect(r.success).toBe(false);
  });

  it("rejects unknown theoreticalAnchor value", () => {
    const r = aiChunkPayloadSchema.safeParse(
      validPayload({ theoreticalAnchors: ["chomsky"] }),
    );
    expect(r.success).toBe(false);
  });

  it("accepts all 5 valid categories", () => {
    for (const cat of [
      "prep-intuition",
      "sentence-stem",
      "verb-collocation",
      "noun-prep",
      "discourse-marker",
    ]) {
      const r = aiChunkPayloadSchema.safeParse(validPayload({ category: cat }));
      expect(r.success, `category "${cat}"`).toBe(true);
    }
  });

  it("accepts all 5 valid theoreticalAnchors", () => {
    const r = aiChunkPayloadSchema.safeParse(
      validPayload({
        theoreticalAnchors: [
          "idiom-principle",
          "formulaic-sequence",
          "lexical-priming",
          "cognitive-chunk",
          "grammaticalized-lexis",
        ],
      }),
    );
    expect(r.success).toBe(true);
  });
});

describe("updateChunkSchema (partial)", () => {
  it("accepts an update with only one field", () => {
    expect(updateChunkSchema.safeParse({ form: "new form" }).success).toBe(true);
    expect(updateChunkSchema.safeParse({ pitfall: "warn user" }).success).toBe(true);
    expect(updateChunkSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown enum even in partial mode (category)", () => {
    expect(
      updateChunkSchema.safeParse({ category: "nonsense" }).success,
    ).toBe(false);
  });

  it("rejects unknown enum even in partial mode (register)", () => {
    expect(
      updateChunkSchema.safeParse({ register: "casual" }).success,
    ).toBe(false);
  });

  it("rejects unknown enum even in partial mode (frequency)", () => {
    expect(
      updateChunkSchema.safeParse({ frequency: "ultra" }).success,
    ).toBe(false);
  });

  it("rejects partial examples with bad inner shape", () => {
    expect(
      updateChunkSchema.safeParse({
        examples: [{ sentence: "x", register: "made-up" }],
      }).success,
    ).toBe(false);
  });
});
