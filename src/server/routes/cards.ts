import { Hono } from "hono";
import { db } from "../db/index.js";
import { cards } from "../db/schema.js";
import { eq, desc, like, or, sql, count } from "drizzle-orm";
import {
  generateCards,
  generateDeepLayer,
  extractWords,
} from "../services/gemini.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  generateCardsRequestSchema,
  extractWordsRequestSchema,
} from "../../shared/validation.js";
import type { Card, CardGenerateResult } from "../../shared/types.js";
import {
  createJob,
  isJobCancelled,
  setJobCancelled,
  setJobDone,
  setJobFailed,
  setJobRunning,
} from "../services/jobs.js";

export const cardRoutes = new Hono();

// JSON text fields that need parsing when reading from DB
const JSON_FIELDS = [
  "collocations",
  "examples",
  "contextLadder",
  "phrases",
  "synonyms",
  "antonyms",
  // Deep layer (nullable; lazy-loaded)
  "familyComparison",
  "schemaAnalysis",
  "boundaryTests",
] as const;

const DEEP_JSON_FIELDS = new Set([
  "familyComparison",
  "schemaAnalysis",
  "boundaryTests",
] as const);

/** Parse a card DB row into the API shape (JSON-decode text fields). */
export function toCard(row: typeof cards.$inferSelect): Card {
  const card: Record<string, unknown> = { ...row };

  for (const field of JSON_FIELDS) {
    const raw = card[field];
    const isDeep = DEEP_JSON_FIELDS.has(field);

    if (typeof raw === "string") {
      try {
        card[field] = JSON.parse(raw);
      } catch {
        // If parsing fails, treat deep layer as absent (null), and shallow arrays as empty.
        card[field] = isDeep ? null : [];
      }
    } else {
      // For deep layer fields, absence should stay null so the client can trigger generation.
      // For other JSON arrays, default to [] for convenience.
      card[field] = isDeep ? (raw ?? null) : (raw ?? []);
    }
  }

  return card as unknown as Card;
}

function normalizeWords(words: string[]): string[] {
  return words
    .map((w) => w.trim())
    .filter(Boolean)
    .filter((w, i, arr) => arr.findIndex((x) => x.toLowerCase() === w.toLowerCase()) === i);
}

async function splitExistingCards(normalized: string[]): Promise<{ existing: Card[]; toGenerate: string[] }> {
  if (normalized.length === 0) return { existing: [], toGenerate: [] };

  const lowered = normalized.map((w) => w.toLowerCase());
  const quoted = lowered.map((w) => sql`${w}`);
  const rows = await db
    .select()
    .from(cards)
    .where(sql`lower(${cards.word}) in (${sql.join(quoted, sql`,`)})`)
    .all();

  const existingMap = new Map(rows.map((row) => [row.word.toLowerCase(), row]));
  const existing: Card[] = [];
  const toGenerate: string[] = [];

  for (const word of normalized) {
    const match = existingMap.get(word.toLowerCase());
    if (match) existing.push(toCard(match));
    else toGenerate.push(word);
  }

  return { existing, toGenerate };
}

async function generateCardsPayload(normalized: string[]): Promise<CardGenerateResult> {
  const { existing, toGenerate } = await splitExistingCards(normalized);

  if (toGenerate.length === 0) {
    return { success: existing, failed: [], existing };
  }

  const generated = await generateCards(toGenerate);
  const now = Date.now();

  const insertedCards = await db.transaction(async (tx) => {
    const rows: Card[] = [];
    for (const card of generated.success) {
      const inserted = await tx
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
        .onConflictDoUpdate({
          target: cards.word,
          set: {
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
            updatedAt: now,
          },
        })
        .returning();
      rows.push(toCard(inserted[0]));
    }
    return rows;
  });

  return { success: [...existing, ...insertedCards], failed: generated.failed, existing };
}

async function runCardsJob(jobId: string, normalized: string[]) {
  await setJobRunning(jobId);
  try {
    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }

    const result = await generateCardsPayload(normalized);

    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }

    await setJobDone(jobId, result);
  } catch (err) {
    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }
    const msg = err instanceof Error ? err.message : "Generation failed";
    await setJobFailed(jobId, msg);
  }
}

// POST /generate — generate cards for a list of words
cardRoutes.post("/generate", async (c) => {
  const limited = rateLimit(c, {
    key: "cards-generate",
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;
  const body = await c.req.json();
  const parsed = generateCardsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  const { words } = parsed.data;
  const normalized = normalizeWords(words);
  if (normalized.length === 0) {
    return c.json({ error: "No valid words", code: "VALIDATION_ERROR" }, 400);
  }

  const useAsync = c.req.query("async") === "1";
  if (useAsync) {
    const jobId = await createJob("cards", { words: normalized });
    void runCardsJob(jobId, normalized);
    return c.json({ jobId, status: "queued" }, 202);
  }

  try {
    const result = await generateCardsPayload(normalized);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    if (msg === "GEMINI_BUSY") {
      return c.json({ error: "Generator busy", code: "GEMINI_BUSY" }, 429);
    }
    return c.json({ error: "Generation failed", code: "GENERATION_FAILED" }, 500);
  }
});

// POST /extract — extract words from text
cardRoutes.post("/extract", async (c) => {
  const body = await c.req.json();
  const parsed = extractWordsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  try {
    const words = await extractWords(parsed.data.text);
    return c.json({ words });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Extraction failed";
    if (msg === "GEMINI_BUSY") {
      return c.json({ error: "Generator busy", code: "GEMINI_BUSY" }, 429);
    }
    return c.json({ error: "Extraction failed", code: "EXTRACTION_FAILED" }, 500);
  }
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

  let deep: Awaited<ReturnType<typeof generateDeepLayer>>;
  try {
    deep = await generateDeepLayer(row.word);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Deep generation failed";
    if (msg === "GEMINI_BUSY") {
      return c.json({ error: "Generator busy", code: "GEMINI_BUSY" }, 429);
    }
    return c.json({ error: "Deep generation failed", code: "GENERATION_FAILED" }, 500);
  }

  // Merge familyBoundaryNote into schemaAnalysis blob (no new DB column)
  const schemaBlob = {
    ...(typeof deep.schemaAnalysis === "object" && deep.schemaAnalysis
      ? deep.schemaAnalysis
      : {}),
    ...(deep.familyBoundaryNote
      ? { familyBoundaryNote: deep.familyBoundaryNote }
      : {}),
  };

  await db
    .update(cards)
    .set({
      familyComparison: JSON.stringify(deep.familyComparison),
      schemaAnalysis: JSON.stringify(schemaBlob),
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
  const total = Number(countResult?.total ?? 0);

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
    page,
    limit,
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
