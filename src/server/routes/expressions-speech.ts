import { Hono, type Context } from "hono";
import { z } from "zod";
import { RIME_SPEAKER_ID, rimePreviewSchema, type RimePreview, type RimeVoices } from "../../shared/rime.js";
import { speechText } from "../services/expressions-talk.js";
import { SpeechError, splitSpeech, synthesizeSpeech } from "../services/expressions-speech.js";

export const expressionSpeechRoutes = new Hono();
export const rimeSettingsRoutes = new Hono();
const request = z.object({ turn: z.number().int().positive(), part: z.number().int().nonnegative().default(0) }).strict();

const englishCatalog = z.object({
  eng: z.array(z.string()).transform((ids) => [...new Set(ids.filter((id) => RIME_SPEAKER_ID.test(id)))].sort()).refine((ids) => ids.length > 0),
});
const voiceCatalog = z.object({ coda: englishCatalog, mistv3: englishCatalog });

rimeSettingsRoutes.get("/voices", async (c) => {
  try {
    const res = await fetch("https://users.rime.ai/data/voices/all-v2.json", {
      redirect: "error", signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(8_000)]),
    });
    if (!res.ok) throw new Error("Rime catalog unavailable");
    const { coda, mistv3 } = voiceCatalog.parse(await res.json());
    return c.json({ coda: coda.eng, mist: mistv3.eng } satisfies RimeVoices);
  } catch {
    return c.json({ error: "Voice catalog unavailable", code: "RIME_CATALOG_UNAVAILABLE" }, 502);
  }
});

rimeSettingsRoutes.post("/preview", async (c) => {
  const parsed = rimePreviewSchema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  return audioResponse(c, "I've been thinking about what you said. Can we talk it through?", 1, parsed.data);
});

// Mounted under /api/expressions, behind the same private guard as the text.
// The request carries a turn id; its English comes from the current masked view.
expressionSpeechRoutes.post("/speech", async (c) => {
  c.header("Cache-Control", "no-store");
  const parsed = request.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  const text = await speechText(parsed.data.turn);
  if (text == null) return c.json({ error: "Turn not found", code: "NOT_FOUND" }, 404);
  const parts = splitSpeech(text);
  if (!parts.length) return c.json({ error: "Nothing to speak", code: "SPEECH_EMPTY" }, 422);
  const part = parts[parsed.data.part];
  if (part == null) return c.json({ error: "Speech part not found", code: "NOT_FOUND" }, 404);
  return audioResponse(c, part, parts.length);
});

async function audioResponse(c: Context, text: string, parts: number, preview?: RimePreview) {
  c.header("Cache-Control", "no-store");
  try {
    const audio = await synthesizeSpeech(text, c.req.raw.signal, preview);
    return c.body(audio, 200, { "Content-Type": "audio/mpeg", "X-Speech-Parts": String(parts) });
  } catch (e) {
    const reason = e instanceof SpeechError ? e.reason : "failed";
    return c.json({ error: "Speech unavailable", code: "SPEECH_FAILED", reason }, reason === "not configured" ? 503 : 502);
  }
}
