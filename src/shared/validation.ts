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

// --- Chunks ---

export const chunkCategoryEnum = z.enum([
  "prep-intuition",
  "sentence-stem",
  "verb-collocation",
  "noun-prep",
  "discourse-marker",
]);

export const chunkRegisterEnum = z.enum([
  "neutral",
  "formal",
  "spoken",
  "academic",
  "literary",
]);

export const chunkFrequencyEnum = z.enum(["high", "mid", "low"]);

export const theoreticalAnchorEnum = z.enum([
  "idiom-principle",
  "formulaic-sequence",
  "lexical-priming",
  "cognitive-chunk",
  "grammaticalized-lexis",
]);

export const generateChunkRequestSchema = z.object({
  input: z.string().min(1).max(200),
});

export const aiChunkPayloadSchema = z.object({
  form: z.string().min(1),
  category: chunkCategoryEnum,
  coreMeaning: z.string().min(1),
  coreMeaningZh: z.string().nullable().optional(),
  coreMechanic: z.string().nullable().optional(),
  register: chunkRegisterEnum,
  frequency: chunkFrequencyEnum,
  slots: z
    .array(
      z.object({
        placeholder: z.string(),
        type: z.string(),
        fillers: z.array(z.string()).optional().default([]),
      }),
    )
    .optional()
    .default([]),
  examples: z
    .array(
      z.object({
        sentence: z.string(),
        register: chunkRegisterEnum,
      }),
    )
    .min(1),
  pitfall: z.string().nullable().optional(),
  contrast: z
    .array(
      z.object({
        form: z.string(),
        diff: z.string(),
      }),
    )
    .nullable()
    .optional(),
  theoreticalAnchors: z
    .array(theoreticalAnchorEnum)
    .nullable()
    .optional(),
});

export const aiChunkResponseSchema = z.object({
  verdict: z.enum(["chunk", "borderline", "not_chunk"]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  payload: aiChunkPayloadSchema.nullable(),
});

export const updateChunkSchema = aiChunkPayloadSchema.partial();

// --- Practice (picture-description) ---

export const practiceStyleEnum = z.enum([
  "documentary",
  "cinematic",
  "watercolor",
  "retro-film",
  "anime",
]);

export const generatePracticeRequestSchema = z.object({
  topic: z.string().max(200).optional().default(""),
  style: practiceStyleEnum.optional().default("documentary"),
});

export const gradePracticeRequestSchema = z.object({
  description: z.string().min(1).max(5000),
});

const practiceSceneFrameSchema = z.object({
  subjects: z.array(z.string()).optional().default([]),
  actions: z.array(z.string()).optional().default([]),
  setting: z.string().optional().default(""),
  mood: z.string().optional().default(""),
});

const practiceChunkSchema = z.object({
  form: z.string(),
  example: z.string().optional().default(""),
});

export const practiceBriefSchema = z.object({
  visualPrompt: z.string().min(1),
  sceneFrame: practiceSceneFrameSchema.optional().default({
    subjects: [],
    actions: [],
    setting: "",
    mood: "",
  }),
  taskBrief: z.string().optional().default(""),
  suggestedChunks: z.array(practiceChunkSchema).optional().default([]),
  starterLine: z.string().optional().default(""),
});

export const practiceFeedbackSchema = z.object({
  overall: z.string().optional().default(""),
  good: z.array(z.string()).optional().default([]),
  improve: z
    .array(z.object({ point: z.string(), suggestion: z.string() }))
    .optional()
    .default([]),
  usedSuggestions: z
    .array(z.object({ form: z.string(), used: z.boolean() }))
    .optional()
    .default([]),
});
