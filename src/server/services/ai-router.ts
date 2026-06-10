import type {
  GroundingSource,
  ChunkGenerateResult,
  StoryArtifact,
} from "../../shared/types.js";
import { getSetting, type ParsedCard } from "./ai-shared.js";
import {
  geminiGenerateStory,
  geminiGenerateCards,
  geminiGenerateDeepLayer,
  geminiGenerateChunk,
  geminiExtractWords,
  geminiTranslateText,
  generateTTS,
  type PreferredVocabItem,
} from "./gemini.js";
import {
  openaiGenerateStory,
  openaiGenerateCards,
  openaiGenerateDeepLayer,
  openaiGenerateChunk,
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
  preferredVocab: PreferredVocabItem[] = [],
): Promise<{ artifact: StoryArtifact; sources: GroundingSource[] }> {
  const provider = await getProvider("story");
  if (provider === "openai") {
    return openaiGenerateStory(imageBuffer, mimeType, prompt, preferredVocab);
  }
  return geminiGenerateStory(imageBuffer, mimeType, prompt, preferredVocab);
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

export async function generateChunk(input: string): Promise<ChunkGenerateResult> {
  const provider = await getProvider("chunks");
  if (provider === "openai") {
    return openaiGenerateChunk(input);
  }
  return geminiGenerateChunk(input);
}

export async function translateText(text: string): Promise<string> {
  const provider = await getProvider("utility");
  if (provider === "openai") {
    return openaiTranslateText(text);
  }
  return geminiTranslateText(text);
}
