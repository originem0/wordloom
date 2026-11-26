import { GoogleGenAI } from "@google/genai";
import { aiCardsResponseSchema, aiDeepLayerSchema } from "../../shared/validation.js";
import {
  Semaphore,
  getSetting,
  runWithModelFallback,
  runJsonCall,
  runTextCall,
  acquireSemaphore,
  type JsonCall,
  type StreamCall,
  type ParsedCard,
} from "./ai-shared.js";
import { parseJsonLenient, normalizeCardsPayload, withCoreSchema } from "./ai-normalize.js";
import {
  CARDS_PROMPT,
  DEEP_PROMPT,
  getExplanationLanguageInstruction,
} from "./ai-prompts.js";

// ---------------------------------------------------------------------------
// Semaphores — limits concurrent Gemini API calls
// ---------------------------------------------------------------------------

const geminiSemaphore = new Semaphore(3);       // cards, utility
const geminiDeepSemaphore = new Semaphore(2);   // deep analysis only

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
      run: async (model, signal) => {
        const ai = await getClient();
        const response = await ai.models.generateContent({
          model,
          contents: `${CARDS_PROMPT}\n\nLanguage preference: ${languageInstruction}\n\nWords to analyze: ${JSON.stringify(words)}`,
          config: {
            abortSignal: signal,
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
  familyAxes?: string;
  familyChoiceRule?: string;
  schemaAnalysis?: unknown;
  boundaryTests: unknown[];
}> {
  await acquireSemaphore(geminiDeepSemaphore);
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKeys: ["deep_model", "general_model"],
      primaryFallback: "gemini-2.5-flash",
      fallbackKeys: ["deep_fallback_model", "general_fallback_model"],
      label: "generateDeepLayer",
      timeoutMultiplier: 2,
      run: async (model, signal) => {
        const ai = await getClient();
        const response = await ai.models.generateContent({
          model,
          contents: `${DEEP_PROMPT}\n\nLanguage preference: ${languageInstruction}\n\nWord: "${word}"`,
          config: {
            abortSignal: signal,
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

        return withCoreSchema(result.data);
      },
    });
  } finally {
    geminiDeepSemaphore.release();
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
      run: async (model, signal) => {
        const ai = await getClient();
        const response = await ai.models.generateContent({
          model,
          contents: `Extract English words worth studying from the following text. Exclude common/simple words (the, is, a, it, etc.). Focus on vocabulary useful for intermediate-to-advanced English learners.

Return a JSON array of strings (just the words).

Text:
${text}`,
          config: {
            abortSignal: signal,
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

// ---------------------------------------------------------------------------
// geminiJson — one attempt; the task that asked validates the answer
// ---------------------------------------------------------------------------

export async function geminiJson(opts: JsonCall): Promise<unknown> {
  return runJsonCall({
    semaphore: geminiSemaphore,
    modelKeys: [`${opts.route}_model`, "cards_model", "general_model"],
    defaultModel: "gemini-2.5-flash",
    label: opts.label,
    signal: opts.signal,
    retryFast: opts.retryFast,
    run: async (model, signal) => {
      const ai = await getClient();
      const response = await ai.models.generateContent({
        model,
        contents: opts.user,
        config: { abortSignal: signal, responseMimeType: "application/json", systemInstruction: opts.system },
      });
      return response.text ?? "";
    },
  });
}

export async function geminiTextStream(opts: StreamCall): Promise<string> {
  let received = false;
  return runTextCall({
    semaphore: geminiSemaphore,
    modelKeys: [`${opts.route}_model`, "cards_model", "general_model"],
    defaultModel: "gemini-2.5-flash",
    label: opts.label,
    signal: opts.signal,
    retryFast: opts.retryFast,
    canRetry: () => !received,
    run: async (model, signal) => {
      const ai = await getClient();
      const stream = await ai.models.generateContentStream({ model, contents: opts.user, config: { abortSignal: signal, systemInstruction: opts.system } });
      let text = "";
      for await (const part of stream) {
        signal.throwIfAborted();
        const reason = String(part.candidates?.[0]?.finishReason ?? "");
        if (reason && reason !== "STOP" && reason !== "FINISH_REASON_UNSPECIFIED") throw new Error("Incomplete reply");
        if (!part.text) continue;
        received = true;
        text += part.text;
        if (text.length > 8000) throw new Error("Reply too long");
        await opts.onDelta(part.text);
      }
      if (!text.trim()) throw new Error("Missing reply");
      return text;
    },
  });
}
