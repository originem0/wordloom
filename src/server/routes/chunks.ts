import { Hono } from "hono";
import { db } from "../db/index.js";
import { chunks } from "../db/schema.js";
import { and, count, desc, eq, like, or, sql } from "drizzle-orm";
import { generateChunk } from "../services/ai-router.js";
import { AI_BUSY } from "../services/ai-shared.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  generateChunkRequestSchema,
  updateChunkSchema,
} from "../../shared/validation.js";
import type { Chunk, ChunkGenerateResult, ChunkPayload } from "../../shared/types.js";
import {
  createJob,
  isJobCancelled,
  setJobCancelled,
  setJobDone,
  setJobFailed,
  setJobRunning,
} from "../services/jobs.js";

export const chunkRoutes = new Hono();

// ---------------------------------------------------------------------------
// JSON field handling
// ---------------------------------------------------------------------------

const JSON_FIELDS = ["slots", "examples", "contrast", "theoreticalAnchors"] as const;

/** Parse a chunks DB row into the API shape (JSON-decode text fields). */
export function toChunk(row: typeof chunks.$inferSelect): Chunk {
  const out: Record<string, unknown> = { ...row };

  for (const field of JSON_FIELDS) {
    const raw = out[field];
    if (typeof raw === "string") {
      try {
        out[field] = JSON.parse(raw);
      } catch {
        // Nullable fields default to null; required arrays default to [].
        out[field] = field === "examples" || field === "slots" ? [] : null;
      }
    } else if (raw == null) {
      out[field] = field === "examples" || field === "slots" ? [] : null;
    }
  }

  return out as unknown as Chunk;
}

// ---------------------------------------------------------------------------
// Persistence: upsert keyed on (form, category)
// ---------------------------------------------------------------------------

async function upsertChunk(
  payload: ChunkPayload,
): Promise<{ chunk: Chunk; wasExisting: boolean }> {
  const now = Date.now();
  const values = {
    form: payload.form,
    category: payload.category,
    coreMeaning: payload.coreMeaning,
    coreMeaningZh: payload.coreMeaningZh ?? null,
    coreMechanic: payload.coreMechanic ?? null,
    register: payload.register,
    frequency: payload.frequency,
    slots: JSON.stringify(payload.slots ?? []),
    examples: JSON.stringify(payload.examples ?? []),
    pitfall: payload.pitfall ?? null,
    contrast: payload.contrast ? JSON.stringify(payload.contrast) : null,
    theoreticalAnchors: payload.theoreticalAnchors
      ? JSON.stringify(payload.theoreticalAnchors)
      : null,
    createdAt: now,
    updatedAt: now,
  };

  const inserted = await db
    .insert(chunks)
    .values(values)
    .onConflictDoUpdate({
      target: [chunks.form, chunks.category],
      set: {
        coreMeaning: values.coreMeaning,
        coreMeaningZh: values.coreMeaningZh,
        coreMechanic: values.coreMechanic,
        register: values.register,
        frequency: values.frequency,
        slots: values.slots,
        examples: values.examples,
        pitfall: values.pitfall,
        contrast: values.contrast,
        theoreticalAnchors: values.theoreticalAnchors,
        updatedAt: now,
      },
    })
    .returning();

  const row = inserted[0];
  // We never touch createdAt in the SET clause, so on update RETURNING gives
  // back the original (older) createdAt; on insert it equals `now`.
  const wasExisting = row.createdAt < now;
  return { chunk: toChunk(row), wasExisting };
}

// ---------------------------------------------------------------------------
// Generation flow
// ---------------------------------------------------------------------------

async function generateChunkPayload(input: string): Promise<ChunkGenerateResult> {
  const result = await generateChunk(input);

  // not_chunk → no persistence
  if (result.verdict === "not_chunk" || !result.payload) {
    return result;
  }

  // chunk / borderline → persist (upsert by form+category)
  const { chunk, wasExisting } = await upsertChunk(result.payload);
  return { ...result, chunk, wasExisting };
}

async function runChunksJob(jobId: string, input: string) {
  await setJobRunning(jobId);
  try {
    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }

    const result = await generateChunkPayload(input);

    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }

    await setJobDone(jobId, result as unknown as Record<string, unknown>);
  } catch (err) {
    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }
    const msg = err instanceof Error ? err.message : "Chunk generation failed";
    await setJobFailed(jobId, msg);
  }
}

// ---------------------------------------------------------------------------
// POST /generate — analyze + (maybe) persist a candidate chunk
// ---------------------------------------------------------------------------

chunkRoutes.post("/generate", async (c) => {
  const limited = rateLimit(c, {
    key: "chunks-generate",
    windowMs: 60_000,
    max: 20,
  });
  if (limited) return limited;

  const body = await c.req.json();
  const parsed = generateChunkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  const input = parsed.data.input.trim();
  if (!input) {
    return c.json({ error: "Empty input", code: "VALIDATION_ERROR" }, 400);
  }

  const useAsync = c.req.query("async") === "1";
  if (useAsync) {
    const jobId = await createJob("chunks", { input });
    void runChunksJob(jobId, input);
    return c.json({ jobId, status: "queued" }, 202);
  }

  try {
    const result = await generateChunkPayload(input);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    if (msg === AI_BUSY) {
      return c.json({ error: "Generator busy", code: "AI_BUSY" }, 429);
    }
    console.error("[chunks/generate] error:", msg);
    return c.json({ error: msg, code: "GENERATION_FAILED" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET / — list with search, category/frequency filter, pagination
//
// Search routing mirrors cards.ts:
//   - CJK input        → substring on coreMeaning + coreMeaningZh
//   - Pure ASCII       → substring on form, ranked: exact > prefix > substring
//   - Mixed / phrase   → substring on all three
// Relevance order (when searching): exact > prefix > substring on form,
// then usageCount desc, then createdAt desc.
// ---------------------------------------------------------------------------

chunkRoutes.get("/", async (c) => {
  const search = c.req.query("search")?.trim() || undefined;
  const category = c.req.query("category");
  const frequency = c.req.query("frequency");
  const page = Math.max(1, Number(c.req.query("page") || "1"));
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") || "20")));
  const offset = (page - 1) * limit;

  const lowerSearch = search?.toLowerCase() ?? "";
  const substrPattern = `%${lowerSearch}%`;
  const prefixPattern = `${lowerSearch}%`;

  const conditions = [];
  if (search) {
    const hasCJK = /[\u4e00-\u9fff]/.test(search);
    const isAsciiWord = /^[a-zA-Z0-9'-]+$/.test(search);
    const rawPattern = `%${search}%`;

    if (hasCJK) {
      conditions.push(
        or(
          like(chunks.coreMeaning, rawPattern),
          like(chunks.coreMeaningZh, rawPattern),
        )!,
      );
    } else if (isAsciiWord) {
      // Substring; ORDER BY below pushes prefix matches above pure substring.
      conditions.push(sql`lower(${chunks.form}) LIKE ${substrPattern}`);
    } else {
      conditions.push(
        or(
          sql`lower(${chunks.form}) LIKE ${substrPattern}`,
          like(chunks.coreMeaning, rawPattern),
          like(chunks.coreMeaningZh, rawPattern),
        )!,
      );
    }
  }
  if (category) {
    conditions.push(eq(chunks.category, category));
  }
  if (frequency) {
    conditions.push(eq(chunks.frequency, frequency));
  }

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  const countResult = where
    ? await db.select({ total: count() }).from(chunks).where(where).get()
    : await db.select({ total: count() }).from(chunks).get();
  const total = Number(countResult?.total ?? 0);

  const orderBy = search
    ? sql`
        CASE
          WHEN lower(${chunks.form}) = ${lowerSearch} THEN 0
          WHEN lower(${chunks.form}) LIKE ${prefixPattern} THEN 1
          WHEN lower(${chunks.form}) LIKE ${substrPattern} THEN 2
          ELSE 3
        END,
        ${chunks.usageCount} DESC,
        ${chunks.createdAt} DESC
      `
    : desc(chunks.createdAt);

  const query = db
    .select()
    .from(chunks)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const rows = where ? await query.where(where).all() : await query.all();

  return c.json({
    chunks: rows.map(toChunk),
    total,
    page,
    limit,
  });
});

// ---------------------------------------------------------------------------
// GET /:id — single chunk
// ---------------------------------------------------------------------------

chunkRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(chunks).where(eq(chunks.id, id)).get();
  if (!row) {
    return c.json({ error: "Chunk not found", code: "NOT_FOUND" }, 404);
  }
  return c.json(toChunk(row));
});

// ---------------------------------------------------------------------------
// PATCH /:id — inline edit (user can correct any AI-generated field)
// ---------------------------------------------------------------------------

chunkRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const parsed = updateChunkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid update", code: "VALIDATION_ERROR" }, 400);
  }

  const row = await db.select().from(chunks).where(eq(chunks.id, id)).get();
  if (!row) {
    return c.json({ error: "Chunk not found", code: "NOT_FOUND" }, 404);
  }

  const data = parsed.data;
  const update: Record<string, unknown> = { updatedAt: Date.now() };

  if (data.form !== undefined) update.form = data.form;
  if (data.category !== undefined) update.category = data.category;
  if (data.coreMeaning !== undefined) update.coreMeaning = data.coreMeaning;
  if (data.coreMeaningZh !== undefined) update.coreMeaningZh = data.coreMeaningZh;
  if (data.coreMechanic !== undefined) update.coreMechanic = data.coreMechanic;
  if (data.register !== undefined) update.register = data.register;
  if (data.frequency !== undefined) update.frequency = data.frequency;
  if (data.slots !== undefined) update.slots = JSON.stringify(data.slots);
  if (data.examples !== undefined) update.examples = JSON.stringify(data.examples);
  if (data.pitfall !== undefined) update.pitfall = data.pitfall;
  if (data.contrast !== undefined) {
    update.contrast = data.contrast ? JSON.stringify(data.contrast) : null;
  }
  if (data.theoreticalAnchors !== undefined) {
    update.theoreticalAnchors = data.theoreticalAnchors
      ? JSON.stringify(data.theoreticalAnchors)
      : null;
  }

  try {
    await db.update(chunks).set(update).where(eq(chunks.id, id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    if (/UNIQUE constraint/i.test(msg)) {
      return c.json(
        { error: "Another chunk with the same form+category exists", code: "DUPLICATE" },
        409,
      );
    }
    throw err;
  }

  const updated = await db.select().from(chunks).where(eq(chunks.id, id)).get();
  return c.json(toChunk(updated!));
});

// ---------------------------------------------------------------------------
// PATCH /:id/usage — increment usageCount
// ---------------------------------------------------------------------------

chunkRoutes.patch("/:id/usage", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(chunks).where(eq(chunks.id, id)).get();
  if (!row) {
    return c.json({ error: "Chunk not found", code: "NOT_FOUND" }, 404);
  }

  await db
    .update(chunks)
    .set({
      usageCount: row.usageCount + 1,
      updatedAt: Date.now(),
    })
    .where(eq(chunks.id, id));

  const updated = await db.select().from(chunks).where(eq(chunks.id, id)).get();
  return c.json(toChunk(updated!));
});

// ---------------------------------------------------------------------------
// DELETE /:id — hard delete
// ---------------------------------------------------------------------------

chunkRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(chunks).where(eq(chunks.id, id)).get();
  if (!row) {
    return c.json({ error: "Chunk not found", code: "NOT_FOUND" }, 404);
  }
  await db.delete(chunks).where(eq(chunks.id, id));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /categories/list — convenience: enum reference for filters
// ---------------------------------------------------------------------------

chunkRoutes.get("/categories/list", (c) =>
  c.json({
    categories: [
      "prep-intuition",
      "sentence-stem",
      "verb-collocation",
      "noun-prep",
      "discourse-marker",
    ],
    frequencies: ["high", "mid", "low"],
    registers: ["neutral", "formal", "spoken", "academic", "literary"],
  }),
);
