import { Hono } from "hono";
import { db } from "../db/index.js";
import { cards, jobs } from "../db/schema.js";
import { and, eq, asc, or, sql, count, inArray } from "drizzle-orm";
import {
  generateCards,
  generateDeepLayer,
  extractWords,
} from "../services/ai-router.js";
import { AI_BUSY } from "../services/ai-shared.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  generateCardsRequestSchema,
  extractWordsRequestSchema,
} from "../../shared/validation.js";
import type { Card, CardGenerateResult } from "../../shared/types.js";

import { setTimeout as delay } from "node:timers/promises";
import { hasDeepData } from "../../shared/card-deep.js";
import { pageNumber } from "../../shared/validation.js";
import { createJob, claimJob, runJob, setJobDone } from "../services/jobs.js";

type CardGeneratePayload = CardGenerateResult & { message?: string };

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

// Typed as Set<string> so .has() accepts any JSON_FIELDS member, not just the
// three literals listed here.
const DEEP_JSON_FIELDS = new Set<string>([
  "familyComparison",
  "schemaAnalysis",
  "boundaryTests",
]);

/** Parse a card DB row into the API shape (JSON-decode text fields). */
export function toCard(row: typeof cards.$inferSelect): Card {
  const card: Record<string, unknown> = { ...row };
  delete card.wordKey;

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
  const rows = await db
    .select()
    .from(cards)
    .where(inArray(cards.wordKey, lowered))
    .orderBy(asc(cards.id))
    .all();

  const existingMap = new Map<string, typeof cards.$inferSelect>();
  for (const row of rows) if (!existingMap.has(row.wordKey!)) existingMap.set(row.wordKey!, row);
  const existing: Card[] = [];
  const toGenerate: string[] = [];

  for (const word of normalized) {
    const match = existingMap.get(word.toLowerCase());
    if (match) existing.push(toCard(match));
    else toGenerate.push(word);
  }

  return { existing, toGenerate };
}

async function generateCardsPayload(normalized: string[], jobId?: string, signal?: AbortSignal): Promise<CardGeneratePayload> {
  const { existing, toGenerate } = await splitExistingCards(normalized);

  if (toGenerate.length === 0) {
    return { success: existing, failed: [], existing, message: "All words already exist" };
  }

  const generated = signal ? await generateCards(toGenerate, signal) : await generateCards(toGenerate);
  const failed: CardGenerateResult["failed"] = [];
  const now = Date.now();

  return db.transaction(async (tx) => {
    if (jobId) {
      const job = await tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get();
      if (job?.status !== "running") throw new Error("Job cancelled");
    }
    const rows: Card[] = [];
    for (const word of toGenerate) {
      const key = word.toLowerCase();
      const matches = generated.success.filter((c) => c.word.trim().toLowerCase() === key);
      if (matches.length !== 1) {
        failed.push({ word, error: matches.length ? "Duplicate model result" : generated.failed.find((e) => e.word.toLowerCase() === key)?.error ?? "Not returned by AI" });
        continue;
      }
      const card = matches[0];
      const concurrent = await tx.select().from(cards).where(eq(cards.wordKey, key)).orderBy(asc(cards.id)).get();
      if (concurrent) { existing.push(toCard(concurrent)); continue; }
      const inserted = await tx
        .insert(cards)
        .values({
          word, wordKey: key,
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
      rows.push(toCard(inserted[0]));
    }
    const result = { success: [...existing, ...rows], failed, existing };
    if (jobId) await setJobDone(jobId, jobSummary(result), tx);
    return result;
  });
}

function jobSummary(result: CardGenerateResult) {
  return { success: result.success.map((c) => c.id), existing: result.existing?.map((c) => c.id) ?? [], failed: result.failed };
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
    void runJob(jobId, async (signal) => jobSummary(await generateCardsPayload(normalized, jobId, signal)));
    return c.json({ jobId, status: "queued" }, 202);
  }

  try {
    const result = await generateCardsPayload(normalized);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    if (msg === AI_BUSY) {
      return c.json({ error: "Generator busy", code: "AI_BUSY" }, 429);
    }
    console.error("[cards/generate] error:", msg);
    return c.json({ error: msg, code: "GENERATION_FAILED" }, 500);
  }
});

// POST /extract — extract words from text
cardRoutes.post("/extract", async (c) => {
  const limited = rateLimit(c, { key: "cards-extract", windowMs: 60_000, max: 20 });
  if (limited) return limited;

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
    if (msg === AI_BUSY) {
      return c.json({ error: "Generator busy", code: "AI_BUSY" }, 429);
    }
    return c.json({ error: "Extraction failed", code: "EXTRACTION_FAILED" }, 500);
  }
});

async function generateDeep(id: number, jobId: string, signal: AbortSignal) {
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) throw new Error("Card not found");
  if (hasDeepData(toCard(row))) return;
  const deep = await generateDeepLayer(row.word, signal);
  if (!hasDeepData(deep)) throw new Error("Model returned an empty deep analysis");
  // The family's notes ride in the schemaAnalysis blob (no new DB column)
  const schemaBlob = {
    ...(typeof deep.schemaAnalysis === "object" && deep.schemaAnalysis
      ? deep.schemaAnalysis
      : {}),
    ...(deep.familyBoundaryNote
      ? { familyBoundaryNote: deep.familyBoundaryNote }
      : {}),
    ...(deep.familyAxes ? { familyAxes: deep.familyAxes } : {}),
    ...(deep.familyChoiceRule ? { familyChoiceRule: deep.familyChoiceRule } : {}),
  };

  await db.transaction(async (tx) => {
    const job = await tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get();
    if (job?.status !== "running") throw new Error("Job cancelled");
    const updated = await tx.update(cards).set({
      familyComparison: JSON.stringify(deep.familyComparison),
      schemaAnalysis: JSON.stringify(schemaBlob),
      boundaryTests: JSON.stringify(deep.boundaryTests),
      updatedAt: Date.now(),
    }).where(eq(cards.id, id)).returning({ id: cards.id }).get();
    if (!updated) throw new Error("Card removed");
    await setJobDone(jobId, { cardId: id }, tx);
  });
}

async function deepJob(id: number, batchId?: string) {
  const job = await claimJob("deep", "deep:" + id, { id }, batchId);
  if (job.created) void runJob(job.id, async (signal) => { await generateDeep(id, job.id, signal); return { cardId: id }; });
  return job.id;
}

async function waitJob(id: string, signal?: AbortSignal) {
  for (;;) {
    signal?.throwIfAborted();
    const job = await db.select({ status: jobs.status, error: jobs.error }).from(jobs).where(eq(jobs.id, id)).get();
    if (job?.status === "done") return;
    if (!job || job.status === "failed" || job.status === "cancelled") throw new Error(job?.error ?? "Job stopped");
    await delay(100, undefined, { signal });
  }
}

cardRoutes.post("/:id/deep", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(cards).where(eq(cards.id, id)).get();
  if (!row) return c.json({ error: "Card not found", code: "NOT_FOUND" }, 404);
  if (hasDeepData(toCard(row))) return c.json(toCard(row));
  const jobId = await deepJob(id);
  if (c.req.query("async") === "1") return c.json({ jobId }, 202);
  try { await waitJob(jobId); } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    return c.json({ error: msg, code: msg === AI_BUSY ? "AI_BUSY" : "GENERATION_FAILED" }, msg === AI_BUSY ? 429 : 502);
  }
  const updated = await db.select().from(cards).where(eq(cards.id, id)).get();
  return updated ? c.json(toCard(updated)) : c.json({ error: "Card removed", code: "NOT_FOUND" }, 404);
});

// The worker owns the batch. Closing the browser only stops observing it.
cardRoutes.post("/deep-batch", async (c) => {
  const batch = await claimJob("deep-batch", "deep-batch", {});
  if (batch.created) void runJob(batch.id, async (signal) => {
    const list = await missingDeep();
    const progress = { total: list.length, done: 0, fail: 0 };
    for (const { id } of list) {
      signal.throwIfAborted();
      try { await waitJob(await deepJob(id, batch.id), signal); } catch {
        signal.throwIfAborted();
        progress.fail++;
      }
      progress.done++;
      await db.update(jobs).set({ result: JSON.stringify(progress), updatedAt: Date.now() }).where(and(eq(jobs.id, batch.id), eq(jobs.status, "running")));
    }
    return progress;
  });
  return c.json({ jobId: batch.id }, 202);
});

// GET / — list cards with optional search, CEFR filter, pagination
//
// Search routing:
//   - CJK input        → substring match on coreMeaning (释义)
//   - Pure ASCII word  → substring on word, ranked: exact > prefix > substring
//   - Mixed / phrase   → substring on both
// Relevance order (when searching): exact > prefix > substring > meaning-only,
// then usageCount desc, then createdAt desc.
cardRoutes.get("/", async (c) => {
  const search = c.req.query("search")?.trim() || undefined;
  const cefr = c.req.query("cefr");
  const page = pageNumber(c.req.query("page"), 1, 100_000_000);
  const limit = pageNumber(c.req.query("limit"), 20, 100);
  if (!page || !limit || (search?.length ?? 0) > 200) return c.json({ error: "Invalid pagination or search", code: "VALIDATION_ERROR" }, 400);
  const offset = (page - 1) * limit;

  const lowerSearch = search?.toLowerCase() ?? "";
  const escaped = lowerSearch.replace(/[!%_]/g, (ch) => "!" + ch);
  const substrPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;

  // Build WHERE conditions
  const conditions = [];
  if (search) {
    const hasCJK = /[\u4e00-\u9fff]/.test(search);
    const isAsciiWord = /^[a-zA-Z0-9'-]+$/.test(search);

    if (hasCJK) {
      conditions.push(sql`${cards.coreMeaning} LIKE ${substrPattern} ESCAPE '!'`);
    } else if (isAsciiWord) {
      // Substring on word — the ORDER BY below ranks exact > prefix > substring
      // so "set" surfaces `set, setup, setting` before `asset, closet, sunset`.
      conditions.push(sql`${cards.wordKey} LIKE ${substrPattern} ESCAPE '!'`);
    } else {
      conditions.push(
        or(
          sql`${cards.wordKey} LIKE ${substrPattern} ESCAPE '!'`,
          sql`${cards.coreMeaning} LIKE ${substrPattern} ESCAPE '!'`,
        )!,
      );
    }
  }
  if (cefr) {
    conditions.push(eq(cards.cefr, cefr));
  }

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  // Count total
  const countResult = where
    ? await db.select({ total: count() }).from(cards).where(where).get()
    : await db.select({ total: count() }).from(cards).get();
  const total = Number(countResult?.total ?? 0);

  // Relevance order when searching; recency otherwise.
  const orderBy = search
    ? sql`
        CASE
          WHEN ${cards.wordKey} = ${lowerSearch} THEN 0
          WHEN ${cards.wordKey} LIKE ${prefixPattern} ESCAPE '!' THEN 1
          WHEN ${cards.wordKey} LIKE ${substrPattern} ESCAPE '!' THEN 2
          ELSE 3
        END,
        ${cards.usageCount} DESC,
        ${cards.createdAt} DESC, ${cards.id} DESC
      `
    : sql`${cards.createdAt} DESC, ${cards.id} DESC`;

  // Fetch page
  const query = db
    .select({ id: cards.id, word: cards.word, cefr: cards.cefr, coreMeaning: cards.coreMeaning })
    .from(cards)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const rows = where ? await query.where(where).all() : await query.all();

  return c.json({
    cards: rows,
    total,
    page,
    limit,
  });
});

// GET /missing-deep — list card IDs that don't have deep layer yet.
// Drives the admin's "Retry Deep". Registered before /:id, and not on the
// guard's public list (which admits numeric ids only).
async function missingDeep() {
  // Keep the prefilter conservative. Malformed and historical empty shells
  // must reach the same content check used when the card is opened.
  const rows = await db.select({ id: cards.id, word: cards.word, familyComparison: cards.familyComparison, schemaAnalysis: cards.schemaAnalysis, boundaryTests: cards.boundaryTests })
    .from(cards).where(sql`CASE WHEN json_valid(${cards.familyComparison}) THEN NOT coalesce(
      json_type(${cards.familyComparison}, '$[0].word') = 'text' AND
      json_extract(${cards.familyComparison}, '$[0].word') GLOB '*[a-zA-Z]*' AND
      json_type(${cards.familyComparison}, '$[0].distinction') = 'text' AND
      json_extract(${cards.familyComparison}, '$[0].distinction') GLOB '*[a-zA-Z一-龥]*', 0) ELSE 1 END`);
  const decode = (value: string | null): unknown => { try { return JSON.parse(value ?? "null"); } catch { return null; } };
  return rows.filter((r) => !hasDeepData({ familyComparison: decode(r.familyComparison), schemaAnalysis: decode(r.schemaAnalysis), boundaryTests: decode(r.boundaryTests) }))
    .map(({ id, word }) => ({ id, word }));
}
cardRoutes.get("/missing-deep", async (c) => {
  const [list, batch] = await Promise.all([missingDeep(), db.select({ result: jobs.result, status: jobs.status, id: jobs.id }).from(jobs).where(eq(jobs.type, "deep-batch")).orderBy(sql`${jobs.createdAt} DESC`).limit(1).get()]);
  return c.json({ cards: list, total: list.length, batch: batch ? { ...batch, progress: batch.result && JSON.parse(batch.result), result: undefined } : null });
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
