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
// Semaphore — independent from Gemini
// ---------------------------------------------------------------------------

const openaiSemaphore = new Semaphore(3);

// ---------------------------------------------------------------------------
// Core HTTP helper
// ---------------------------------------------------------------------------

async function getOpenaiConfig(): Promise<{ apiKey: string; chatUrl: string }> {
  const apiKey = (await getSetting("openai_api_key")).trim();
  if (!apiKey)
    throw new Error("OpenAI-compatible API Key not configured. Set it in AI Providers.");

  let baseUrl = (await getSetting("openai_base_url")).trim().replace(/\/+$/, "");
  if (!baseUrl)
    throw new Error("OpenAI-compatible Base URL not configured. Set it in AI Providers.");

  // Normalize: if base already ends with /v1, don't double it
  const chatPath = /\/v1\/?$/i.test(baseUrl) ? "chat/completions" : "v1/chat/completions";
  const chatUrl = `${baseUrl}/${chatPath}`;

  return { apiKey, chatUrl };
}

type MessageContent = string | Array<{ type: string; [k: string]: unknown }>;

async function openaiChat(opts: {
  model: string;
  messages: Array<{ role: string; content: MessageContent }>;
}): Promise<string> {
  const { apiKey, chatUrl } = await getOpenaiConfig();

  const res = await fetch(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text);
      if (body?.error?.message) errMsg = body.error.message;
    } catch {
      if (text.length < 300) errMsg += `: ${text}`;
    }
    throw new Error(errMsg);
  }

  const body = JSON.parse(text);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("OpenAI response missing choices[0].message.content");
  }
  return content;
}

// ---------------------------------------------------------------------------
// openaiGenerateStory
// ---------------------------------------------------------------------------

export async function openaiGenerateStory(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
): Promise<{ story: string; sources: GroundingSource[] }> {
  await acquireSemaphore(openaiSemaphore);
  try {
    let systemInstruction = STORY_SYSTEM_PROMPT;
    if (prompt) {
      systemInstruction += `\n\n**User's Custom Requirements (PRIORITY):**\n${prompt}`;
    }

    return await runWithModelFallback({
      primaryKeys: ["story_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["story_openai_fallback_model"],
      label: "generateStory (OpenAI)",
      timeoutMultiplier: 1.5,
      run: async (model) => {
        const base64 = imageBuffer.toString("base64");
        const dataUri = `data:${mimeType};base64,${base64}`;

        const text = await openaiChat({
          model,
          messages: [
            { role: "system", content: systemInstruction },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: dataUri } },
                { type: "text", text: "Describe this image following the instructions." },
              ],
            },
          ],
        });

        // No grounding with OpenAI-compatible providers
        return { story: text, sources: [] };
      },
    });
  } finally {
    openaiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// openaiTranslateText
// ---------------------------------------------------------------------------

export async function openaiTranslateText(text: string): Promise<string> {
  await acquireSemaphore(openaiSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["utility_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["utility_openai_fallback_model"],
      label: "translateText (OpenAI)",
      run: async (model) => {
        return await openaiChat({
          model,
          messages: [
            {
              role: "user",
              content: `Translate the following text to Simplified Chinese. Keep the markdown formatting intact. Only return the translated text, nothing else.\n\n${text}`,
            },
          ],
        });
      },
    });
  } finally {
    openaiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// openaiGenerateCards
// ---------------------------------------------------------------------------

export async function openaiGenerateCards(
  words: string[],
): Promise<{ success: ParsedCard[]; failed: { word: string; error: string }[] }> {
  await acquireSemaphore(openaiSemaphore);
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKeys: ["cards_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["cards_openai_fallback_model"],
      label: "generateCards (OpenAI)",
      run: async (model) => {
        const text = await openaiChat({
          model,
          messages: [
            {
              role: "system",
              content: `${CARDS_PROMPT}\n\nLanguage preference: ${languageInstruction}\n\nRespond in JSON only. No markdown fences, no explanation — just the JSON array.`,
            },
            {
              role: "user",
              content: `Words to analyze: ${JSON.stringify(words)}`,
            },
          ],
        });

        let parsed: unknown;
        try {
          parsed = parseJsonLenient(text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Failed to parse OpenAI JSON response: ${msg}`);
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
    openaiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// openaiGenerateDeepLayer
// ---------------------------------------------------------------------------

export async function openaiGenerateDeepLayer(
  word: string,
): Promise<{
  familyComparison: unknown[];
  familyBoundaryNote?: string;
  schemaAnalysis?: unknown;
  boundaryTests: unknown[];
}> {
  await acquireSemaphore(openaiSemaphore);
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKeys: ["deep_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["deep_openai_fallback_model"],
      label: "generateDeepLayer (OpenAI)",
      timeoutMultiplier: 2,
      run: async (model) => {
        const text = await openaiChat({
          model,
          messages: [
            {
              role: "system",
              content: `${DEEP_PROMPT}\n\nLanguage preference: ${languageInstruction}\n\nRespond in JSON only. No markdown fences, no explanation — just the JSON object.`,
            },
            {
              role: "user",
              content: `Word: "${word}"`,
            },
          ],
        });

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
          if (["scale", "weigh", "weighing", "tradeoff", "trade-off", "equilibrium"].includes(v)) return "balance";
          if (["force", "pressure", "push", "pull"].includes(v)) return "blockage";
          if (["cycle", "loop", "repeat", "repetition"].includes(v)) return "path";
          if (v.includes("contain") || v.includes("inside") || v.includes("outside") || v.includes("boundary") || v === "box") return "container";
          if (v.includes("journey") || v.includes("route") || v.includes("progress") || v.includes("path")) return "path";
          if (v.includes("connect") || v.includes("relation") || v.includes("association") || v.includes("link")) return "link";
          if (v.includes("balance") || v.includes("equilib") || v.includes("weigh")) return "balance";
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
    openaiSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// openaiExtractWords
// ---------------------------------------------------------------------------

export async function openaiExtractWords(text: string): Promise<string[]> {
  await acquireSemaphore(openaiSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["utility_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["utility_openai_fallback_model"],
      label: "extractWords (OpenAI)",
      run: async (model) => {
        const raw = await openaiChat({
          model,
          messages: [
            {
              role: "user",
              content: `Extract English words worth studying from the following text. Exclude common/simple words (the, is, a, it, etc.). Focus on vocabulary useful for intermediate-to-advanced English learners.

Return a JSON array of strings (just the words). No explanation, just the JSON array.

Text:
${text}`,
            },
          ],
        });

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
    openaiSemaphore.release();
  }
}
