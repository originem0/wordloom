import { z } from "zod";

// --- Request schemas ---

export const generateCardsRequestSchema = z.object({
  words: z.array(z.string().min(1)).min(1).max(10),
});

export const extractWordsRequestSchema = z.object({
  text: z.string().min(1).max(10000),
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
        context: z.string(),
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
  schemaAnalysis: z
    .object({
      coreSchema: z.string(),
      metaphoricalExtensions: z.array(z.string()),
      registerVariation: z.string(),
    })
    .optional(),
  boundaryTests: z
    .array(
      z.object({
        scenario: z.string(),
        answer: z.string(),
        explanation: z.string(),
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
