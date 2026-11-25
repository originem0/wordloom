import { Hono } from "hono";
import { z } from "zod";
import { speechText } from "../services/expressions-talk.js";
import { SpeechError, splitSpeech, synthesizeSpeech } from "../services/expressions-speech.js";

export const expressionSpeechRoutes = new Hono();
const request = z.object({ turn: z.number().int().positive(), part: z.number().int().nonnegative().default(0) }).strict();

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
  try {
    const audio = await synthesizeSpeech(part, c.req.raw.signal);
    return c.body(audio, 200, { "Content-Type": "audio/mpeg", "X-Speech-Parts": String(parts.length) });
  } catch (e) {
    const reason = e instanceof SpeechError ? e.reason : "failed";
    return c.json({ error: "Speech unavailable", code: "SPEECH_FAILED", reason }, reason === "not configured" ? 503 : 502);
  }
});
