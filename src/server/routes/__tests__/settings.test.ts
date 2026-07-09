import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

// Avoid touching the real sqlite file in tests.
vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(() => ({ value: "" })),
        })),
        all: vi.fn(() => []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({})),
      })),
    })),
  },
}));

import { settingRoutes } from "../settings.js";

function buildApp() {
  const app = new Hono();
  app.route("/settings", settingRoutes);
  return app;
}

describe("settings /test endpoint", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns VALIDATION_ERROR for malformed body", async () => {
    const app = buildApp();
    const res = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("baseUrl test does not require apiKey (401/403 is treated as reachable)", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: { message: "Missing API key" } }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = mockFetch as any;

    const app = buildApp();
    const res = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "baseUrl",
        baseUrl: "https://relay.example.com",
      }),
    });

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.target).toBe("baseUrl");
    expect(body.request.requestRoot).toBe("https://relay.example.com/v1beta");
    expect(body.result.status).toBe(403);

    // Ensure we didn't send x-goog-api-key on baseUrl test.
    const [, init] = mockFetch.mock.calls[0];
    const headers = (init as any)?.headers ?? {};
    expect(headers["x-goog-api-key"]).toBeUndefined();
  });

  it("apiKey test fails with a clear message when apiKey is missing", async () => {
    const app = buildApp();
    const res = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "apiKey",
        baseUrl: "https://relay.example.com",
        apiKey: "",
      }),
    });

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toMatch(/API Key not configured/i);
  });

  it("generalModel test parses fenced JSON correctly", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "```json\n{\"ok\": true, \"n\": 1}\n```",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = mockFetch as any;

    const app = buildApp();
    const res = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "generalModel",
        baseUrl: "https://relay.example.com",
        apiKey: "test-key",
        model: "gemini-2.5-pro-bs",
      }),
    });

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.model).toBe("gemini-2.5-pro-bs");
    expect(body.result.parsedJson).toEqual({ ok: true, n: 1 });

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/v1beta/models/gemini-2.5-pro-bs:generateContent");
    expect((init as any).headers["x-goog-api-key"]).toBe("test-key");
  });

  it("ttsModel test detects inline audio", async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/pcm",
                      data: "AAA=",
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    globalThis.fetch = mockFetch as any;

    const app = buildApp();
    const res = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: "ttsModel",
        baseUrl: "https://relay.example.com",
        apiKey: "test-key",
        model: "gemini-2.5-flash-preview-tts",
      }),
    });

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.model).toBe("gemini-2.5-flash-preview-tts");
    expect(body.result.audioBase64Length).toBe(4);
  });
});

describe("settings /test endpoint — OpenAI model tests token budget", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const VALID_DEEP_JSON = JSON.stringify({
    schemaAnalysis: {
      coreSchema: "path",
      coreImageText: "branching road",
      metaphoricalExtensions: ["opinions diverge"],
      registerVariation: "formal",
      etymologyChain: ["dis-", "vergere"],
      sceneActivation: ["two roads"],
    },
    familyComparison: [{ word: "diverge", pos: "verb", meaning: "to separate" }],
    boundaryTests: [{ pair: "diverge vs deviate", distinction: "gradual separation" }],
  });

  function openaiChatResponse(content: string, finishReason: string) {
    return new Response(
      JSON.stringify({
        choices: [{ message: { content }, finish_reason: finishReason }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  async function requestModelTest(app: Hono, target: string): Promise<any> {
    const res = await app.request("/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target,
        provider: "openai",
        baseUrl: "https://gw.example.com/v1",
        apiKey: "test-key",
        model: "test-model",
      }),
    });
    return res.json();
  }

  it("deepModel test sends a large enough max_tokens for the deep JSON schema", async () => {
    const mockFetch = vi.fn(async () => openaiChatResponse(VALID_DEEP_JSON, "stop"));
    globalThis.fetch = mockFetch as any;

    const body = await requestModelTest(buildApp(), "deepModel");
    expect(body.ok).toBe(true);

    const [, init] = mockFetch.mock.calls[0] as any[];
    const sent = JSON.parse((init as any).body);
    // Real deep responses run 600+ tokens (verbose/pretty-printing models more);
    // the old global 300 cap truncated them into invalid JSON.
    expect(sent.max_tokens).toBeGreaterThanOrEqual(2000);
  });

  it("deepModel test reports truncation when finish_reason=length instead of Invalid JSON", async () => {
    const truncated = VALID_DEEP_JSON.slice(0, 120); // cut mid-JSON
    const mockFetch = vi.fn(async () => openaiChatResponse(truncated, "length"));
    globalThis.fetch = mockFetch as any;

    const body = await requestModelTest(buildApp(), "deepModel");
    expect(body.ok).toBe(false);
    expect(body.error.message).toMatch(/truncated/i);
    expect(body.error.message).toMatch(/max_tokens/);
    expect(body.error.message).not.toBe("Invalid JSON response");
  });
});

describe("settings PUT — masked-literal write guard", () => {
  async function putSetting(key: string, value: string): Promise<{ status: number; body: any }> {
    const app = buildApp();
    const res = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("rejects saving the GET mask literal to sensitive keys", async () => {
    // The GET handler masks base URLs / API keys as "configured" for anonymous
    // readers; echoing that back through save must not destroy the real value.
    for (const key of ["gemini_base_url", "image_base_url", "gemini_api_key"]) {
      const { status, body } = await putSetting(key, "configured");
      expect(status).toBe(400);
      expect(body.code).toBe("MASKED_LITERAL");
    }
  });

  it("still saves real values and clears to sensitive keys", async () => {
    const real = await putSetting("image_base_url", "https://img.example.com/v1");
    expect(real.status).toBe(200);
    expect(real.body.ok).toBe(true);

    const cleared = await putSetting("image_base_url", "");
    expect(cleared.status).toBe(200);
    expect(cleared.body.ok).toBe(true);
  });

  it("allows 'configured' as a value for non-sensitive keys", async () => {
    const { status, body } = await putSetting("explanation_language", "configured");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
