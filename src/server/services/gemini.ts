import { GoogleGenAI, Modality } from "@google/genai";
import {
  aiCardsResponseSchema,
  aiDeepLayerSchema,
} from "../../shared/validation.js";
import type { GroundingSource } from "../../shared/types.js";
import {
  Semaphore,
  getSetting,
  runWithModelFallback,
  acquireSemaphore,
  type ParsedCard,
} from "./ai-shared.js";
import { parseJsonLenient, normalizeCardsPayload } from "./ai-normalize.js";
import {
  STORY_SYSTEM_PROMPT,
  CARDS_PROMPT,
  DEEP_PROMPT,
  getExplanationLanguageInstruction,
} from "./ai-prompts.js";

// ---------------------------------------------------------------------------
// Semaphore — limits concurrent Gemini API calls
// ---------------------------------------------------------------------------

const geminiSemaphore = new Semaphore(3);

// ---------------------------------------------------------------------------
// Gemini client
// ---------------------------------------------------------------------------

async function getClient(): Promise<GoogleGenAI> {
  const apiKey = await getSetting("gemini_api_key");
  if (!apiKey)
    throw new Error("Gemini API Key not configured. Set it in AI Providers.");
  const baseUrl = await getSetting("gemini_base_url");
  return new GoogleGenAI({
    apiKey,
    ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
  });
}

// ---------------------------------------------------------------------------
// geminiGenerateStory
// ---------------------------------------------------------------------------

export async function geminiGenerateStory(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
): Promise<{ story: string; sources: GroundingSource[] }> {
  await acquireSemaphore(geminiSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["story_model"],
      primaryFallback: "gemini-2.5-pro",
      fallbackKeys: ["story_fallback_model"],
      label: "generateStory",
      timeoutMultiplier: 1.5,
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
// generateTTS — Gemini native TTS, returns base64 PCM (always Gemini, not routed)
// ---------------------------------------------------------------------------

export async function generateTTS(text: string): Promise<string> {
  await acquireSemaphore(geminiSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["gemini_tts_model", "tts_model"],
      primaryFallback: "gemini-2.5-flash-preview-tts",
      fallbackKeys: ["gemini_tts_fallback_model", "tts_fallback_model"],
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
// geminiTranslateText
// ---------------------------------------------------------------------------

export async function geminiTranslateText(text: string): Promise<string> {
  await acquireSemaphore(geminiSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["utility_model", "general_model"],
      primaryFallback: "gemini-2.5-flash",
      fallbackKeys: ["utility_fallback_model", "general_fallback_model"],
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
// geminiGenerateCards — surface + middle layers
// ---------------------------------------------------------------------------

export async function geminiGenerateCards(
  words: string[],
): Promise<{ success: ParsedCard[]; failed: { word: string; error: string }[] }> {
  await acquireSemaphore(geminiSemaphore);
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKeys: ["cards_model", "general_model"],
      primaryFallback: "gemini-2.5-flash",
      fallbackKeys: ["cards_fallback_model", "general_fallback_model"],
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
            failed.push({ word, error: "Validation failed" });
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
// geminiGenerateDeepLayer
// ---------------------------------------------------------------------------

export async function geminiGenerateDeepLayer(
  word: string,
): Promise<{
  familyComparison: unknown[];
  familyBoundaryNote?: string;
  schemaAnalysis?: unknown;
  boundaryTests: unknown[];
}> {
  await acquireSemaphore(geminiSemaphore);
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKeys: ["deep_model", "general_model"],
      primaryFallback: "gemini-2.5-flash",
      fallbackKeys: ["deep_fallback_model", "general_fallback_model"],
      label: "generateDeepLayer",
      timeoutMultiplier: 2,
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
// geminiExtractWords
// ---------------------------------------------------------------------------

export async function geminiExtractWords(text: string): Promise<string[]> {
  await acquireSemaphore(geminiSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["utility_model", "general_model"],
      primaryFallback: "gemini-2.5-flash",
      fallbackKeys: ["utility_fallback_model", "general_fallback_model"],
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
