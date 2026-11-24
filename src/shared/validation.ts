import { z } from "zod";
import { EXPRESSION_LIMITS, SOURCE_TYPES } from "./expressions.js";

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

const encounterSource = {
  textBefore: z.string().max(EXPRESSION_LIMITS.text).optional(),
  sourceType: z.enum(SOURCE_TYPES).optional(),
  sourceTitle: label(EXPRESSION_LIMITS.sourceTitle).optional(),
  sourceLocator: label(EXPRESSION_LIMITS.sourceLocator).optional(),
  occurredAt: z.number().int().positive().optional(),
};

export const captureRequestSchema = z.object({
  text: verbatimText,
  focus: label(EXPRESSION_LIMITS.focus).optional(),
  force: z.boolean().optional(),
  ...encounterSource,
});

export const encounterRequestSchema = z.object({ text: verbatimText, ...encounterSource });

export const expressionPatchSchema = z.object({
  note: z.string().max(EXPRESSION_LIMITS.note).nullable().optional(),
  focus: label(EXPRESSION_LIMITS.focus).nullable().optional(),
  intent: label(EXPRESSION_LIMITS.intent).nullable().optional(),
  intentBy: z.enum(["self", "find", "paste", "ai"]).optional(),
  // "active" is the 想用 layer, which does not exist yet: until it does an
  // entry can only be shelved and brought back.
  status: z.enum(["seen", "retired"]).optional(),
  occurredAt: z.number().int().positive().optional(),
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
  familyBoundaryNote: z.string().optional(),
  schemaAnalysis: z
    .object({
      coreSchema: z.string(),
      coreImageText: z.string().optional(),
      coreSvg: z.string().optional(),
      metaphoricalExtensions: z.array(z.string()),
      registerVariation: z.string(),
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
