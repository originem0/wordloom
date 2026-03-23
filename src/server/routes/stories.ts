import { Hono } from "hono";
import type { Context } from "hono";
import { randomUUID, createHash } from "crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { db } from "../db/index.js";
import { stories } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import { compressImage } from "../services/image.js";
import { generateStory, generateTTS, translateText } from "../services/ai-router.js";
import { AI_BUSY } from "../services/ai-shared.js";
import { generateEdgeTtsMp3 } from "../services/edgeTts.js";
import { pcmToWav } from "../services/tts.js";
import type { Story, GroundingSource } from "../../shared/types.js";
import { rateLimit, dailyLimit } from "../middleware/rateLimit.js";
import {
  createJob,
  isJobCancelled,
  setJobCancelled,
  setJobDone,
  setJobFailed,
  setJobRunning,
} from "../services/jobs.js";

const IMAGE_DIR = join(process.cwd(), "data", "images");
const TTS_CACHE_DIR = join(process.cwd(), "data", "tts");

// Ensure image directory exists at module load
await mkdir(IMAGE_DIR, { recursive: true });
await mkdir(TTS_CACHE_DIR, { recursive: true });

export const storyRoutes = new Hono();

/** Parse a story DB row into the API shape (JSON-decode sources). */
function toStory(row: typeof stories.$inferSelect): Story {
  let sources: GroundingSource[] = [];
  if (row.sources) {
    try {
      sources = JSON.parse(row.sources);
    } catch {
      /* ignore malformed JSON */
    }
  }
  return {
    id: row.id,
    imagePath: row.imagePath,
    prompt: row.prompt ?? "",
    story: row.story,
    sources,
    createdAt: row.createdAt,
  };
}

type StoryJobInput = {
  prompt: string;
  mimeType: string;
  imageBuffer: Buffer;
};

async function createStoryRecord(input: StoryJobInput): Promise<Story> {
  const { prompt, mimeType, imageBuffer } = input;

  const result = await compressImage(imageBuffer, mimeType);
  const generated = await generateStory(result.buffer, result.mimeType, prompt);

  const filename = `${randomUUID()}.jpg`;
  const imagePath = `data/images/${filename}`;
  await writeFile(join(IMAGE_DIR, filename), result.buffer);

  const now = Date.now();
  const inserted = await db
    .insert(stories)
    .values({
      imagePath,
      prompt,
      story: generated.story,
      sources: JSON.stringify(generated.sources),
      createdAt: now,
    })
    .returning();

  return toStory(inserted[0]);
}

async function runStoryJob(jobId: string, input: StoryJobInput) {
  await setJobRunning(jobId);
  try {
    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }

    const story = await createStoryRecord(input);

    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }

    await setJobDone(jobId, story as unknown as Record<string, unknown>);
  } catch (err) {
    if (await isJobCancelled(jobId)) {
      await setJobCancelled(jobId);
      return;
    }
    const msg = err instanceof Error ? err.message : "Story generation failed";
    await setJobFailed(jobId, msg);
  }
}

// POST /generate — upload image + optional prompt, get a story back
storyRoutes.post("/generate", async (c) => {
  const limited = rateLimit(c, {
    key: "stories-generate",
    windowMs: 60_000,
    max: 10,
  });
  if (limited) return limited;

  const dailyLimited = await dailyLimit(c, {
    key: "daily-story",
    settingKey: "daily_story_limit",
    defaultMax: 20,
  });
  if (dailyLimited) return dailyLimited;
  const body = await c.req.parseBody();
  const file = body["image"];
  const prompt = typeof body["prompt"] === "string" ? body["prompt"] : "";

  if (!(file instanceof File)) {
    return c.json({ error: "No image uploaded", code: "MISSING_IMAGE" }, 400);
  }

  // 10 MB limit
  if (file.size > 10 * 1024 * 1024) {
    return c.json({ error: "Image too large (max 10 MB)", code: "IMAGE_TOO_LARGE" }, 400);
  }

  if (!file.type.startsWith("image/")) {
    return c.json({ error: "Invalid image type", code: "INVALID_IMAGE" }, 400);
  }

  const imageBuffer = Buffer.from(await file.arrayBuffer());
  const useAsync = c.req.query("async") === "1";

  if (useAsync) {
    const jobId = await createJob("story", {
      prompt,
      mimeType: file.type,
      imageSize: file.size,
    });

    void runStoryJob(jobId, {
      prompt,
      mimeType: file.type,
      imageBuffer,
    });

    return c.json({ jobId, status: "queued" }, 202);
  }

  try {
    const story = await createStoryRecord({
      prompt,
      mimeType: file.type,
      imageBuffer,
    });
    return c.json(story);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Story generation failed";
    if (msg === AI_BUSY) {
      return c.json({ error: "Story generator busy", code: "AI_BUSY" }, 429);
    }
    if (msg.toLowerCase().includes("invalid image")) {
      return c.json({ error: msg, code: "INVALID_IMAGE" }, 400);
    }
    return c.json({ error: "Story generation failed", code: "STORY_FAILED" }, 500);
  }
});

// GET /:id/tts — generate TTS audio for a story (audio tag-friendly)
const ttsHandler = async (c: Context) => {
  const limited = rateLimit(c, {
    key: "stories-tts",
    windowMs: 60_000,
    max: 30,
  });
  if (limited) return limited;
  const id = Number(c.req.param("id"));
  const row = await db.select().from(stories).where(eq(stories.id, id)).get();
  if (!row) {
    return c.json({ error: "Story not found", code: "NOT_FOUND" }, 404);
  }

  const provider = (c.req.query("provider") || "edge").toLowerCase();
  if (provider !== "edge" && provider !== "gemini") {
    return c.json({ error: "Invalid provider", code: "INVALID_PROVIDER" }, 400);
  }
  const hash = createHash("sha256").update(`${provider}:${row.story}`).digest("hex");
  const cachePath = join(TTS_CACHE_DIR, `${row.id}-${hash}.${provider === "edge" ? "mp3" : "wav"}`);

  try {
    const cached = await readFile(cachePath);
    return new Response(cached, {
      headers: { "Content-Type": provider === "edge" ? "audio/mpeg" : "audio/wav" },
    });
  } catch {
    // cache miss, continue
  }

  if (provider === "edge") {
    try {
      const mp3Buffer = await generateEdgeTtsMp3(row.story);
      await writeFile(cachePath, mp3Buffer);
      return new Response(mp3Buffer, {
        headers: { "Content-Type": "audio/mpeg" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "TTS failed";
      if (msg === "TTS_BUSY") {
        return c.json({ error: "TTS busy", code: "TTS_BUSY" }, 429);
      }
      return c.json({ error: "TTS failed", code: "TTS_FAILED" }, 500);
    }
  }

  // Default: Gemini native TTS (PCM → wav)
  let pcmBase64: string;
  try {
    pcmBase64 = await generateTTS(row.story);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "TTS failed";
    if (msg === AI_BUSY) {
      return c.json({ error: "TTS busy", code: "AI_BUSY" }, 429);
    }
    return c.json({ error: "TTS failed", code: "TTS_FAILED" }, 500);
  }
  const wavBuffer = pcmToWav(pcmBase64);
  await writeFile(cachePath, wavBuffer);

  return new Response(wavBuffer, {
    headers: { "Content-Type": "audio/wav" },
  });
};

storyRoutes.get("/:id/tts", ttsHandler);
// Keep POST for backward compatibility (older clients may POST)
storyRoutes.post("/:id/tts", ttsHandler);

// POST /:id/translate — translate a story to Chinese
storyRoutes.post("/:id/translate", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(stories).where(eq(stories.id, id)).get();
  if (!row) {
    return c.json({ error: "Story not found", code: "NOT_FOUND" }, 404);
  }

  try {
    const translation = await translateText(row.story);
    return c.json({ translation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Translation failed";
    if (msg === AI_BUSY) {
      return c.json({ error: "Translator busy", code: "AI_BUSY" }, 429);
    }
    return c.json({ error: "Translation failed", code: "TRANSLATION_FAILED" }, 500);
  }
});

// GET /:id/image — serve the story's image file
storyRoutes.get("/:id/image", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(stories).where(eq(stories.id, id)).get();
  if (!row) {
    return c.json({ error: "Story not found", code: "NOT_FOUND" }, 404);
  }

  try {
    const buf = await readFile(join(process.cwd(), row.imagePath));
    // All compressed images are JPEG (see compressImage)
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

// GET / — list all stories, newest first
storyRoutes.get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page") || "1"));
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") || "10")));
  const offset = (page - 1) * limit;

  const rows = await db
    .select()
    .from(stories)
    .orderBy(desc(stories.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  const countRow = await db
    .select({ total: sql<number>`count(*)` })
    .from(stories)
    .get();
  const total = Number(countRow?.total ?? 0);
  return c.json({ stories: rows.map(toStory), total, page, limit });
});

// DELETE /:id — delete a story and its image
storyRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(stories).where(eq(stories.id, id)).get();
  if (!row) {
    return c.json({ error: "Story not found", code: "NOT_FOUND" }, 404);
  }

  await db.delete(stories).where(eq(stories.id, id));

  // Best-effort image cleanup
  try {
    await unlink(join(process.cwd(), row.imagePath));
  } catch {
    /* image may already be gone */
  }

  // Best-effort TTS cache cleanup
  try {
    const files = await readdir(TTS_CACHE_DIR);
    const prefix = `${id}-`;
    await Promise.all(
      files
        .filter((name) => name.startsWith(prefix))
        .map((name) => unlink(join(TTS_CACHE_DIR, name))),
    );
  } catch {
    /* ignore cache cleanup errors */
  }

  return c.json({ ok: true });
});
