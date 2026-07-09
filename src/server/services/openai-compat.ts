import {
  aiCardsResponseSchema,
  aiDeepLayerSchema,
  aiChunkResponseSchema,
  practiceBriefSchema,
  practiceFeedbackSchema,
} from "../../shared/validation.js";
import type {
  GroundingSource,
  ChunkGenerateResult,
  StoryArtifact,
  PracticeBrief,
  PracticeFeedback,
} from "../../shared/types.js";
import {
  Semaphore,
  getSetting,
  runWithModelFallback,
  acquireSemaphore,
  type ParsedCard,
} from "./ai-shared.js";
import {
  parseJsonLenient,
  normalizeCardsPayload,
  normalizeChunkResponse,
  normalizeStoryArtifact,
  buildFallbackStoryArtifact,
} from "./ai-normalize.js";
import {
  buildStorySystemPrompt,
  buildPracticeBriefPrompt,
  CARDS_PROMPT,
  DEEP_PROMPT,
  CHUNKS_PROMPT,
  PRACTICE_GRADE_PROMPT,
  getExplanationLanguageInstruction,
} from "./ai-prompts.js";
import type { PreferredVocabItem, PracticeBriefInput, PracticeGradeInput } from "./gemini.js";

// ---------------------------------------------------------------------------
// Semaphores — independent from Gemini, split by route to avoid starvation
// ---------------------------------------------------------------------------

const openaiSemaphore = new Semaphore(3);      // story, cards, utility
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
  preferredVocab: PreferredVocabItem[] = [],
): Promise<{ artifact: StoryArtifact; sources: GroundingSource[] }> {
  await acquireSemaphore(openaiSemaphore);
  try {
    const systemInstruction = buildStorySystemPrompt({
      preferredVocab,
      customPrompt: prompt,
    });

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
                { type: "text", text: "Describe this image following the instructions. Return ONLY the JSON object." },
              ],
            },
          ],
        });

        let artifact: StoryArtifact;
        try {
          const parsed = parseJsonLenient(text);
          const normalized = normalizeStoryArtifact(parsed);
          artifact = (normalized ?? buildFallbackStoryArtifact(text)) as StoryArtifact;
        } catch {
          artifact = buildFallbackStoryArtifact(text) as StoryArtifact;
        }

        // No grounding with OpenAI-compatible providers
        return { artifact, sources: [] };
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
  await acquireSemaphore(openaiDeepSemaphore);
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
    openaiDeepSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// openaiGenerateChunk — chunk analysis (is_chunk + parse fields)
// ---------------------------------------------------------------------------

export async function openaiGenerateChunk(input: string): Promise<ChunkGenerateResult> {
  await acquireSemaphore(openaiSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["chunks_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["chunks_openai_fallback_model"],
      label: "generateChunk (OpenAI)",
      run: async (model) => {
        const text = await openaiChat({
          model,
          messages: [
            {
              role: "system",
              content: `${CHUNKS_PROMPT}\n\nRespond in JSON only. No markdown fences, no explanation — just the JSON object.`,
            },
            {
              role: "user",
              content: `Candidate: ${JSON.stringify(input)}`,
            },
          ],
        });

        let parsed: unknown;
        try {
          parsed = parseJsonLenient(text);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Failed to parse chunk JSON: ${msg}`);
        }

        parsed = normalizeChunkResponse(parsed);

        const result = aiChunkResponseSchema.safeParse(parsed);
        if (!result.success) {
          const issues = result.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw new Error(`Chunk validation failed: ${issues}`);
        }

        return result.data as ChunkGenerateResult;
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

// ---------------------------------------------------------------------------
// Image generation (gpt-image-2 etc.) — may live on a SEPARATE gateway from the
// text endpoint. Setting image_base_url opts in to that gateway; when it is
// blank the FULL openai pair is used and image_api_key is ignored.
// ---------------------------------------------------------------------------

const openaiImageSemaphore = new Semaphore(2);

/** Key must follow URL — an image-gateway key sent to the text gateway 401s
 *  ("Invalid token"), so the key/URL pair resolves together, never crossed. */
export function resolveImageConfig(cfg: {
  imageKey: string;
  imageUrl: string;
  openaiKey: string;
  openaiUrl: string;
}): { apiKey: string; baseUrl: string } {
  if (cfg.imageUrl) {
    return { apiKey: cfg.imageKey || cfg.openaiKey, baseUrl: cfg.imageUrl };
  }
  return { apiKey: cfg.openaiKey, baseUrl: cfg.openaiUrl };
}

async function getImageConfig(): Promise<{ apiKey: string; imagesUrl: string }> {
  const [imageKey, imageUrl, openaiKey, openaiUrl] = await Promise.all([
    getSetting("image_api_key"),
    getSetting("image_base_url"),
    getSetting("openai_api_key"),
    getSetting("openai_base_url"),
  ]);
  const resolved = resolveImageConfig({
    imageKey: imageKey.trim(),
    imageUrl: imageUrl.trim(),
    openaiKey: openaiKey.trim(),
    openaiUrl: openaiUrl.trim(),
  });

  if (!resolved.apiKey)
    throw new Error("Image API Key not configured. Set it in AI Providers (Image Generation).");

  const baseUrl = resolved.baseUrl.replace(/\/+$/, "");
  if (!baseUrl)
    throw new Error("Image Base URL not configured. Set it in AI Providers (Image Generation).");

  // Normalize: if base already ends with /v1, don't double it
  const imagesPath = /\/v1\/?$/i.test(baseUrl) ? "images/generations" : "v1/images/generations";
  return { apiKey: resolved.apiKey, imagesUrl: `${baseUrl}/${imagesPath}` };
}

/** Generate one image and return it as a Buffer (caller compresses + persists). */
export async function openaiGenerateImage(prompt: string): Promise<Buffer> {
  await acquireSemaphore(openaiImageSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["image_model"],
      primaryFallback: "gpt-image-2",
      fallbackKeys: ["image_fallback_model"],
      label: "generateImage (OpenAI)",
      timeoutMultiplier: 3, // image generation is slow (~50s observed)
      run: async (model) => {
        const { apiKey, imagesUrl } = await getImageConfig();
        const res = await fetch(imagesUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          // size is a hint only — some gateways ignore/approximate it; compressImage normalizes output.
          body: JSON.stringify({ model, prompt, size: "1024x1024", quality: "high", n: 1 }),
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

        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new Error("Image API returned non-JSON response");
        }

        const item = (body as { data?: Array<{ b64_json?: string; url?: string }> })?.data?.[0];
        if (item?.b64_json) {
          return Buffer.from(item.b64_json, "base64");
        }
        if (item?.url) {
          const imgRes = await fetch(item.url);
          if (!imgRes.ok) throw new Error(`Failed to fetch image url: HTTP ${imgRes.status}`);
          return Buffer.from(await imgRes.arrayBuffer());
        }
        throw new Error("Image API response missing data[0].b64_json and url");
      },
    });
  } finally {
    openaiImageSemaphore.release();
  }
}

// ---------------------------------------------------------------------------
// Practice brief + grading — text calls that reuse the "story" route's model.
// ---------------------------------------------------------------------------

export async function openaiGeneratePracticeBrief(
  input: PracticeBriefInput,
): Promise<PracticeBrief> {
  await acquireSemaphore(openaiSemaphore);
  try {
    return await runWithModelFallback({
      primaryKeys: ["story_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["story_openai_fallback_model"],
      label: "practiceBrief (OpenAI)",
      timeoutMultiplier: 1.5,
      run: async (model) => {
        const system = buildPracticeBriefPrompt(input);
        const text = await openaiChat({
          model,
          messages: [
            { role: "system", content: `${system}\n\nRespond in JSON only. No markdown fences.` },
            { role: "user", content: "Produce the practice brief JSON now." },
          ],
        });
        const parsed = parseJsonLenient(text);
        const result = practiceBriefSchema.safeParse(parsed);
        if (!result.success) throw new Error("Practice brief validation failed");
        return result.data as PracticeBrief;
      },
    });
  } finally {
    openaiSemaphore.release();
  }
}

export async function openaiGradePractice(input: PracticeGradeInput): Promise<PracticeFeedback> {
  await acquireSemaphore(openaiSemaphore);
  try {
    const languageInstruction = await getExplanationLanguageInstruction();
    return await runWithModelFallback({
      primaryKeys: ["story_openai_model"],
      primaryFallback: "",
      fallbackKeys: ["story_openai_fallback_model"],
      label: "gradePractice (OpenAI)",
      run: async (model) => {
        const text = await openaiChat({
          model,
          messages: [
            {
              role: "system",
              content: `${PRACTICE_GRADE_PROMPT}\n\nLanguage preference: ${languageInstruction}\n\nRespond in JSON only. No markdown fences.`,
            },
            {
              role: "user",
              content: `SCENE: ${input.visualPrompt}\n\nSUGGESTED_EXPRESSIONS: ${JSON.stringify(input.suggestedChunks)}\n\nDESCRIPTION: ${input.description}`,
            },
          ],
        });
        const parsed = parseJsonLenient(text);
        const result = practiceFeedbackSchema.safeParse(parsed);
        if (!result.success) throw new Error("Practice feedback validation failed");
        return result.data as PracticeFeedback;
      },
    });
  } finally {
    openaiSemaphore.release();
  }
}
