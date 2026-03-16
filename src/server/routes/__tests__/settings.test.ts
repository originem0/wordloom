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
