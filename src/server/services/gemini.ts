import { GoogleGenAI, Modality } from "@google/genai";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  aiCardsResponseSchema,
  aiDeepLayerSchema,
} from "../../shared/validation.js";
import type { GroundingSource } from "../../shared/types.js";
import { Semaphore } from "./semaphore.js";

// ---------------------------------------------------------------------------
// Semaphore — limits concurrent Gemini API calls
// ---------------------------------------------------------------------------

const geminiSemaphore = new Semaphore(3);

// ---------------------------------------------------------------------------
// Retry with exponential back-off
// ---------------------------------------------------------------------------

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const msg =
        error instanceof Error ? error.message : String(error);
      // Only retry on transient errors
      const shouldRetry =
        /502|503|overloaded|429|rate.limit|UNAVAILABLE|network|timeout|fetch|ECONNRESET|socket|SSL|TLS|eof|getoxsrf/i.test(
          msg,
        );
      if (!shouldRetry || attempt === maxRetries - 1) throw error;
      const delayMs = initialDelay * Math.pow(2, attempt);
      console.log(`Retry ${attempt + 1}/${maxRetries} in ${delayMs}ms...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Lenient JSON parsing (some models wrap JSON in markdown fences)
// ---------------------------------------------------------------------------

function extractJsonCandidate(raw: string): string {
  const text = raw.trim();
  if (!text) return text;

  // Common case: ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Fallback: grab the largest {...} or [...] block
  const firstObj = text.indexOf("{");
  const lastObj = text.lastIndexOf("}");
  const firstArr = text.indexOf("[");
  const lastArr = text.lastIndexOf("]");

  const candidates: string[] = [];
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    candidates.push(text.slice(firstArr, lastArr + 1));
  }
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    candidates.push(text.slice(firstObj, lastObj + 1));
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].trim();
  }

  return text;
}

function parseJsonLenient(raw: string): unknown {
  const candidate = extractJsonCandidate(raw);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const snippet = raw.trim().slice(0, 220);
    throw new Error(
      `Failed to parse JSON from model output (${reason}). Snippet: ${snippet}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Normalize AI output — tolerate common schema drift across models/proxies
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    const parts = value
      .split(/[,，;；\n]/g)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return undefined;
}

function normalizeCefr(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim().toUpperCase();
  if (/^(A1|A2|B1|B2|C1|C2)$/.test(v)) return v;
  return value;
}

function normalizeConfidence(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  if (v === "med") return "medium";
  return value;
}

function normalizeExamples(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const normalized = value
    .map((item, idx) => {
      if (!isRecord(item)) return null;

      const levelRaw = item.level;
      let level: unknown = levelRaw;
      if (typeof levelRaw === "number") {
        level = levelRaw <= 1 ? "basic" : levelRaw === 2 ? "intermediate" : "advanced";
      } else if (typeof levelRaw === "string") {
        const l = levelRaw.toLowerCase();
        if (l === "beginner" || l === "easy" || l === "simple") level = "basic";
        else if (l === "intermediate" || l === "medium") level = "intermediate";
        else if (l === "advanced" || l === "hard") level = "advanced";
      } else if (levelRaw == null) {
        level = idx === 0 ? "basic" : idx === 1 ? "intermediate" : "advanced";
      }

      const sentence =
        (typeof item.sentence === "string" ? item.sentence : undefined) ??
        (typeof item.en === "string" ? item.en : undefined) ??
        (typeof item.english === "string" ? item.english : undefined) ??
        (typeof item.text === "string" ? item.text : undefined) ??
        (typeof item.example === "string" ? item.example : undefined);

      if (!sentence) return null;

      const translation =
        (typeof item.translation === "string" ? item.translation : undefined) ??
        (typeof item.zh === "string" ? item.zh : undefined) ??
        (typeof item.cn === "string" ? item.cn : undefined) ??
        (typeof item.chinese === "string" ? item.chinese : undefined) ??
        "";

      return { level, sentence, translation };
    })
    .filter(Boolean);

  return normalized;
}

function normalizeContextLadder(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const normalized = value
    .map((item, idx) => {
      if (!isRecord(item)) return null;

      const level = coerceNumber(item.level) ?? idx + 1;
      const sentence =
        (typeof item.sentence === "string" ? item.sentence : undefined) ??
        (typeof item.en === "string" ? item.en : undefined) ??
        (typeof item.text === "string" ? item.text : undefined);

      if (!sentence) return null;

      const context =
        (typeof item.context === "string" ? item.context : undefined) ??
        (typeof item.contextDescription === "string" ? item.contextDescription : undefined) ??
        (typeof (item as any).context_description === "string" ? (item as any).context_description : undefined) ??
        (typeof item.description === "string" ? item.description : undefined) ??
        (typeof item.desc === "string" ? item.desc : undefined) ??
        "";

      return { level, sentence, context };
    })
    .filter(Boolean);

  return normalized;
}

function normalizeCardObject(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = { ...value };

  // Field aliases
  if (out.partOfSpeech && !out.pos) out.pos = out.partOfSpeech;
  if (out.meaning && !out.coreMeaning) out.coreMeaning = out.meaning;
  if (out.definition && !out.coreMeaning) out.coreMeaning = out.definition;
  if (out.minimalPair && !out.minPair) out.minPair = out.minimalPair;

  out.cefr = normalizeCefr(out.cefr);
  out.cefrConfidence = normalizeConfidence(out.cefrConfidence);

  const wad = coerceNumber(out.wad);
  if (wad != null) out.wad = wad;
  const wap = coerceNumber(out.wap);
  if (wap != null) out.wap = wap;

  out.collocations = coerceStringArray(out.collocations) ?? out.collocations;
  out.phrases = coerceStringArray(out.phrases) ?? out.phrases;
  out.synonyms = coerceStringArray(out.synonyms) ?? out.synonyms;
  out.antonyms = coerceStringArray(out.antonyms) ?? out.antonyms;

  out.examples = normalizeExamples(out.examples);
  out.contextLadder = normalizeContextLadder(out.contextLadder);

  return out;
}

function normalizeCardsPayload(parsed: unknown): unknown {
  let payload: unknown = parsed;

  // Some models wrap the array in an object.
  if (isRecord(payload)) {
    if (Array.isArray(payload.cards)) payload = payload.cards;
    else if (Array.isArray(payload.data)) payload = payload.data;
    else if (Array.isArray(payload.items)) payload = payload.items;
  }

  if (Array.isArray(payload)) return payload.map(normalizeCardObject);
  return payload;
}

// ---------------------------------------------------------------------------
// API Key from DB
// ---------------------------------------------------------------------------

async function getSetting(key: string): Promise<string> {
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? "";
}

async function getClient(): Promise<GoogleGenAI> {
  const apiKey = await getSetting("gemini_api_key");
  if (!apiKey)
    throw new Error("Gemini API Key not configured. Set it in Settings.");
  const baseUrl = await getSetting("gemini_base_url");
  return new GoogleGenAI({
    apiKey,
    ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
  });
}

async function getModel(settingKey: string, fallback: string): Promise<string> {
  return (await getSetting(settingKey)) || fallback;
}

function parsePositiveInt(raw: string, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

async function getRuntimeSettings(): Promise<{ timeoutMs: number; maxRetries: number }> {
  return {
    timeoutMs: parsePositiveInt(await getSetting("api_timeout_ms"), 45_000, 5_000, 180_000),
    maxRetries: parsePositiveInt(await getSetting("api_max_retries"), 3, 1, 6),
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

async function runWithRetries<T>(fn: () => Promise<T>): Promise<T> {
  const { timeoutMs, maxRetries } = await getRuntimeSettings();
  return await retryWithBackoff(() => withTimeout(fn(), timeoutMs), maxRetries);
}

async function getModelPreference(
  primaryKey: string,
  primaryFallback: string,
  fallbackKey: string,
): Promise<{ primary: string; fallback: string | null }> {
  const primary = ((await getSetting(primaryKey)).trim() || primaryFallback).trim();
  const fallback = (await getSetting(fallbackKey)).trim();
  return {
    primary,
    fallback: fallback && fallback !== primary ? fallback : null,
  };
}

async function runWithModelFallback<T>(opts: {
  primaryKey: string;
  primaryFallback: string;
  fallbackKey: string;
  label: string;
  run: (model: string) => Promise<T>;
}): Promise<T> {
  const pref = await getModelPreference(opts.primaryKey, opts.primaryFallback, opts.fallbackKey);
  try {
    return await runWithRetries(() => opts.run(pref.primary));
  } catch (primaryError) {
    if (!pref.fallback) throw primaryError;
    console.warn(`${opts.label}: primary model ${pref.primary} failed, trying fallback ${pref.fallback}`);
    try {
      return await runWithRetries(() => opts.run(pref.fallback!));
    } catch (fallbackError) {
      const p = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const f = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${opts.label} failed on primary (${pref.primary}): ${p}; fallback (${pref.fallback}): ${f}`);
    }
  }
}

async function getExplanationLanguageInstruction(): Promise<string> {
  const pref = ((await getSetting("analysis_language")).trim() || "zh-CN").toLowerCase();
  if (pref === "en") {
    return "Use English for explanatory text such as meanings, etymology, distinctions, notes, reasons, and core image descriptions unless a field explicitly requires Chinese.";
  }
  if (pref === "bilingual") {
    return "Use concise bilingual explanations: English first, then Simplified Chinese where it helps learners. Keep them compact.";
  }
  return "Use Simplified Chinese for explanatory text unless a field explicitly requires English.";
}

// ---------------------------------------------------------------------------
// System prompt for story generation (picture description)
// ---------------------------------------------------------------------------

const STORY_SYSTEM_PROMPT = `Write a compact, essay-style paragraph (100-180 words) inspired by the image.

Style: tight prose like a good blog post or short essay — no filler, every sentence earns its place. Vary rhythm (mix short punchy sentences with longer ones). Show, don't tell.

Mark 2-3 useful expressions in **double asterisks** (e.g. **catch someone's eye**). No other Markdown — no headings, lists, or rules.

Only describe what's visible; use "someone" if identity is unclear. Use search for recognizable people/places.

Output must sound natural read aloud (TTS).`;

// ---------------------------------------------------------------------------
// generateStory
// ---------------------------------------------------------------------------

export async function generateStory(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
): Promise<{ story: string; sources: GroundingSource[] }> {
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
  try {
    return await runWithModelFallback({
      primaryKey: "story_model",
      primaryFallback: "gemini-2.5-pro",
      fallbackKey: "story_fallback_model",
      label: "generateStory",
      run: async (model) => {
        const ai = await getClient();

        let systemInstruction = STORY_SYSTEM_PROMPT;
        if (prompt) {
          systemInstruction += `\n\n**User's Custom Requirements (PRIORITY):**\n${prompt}`;
        }

        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: imageBuffer.toString("base64"),
                  },
                },
                { text: "Describe this image following the instructions." },
              ],
            },
          ],
          config: {
            systemInstruction,
            tools: [{ googleSearch: {} }],
          },
        });

        const story = response.text ?? "";

        const sources: GroundingSource[] = [];
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (chunks) {
          for (const chunk of chunks) {
            if (chunk.web) {
              sources.push({
                web: {
                  uri: chunk.web.uri ?? "",
                  title: chunk.web.title ?? "",
                },
              });
            }
          }
        }

        return { story, sources };
      },
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// generateTTS — Gemini native TTS, returns base64 PCM
// ---------------------------------------------------------------------------

export async function generateTTS(text: string): Promise<string> {
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
  try {
    return await runWithModelFallback({
      primaryKey: "tts_model",
      primaryFallback: "gemini-2.5-flash-preview-tts",
      fallbackKey: "tts_fallback_model",
      label: "generateTTS",
      run: async (model) => {
        const ai = await getClient();
        const voiceName = (await getSetting("gemini_tts_voice")).trim() || "Zephyr";

        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Read this story in a natural, human-like voice, with engaging and varied intonation suitable for an English learner. Avoid a robotic tone. Story: ${text}`,
                },
              ],
            },
          ],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
        });

        const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!data) throw new Error("TTS returned no audio data");
        return data;
      },
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// translateText
// ---------------------------------------------------------------------------

export async function translateText(text: string): Promise<string> {
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
  try {
    return await runWithModelFallback({
      primaryKey: "general_model",
      primaryFallback: "gemini-2.5-flash",
      fallbackKey: "general_fallback_model",
      label: "translateText",
      run: async (model) => {
        const ai = await getClient();
        const response = await ai.models.generateContent({
          model,
          contents: `Translate the following text to Simplified Chinese. Keep the markdown formatting intact. Only return the translated text, nothing else.\n\n${text}`,
        });
        return response.text ?? "";
      },
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// generateCards — surface + middle layers
// ---------------------------------------------------------------------------

const CARDS_PROMPT = `You are a vocabulary analysis engine for English learners.

For each word provided, generate a comprehensive card with these fields:
- word: the word itself
- ipa: IPA pronunciation (e.g. "/ˈwɜːr.kɪŋ/")
- pos: part of speech (noun, verb, adj, adv, etc.)
- cefr: CEFR level (A1/A2/B1/B2/C1/C2)
- cefrConfidence: confidence in CEFR assessment (high/medium/low)
- coreMeaning: a concise core meaning in Chinese (一句话核心释义)
- wad: word acquisition difficulty (1-5, where 5 is hardest)
- wap: word academic prevalence (1-5, where 5 is most academic)
- etymology: brief etymology in Chinese (用中文解释词源，包括来源语言和语义演变，例如"源自拉丁语 per-（贯穿）+ severus（严格），原义'严格坚持到底'，后演变为'坚持不懈'")
- collocations: 3-5 common collocations as strings
- examples: 3 example sentences at basic/intermediate/advanced levels, each with Chinese translation
- contextLadder: 3 progressive context levels (1=simple, 2=moderate, 3=complex), each with a sentence and context description
- phrases: 2-3 common phrases containing the word
- synonyms: 2-4 synonyms
- antonyms: 1-3 antonyms
- minPair: a minimal pair word that learners often confuse with this word

Return a JSON array of card objects.`;

interface ParsedCard {
  word: string;
  ipa?: string;
  pos?: string;
  cefr?: string;
  cefrConfidence?: string;
  coreMeaning?: string;
  wad?: number;
  wap?: number;
  etymology?: string;
  collocations: string[];
  examples: { level: string; sentence: string; translation: string }[];
  contextLadder: { level: number; sentence: string; context: string }[];
  phrases: string[];
  synonyms: string[];
  antonyms: string[];
  minPair?: string;
}

export async function generateCards(
  words: string[],
): Promise<{ success: ParsedCard[]; failed: { word: string; error: string }[] }> {
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKey: "general_model",
      primaryFallback: "gemini-2.5-flash",
      fallbackKey: "general_fallback_model",
      label: "generateCards",
      run: async (model) => {
        const ai = await getClient();
        const response = await ai.models.generateContent({
          model,
          contents: `${CARDS_PROMPT}\n\nLanguage preference: ${languageInstruction}\n\nWords to analyze: ${JSON.stringify(words)}`,
          config: {
            responseMimeType: "application/json",
          },
        });

        const text = response.text ?? "[]";
        let parsed: unknown;
        try {
          parsed = parseJsonLenient(text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Failed to parse Gemini JSON response: ${msg}`);
        }

        parsed = normalizeCardsPayload(parsed);

        const result = aiCardsResponseSchema.safeParse(parsed);
        if (result.success) {
          return { success: result.data as ParsedCard[], failed: [] };
        }

        const rawArray = Array.isArray(parsed) ? parsed : [];
        const success: ParsedCard[] = [];
        const failed: { word: string; error: string }[] = [];

        for (const item of rawArray) {
          const single = aiCardsResponseSchema.element.safeParse(item);
          if (single.success) {
            success.push(single.data as ParsedCard);
          } else {
            const word =
              typeof item === "object" && item !== null && "word" in item
                ? String((item as { word: unknown }).word)
                : "unknown";
            const first = single.error.issues?.[0];
            const path = first?.path?.length ? first.path.join(".") : "";
            const msg = first?.message ? String(first.message) : "Validation failed";
            failed.push({ word, error: path ? `${path}: ${msg}` : msg });
          }
        }

        const returnedWords = new Set(
          [...success.map((c) => c.word), ...failed.map((f) => f.word)].map(
            (w) => w.toLowerCase(),
          ),
        );
        for (const w of words) {
          if (!returnedWords.has(w.toLowerCase())) {
            failed.push({ word: w, error: "Not returned by AI" });
          }
        }

        return { success, failed };
      },
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// generateDeepLayer
// ---------------------------------------------------------------------------

const DEEP_PROMPT = `You are a vocabulary deep-analysis engine for English learners.

For the given word, generate a JSON object with these fields:

1. familyComparison: Array of related/similar words (word family + common confusables).
   Each entry: { word, pos, distinction (核心区别 in Chinese), register (情感/语域 in Chinese), typicalScene (典型场景 in Chinese) }
   Include the target word itself as the first entry (highlighted).
   Include 3-5 comparison words.

2. familyBoundaryNote: A short paragraph in Chinese comparing 2-3 key pairs from the family (e.g. "X vs Y: X 是…；Y 是…"). Use concrete metaphors.

3. schemaAnalysis: Cognitive schema analysis.
   {
     coreSchema: one of "blockage" | "container" | "path" | "link" | "balance" (pick the closest),
     coreImageText: A paragraph in Chinese (2-3 sentences) describing the core cognitive image of the word — what mental picture it evokes, using the metaphor behind the word,
     coreSvg: A COMPLETE inline SVG string that vividly illustrates THIS SPECIFIC WORD's core meaning.
       SVG REQUIREMENTS:
       - Must start with <svg viewBox="0 0 600 180" xmlns="http://www.w3.org/2000/svg"> and end with </svg>
       - Use an inline <style> block for CSS @keyframes animations (NO SMIL attributes like <animate>)
       - The visual must be a METAPHORICAL ILLUSTRATION specific to this word, not a generic diagram
       - For example: "perseverance" → a figure climbing a steep mountain with falling rocks, still moving up;
         "diverge" → a single path splitting into multiple colorful branches going different directions;
         "obscure" → a clear shape gradually being covered by fog/clouds
       - Use soft colors: teal (#2aa198), gold (#b58900), dark (#073642), muted gray (#93a1a1), cream (#eee8d5)
       - Add 2-3 subtle CSS animations (floating, pulsing, dashing, moving) to make it feel alive
       - Add short Chinese labels (1-3) at key positions using <text> elements, font-size 11-12px
       - Keep the SVG under 2KB — simple shapes, no complex paths
       - DO NOT use <image>, <foreignObject>, or external resources
     metaphoricalExtensions: string[],
     registerVariation: string,
     etymologyChain: Array of 2-4 short Chinese labels showing the semantic evolution stages (e.g. ["物理：昏暗/被遮挡", "认知：晦涩难懂", "社会：默默无闻"]),
     sceneActivation: Array of 2-3 scene frames, each:
       {
         title: "Scene N — [domain] ([frame name])" in English,
         description: A vivid paragraph in English describing a concrete scenario where the word applies,
         example: An example sentence in English using the word (wrap the target word in double asterisks),
         associatedWords: 4-6 related English words for this particular usage scene
       }
   }

4. boundaryTests: 3-4 fill-in-the-blank test scenarios.
   Each entry:
   {
     sentence: English sentence with a blank (use "______" for the blank),
     options: Array of 2-3 candidate words, each:
       { verdict: "yes" | "no" | "maybe", word: the candidate word, reason: short explanation in Chinese }
   }
   Include the target word and at least one confusable word from familyComparison in the options.

Return as a single JSON object.

Hard requirements:
- schemaAnalysis MUST be present.
- schemaAnalysis.coreSchema MUST be one of: blockage, container, path, link, balance.

All Chinese text should use Simplified Chinese.`;


export async function generateDeepLayer(
  word: string,
): Promise<{
  familyComparison: unknown[];
  familyBoundaryNote?: string;
  schemaAnalysis?: unknown;
  boundaryTests: unknown[];
}> {
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKey: "general_model",
      primaryFallback: "gemini-2.5-flash",
      fallbackKey: "general_fallback_model",
      label: "generateDeepLayer",
      run: async (model) => {
        const ai = await getClient();
        const response = await ai.models.generateContent({
          model,
          contents: `${DEEP_PROMPT}\n\nLanguage preference: ${languageInstruction}\n\nWord: "${word}"`,
          config: {
            responseMimeType: "application/json",
          },
        });

        const text = response.text ?? "{}";
        let parsed: unknown;
        try {
          parsed = parseJsonLenient(text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Failed to parse deep layer JSON: ${msg}`);
        }

        const result = aiDeepLayerSchema.safeParse(parsed);
        if (!result.success) {
          throw new Error(`Deep layer validation failed for "${word}"`);
        }

        const ALLOWED = ["blockage", "container", "path", "link", "balance"] as const;
        type CoreSchema = (typeof ALLOWED)[number];
        const normalizeCoreSchema = (raw: unknown): CoreSchema => {
          if (typeof raw !== "string") return "blockage";
          const v = raw.trim().toLowerCase();
          if ((ALLOWED as readonly string[]).includes(v)) return v as CoreSchema;
          if (["scale", "weigh", "weighing", "tradeoff", "trade-off", "equilibrium"].includes(v)) {
            return "balance";
          }
          if (["force", "pressure", "push", "pull"].includes(v)) return "blockage";
          if (["cycle", "loop", "repeat", "repetition"].includes(v)) return "path";
          if (v.includes("contain") || v.includes("inside") || v.includes("outside") || v.includes("boundary") || v === "box") {
            return "container";
          }
          if (v.includes("journey") || v.includes("route") || v.includes("progress") || v.includes("path")) {
            return "path";
          }
          if (v.includes("connect") || v.includes("relation") || v.includes("association") || v.includes("link")) {
            return "link";
          }
          if (v.includes("balance") || v.includes("equilib") || v.includes("weigh")) {
            return "balance";
          }
          return "blockage";
        };

        const out = result.data;
        if (!out.schemaAnalysis) {
          out.schemaAnalysis = {
            coreSchema: "blockage",
            coreImageText: "",
            metaphoricalExtensions: [],
            registerVariation: "",
            etymologyChain: [],
            sceneActivation: [],
          };
        } else {
          out.schemaAnalysis.coreSchema = normalizeCoreSchema(out.schemaAnalysis.coreSchema);
        }

        return out;
      },
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// extractWords
// ---------------------------------------------------------------------------

export async function extractWords(text: string): Promise<string[]> {
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
  try {
    return await runWithModelFallback({
      primaryKey: "general_model",
      primaryFallback: "gemini-2.5-flash",
      fallbackKey: "general_fallback_model",
      label: "extractWords",
      run: async (model) => {
        const ai = await getClient();
        const response = await ai.models.generateContent({
          model,
          contents: `Extract English words worth studying from the following text. Exclude common/simple words (the, is, a, it, etc.). Focus on vocabulary useful for intermediate-to-advanced English learners.

Return a JSON array of strings (just the words).

Text:
${text}`,
          config: {
            responseMimeType: "application/json",
          },
        });

        const raw = response.text ?? "[]";
        let parsed: unknown;
        try {
          parsed = parseJsonLenient(raw);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Failed to parse extracted words JSON: ${msg}`);
        }

        if (!Array.isArray(parsed)) return [];
        return parsed.filter((w): w is string => typeof w === "string");
      },
    });
  } finally {
    geminiSemaphore.release();
  }
}
