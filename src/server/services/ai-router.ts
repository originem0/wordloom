import { getSetting, type ParsedCard } from "./ai-shared.js";
import {
  geminiGenerateCards,
  geminiGenerateDeepLayer,
  geminiExtractWords,
} from "./gemini.js";
import {
  openaiGenerateCards,
  openaiGenerateDeepLayer,
  openaiExtractWords,
} from "./openai-compat.js";

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

type ProviderType = "gemini" | "openai";

async function getProvider(route: string): Promise<ProviderType> {
  const val = (await getSetting(`${route}_provider`)).trim().toLowerCase();
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
