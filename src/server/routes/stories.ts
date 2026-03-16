import { Hono } from "hono";
import type { Context } from "hono";
import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { db } from "../db/index.js";
import { stories } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { compressImage } from "../services/image.js";
import { generateStory, generateTTS, translateText } from "../services/gemini.js";
import { pcmToWav } from "../services/tts.js";
import type { Story, GroundingSource } from "../../shared/types.js";

const IMAGE_DIR = join(process.cwd(), "data", "images");

// Ensure image directory exists at module load
await mkdir(IMAGE_DIR, { recursive: true });

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

// POST /generate — upload image + optional prompt, get a story back
storyRoutes.post("/generate", async (c) => {
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

  const rawBuffer = Buffer.from(await file.arrayBuffer());
  const { buffer: compressedBuffer, mimeType } = await compressImage(rawBuffer, file.type);

  // Save image
  const filename = `${randomUUID()}.jpg`;
  const imagePath = `data/images/${filename}`;
  await writeFile(join(IMAGE_DIR, filename), compressedBuffer);

  // Generate story via Gemini
  const { story, sources } = await generateStory(compressedBuffer, mimeType, prompt);

  const now = Date.now();
  const inserted = await db
    .insert(stories)
    .values({
      imagePath,
      prompt,
      story,
      sources: JSON.stringify(sources),
      createdAt: now,
    })
    .returning();

  return c.json(toStory(inserted[0]));
});

// GET /:id/tts — generate TTS audio for a story (audio tag-friendly)
const ttsHandler = async (c: Context) => {
  const id = Number(c.req.param("id"));
  const row = await db.select().from(stories).where(eq(stories.id, id)).get();
  if (!row) {
    return c.json({ error: "Story not found", code: "NOT_FOUND" }, 404);
  }

  const pcmBase64 = await generateTTS(row.story);
  const wavBuffer = pcmToWav(pcmBase64);

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

  const translation = await translateText(row.story);
  return c.json({ translation });
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
  const rows = await db
    .select()
    .from(stories)
    .orderBy(desc(stories.createdAt))
    .all();
  return c.json(rows.map(toStory));
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

  return c.json({ ok: true });
});
