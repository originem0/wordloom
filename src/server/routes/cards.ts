import { Hono } from "hono";
import { db } from "../db/index.js";
import { cards } from "../db/schema.js";
import { eq, desc, like, inArray, or, sql, count } from "drizzle-orm";
import {
  generateCards,
  generateDeepLayer,
  extractWords,
} from "../services/gemini.js";
import {
  generateCardsRequestSchema,
  extractWordsRequestSchema,
} from "../../shared/validation.js";
import type { Card } from "../../shared/types.js";

export const cardRoutes = new Hono();

// JSON text fields that need parsing when reading from DB
const JSON_FIELDS = [
  "collocations",
  "examples",
  "contextLadder",
  "phrases",
  "synonyms",
  "antonyms",
  "familyComparison",
  "schemaAnalysis",
  "boundaryTests",
] as const;

/** Parse a card DB row into the API shape (JSON-decode text fields). */
function toCard(row: typeof cards.$inferSelect): Card {
  const card: Record<string, unknown> = { ...row };
  for (const field of JSON_FIELDS) {
    const raw = card[field];
    if (typeof raw === "string") {
      try {
        card[field] = JSON.parse(raw);
      } catch {
        card[field] = field === "schemaAnalysis" ? null : [];
      }
    } else {
      card[field] = field === "schemaAnalysis" ? null : raw ?? [];
    }
  }
  return card as unknown as Card;
}

// POST /generate — generate cards for a list of words
cardRoutes.post("/generate", async (c) => {
  const body = await c.req.json();
  const parsed = generateCardsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  const { words } = parsed.data;

  // Find which words already exist
  const existing = await db
    .select({ word: cards.word })
    .from(cards)
    .where(inArray(cards.word, words))
    .all();
  const existingWords = new Set(existing.map((r) => r.word.toLowerCase()));
  const newWords = words.filter((w) => !existingWords.has(w.toLowerCase()));

  if (newWords.length === 0) {
    return c.json({ success: [], failed: [], message: "All words already exist" });
  }

  // Generate via Gemini
  const { success, failed } = await generateCards(newWords);

  // Insert successful cards into DB
  const now = Date.now();
  const insertedCards: Card[] = [];

  for (const card of success) {
    const inserted = await db
      .insert(cards)
      .values({
        word: card.word,
        ipa: card.ipa ?? null,
        pos: card.pos ?? null,
        cefr: card.cefr ?? null,
        cefrConfidence: card.cefrConfidence ?? null,
        coreMeaning: card.coreMeaning ?? null,
        wad: card.wad ?? null,
        wap: card.wap ?? null,
        etymology: card.etymology ?? null,
        collocations: JSON.stringify(card.collocations ?? []),
        examples: JSON.stringify(card.examples ?? []),
        contextLadder: JSON.stringify(card.contextLadder ?? []),
        phrases: JSON.stringify(card.phrases ?? []),
        synonyms: JSON.stringify(card.synonyms ?? []),
        antonyms: JSON.stringify(card.antonyms ?? []),
        minPair: card.minPair ?? null,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    insertedCards.push(toCard(inserted[0]));
  }

  return c.json({ success: insertedCards, failed });
});

// POST /extract — extract words from text
cardRoutes.post("/extract", async (c) => {
  const body = await c.req.json();
  const parsed = extractWordsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  const words = await extractWords(parsed.data.text);
  return c.json({ words });
});

// POST /:id/deep — generate deep layer for a card (lazy)
cardRoutes.post("/:id/deep", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) {
    return c.json({ error: "Card not found", code: "NOT_FOUND" }, 404);
  }

  // If deep layer already exists, return as-is
  if (row.familyComparison) {
    return c.json(toCard(row));
  }

  const deep = await generateDeepLayer(row.word);

  await db
    .update(cards)
    .set({
      familyComparison: JSON.stringify(deep.familyComparison),
      schemaAnalysis: JSON.stringify(deep.schemaAnalysis),
      boundaryTests: JSON.stringify(deep.boundaryTests),
      updatedAt: Date.now(),
    })
    .where(eq(cards.id, id));

  // Re-read the updated row
  const updated = await db.select().from(cards).where(eq(cards.id, id)).get();
  return c.json(toCard(updated!));
});

// GET / — list cards with optional search, CEFR filter, pagination
cardRoutes.get("/", async (c) => {
  const search = c.req.query("search");
  const cefr = c.req.query("cefr");
  const page = Math.max(1, Number(c.req.query("page") || "1"));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || "20")));
  const offset = (page - 1) * limit;

  // Build WHERE conditions
  const conditions = [];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(like(cards.word, pattern), like(cards.coreMeaning, pattern))!,
    );
  }
  if (cefr) {
    conditions.push(eq(cards.cefr, cefr));
  }

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : sql`${conditions[0]} AND ${conditions[1]}`;

  // Count total
  const countResult = where
    ? await db.select({ total: count() }).from(cards).where(where).get()
    : await db.select({ total: count() }).from(cards).get();
  const total = countResult?.total ?? 0;

  // Fetch page
  const query = db
    .select()
    .from(cards)
    .orderBy(desc(cards.createdAt))
    .limit(limit)
    .offset(offset);

  const rows = where ? await query.where(where).all() : await query.all();

  return c.json({
    cards: rows.map(toCard),
    total,
  });
});

// GET /:id — single card
cardRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) {
    return c.json({ error: "Card not found", code: "NOT_FOUND" }, 404);
  }
  return c.json(toCard(row));
});

// PATCH /:id/usage — increment usage count
cardRoutes.patch("/:id/usage", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) {
    return c.json({ error: "Card not found", code: "NOT_FOUND" }, 404);
  }

  await db
    .update(cards)
    .set({
      usageCount: row.usageCount + 1,
      updatedAt: Date.now(),
    })
    .where(eq(cards.id, id));

  const updated = await db.select().from(cards).where(eq(cards.id, id)).get();
  return c.json(toCard(updated!));
});

// DELETE /:id — delete a card
cardRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) {
    return c.json({ error: "Card not found", code: "NOT_FOUND" }, 404);
  }

  await db.delete(cards).where(eq(cards.id, id));
  return c.json({ ok: true });
});
