import { describe, it, expect } from "vitest";
import {
  normalizeChunkResponse,
  normalizeChunkPayload,
} from "../ai-normalize.js";

// Helpers — build a minimally valid payload then override what we want to test.
function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    form: "make a difference",
    category: "verb-collocation",
    coreMeaning: "produce a noticeable change",
    register: "neutral",
    frequency: "high",
    slots: [],
    examples: [{ sentence: "He really made a difference.", register: "neutral" }],
    pitfall: null,
    contrast: null,
    theoreticalAnchors: null,
    ...overrides,
  };
}

function baseResponse(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "chunk",
    confidence: 0.9,
    reason: "looks like a real collocation",
    payload: basePayload(),
    ...overrides,
  };
}

describe("normalizeChunkResponse — verdict aliases", () => {
  it("accepts 'chunk' as-is", () => {
    const out = normalizeChunkResponse(baseResponse()) as { verdict: string };
    expect(out.verdict).toBe("chunk");
  });

  it("maps 'is_chunk' / 'yes' / 'valid' → 'chunk'", () => {
    for (const v of ["is_chunk", "IS_CHUNK", "yes", "Valid", "  valid  "]) {
      const out = normalizeChunkResponse(baseResponse({ verdict: v })) as { verdict: string };
      expect(out.verdict).toBe("chunk");
    }
  });

  it("maps 'not_chunk' / 'no' / 'invalid' / 'reject' → 'not_chunk'", () => {
    for (const v of ["not_chunk", "no", "Invalid", "reject"]) {
      const out = normalizeChunkResponse(baseResponse({ verdict: v, payload: null })) as { verdict: string };
      expect(out.verdict).toBe("not_chunk");
    }
  });

  it("maps 'maybe' / 'unclear' / 'weak' → 'borderline'", () => {
    for (const v of ["maybe", "Unclear", "weak"]) {
      const out = normalizeChunkResponse(baseResponse({ verdict: v })) as { verdict: string };
      expect(out.verdict).toBe("borderline");
    }
  });

  it("leaves unknown verdict untouched so downstream zod can reject it", () => {
    const out = normalizeChunkResponse(baseResponse({ verdict: "definitely-yes" })) as { verdict: string };
    expect(out.verdict).toBe("definitely-yes");
  });

  it("handles non-record input by passing through", () => {
    expect(normalizeChunkResponse(null)).toBe(null);
    expect(normalizeChunkResponse("not an object")).toBe("not an object");
    expect(normalizeChunkResponse(42)).toBe(42);
  });
});

describe("normalizeChunkResponse — payload handling", () => {
  it("verdict=not_chunk forces payload=null even if AI returned one", () => {
    const out = normalizeChunkResponse(
      baseResponse({ verdict: "not_chunk", payload: basePayload() }),
    ) as { payload: unknown };
    expect(out.payload).toBeNull();
  });

  it("verdict=chunk preserves payload (after internal normalization)", () => {
    const out = normalizeChunkResponse(baseResponse()) as { payload: { form: string } };
    expect(out.payload.form).toBe("make a difference");
  });

  it("coerces string confidence into a number in [0, 1]", () => {
    const out1 = normalizeChunkResponse(baseResponse({ confidence: "0.75" })) as { confidence: number };
    expect(out1.confidence).toBeCloseTo(0.75);
    const out2 = normalizeChunkResponse(baseResponse({ confidence: "5" })) as { confidence: number };
    expect(out2.confidence).toBe(1);
    const out3 = normalizeChunkResponse(baseResponse({ confidence: "-2" })) as { confidence: number };
    expect(out3.confidence).toBe(0);
  });

  it("non-string reason is coerced to a string", () => {
    const out = normalizeChunkResponse(baseResponse({ reason: 123 })) as { reason: string };
    expect(out.reason).toBe("123");
  });
});

describe("normalizeChunkPayload — enum coercion", () => {
  it("normalizes category synonyms to kebab-case canon", () => {
    const cases: Array<[string, string]> = [
      ["preposition", "prep-intuition"],
      ["prep", "prep-intuition"],
      ["Sentence Stem", "sentence-stem"],
      ["sentence_builder", "sentence-stem"],
      ["template", "sentence-stem"],
      ["Collocation", "verb-collocation"],
      ["v-n", "verb-collocation"],
      ["noun-preposition", "noun-prep"],
      ["n-prep", "noun-prep"],
      ["Connector", "discourse-marker"],
      ["marker", "discourse-marker"],
    ];
    for (const [input, expected] of cases) {
      const out = normalizeChunkPayload(basePayload({ category: input })) as { category: string };
      expect(out.category, `category "${input}"`).toBe(expected);
    }
  });

  it("normalizes register synonyms", () => {
    const cases: Array<[string, string]> = [
      ["informal", "spoken"],
      ["colloquial", "spoken"],
      ["conversational", "spoken"],
      ["scholarly", "academic"],
      ["scientific", "academic"],
      ["poetic", "literary"],
      ["standard", "neutral"],
      ["general", "neutral"],
    ];
    for (const [input, expected] of cases) {
      const out = normalizeChunkPayload(basePayload({ register: input })) as { register: string };
      expect(out.register, `register "${input}"`).toBe(expected);
    }
  });

  it("normalizes frequency synonyms", () => {
    const cases: Array<[string, string]> = [
      ["medium", "mid"],
      ["moderate", "mid"],
      ["middle", "mid"],
      ["very high", "high"],
      ["frequent", "high"],
      ["rare", "low"],
      ["uncommon", "low"],
    ];
    for (const [input, expected] of cases) {
      const out = normalizeChunkPayload(basePayload({ frequency: input })) as { frequency: string };
      expect(out.frequency, `frequency "${input}"`).toBe(expected);
    }
  });

  it("normalizes theoreticalAnchors author aliases", () => {
    const out = normalizeChunkPayload(
      basePayload({ theoreticalAnchors: ["sinclair", "Hoey", "lewis"] }),
    ) as { theoreticalAnchors: string[] };
    expect(out.theoreticalAnchors).toEqual([
      "idiom-principle",
      "lexical-priming",
      "grammaticalized-lexis",
    ]);
  });

  it("leaves already-canonical enum values unchanged", () => {
    const out = normalizeChunkPayload(
      basePayload({
        category: "verb-collocation",
        register: "academic",
        frequency: "low",
        theoreticalAnchors: ["formulaic-sequence"],
      }),
    ) as Record<string, unknown>;
    expect(out.category).toBe("verb-collocation");
    expect(out.register).toBe("academic");
    expect(out.frequency).toBe("low");
    expect(out.theoreticalAnchors).toEqual(["formulaic-sequence"]);
  });

  it("leaves unknown enum values untouched so downstream zod can flag them", () => {
    const out = normalizeChunkPayload(
      basePayload({ category: "nonsense-category", register: "ranty" }),
    ) as { category: string; register: string };
    expect(out.category).toBe("nonsense-category");
    expect(out.register).toBe("ranty");
  });
});

describe("normalizeChunkPayload — example register coercion", () => {
  // Unlike the top-level chunk.register (which fails loud), an out-of-enum
  // register on an *example* must not reject the whole chunk. Models routinely
  // emit a life-domain ("social", "news", "work") here because the prompt asks
  // for one example per domain. Regression test for the 27%-drop bug.
  it("coerces an unknown example register (life-domain) to neutral", () => {
    const out = normalizeChunkPayload(
      basePayload({
        examples: [
          { sentence: "The new rule poses a threat to small shops.", register: "news" },
          { sentence: "I felt it took its toll on me.", register: "emotional" },
          { sentence: "We met the team's needs on time.", register: "formal" },
        ],
      }),
    ) as { examples: Array<{ sentence: string; register: string }> };
    expect(out.examples.map((e) => e.register)).toEqual([
      "neutral", // "news"      → unknown → neutral
      "neutral", // "emotional" → unknown → neutral
      "formal", // valid enum   → preserved
    ]);
  });

  it("still maps known register synonyms on examples (informal → spoken)", () => {
    const out = normalizeChunkPayload(
      basePayload({
        examples: [{ sentence: "Yeah, that works for me.", register: "informal" }],
      }),
    ) as { examples: Array<{ register: string }> };
    expect(out.examples[0].register).toBe("spoken");
  });
});

describe("normalizeChunkPayload — field defaults & aliases", () => {
  it("missing slots becomes []", () => {
    const p = basePayload();
    delete (p as Record<string, unknown>).slots;
    const out = normalizeChunkPayload(p) as { slots: unknown[] };
    expect(Array.isArray(out.slots)).toBe(true);
    expect(out.slots.length).toBe(0);
  });

  it("missing contrast becomes null (not [])", () => {
    const p = basePayload();
    delete (p as Record<string, unknown>).contrast;
    const out = normalizeChunkPayload(p) as { contrast: unknown };
    expect(out.contrast).toBeNull();
  });

  it("missing theoreticalAnchors becomes null (not [])", () => {
    const p = basePayload();
    delete (p as Record<string, unknown>).theoreticalAnchors;
    const out = normalizeChunkPayload(p) as { theoreticalAnchors: unknown };
    expect(out.theoreticalAnchors).toBeNull();
  });

  it("empty-string pitfall becomes null", () => {
    const out = normalizeChunkPayload(basePayload({ pitfall: "" })) as { pitfall: unknown };
    expect(out.pitfall).toBeNull();
  });

  it("undefined pitfall becomes null", () => {
    const p = basePayload();
    delete (p as Record<string, unknown>).pitfall;
    const out = normalizeChunkPayload(p) as { pitfall: unknown };
    expect(out.pitfall).toBeNull();
  });

  it("missing coreMechanic becomes null", () => {
    const out = normalizeChunkPayload(basePayload()) as { coreMechanic: unknown };
    expect(out.coreMechanic).toBeNull();
  });

  it("empty-string coreMechanic becomes null", () => {
    const out = normalizeChunkPayload(basePayload({ coreMechanic: "" })) as {
      coreMechanic: unknown;
    };
    expect(out.coreMechanic).toBeNull();
  });

  it("provided coreMechanic passes through", () => {
    const out = normalizeChunkPayload(
      basePayload({ coreMechanic: "把价值锚定到对象上" }),
    ) as { coreMechanic: string };
    expect(out.coreMechanic).toBe("把价值锚定到对象上");
  });

  it("missing coreMeaningZh becomes null", () => {
    const out = normalizeChunkPayload(basePayload()) as { coreMeaningZh: unknown };
    expect(out.coreMeaningZh).toBeNull();
  });

  it("empty-string coreMeaningZh becomes null", () => {
    const out = normalizeChunkPayload(basePayload({ coreMeaningZh: "" })) as {
      coreMeaningZh: unknown;
    };
    expect(out.coreMeaningZh).toBeNull();
  });

  it("provided coreMeaningZh passes through", () => {
    const out = normalizeChunkPayload(
      basePayload({ coreMeaningZh: "产生显著影响" }),
    ) as { coreMeaningZh: string };
    expect(out.coreMeaningZh).toBe("产生显著影响");
  });

  it("'meaning' alias maps to coreMeaning", () => {
    const p = basePayload();
    delete (p as Record<string, unknown>).coreMeaning;
    (p as Record<string, unknown>).meaning = "create real effect";
    const out = normalizeChunkPayload(p) as { coreMeaning: string };
    expect(out.coreMeaning).toBe("create real effect");
  });

  it("'definition' alias maps to coreMeaning when meaning absent", () => {
    const p = basePayload();
    delete (p as Record<string, unknown>).coreMeaning;
    (p as Record<string, unknown>).definition = "from definition";
    const out = normalizeChunkPayload(p) as { coreMeaning: string };
    expect(out.coreMeaning).toBe("from definition");
  });

  it("'anchors' alias maps to theoreticalAnchors", () => {
    const p = basePayload();
    delete (p as Record<string, unknown>).theoreticalAnchors;
    (p as Record<string, unknown>).anchors = ["sinclair"];
    const out = normalizeChunkPayload(p) as { theoreticalAnchors: string[] };
    expect(out.theoreticalAnchors).toEqual(["idiom-principle"]);
  });
});

describe("normalizeChunkPayload — examples normalization", () => {
  it("tolerates {text} and {example} aliases on example items", () => {
    const out = normalizeChunkPayload(
      basePayload({
        examples: [
          { text: "from text alias", register: "neutral" },
          { example: "from example alias", register: "academic" },
          { sentence: "from canonical", register: "spoken" },
        ],
      }),
    ) as { examples: Array<{ sentence: string; register: string }> };

    expect(out.examples.length).toBe(3);
    expect(out.examples[0].sentence).toBe("from text alias");
    expect(out.examples[1].sentence).toBe("from example alias");
    expect(out.examples[2].sentence).toBe("from canonical");
  });

  it("defaults missing example register to 'neutral'", () => {
    const out = normalizeChunkPayload(
      basePayload({ examples: [{ sentence: "no register here" }] }),
    ) as { examples: Array<{ sentence: string; register: string }> };
    expect(out.examples[0].register).toBe("neutral");
  });

  it("drops malformed example items (no sentence at all)", () => {
    const out = normalizeChunkPayload(
      basePayload({
        examples: [
          { sentence: "valid one", register: "neutral" },
          { foo: "bar" }, // no sentence/text/example → dropped
          null,
          "not an object",
        ],
      }),
    ) as { examples: Array<{ sentence: string }> };
    expect(out.examples.length).toBe(1);
    expect(out.examples[0].sentence).toBe("valid one");
  });

  it("normalizes example register synonyms (informal → spoken)", () => {
    const out = normalizeChunkPayload(
      basePayload({ examples: [{ sentence: "x", register: "informal" }] }),
    ) as { examples: Array<{ register: string }> };
    expect(out.examples[0].register).toBe("spoken");
  });
});

describe("normalizeChunkPayload — slots and contrast normalization", () => {
  it("accepts {name} and {slot} as placeholder aliases", () => {
    const out = normalizeChunkPayload(
      basePayload({
        slots: [
          { name: "X", type: "noun", fillers: ["a"] },
          { slot: "Y", type: "verb", fillers: ["b"] },
          { placeholder: "Z", type: "adj", fillers: ["c"] },
        ],
      }),
    ) as { slots: Array<{ placeholder: string }> };
    expect(out.slots.map((s) => s.placeholder)).toEqual(["X", "Y", "Z"]);
  });

  it("drops slot items with no usable placeholder", () => {
    const out = normalizeChunkPayload(
      basePayload({
        slots: [
          { placeholder: "X", type: "noun", fillers: [] },
          { type: "verb", fillers: [] }, // missing placeholder
          null,
        ],
      }),
    ) as { slots: unknown[] };
    expect(out.slots.length).toBe(1);
  });

  it("contrast: empty/invalid array becomes null", () => {
    const out = normalizeChunkPayload(
      basePayload({ contrast: [{ foo: "no form here" }] }),
    ) as { contrast: unknown };
    expect(out.contrast).toBeNull();
  });

  it("contrast: accepts {chunk} and {pattern} as form aliases", () => {
    const out = normalizeChunkPayload(
      basePayload({
        contrast: [
          { chunk: "from chunk alias", diff: "x" },
          { pattern: "from pattern alias", diff: "y" },
        ],
      }),
    ) as { contrast: Array<{ form: string }> };
    expect(out.contrast.map((c) => c.form)).toEqual([
      "from chunk alias",
      "from pattern alias",
    ]);
  });

  it("contrast: accepts {difference} and {note} as diff aliases", () => {
    const out = normalizeChunkPayload(
      basePayload({
        contrast: [
          { form: "a", difference: "from difference" },
          { form: "b", note: "from note" },
        ],
      }),
    ) as { contrast: Array<{ form: string; diff: string }> };
    expect(out.contrast[0].diff).toBe("from difference");
    expect(out.contrast[1].diff).toBe("from note");
  });
});
