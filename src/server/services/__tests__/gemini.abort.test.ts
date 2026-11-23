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
  return { GoogleGenAI: FakeGenAI };
});

import {
  geminiGenerateCards,
  geminiGenerateDeepLayer,
  geminiExtractWords,
} from "../gemini.js";

// The SDK cancels the HTTP request through config.abortSignal; a call that
// omits it keeps running (and billing) after our timeout has given up on it.
describe("every Gemini call can be cancelled by the timeout", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    mockGenerateContent.mockResolvedValue({ text: "{}" });
  });

  it.each([
    ["cards", () => geminiGenerateCards(["word"])],
    ["deep", () => geminiGenerateDeepLayer("word")],
    ["extract", () => geminiExtractWords("some text")],
  ])("%s passes an abort signal to the SDK", async (_name, invoke) => {
    await invoke().catch(() => undefined);
    expect(mockGenerateContent).toHaveBeenCalled();
    const request = mockGenerateContent.mock.calls[0][0] as { config?: { abortSignal?: unknown } };
    expect(request.config?.abortSignal).toBeInstanceOf(AbortSignal);
  });
});
