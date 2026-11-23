import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";

// Characterization tests: they pin what POST /settings/test answers for the
// branches that read untyped upstream JSON, so the handler can be moved and
// re-typed without changing what the AI Providers page sees.
vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ get: vi.fn(() => ({ value: "" })) })),
        all: vi.fn(() => []),
      })),
    })),
  },
}));

import { settingRoutes } from "../settings.js";

type TestResult = {
  ok: boolean;
  model?: string;
  error?: { message: string };
  result?: Record<string, unknown>;
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function upstream(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

async function run(payload: Record<string, unknown>): Promise<TestResult> {
  const app = new Hono();
  app.route("/settings", settingRoutes);
  const res = await app.request("/settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as TestResult;
}

const gemini = { baseUrl: "https://relay.example.com", apiKey: "k" };
const openai = { provider: "openai", baseUrl: "https://gw.example.com/v1", apiKey: "k", model: "m" };
const geminiText = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });
const chat = (content: unknown, finish = "stop") => ({ choices: [{ message: { content }, finish_reason: finish }] });

describe("Gemini listModels", () => {
  it("returns the model names, skipping entries without a string name", async () => {
    upstream({ models: [{ name: "models/a" }, { name: 42 }, {}, { name: "models/b" }] });
    const body = await run({ target: "listModels", ...gemini });
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ modelCount: 2, models: ["models/a", "models/b"], totalListed: 2 });
  });

  it("reports zero models when the payload has no models array", async () => {
    upstream({ models: "nope" });
    const body = await run({ target: "listModels", ...gemini });
    expect(body.result).toMatchObject({ modelCount: 0, models: [] });
  });

  it("surfaces the upstream error message on failure", async () => {
    upstream({ error: { message: "API key not valid", code: 400 } }, 400);
    const body = await run({ target: "listModels", ...gemini });
    expect(body.ok).toBe(false);
    expect(body.error?.message).toContain("API key not valid");
  });
});

describe("Gemini model probes", () => {
  it("utilityModel passes on a text reply", async () => {
    upstream(geminiText("pong"));
    expect((await run({ target: "utilityModel", ...gemini, model: "g" })).ok).toBe(true);
  });

  it("deepModel passes on a complete deep structure", async () => {
    upstream(geminiText('{"schemaAnalysis":{"coreSchema":"path"},"familyComparison":[],"boundaryTests":[]}'));
    expect((await run({ target: "deepModel", ...gemini, model: "g" })).ok).toBe(true);
  });

  it("deepModel fails on an incomplete structure and on a JSON null", async () => {
    upstream(geminiText('{"schemaAnalysis":{"coreSchema":"path"}}'));
    expect((await run({ target: "deepModel", ...gemini, model: "g" })).ok).toBe(false);
    upstream(geminiText("null"));
    expect((await run({ target: "deepModel", ...gemini, model: "g" })).ok).toBe(false);
  });

  it("ttsModel fails with a clear message when no audio comes back", async () => {
    upstream(geminiText("I cannot speak"));
    const body = await run({ target: "ttsModel", ...gemini, model: "tts" });
    expect(body.ok).toBe(false);
    expect(body.error?.message).toMatch(/No audio returned/);
  });

  it("ttsModel reports the audio mime type", async () => {
    upstream({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/pcm", data: "AAAA" } }] } }] });
    const body = await run({ target: "ttsModel", ...gemini, model: "tts" });
    expect(body.result).toMatchObject({ mimeType: "audio/pcm" });
  });
});

describe("OpenAI-compatible probes", () => {
  it("openaiListModels returns ids, skipping entries without a string id", async () => {
    upstream({ data: [{ id: "gpt-a" }, { id: null }, {}, { id: "gpt-b" }] });
    const body = await run({ target: "openaiListModels", baseUrl: openai.baseUrl, apiKey: "k" });
    expect(body.ok).toBe(true);
    expect(body.result).toMatchObject({ modelCount: 2, models: ["gpt-a", "gpt-b"], totalListed: 2 });
  });

  it("openaiListModels surfaces the upstream error message", async () => {
    upstream({ error: { message: "Invalid token" } }, 401);
    const body = await run({ target: "openaiListModels", baseUrl: openai.baseUrl, apiKey: "k" });
    expect(body.ok).toBe(false);
    expect(body.error?.message).toBe("Invalid token");
  });

  it("openaiListModels falls back to the HTTP status when the error body has no message", async () => {
    upstream({ nope: true }, 502);
    const body = await run({ target: "openaiListModels", baseUrl: openai.baseUrl, apiKey: "k" });
    expect(body.error?.message).toMatch(/^HTTP 502/);
  });

  it("a model probe echoes a sample of the reply", async () => {
    upstream(chat("pong from the model"));
    const body = await run({ target: "utilityModel", ...openai });
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ sample: "pong from the model" });
  });

  it("a model probe reports an empty reply", async () => {
    upstream(chat(""));
    expect((await run({ target: "utilityModel", ...openai })).error?.message).toBe("Empty response");
    upstream({ choices: [] });
    expect((await run({ target: "utilityModel", ...openai })).error?.message).toBe("Empty response");
  });

  it("a model probe surfaces the upstream error message", async () => {
    upstream({ error: { message: "model not found" } }, 404);
    expect((await run({ target: "utilityModel", ...openai })).error?.message).toBe("model not found");
  });

  it("a model probe falls back to the HTTP status when the error body has no message", async () => {
    upstream({}, 503);
    expect((await run({ target: "utilityModel", ...openai })).error?.message).toMatch(/^HTTP 503/);
  });
});
