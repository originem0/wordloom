import { inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";

export type SpeechFailure = "not configured" | "timeout" | "busy" | "failed";

export class SpeechError extends Error {
  constructor(readonly reason: SpeechFailure) {
    super(reason);
    this.name = "SpeechError";
  }
}

const MAX_TEXT = 1_000;
const KEYS = ["rime_api_key", "rime_model", "rime_speaker", "rime_speed"];

/** Rime accepts at most 1,000 characters. Keep sentence boundaries where
 * possible, and never cut a UTF-16 surrogate pair when a sentence is longer. */
export function splitSpeech(text: string): string[] {
  const chunks: string[] = [];
  let part = "";
  // The library's blanks remain blanks in speech, rather than spoken underscores.
  const plain = text.replace(/_{4,}/g, " ").trim();
  for (const { segment } of new Intl.Segmenter("en", { granularity: "sentence" }).segment(plain)) {
    let sentence = segment.trim();
    if (!sentence) continue;
    if (part && part.length + sentence.length + 1 > MAX_TEXT) {
      chunks.push(part);
      part = "";
    }
    while (sentence.length > MAX_TEXT) {
      let cut = MAX_TEXT;
      const space = sentence.lastIndexOf(" ", cut);
      if (space >= MAX_TEXT / 2) cut = space;
      if (/^[\uDC00-\uDFFF]$/.test(sentence[cut])) cut--;
      chunks.push(sentence.slice(0, cut).trim());
      sentence = sentence.slice(cut).trim();
    }
    if (sentence) part = part ? `${part} ${sentence}` : sentence;
  }
  if (part) chunks.push(part);
  return chunks;
}

/** Credentials stay on the server. Only the fixed Rime hosts receive them;
 * provider failures never carry their response body into our errors or logs. */
export async function synthesizeSpeech(text: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!text || text.length > MAX_TEXT) throw new SpeechError("failed");
  const rows = await db.select().from(settings).where(inArray(settings.key, KEYS)).all();
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value.trim()]));
  const key = saved.rime_api_key;
  const model = saved.rime_model || "coda";
  const speaker = saved.rime_speaker || "astra";
  if (!key || key === "configured" || !["coda", "mist"].includes(model) || !/^[a-z][a-z0-9_-]{0,59}$/.test(speaker)) {
    throw new SpeechError("not configured");
  }
  const speed = Math.min(2, Math.max(0.5, Number(saved.rime_speed) || 1));
  const timeout = AbortSignal.timeout(30_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(`https://${model}.api.rime.ai/`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text, speaker, modelId: model === "mist" ? "mistv3" : "coda", lang: "en", samplingRate: 24_000,
        // Rime's timeScaleFactor is the duration multiplier; our setting is speaking speed.
        timeScaleFactor: 1 / speed,
      }),
      signal: requestSignal,
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new SpeechError(res.status === 429 ? "busy" : [401, 403].includes(res.status) ? "not configured" : "failed");
    }
    if (!/^audio\/(mpeg|mp3)(;|$)/i.test(res.headers.get("Content-Type") ?? "")) {
      await res.body?.cancel();
      throw new SpeechError("failed");
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) throw new SpeechError("failed");
    return bytes;
  } catch (e) {
    if (e instanceof SpeechError) throw e;
    throw new SpeechError(timeout.aborted ? "timeout" : "failed");
  }
}
