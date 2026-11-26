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
import { readSSE } from "../../shared/sse.js";

// ---------------------------------------------------------------------------
// Semaphores — independent from Gemini, split by route to avoid starvation
// ---------------------------------------------------------------------------

const openaiSemaphore = new Semaphore(3);      // cards, utility
const openaiDeepSemaphore = new Semaphore(2);   // deep analysis only

// ---------------------------------------------------------------------------
// Core HTTP helper
// ---------------------------------------------------------------------------

async function getOpenaiConfig(): Promise<{ apiKey: string; chatUrl: string }> {
  const apiKey = (await getSetting("openai_api_key")).trim();
  if (!apiKey)
    throw new Error("OpenAI-compatible API Key not configured. Set it in AI Providers.");

  const baseUrl = (await getSetting("openai_base_url")).trim().replace(/\/+$/, "");
  if (!baseUrl)
    throw new Error("OpenAI-compatible Base URL not configured. Set it in AI Providers.");

  // Normalize: if base already ends with /v1, don't double it
  const chatPath = /\/v1\/?$/i.test(baseUrl) ? "chat/completions" : "v1/chat/completions";
  const chatUrl = `${baseUrl}/${chatPath}`;

  return { apiKey, chatUrl };
}

async function openaiChat(opts: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  /** Required on purpose: a call site that forgets it cannot be cancelled. */
  signal: AbortSignal;
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
    signal: opts.signal,
  });

  const text = await res.text();
  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text);
      const code = [body?.error?.code, body?.error?.type].filter((s) => typeof s === "string").join(" ");
      if (/quota|billing|exceeded|insufficient/i.test(code)) errMsg = `Quota exhausted (HTTP ${res.status})`;
      else if (/auth|invalid.api.key/i.test(code)) errMsg = `Unauthorized (HTTP ${res.status})`;
      else if (body?.error?.message) errMsg = body.error.message;
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
      run: async (model, signal) => {
        const text = await openaiChat({
          signal,
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
  familyAxes?: string;
  familyChoiceRule?: string;
  schemaAnalysis?: unknown;
  boundaryTests: unknown[];
}> {
  await acquireSemaphore(openaiDeepSemaphore);
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKeys: ["deep_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["deep_openai_fallback_model"],
      label: "generateDeepLayer (OpenAI)",
      timeoutMultiplier: 2,
      run: async (model, signal) => {
        const text = await openaiChat({
          signal,
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

        return withCoreSchema(result.data);
      },
    });
  } finally {
    openaiDeepSemaphore.release();
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
      run: async (model, signal) => {
        const raw = await openaiChat({
          signal,
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

// ---------------------------------------------------------------------------
// openaiJson — one attempt; the task that asked validates the answer
// ---------------------------------------------------------------------------

export async function openaiJson(opts: JsonCall): Promise<unknown> {
  return runJsonCall({
    semaphore: openaiSemaphore,
    modelKeys: [`${opts.route}_openai_model`, "cards_openai_model"],
    defaultModel: "",
    label: `${opts.label} (OpenAI)`,
    signal: opts.signal,
    retryFast: opts.retryFast,
    run: (model, signal) =>
      openaiChat({
        signal,
        model,
        messages: [
          {
            role: "system",
            content: `${opts.system}\n\nRespond in JSON only. No markdown fences, no explanation — just the JSON object.`,
          },
          { role: "user", content: opts.user },
        ],
      }),
  });
}

/** Uses the same provider, model and slot as the JSON path, without buffering
 *  a whole reply. Once a delta has arrived a retry would repeat visible words. */
export async function openaiTextStream(opts: StreamCall): Promise<string> {
  let received = false;
  return runTextCall({
    semaphore: openaiSemaphore,
    modelKeys: [`${opts.route}_openai_model`, "cards_openai_model"],
    defaultModel: "",
    label: `${opts.label} (OpenAI)`,
    signal: opts.signal,
    retryFast: opts.retryFast,
    canRetry: () => !received,
    run: async (model, signal) => {
      const { apiKey, chatUrl } = await getOpenaiConfig();
      const res = await fetch(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }] }),
        signal,
      });
      if (!res.ok) {
        // Preserve only a fixed error class. A quota 429 is not transient,
        // and an upstream message may quote the learner's private words.
        const body = await res.json().catch(() => null) as { error?: { code?: unknown; type?: unknown } } | null;
        const code = [body?.error?.code, body?.error?.type].filter((s) => typeof s === "string").join(" ");
        if (/quota|billing|exceeded|insufficient/i.test(code)) throw new Error(`Quota exhausted (HTTP ${res.status})`);
        if (/auth|invalid.api.key/i.test(code)) throw new Error(`Unauthorized (HTTP ${res.status})`);
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.body) throw new Error("Missing response stream");
      let text = "";
      let finished = false;
      // Some compatible gateways ignore stream:true and return the normal
      // envelope. It is still the same call and model, just one complete delta.
      if (res.headers.get("content-type")?.includes("application/json")) {
        const body = await res.json() as { choices?: { message?: { content?: string } }[] };
        const content = body.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new Error("Missing reply");
        if (content.length > 8000) throw new Error("Reply too long");
        received = true;
        await opts.onDelta(content);
        return content;
      }
      for await (const frame of readSSE(res.body)) {
        signal.throwIfAborted();
        if (frame.data === "[DONE]") { finished = true; break; }
        const packet = JSON.parse(frame.data) as { error?: unknown; choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[] };
        if (packet.error) throw new Error("Provider stream failed");
        const choice = packet.choices?.[0];
        if (choice?.finish_reason === "length" || choice?.finish_reason === "content_filter") throw new Error("Incomplete reply");
        if (choice?.finish_reason) finished = true;
        const delta = choice?.delta?.content;
        if (typeof delta !== "string" || !delta) continue;
        received = true;
        text += delta;
        if (text.length > 8000) throw new Error("Reply too long");
        await opts.onDelta(delta);
      }
      if (!finished || !text.trim()) throw new Error("Reply stream ended early");
      return text;
    },
  });
}
