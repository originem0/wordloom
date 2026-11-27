import { describe, it, expect, vi, beforeEach } from "vitest";

import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
beforeEach(async () => {
  await db.delete(settings);
  await db.insert(settings).values({ key: "gemini_api_key", value: "fake-api-key" });
});

const mockGenerateContent = vi.fn();
vi.mock("../gemini-transport.js", async (original) => ({
  ...await original<typeof import("../gemini-transport.js")>(),
  geminiTransport: () => ({ generateContent: mockGenerateContent }),
}));

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
