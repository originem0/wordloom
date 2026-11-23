import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(() => ({ value: "fake-api-key" })),
        })),
      })),
    })),
  },
}));

const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => {
  class FakeGenAI {
    models = { generateContent: mockGenerateContent };
  }
  return { GoogleGenAI: FakeGenAI, Modality: { AUDIO: "AUDIO" } };
});

import {
  geminiGenerateStory,
  generateTTS,
  geminiTranslateText,
  geminiGenerateCards,
  geminiGenerateDeepLayer,
  geminiGenerateChunk,
  geminiExtractWords,
  geminiGeneratePracticeBrief,
  geminiGradePractice,
} from "../gemini.js";

// The SDK cancels the HTTP request through config.abortSignal; a call that
// omits it keeps running (and billing) after our timeout has given up on it.
describe("every Gemini call can be cancelled by the timeout", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue({ text: "{}" });
  });

  const img = Buffer.from("img");
  it.each([
    ["story", () => geminiGenerateStory(img, "image/jpeg", "")],
    ["tts", () => generateTTS("hello")],
    ["translate", () => geminiTranslateText("text")],
    ["cards", () => geminiGenerateCards(["word"])],
    ["deep", () => geminiGenerateDeepLayer("word")],
    ["chunk", () => geminiGenerateChunk("in terms of")],
    ["extract", () => geminiExtractWords("some text")],
    ["practice brief", () => geminiGeneratePracticeBrief({ topic: "", chunkCandidates: [], currentDate: "2026-01-01" })],
    ["practice grade", () => geminiGradePractice({ visualPrompt: "v", suggestedChunks: [], description: "d" })],
  ])("%s passes an abort signal to the SDK", async (_name, invoke) => {
    await invoke().catch(() => undefined);
    expect(mockGenerateContent).toHaveBeenCalled();
    const request = mockGenerateContent.mock.calls[0][0] as { config?: { abortSignal?: unknown } };
    expect(request.config?.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
