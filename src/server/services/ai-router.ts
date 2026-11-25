import { getFirstSetting, type JsonCall, type StreamCall, type ParsedCard } from "./ai-shared.js";
import {
  geminiGenerateCards,
  geminiGenerateDeepLayer,
  geminiExtractWords,
  geminiJson,
  geminiTextStream,
} from "./gemini.js";
import {
  openaiGenerateCards,
  openaiGenerateDeepLayer,
  openaiExtractWords,
  openaiJson,
  openaiTextStream,
} from "./openai-compat.js";

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

type ProviderType = "gemini" | "openai";

/** `borrow` names a route whose provider is used while this one has none. */
async function getProvider(route: string, borrow?: string): Promise<ProviderType> {
  const keys = [`${route}_provider`, ...(borrow ? [`${borrow}_provider`] : [])];
  const val = (await getFirstSetting(keys)).toLowerCase();
  return val === "openai" ? "openai" : "gemini";
}

// ---------------------------------------------------------------------------
// Routed exports — same signatures as the old gemini.ts exports
// ---------------------------------------------------------------------------

export async function generateCards(
  words: string[],
): Promise<{ success: ParsedCard[]; failed: { word: string; error: string }[] }> {
  const provider = await getProvider("cards");
  if (provider === "openai") {
    return openaiGenerateCards(words);
  }
  return geminiGenerateCards(words);
}

export async function generateDeepLayer(
  word: string,
): Promise<{
  familyComparison: unknown[];
  familyBoundaryNote?: string;
  schemaAnalysis?: unknown;
  boundaryTests: unknown[];
}> {
  const provider = await getProvider("deep");
  if (provider === "openai") {
    return openaiGenerateDeepLayer(word);
  }
  return geminiGenerateDeepLayer(word);
}

export async function extractWords(text: string): Promise<string[]> {
  const provider = await getProvider("utility");
  if (provider === "openai") {
    return openaiExtractWords(text);
  }
  return geminiExtractWords(text);
}

/**
 * One attempt for a task that brings its own prompt and validates the answer.
 * A route with no settings of its own runs on the cards route's.
 */
export async function generateJson(route: string, opts: Omit<JsonCall, "route">): Promise<unknown> {
  const provider = await getProvider(route, "cards");
  return provider === "openai" ? openaiJson({ route, ...opts }) : geminiJson({ route, ...opts });
}

export async function generateTextStream(route: string, opts: Omit<StreamCall, "route">): Promise<string> {
  const provider = await getProvider(route, "cards");
  return provider === "openai" ? openaiTextStream({ route, ...opts }) : geminiTextStream({ route, ...opts });
}
