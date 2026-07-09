import { Hono } from "hono";
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { db } from "../db/index.js";
import { practices, chunks } from "../db/schema.js";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { compressImage } from "../services/image.js";
import {
  generatePracticeImage,
  generatePracticeBrief,
  gradePracticeDescription,
} from "../services/ai-router.js";
import { AI_BUSY } from "../services/ai-shared.js";
import { PRACTICE_STYLE_SUFFIX } from "../services/ai-prompts.js";
import type { Practice, StorySceneFrame } from "../../shared/types.js";
import { rateLimit, dailyLimit } from "../middleware/rateLimit.js";
import {
  createJob,
  isJobCancelled,
  setJobCancelled,
  setJobDone,
  setJobFailed,
  setJobRunning,
} from "../services/jobs.js";
import {
  generatePracticeRequestSchema,
  gradePracticeRequestSchema,
} from "../../shared/validation.js";

const IMAGE_DIR = join(process.cwd(), "data", "images");
await mkdir(IMAGE_DIR, { recursive: true });

export const practiceRoutes = new Hono();

type SuggestedChunk = { form: string; example: string };

/** Parse stored JSON columns into the API shape. */
function toPractice(row: typeof practices.$inferSelect): Practice {
  let sceneFrame: StorySceneFrame | null = null;
  if (row.sceneFrame) {
    try {
      sceneFrame = JSON.parse(row.sceneFrame) as StorySceneFrame;
    } catch {
      /* malformed — leave null */
    }
  }
  return {
    id: row.id,
    imagePath: row.imagePath,
    topic: row.topic ?? "",
    style: row.style ?? "documentary",
    visualPrompt: row.visualPrompt,
    sceneFrame,
    suggestedChunks: parseSuggestedChunks(row.suggestedChunks),
    starterLine: row.starterLine,
    taskBrief: row.taskBrief,
    createdAt: row.createdAt,
  };
}

function parseSuggestedChunks(raw: string | null): SuggestedChunk[] {
  if (!raw) return [];
  try {
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    return p
      .filter((c): c is SuggestedChunk => !!c && typeof c.form === "string")
      .map((c) => ({ form: c.form, example: typeof c.example === "string" ? c.example : "" }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Chunk scaffolds — pull candidates from Chunk Forge to lower the "how to start"
// barrier. Generic openers (sentence-stem / discourse-marker) fit any picture;
// content chunks are offered to the AI to use only if they fit the scene.
// ---------------------------------------------------------------------------

const OPENER_CATEGORIES = ["sentence-stem", "discourse-marker"];
const CONTENT_CATEGORIES = ["verb-collocation", "noun-prep", "prep-intuition"];

async function fetchChunkCandidates(): Promise<
  Array<{ form: string; category: string; coreMeaning: string | null }>
> {
  const pick = (cats: string[], limit: number) =>
    db
      .select({
        form: chunks.form,
        category: chunks.category,
        coreMeaning: chunks.coreMeaning,
        usageCount: chunks.usageCount,
      })
      .from(chunks)
      .where(inArray(chunks.category, cats))
      .orderBy(desc(chunks.usageCount), desc(chunks.createdAt))
      .limit(limit)
      .all();
  const [openers, content] = await Promise.all([
    pick(OPENER_CATEGORIES, 8),
    pick(CONTENT_CATEGORIES, 10),
  ]);
  return [...openers, ...content].map((c) => ({
    form: c.form,
    category: c.category,
    coreMeaning: c.coreMeaning ?? null,
  }));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type PracticeJobInput = { topic: string; style: string };

async function createPracticeRecord(input: PracticeJobInput): Promise<Practice> {
  const chunkCandidates = await fetchChunkCandidates();

  // 1) text call: expand topic into a vivid scene + scaffolds (chunks, starter line)
  const brief = await generatePracticeBrief({
    topic: input.topic,
    chunkCandidates,
    currentDate: today(),
  });

  // 2) image call: draw the scene with the chosen art-style suffix (slow)
  const styleSuffix = PRACTICE_STYLE_SUFFIX[input.style] ?? PRACTICE_STYLE_SUFFIX.documentary;
  const rawImage = await generatePracticeImage(`${brief.visualPrompt} ${styleSuffix}`);
  const compressed = await compressImage(rawImage, "image/png");

  const filename = `${randomUUID()}.jpg`;
  const imagePath = `data/images/${filename}`;
  await writeFile(join(IMAGE_DIR, filename), compressed.buffer);

  const now = Date.now();
  const inserted = await db
    .insert(practices)
    .values({
      imagePath,
      topic: input.topic,
      style: input.style,
      visualPrompt: brief.visualPrompt,
      sceneFrame: JSON.stringify(brief.sceneFrame),
      suggestedChunks: JSON.stringify(brief.suggestedChunks),
      starterLine: brief.starterLine,
      taskBrief: brief.taskBrief,
      createdAt: now,
    })
    .returning();

  return toPractice(inserted[0]);
}

async function runPracticeJob(jobId: string, input: PracticeJobInput) {
  await setJobRunning(jobId);
  try {
    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }

    const practice = await createPracticeRecord(input);

    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }

    await setJobDone(jobId, practice as unknown as Record<string, unknown>);
  } catch (err) {
    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }
    const msg = err instanceof Error ? err.message : "Practice generation failed";
    await setJobFailed(jobId, msg);
  }
}

// POST /generate — create a picture-description question (image gen is slow → async)
practiceRoutes.post("/generate", async (c) => {
  const limited = rateLimit(c, { key: "practice-generate", windowMs: 60_000, max: 6 });
  if (limited) return limited;

  // Image generation is the expensive op — gate it on the daily image limit.
  const dailyLimited = await dailyLimit(c, {
    key: "daily-image",
    settingKey: "daily_image_limit",
    defaultMax: 5,
  });
  if (dailyLimited) return dailyLimited;

  const raw = await c.req.json().catch(() => ({}));
  const parsed = generatePracticeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "INVALID_REQUEST" }, 400);
  }
  const { topic, style } = parsed.data;

  const useAsync = c.req.query("async") === "1";
  if (useAsync) {
    const jobId = await createJob("practice", { topic, style });
    void runPracticeJob(jobId, { topic, style });
    return c.json({ jobId, status: "queued" }, 202);
  }

  try {
    const practice = await createPracticeRecord({ topic, style });
    return c.json(practice);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Practice generation failed";
    if (msg === AI_BUSY) {
      return c.json({ error: "Generator busy", code: "AI_BUSY" }, 429);
    }
    return c.json({ error: "Practice generation failed", code: "PRACTICE_FAILED" }, 500);
  }
});

// POST /:id/grade — grade the learner's description (synchronous, NOT persisted)
practiceRoutes.post("/:id/grade", async (c) => {
  const limited = rateLimit(c, { key: "practice-grade", windowMs: 60_000, max: 20 });
  if (limited) return limited;

  const id = Number(c.req.param("id"));
  const row = await db.select().from(practices).where(eq(practices.id, id)).get();
  if (!row) {
    return c.json({ error: "Practice not found", code: "NOT_FOUND" }, 404);
  }

  const raw = await c.req.json().catch(() => ({}));
  const parsed = gradePracticeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "INVALID_REQUEST" }, 400);
  }

  try {
    const feedback = await gradePracticeDescription({
      visualPrompt: row.visualPrompt,
      suggestedChunks: parseSuggestedChunks(row.suggestedChunks).map((ch) => ch.form),
      description: parsed.data.description,
    });
    return c.json(feedback);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Grading failed";
    if (msg === AI_BUSY) {
      return c.json({ error: "Grader busy", code: "AI_BUSY" }, 429);
    }
    return c.json({ error: "Grading failed", code: "GRADE_FAILED" }, 500);
  }
});

// GET / — list practices, newest first
practiceRoutes.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || "1"));
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") || "10")));
  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(practices)
    .orderBy(desc(practices.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  const countRow = await db
    .select({ total: sql<number>`count(*)` })
    .from(practices)
    .get();
  const total = Number(countRow?.total ?? 0);
  return c.json({ practices: rows.map(toPractice), total, page, limit });
});

// GET /:id/image — serve the generated image file
practiceRoutes.get("/:id/image", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(practices).where(eq(practices.id, id)).get();
  if (!row) {
    return c.json({ error: "Practice not found", code: "NOT_FOUND" }, 404);
  }

  try {
    const buf = await readFile(join(process.cwd(), row.imagePath));
    return new Response(buf, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return c.json({ error: "Image file not found", code: "IMAGE_MISSING" }, 404);
  }
});

// DELETE /:id — delete a practice and its image
practiceRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(practices).where(eq(practices.id, id)).get();
  if (!row) {
    return c.json({ error: "Practice not found", code: "NOT_FOUND" }, 404);
  }

  await db.delete(practices).where(eq(practices.id, id));

  // Best-effort image cleanup
  try {
    await unlink(join(process.cwd(), row.imagePath));
  } catch {
    /* image may already be gone */
  }

  return c.json({ ok: true });
});
