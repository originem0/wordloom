import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";

export const stories = sqliteTable("stories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  imagePath: text("image_path").notNull(),
  prompt: text("prompt").default(""),
  story: text("story").notNull(),
  sources: text("sources"), // JSON string: GroundingSource[]
  createdAt: integer("created_at").notNull(),
});

export const cards = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  word: text("word").notNull().unique(),
  ipa: text("ipa"),
  pos: text("pos"),
  cefr: text("cefr"),
  cefrConfidence: text("cefr_confidence"),
  coreMeaning: text("core_meaning"),
  wad: real("wad"),
  wap: real("wap"),
  etymology: text("etymology"),
  collocations: text("collocations"), // JSON string: string[]
  examples: text("examples"), // JSON string: {level, sentence, translation}[]
  contextLadder: text("context_ladder"), // JSON string: {level, sentence, context}[]
  phrases: text("phrases"), // JSON string: string[]
  synonyms: text("synonyms"), // JSON string: string[]
  antonyms: text("antonyms"), // JSON string: string[]
  minPair: text("min_pair"),
  // Deep layer fields — nullable, lazy-loaded
  familyComparison: text("family_comparison"),
  schemaAnalysis: text("schema_analysis"),
  boundaryTests: text("boundary_tests"),
  usageCount: integer("usage_count").notNull().default(0),
  storyId: integer("story_id").references(() => stories.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("cards_created_at_idx").on(table.createdAt),
  index("cards_cefr_idx").on(table.cefr),
]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // story | cards | chunks
  status: text("status").notNull(), // queued | running | done | failed | cancelled
  input: text("input").notNull(), // JSON payload
  result: text("result"), // JSON payload
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Chunks: multi-word prefabricated patterns (separate from word-level cards)
// ---------------------------------------------------------------------------

export const chunks = sqliteTable("chunks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // Canonical pattern with slot placeholders, e.g. "with a (growing) sense of X"
  form: text("form").notNull(),
  // enum: prep-intuition | sentence-stem | verb-collocation | noun-prep | discourse-marker
  category: text("category").notNull(),
  // <= 12 English words; what it actually does
  coreMeaning: text("core_meaning").notNull(),
  // Optional Chinese gloss for `coreMeaning` (UX: dictionary-level readability)
  coreMeaningZh: text("core_meaning_zh"),
  // Optional Chinese one-liner naming the chunk's underlying mechanic / tension
  coreMechanic: text("core_mechanic"),
  // enum: neutral | formal | spoken | academic | literary
  register: text("register").notNull(),
  // enum: high | mid | low — corpus-style observation, NOT mastery/priority
  frequency: text("frequency").notNull(),
  // JSON: [{ placeholder, type, fillers[] }]
  slots: text("slots"),
  // JSON: [{ sentence, register }] — 2 or 3 entries, English only
  examples: text("examples").notNull(),
  // One-sentence L1-interference trap; nullable
  pitfall: text("pitfall"),
  // JSON: [{ form, diff }] up to 3 sibling chunks; nullable
  contrast: text("contrast"),
  // JSON: string[] from fixed enum; 0-2 items; nullable
  theoreticalAnchors: text("theoretical_anchors"),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("chunks_created_at_idx").on(table.createdAt),
  index("chunks_category_idx").on(table.category),
  unique("chunks_form_category_unique").on(table.form, table.category),
]);
