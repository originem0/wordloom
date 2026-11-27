import { z } from "zod";
import { EXPRESSION_LIMITS, EXPRESSION_STATUSES, SOURCE_TYPES } from "./expressions.js";

// --- Request schemas ---

export const generateCardsRequestSchema = z.object({
  // 64 chars covers any real headword or short compound; an unbounded "word"
  // is a free-form prompt-injection channel into the card/deep prompts.
  words: z.array(z.string().min(1).max(64)).min(1).max(10),
});

export const extractWordsRequestSchema = z.object({
  text: z.string().min(1).max(10000),
});

// --- Expressions ---

// Kept verbatim, so it is checked for content rather than trimmed. An empty
// text is the one thing capture refuses; the bounds only stop runaway input.
const verbatimText = z.string().max(EXPRESSION_LIMITS.text).refine((s) => s.trim().length > 0);
const label = (max: number) => z.string().trim().max(max);
// A message to the partner in 对谈: what the user wanted to say.
const said = z.string().trim().min(1).max(EXPRESSION_LIMITS.said);
const attempt = z.string().max(EXPRESSION_LIMITS.attempt);

const encounterSource = {
  textBefore: z.string().max(EXPRESSION_LIMITS.text).optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  sourceTitle: label(EXPRESSION_LIMITS.sourceTitle).optional(),
  sourceLocator: label(EXPRESSION_LIMITS.sourceLocator).optional(),
  occurredAt: z.number().int().positive().optional(),
};

const focusRange = z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).refine((r) => r.end > r.start);

export const captureRequestSchema = z.object({
  text: verbatimText,
  focusRange: focusRange.optional(),
  focus: z.string().max(EXPRESSION_LIMITS.focus).optional(),
  force: z.boolean().optional(),
  found: z.object({ need: said, attempt: attempt.optional() }).optional(),
  ...encounterSource,
});

export const encounterRequestSchema = z.object({ text: verbatimText, ...encounterSource });

export const expressionPatchSchema = z.object({
  expectedUpdatedAt: z.number().int().nonnegative().optional(),
  focusRange: focusRange.nullable().optional(),
  note: z.string().max(EXPRESSION_LIMITS.note).nullable().optional(),
  focus: z.string().max(EXPRESSION_LIMITS.focus).nullable().optional(),
  intent: label(EXPRESSION_LIMITS.intent).nullable().optional(),
  intentBy: z.enum(["self", "find", "paste", "ai"]).optional(),
  status: z.enum(EXPRESSION_STATUSES).optional(),
  occurredAt: z.number().int().positive().optional(),
});

const noteText = z.string().trim().min(1).max(EXPRESSION_LIMITS.note);
const passageContent = z.object({
  body: noteText,
  examples: z.tuple([noteText, noteText]).nullable(),
});
export const passageNoteChangeSchema = z.object({
  start: z.number().int().min(0).max(EXPRESSION_LIMITS.text - 1),
  end: z.number().int().positive().max(EXPRESSION_LIMITS.text),
  before: passageContent.nullable(),
  after: passageContent.nullable(),
}).refine((v) => v.start < v.end && (v.before !== null || v.after !== null));

export const revealRequestSchema = z.object({ cue: z.enum(["masked", "none", "need", "scene"]) });

export const attemptRequestSchema = z.object({
  targetVersion: z.number().int().nonnegative().optional(),
  text: attempt.refine((s) => s.trim().length > 0),
  cue: z.enum(["none", "need", "scene", "revealed"]),
  // A stored scene, the intent, or in 对谈 the message that found the entry.
  prompt: z.string().min(1).max(EXPRESSION_LIMITS.said),
});

export const overturnRequestSchema = z.object({ outcome: z.enum(["pass", "fail"]) });

export const talkRequestSchema = z.object({
  messageId: z.string().uuid().optional(),
  said,
  thread: z.number().int().positive().optional(),
});

export const pickRequestSchema = z.object({
  text: z.string().max(EXPRESSION_LIMITS.paste).refine((s) => s.trim().length > 0),
});

// --- AI output schemas ---

export const aiCardSchema = z.object({
  word: z.string(),
  ipa: z.string().optional(),
  pos: z.string().optional(),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).optional(),
  cefrConfidence: z.enum(["high", "medium", "low"]).optional(),
  coreMeaning: z.string().optional(),
  wad: z.number().min(1).max(5).optional(),
  wap: z.number().min(1).max(5).optional(),
  etymology: z.string().optional(),
  collocations: z.array(z.string()).optional().default([]),
  examples: z
    .array(
      z.object({
        level: z.enum(["basic", "intermediate", "advanced"]),
        sentence: z.string(),
        translation: z.string(),
      }),
    )
    .optional()
    .default([]),
  contextLadder: z
    .array(
      z.object({
        level: z.number(),
        sentence: z.string(),
        // Some models omit context description; tolerate and default to empty.
        context: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
  phrases: z.array(z.string()).optional().default([]),
  synonyms: z.array(z.string()).optional().default([]),
  antonyms: z.array(z.string()).optional().default([]),
  minPair: z.string().optional(),
});

export const aiCardsResponseSchema = z.array(aiCardSchema);

// The notes around the family table. A model that sends a list where one line
// was asked for, or nothing usable, loses the note and keeps its deep layer.
const looseLine = (separator: string) =>
  z.preprocess((value) => {
    const parts = Array.isArray(value) ? value : [value];
    const line = parts
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(separator);
    return line || undefined;
  }, z.string().optional());

export const aiDeepLayerSchema = z.object({
  familyComparison: z
    .array(
      z.object({
        word: z.string(),
        pos: z.string(),
        distinction: z.string(),
        register: z.string(),
        typicalScene: z.string(),
      }),
    )
    .optional()
    .default([]),
  familyBoundaryNote: looseLine("\n"),
  familyAxes: looseLine(" / "),
  familyChoiceRule: looseLine(" "),
  schemaAnalysis: z
    .object({
      coreSchema: z.string(),
      coreImageText: z.string().optional(),
      coreImageExample: z.string().trim().optional().catch(undefined),
      coreSvg: z.string().optional().catch(undefined),
      wordType: z.string().optional().catch(undefined),
      // No longer asked for; tolerated from models that still send them.
      metaphoricalExtensions: z.array(z.string()).optional().catch(undefined),
      registerVariation: z.string().optional().catch(undefined),
      etymologyChain: z.array(z.string()).optional(),
      sceneActivation: z
        .array(
          z.object({
            title: z.string(),
            description: z.string(),
            example: z.string(),
            associatedWords: z.array(z.string()),
          }),
        )
        .optional(),
    })
    .optional(),
  boundaryTests: z
    .array(
      z.object({
        sentence: z.string().optional(),
        options: z
          .array(
            z.object({
              verdict: z.enum(["yes", "no", "maybe"]),
              word: z.string(),
              reason: z.string(),
            }),
          )
          .optional(),
        // Legacy fields kept for backward compat
        scenario: z.string().optional(),
        answer: z.string().optional(),
        explanation: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

// --- Settings ---

export const updateSettingsSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

/** Reject values the SQL driver would round, ignore or turn into an unlimited query. */
export function pageNumber(raw: string | undefined, fallback: number, max: number): number | null {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null;
}
