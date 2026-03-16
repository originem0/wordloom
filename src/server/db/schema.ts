import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
