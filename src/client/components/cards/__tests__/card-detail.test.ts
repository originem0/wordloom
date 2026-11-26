import { describe, it, expect } from "vitest";
import { mergePhrases, ownSentences, seedOf, shuffleOptions, splitBoundaryNote } from "../card-detail";
import type { ExpressionSummary } from "@/shared/expressions";

describe("the order of a question's options", () => {
  const options = ["fits", "close", "wrong"];

  it("keeps every option", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect([...shuffleOptions(options, seed)].sort()).toEqual([...options].sort());
    }
    expect(options).toEqual(["fits", "close", "wrong"]);
  });

  it("is the same every time the same question is drawn", () => {
    const seed = seedOf(3380, 0, 2);
    expect(shuffleOptions(options, seed)).toEqual(shuffleOptions(options, seed));
    expect(seedOf(3380, 0, 2)).toBe(seed);
  });

  // The whole point: the stored first option is the fitting one.
  it("puts each option first for some question", () => {
    const first = new Map<string, number>();
    for (let card = 1; card <= 300; card++) {
      const lead = shuffleOptions(options, seedOf(seedOf(card, 0, 0), 0))[0];
      first.set(lead, (first.get(lead) ?? 0) + 1);
    }
    for (const option of options) {
      // a third each, give or take; the stored order would put 300 on "fits"
      expect(first.get(option)).toBeGreaterThan(60);
    }
  });

  it("tells cards, rounds and questions apart", () => {
    expect(new Set([seedOf(1, 0, 0), seedOf(2, 0, 0), seedOf(1, 1, 0), seedOf(1, 0, 1), seedOf(10, 0), seedOf(1, 0, 0, 0)]).size).toBe(6);
  });
});

describe("the family's boundary note", () => {
  it("cuts an older one-paragraph note where each pair begins", () => {
    const note = "spontaneous vs impulsive：spontaneous 像泉水自然涌出；impulsive 像闸门失控。spontaneous vs impromptu：spontaneous 侧重心意；impromptu 侧重临场发挥。";
    expect(splitBoundaryNote(note)).toEqual([
      "spontaneous vs impulsive：spontaneous 像泉水自然涌出；impulsive 像闸门失控。",
      "spontaneous vs impromptu：spontaneous 侧重心意；impromptu 侧重临场发挥。",
    ]);
  });

  it("keeps the lines of a note written one pair per line", () => {
    expect(splitBoundaryNote("give up vs. quit：前者口语。\n\n  quit vs resign：后者正式。\n")).toEqual([
      "give up vs. quit：前者口语。",
      "quit vs resign：后者正式。",
    ]);
  });

  it("does not cut a pair mentioned inside a sentence", () => {
    const note = "这组词里最容易混的是 block vs hinder，其次才是 clog。";
    expect(splitBoundaryNote(note)).toEqual([note]);
  });

  it("returns nothing for an empty note", () => {
    expect(splitBoundaryNote(" \n ")).toEqual([]);
  });
});

describe("collocations and phrases", () => {
  it("lists each once, whatever its case, and ignores what is not a list of strings", () => {
    expect(mergePhrases(["road block", " mental block "], ["Mental block", "", 3, "old block"], null, "block")).toEqual([
      "road block",
      "mental block",
      "old block",
    ]);
  });
});

function saved(id: number, text: string | null, overrides: Partial<ExpressionSummary> = {}): ExpressionSummary {
  return {
    id, text, masked: false, focus: null, status: "seen", intent: null, intentBy: null,
    sourceType: null, sourceTitle: null, occurredAt: null, createdAt: id, updatedAt: id,
    produced: false, graduated: false, queued: false, ...overrides,
  };
}

describe("sentences from the reader's expression library", () => {
  it("finds the whole word in any case and its regular verb forms, without finding a longer word", () => {
    const entries = [saved(4, "We BLOCK the road."), saved(3, "A tree blocked it."), saved(2, "It is blocking traffic."), saved(1, "A blockade remained.")];
    expect(ownSentences(entries, "block", "verb").map((s) => s.hit)).toEqual(["BLOCK", "blocked", "blocking"]);
    expect(ownSentences([saved(1, "Care is needed.")], "car", "noun")).toEqual([]);
  });

  it("uses the part of speech and does not guess one when it is missing", () => {
    const entries = [saved(2, "He pasted it here."), saved(1, "The past is gone.")];
    expect(ownSentences(entries, "past", "noun").map((s) => s.id)).toEqual([1]);
    expect(ownSentences(entries, "past").map((s) => s.id)).toEqual([1]);
    expect(ownSentences([saved(1, "We named them.")], "name", "noun")).toEqual([]);
  });

  it("keeps a short doubled verb separate from a different verb ending in e", () => {
    const entries = [saved(3, "She hopped away."), saved(2, "She hoped so."), saved(1, "She is hopping.")];
    expect(ownSentences(entries, "hop", "v").map((s) => s.id)).toEqual([3, 1]);
    expect(ownSentences(entries, "hope", "v").map((s) => s.id)).toEqual([2]);
    expect(ownSentences([saved(1, "Plant the seed.")], "see", "verb")).toEqual([]);
  });

  it("finds regular y and e endings, and a noun's plural and possessive", () => {
    expect(ownSentences([saved(1, "She studied it.")], "study", "verb")[0].hit).toBe("studied");
    expect(ownSentences([saved(1, "We are agreeing.")], "agree", "verb")[0].hit).toBe("agreeing");
    expect(ownSentences([saved(1, "The boxes arrived.")], "box", "noun")[0].hit).toBe("boxes");
    const sentence = ownSentences([saved(1, "The car’s engine stopped.")], "car", "noun")[0];
    expect(sentence.hit).toBe("car");
    expect(sentence.before + sentence.hit + sentence.after).toBe("The car’s engine stopped.");
  });

  it("matches phrases with their separators, and treats an apostrophe as part of a word", () => {
    const entries = [saved(3, "We repeat it ad nauseam."), saved(2, "He said ad. Nauseam came next."), saved(1, "We repeat it ad, nauseam.")];
    expect(ownSentences(entries, "ad nauseam").map((s) => s.id)).toEqual([3]);
    expect(ownSentences([saved(1, "It supports well-being.")], "well-being")[0].hit).toBe("well-being");
    expect(ownSentences([saved(1, "I DON’T know.")], "don't")[0].hit).toBe("DON’T");
    expect(ownSentences([saved(1, "I can't do it.")], "can", "verb")).toEqual([]);
  });

  it("leaves out archived and masked entries even if a masked entry accidentally contains text", () => {
    const entries = [
      saved(5, "Block the road.", { status: "retired" }),
      saved(4, "Block the road.", { masked: true, status: "active" }),
      saved(3, null, { masked: true, status: "active" }),
      saved(2, "Block the road.", { status: "active", graduated: true }),
      saved(1, "Block another road."),
    ];
    expect(ownSentences(entries, "block").map((s) => s.id)).toEqual([2, 1]);
  });

  it("puts a marked focus first and excerpts that occurrence, listing each entry once", () => {
    const entries = [
      saved(3, "One block remained."),
      saved(2, "A BLOCK stopped us, but another block remained.", { focus: "another block", sourceType: "book", sourceTitle: "My book", occurredAt: 0 }),
      saved(1, "The last block."),
    ];
    const sentences = ownSentences(entries, "block", "noun");
    expect(sentences.map((s) => s.id)).toEqual([2, 3, 1]);
    expect(sentences[0]).toMatchObject({ before: "A BLOCK stopped us, but another ", hit: "block", after: " remained.", sourceTitle: "My book", at: 0 });
    expect(entries.map((e) => e.id)).toEqual([3, 2, 1]);
  });

  it("shows the same original once when it was saved with different focuses, keeping the matching focus", () => {
    const entries = [
      saved(3, "We noticed the sore spot.", { focus: "noticed" }),
      saved(2, "We noticed the sore spot.", { focus: "sore spot", sourceTitle: "The matching entry" }),
      saved(1, "We noticed\n the sore spot."),
    ];
    const sentences = ownSentences(entries, "sore", "adj");
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toMatchObject({ id: 2, hit: "sore", sourceTitle: "The matching entry" });
  });

  it("keeps a long passage bounded around the matching word", () => {
    const text = `${"Some earlier context. ".repeat(100)}BLOCK${" Later context.".repeat(100)}`;
    const sentence = ownSentences([saved(1, text)], "block")[0];
    expect(sentence.hit).toBe("BLOCK");
    expect(sentence.before).toMatch(/^…/);
    expect(sentence.after).toMatch(/…$/);
    expect(sentence.before.length + sentence.hit.length + sentence.after.length).toBeLessThanOrEqual(247);
  });

  it("does not guess irregular forms or search for an empty word", () => {
    expect(ownSentences([saved(1, "We sought it.")], "seek", "verb")).toEqual([]);
    expect(ownSentences([saved(1, "Anything")], " !!! ")).toEqual([]);
  });
});
