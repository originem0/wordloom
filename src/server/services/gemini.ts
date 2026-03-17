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
        /503|overloaded|429|rate.limit|UNAVAILABLE|network|timeout|fetch|ECONNRESET|socket|SSL|TLS|eof|getoxsrf/i.test(
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

Write 2-3 flowing paragraphs of plain prose. Start by describing the key visible elements with precise vocabulary, then convey the mood or feeling, and weave in a short narrative.

RULES:
- 150-250 words total. Do NOT exceed.
- Wrap 2-3 useful expressions or collocations in **double asterisks** so learners can study them (e.g. **catch someone's eye**). This is the ONLY Markdown allowed.
- Do NOT use any other Markdown: no headings (#), no horizontal rules (---), no bullet points, no numbered lists, no code blocks.
- Do NOT add section titles like "What I See" or "Mini Story". Just write natural paragraphs.
- Use varied sentence structures (short + long).
- Natural, conversational tone — not overly literary.
- Only describe what is clearly visible; use "someone" if identity is unclear.
- Use search tool for recognizable people, places, or events.

The output will be read aloud by TTS, so it must sound natural as spoken English.`;

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
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
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
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
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
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
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
        parsed = parseJsonLenient(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to parse Gemini JSON response: ${msg}`);
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

const DEEP_PROMPT = `You are a vocabulary deep-analysis engine for English learners.

For the given word, generate a JSON object with these fields:

1. familyComparison: Array of related/similar words (word family + common confusables).
   Each entry: { word, pos, distinction (核心区别 in Chinese), register (情感/语域 in Chinese), typicalScene (典型场景 in Chinese) }
   Include the target word itself as the first entry (highlighted).
   Include 3-5 comparison words.

2. familyBoundaryNote: A short paragraph in Chinese comparing 2-3 key pairs from the family (e.g. "X vs Y: X 是…；Y 是…"). Use concrete metaphors.

3. schemaAnalysis: Cognitive schema analysis.
   {
     coreSchema: one of "blockage" | "container" | "path" | "link" | "balance" | "scale" | "force" | "cycle",
     coreImageText: A paragraph in Chinese (2-3 sentences) describing the core cognitive image of the word — what mental picture it evokes, using the metaphor behind the word,
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

Return as a single JSON object. All Chinese text should use Simplified Chinese.`;

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
        parsed = parseJsonLenient(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to parse deep layer JSON: ${msg}`);
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
  try {
    await geminiSemaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error("GEMINI_BUSY");
    }
    throw err;
  }
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
        parsed = parseJsonLenient(raw);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to parse extracted words JSON: ${msg}`);
      }

      if (!Array.isArray(parsed)) return [];
      return parsed.filter((w): w is string => typeof w === "string");
    });
  } finally {
    geminiSemaphore.release();
  }
}
