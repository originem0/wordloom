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
        /503|overloaded|429|rate.limit|UNAVAILABLE|network|timeout|fetch/i.test(
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

// ---------------------------------------------------------------------------
// System prompt for story generation (picture description)
// ---------------------------------------------------------------------------

const STORY_SYSTEM_PROMPT = `You are creating a SHORT model essay (150-250 words) for English learners practicing "picture description" (看图说话).

**STRUCTURE (keep each section brief):**

1. **What I See** (2-3 sentences)
   Describe the key visible elements with precise vocabulary. Avoid generic words like "beautiful" or "nice."

2. **What I Feel** (2-3 sentences)
   What mood or story does this image convey? Connect visuals to meaning.

3. **Mini Story** (3-5 sentences)
   A short, engaging narrative woven from your observations.

**RULES:**
- Total length: 150-250 words (DO NOT exceed)
- **Bold** 2-3 useful expressions/collocations for learners to study
- Use varied sentence structures (short + long)
- Natural, conversational tone — not overly literary
- Only describe what's clearly visible; use "someone" if identity is unclear
- Use search tool for recognizable people/places/events

Keep it concise and learner-friendly. Quality over quantity.`;

// ---------------------------------------------------------------------------
// generateStory
// ---------------------------------------------------------------------------

export async function generateStory(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
): Promise<{ story: string; sources: GroundingSource[] }> {
  await geminiSemaphore.acquire();
  try {
    return await retryWithBackoff(async () => {
      const ai = await getClient();
      const model = await getModel("story_model", "gemini-2.5-pro");

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

      // Extract grounding sources from metadata
      const sources: GroundingSource[] = [];
      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks;
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
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// generateTTS — Gemini native TTS, returns base64 PCM
// ---------------------------------------------------------------------------

export async function generateTTS(text: string): Promise<string> {
  await geminiSemaphore.acquire();
  try {
    return await retryWithBackoff(async () => {
      const ai = await getClient();
      const model = await getModel("tts_model", "gemini-2.5-flash-preview-tts");

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
              prebuiltVoiceConfig: { voiceName: "Zephyr" },
            },
          },
        },
      });

      // The response contains inline audio data
      const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData
        ?.data;
      if (!data) throw new Error("TTS returned no audio data");
      return data;
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// translateText
// ---------------------------------------------------------------------------

export async function translateText(text: string): Promise<string> {
  await geminiSemaphore.acquire();
  try {
    return await retryWithBackoff(async () => {
      const ai = await getClient();
      const model = await getModel("general_model", "gemini-2.5-flash");

      const response = await ai.models.generateContent({
        model,
        contents: `Translate the following text to Simplified Chinese. Keep the markdown formatting intact. Only return the translated text, nothing else.\n\n${text}`,
      });

      return response.text ?? "";
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
- etymology: brief etymology (origin language + meaning evolution)
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
  await geminiSemaphore.acquire();
  try {
    return await retryWithBackoff(async () => {
      const ai = await getClient();
      const model = await getModel("general_model", "gemini-2.5-flash");

      const response = await ai.models.generateContent({
        model,
        contents: `${CARDS_PROMPT}\n\nWords to analyze: ${JSON.stringify(words)}`,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text ?? "[]";
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Failed to parse Gemini JSON response: ${text.slice(0, 200)}`);
      }

      const result = aiCardsResponseSchema.safeParse(parsed);
      if (result.success) {
        return { success: result.data as ParsedCard[], failed: [] };
      }

      // Partial success: try to validate each item individually
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
          failed.push({ word, error: "Validation failed" });
        }
      }

      // Report words that were requested but missing from response
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
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// generateDeepLayer
// ---------------------------------------------------------------------------

const DEEP_PROMPT = `You are a vocabulary deep-analysis engine.

For the given word, generate:

1. familyComparison: An array of related/similar words (word family + common confusables).
   Each entry: { word, pos, distinction, register, typicalScene }

2. schemaAnalysis: Cognitive schema analysis.
   { coreSchema: string, metaphoricalExtensions: string[], registerVariation: string }

3. boundaryTests: 3-5 "can you use X here?" scenario tests.
   Each entry: { scenario, answer ("yes"/"no"/"depends"), explanation }

Return as a JSON object.`;

export async function generateDeepLayer(
  word: string,
): Promise<{
  familyComparison: unknown[];
  schemaAnalysis?: unknown;
  boundaryTests: unknown[];
}> {
  await geminiSemaphore.acquire();
  try {
    return await retryWithBackoff(async () => {
      const ai = await getClient();
      const model = await getModel("general_model", "gemini-2.5-flash");

      const response = await ai.models.generateContent({
        model,
        contents: `${DEEP_PROMPT}\n\nWord: "${word}"`,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text ?? "{}";
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(`Failed to parse deep layer JSON: ${text.slice(0, 200)}`);
      }

      const result = aiDeepLayerSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(`Deep layer validation failed for "${word}"`);
      }

      return result.data;
    });
  } finally {
    geminiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// extractWords
// ---------------------------------------------------------------------------

export async function extractWords(text: string): Promise<string[]> {
  await geminiSemaphore.acquire();
  try {
    return await retryWithBackoff(async () => {
      const ai = await getClient();
      const model = await getModel("general_model", "gemini-2.5-flash");

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
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(`Failed to parse extracted words JSON: ${raw.slice(0, 200)}`);
      }

      if (!Array.isArray(parsed)) return [];
      return parsed.filter((w): w is string => typeof w === "string");
    });
  } finally {
    geminiSemaphore.release();
  }
}
