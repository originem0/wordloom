import { EdgeTTS } from "edge-tts-universal";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { Semaphore } from "./semaphore.js";

const edgeSemaphore = new Semaphore(2);

const DEFAULT_EDGE_VOICE = "en-US-EmmaMultilingualNeural";

async function getSetting(key: string): Promise<string> {
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? "";
}

function sanitizeTtsText(text: string): string {
  // Strip any Markdown artifacts that would sound wrong when read aloud.
  return text
    .replace(/^#{1,6}\s+/gm, "")   // headings: ### Title
    .replace(/^[-*]\s+/gm, "")     // bullet points
    .replace(/^\d+\.\s+/gm, "")    // numbered lists
    .replace(/^---+$/gm, "")       // horizontal rules
    .replace(/\*\*/g, "")          // bold **word**
    .replace(/__+/g, "")           // bold __word__
    .replace(/`+/g, "")            // code `word`
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links [text](url) → text
    .replace(/\n{3,}/g, "\n\n")    // collapse excess newlines
    .trim();
}

function normalizeEnglishVoice(raw: string): string {
  const v = raw.trim();
  if (!v) return DEFAULT_EDGE_VOICE;
  // Hard guard: user asked for English voices only.
  if (!v.toLowerCase().startsWith("en-")) return DEFAULT_EDGE_VOICE;
  return v;
}

export async function generateEdgeTtsMp3(text: string): Promise<Buffer> {
  await edgeSemaphore.acquire();
  try {
    const voice = normalizeEnglishVoice(await getSetting("edge_tts_voice"));
    const clean = sanitizeTtsText(text);

    const tts = new EdgeTTS(clean, voice);
    const result = await tts.synthesize();

    return Buffer.from(await result.audio.arrayBuffer());
  } finally {
    edgeSemaphore.release();
  }
}
