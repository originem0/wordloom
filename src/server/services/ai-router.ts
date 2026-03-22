import type { GroundingSource } from "../../shared/types.js";
import { getSetting, type ParsedCard } from "./ai-shared.js";
import {
  geminiGenerateStory,
  geminiGenerateCards,
  geminiGenerateDeepLayer,
  geminiExtractWords,
  geminiTranslateText,
  generateTTS,
} from "./gemini.js";
import {
  openaiGenerateStory,
  openaiGenerateCards,
  openaiGenerateDeepLayer,
  openaiExtractWords,
  openaiTranslateText,
} from "./openai-compat.js";

// Re-export TTS — always Gemini, not routed
export { generateTTS };

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

export async function generateStory(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
): Promise<{ story: string; sources: GroundingSource[] }> {
  const provider = await getProvider("story");
  if (provider === "openai") {
    return openaiGenerateStory(imageBuffer, mimeType, prompt);
  }
  return geminiGenerateStory(imageBuffer, mimeType, prompt);
}

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

export async function translateText(text: string): Promise<string> {
  const provider = await getProvider("utility");
  if (provider === "openai") {
    return openaiTranslateText(text);
  }
  return geminiTranslateText(text);
}
