import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { updateSettingsSchema } from "../../shared/validation.js";

export const settingRoutes = new Hono();

const GEMINI_API_VERSION = "v1beta";

async function getSetting(key: string): Promise<string> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? "";
}

function buildRequestRoot(baseUrlRaw: string): { requestRoot: string; warnings: string[] } {
  const warnings: string[] = [];
  const trimmed = baseUrlRaw.trim();

  const base = trimmed || "https://generativelanguage.googleapis.com";

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(
      `Invalid Base URL: "${baseUrlRaw}" (expected something like https://x666.me or leave empty)`
    );
  }

  // Mirror @google/genai behavior: baseUrl + /{apiVersion}
  const normalizedBase = url.toString().replace(/\/+$/, "");
  if (/\/v1(beta)?\/?$/i.test(normalizedBase)) {
    warnings.push(
      `Base URL already ends with /v1 or /v1beta. In WordLoom, Base URL should NOT include the version (otherwise it becomes /v1beta/v1beta).`
    );
  }

  return {
    requestRoot: `${normalizedBase}/${GEMINI_API_VERSION}`,
    warnings,
  };
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const { timeoutMs = 20000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function extractGeminiText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
}

function extractUpstreamError(payload: any): { message?: string; code?: unknown; type?: unknown } {
  const err = payload?.error;
  if (!err || typeof err !== "object") return {};
  return {
    message: typeof err.message === "string" ? err.message : undefined,
    code: err.code,
    type: err.type,
  };
}

function extractJsonCandidate(raw: string): string {
  const text = raw.trim();
  if (!text) return text;

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const firstObj = text.indexOf("{");
  const lastObj = text.lastIndexOf("}");
  const firstArr = text.indexOf("[");
  const lastArr = text.lastIndexOf("]");

  const candidates: string[] = [];
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    candidates.push(text.slice(firstArr, lastArr + 1));
  }
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    candidates.push(text.slice(firstObj, lastObj + 1));
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].trim();
  }

  return text;
}

function buildHint(msg: string, warnings: string[], target: string): string | undefined {
  const m = msg.toLowerCase();
  if (warnings.length) return warnings[0];
  if (m.includes("no active api keys")) return "Upstream reports no active keys for this model group (provider-side issue).";
  if (m.includes("distributor") || msg.includes("无可用渠道")) return "This relay has no available channel/distributor for that model.";
  if (m.includes("only supports text")) return "This model does not support AUDIO output. Pick a TTS-capable model or switch TTS Preference to Browser.";
  if (m.includes("invalid base url") || m.includes("failed to fetch") || m.includes("econn") || m.includes("timeout")) return "Base URL may be unreachable, blocked, or misconfigured.";
  if (target === "generalModel" && (m.includes("parse") || m.includes("json"))) return "This model did not return valid JSON for responseMimeType=application/json.";
  return undefined;
}

const SAMPLE_IMAGE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAYklEQVR4nO3PwREAIAzDMMr+O8MUPX+kAZLzvLNrlg/u7vw+ATUBNQE1ATUBNQE1ATUBNQE1ATUBNQE1ATUBNQE1ATUBNQE1ATUBNQE1ATUBNQE1ATUBNQE1ATUBNQE1AbUPM1YCf8DaY+oAAAAASUVORK5CYII=";

const settingTestSchema = z
  .object({
    target: z.enum([
      "apiKey",
      "baseUrl",
      "listModels",
      "storyModel",
      "generalModel",
      "ttsModel",
    ]),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
  })
  .strict();

// GET / — read all settings (mask API key)
settingRoutes.get("/", async (c) => {
  const rows = await db.select().from(settings).all();

  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === "gemini_api_key") {
      result[row.key] = row.value ? "configured" : "";
    } else {
      result[row.key] = row.value;
    }
  }

  return c.json(result);
});

// PUT / — upsert a setting
settingRoutes.put("/", async (c) => {
  const body = await c.req.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  const { key, value } = parsed.data;

  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    });

  return c.json({ ok: true });
});

// POST /test — test connectivity/model capability using current (or provided) settings
settingRoutes.post("/test", async (c) => {
  const started = Date.now();

  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const parsed = settingTestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      error: "Invalid request",
      code: "VALIDATION_ERROR",
      issues: parsed.error.issues,
    });
  }

  const { target } = parsed.data;

  const apiKey = (parsed.data.apiKey ?? (await getSetting("gemini_api_key"))).trim();
  const baseUrlRaw = (parsed.data.baseUrl ?? (await getSetting("gemini_base_url"))).trim();

  // Build requestRoot in the same way @google/genai does for Gemini API
  let requestRoot = "";
  let warnings: string[] = [];
  try {
    const built = buildRequestRoot(baseUrlRaw);
    requestRoot = built.requestRoot;
    warnings = built.warnings;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({
      ok: false,
      target,
      warnings,
      latencyMs: Date.now() - started,
      request: {
        baseUrl: baseUrlRaw,
        apiVersion: GEMINI_API_VERSION,
        requestRoot: null,
      },
      error: {
        message: msg,
        hint: buildHint(msg, warnings, target),
      },
    });
  }

  const baseRequest = {
    target,
    warnings,
    latencyMs: 0,
    request: {
      baseUrl: baseUrlRaw,
      apiVersion: GEMINI_API_VERSION,
      requestRoot,
    },
  };

  async function fail(
    msg: string,
    extra: Record<string, unknown> = {},
  ) {
    const isProd = process.env.NODE_ENV === "production";
    const safeExtra = isProd
      ? Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "upstream" && k !== "rawText"))
      : extra;
    return c.json({
      ok: false,
      ...baseRequest,
      latencyMs: Date.now() - started,
      ...safeExtra,
      error: {
        message: msg,
        hint: buildHint(msg, warnings, target),
        ...(isProd ? {} : extra["upstream"] ? { upstream: extra["upstream"] } : {}),
      },
    });
  }

  // --- Tests ---

  // Base URL reachability test (does NOT require API key)
  if (target === "baseUrl") {
    const url = `${requestRoot}/models`;
    try {
      const res = await fetchJson(url, { method: "GET", timeoutMs: 15000 });
      const upstream = extractUpstreamError(res.json as any);

      // Treat 200/401/403 as "reachable". 401/403 usually means "API key required".
      if (res.status === 200 || res.status === 401 || res.status === 403) {
        const isProd = process.env.NODE_ENV === "production";
        const result: Record<string, unknown> = {
          status: res.status,
          note:
            res.status === 200
              ? "Base URL reachable."
              : "Base URL reachable (auth required).",
        };
        if (!isProd) result.upstream = upstream;
        return c.json({
          ok: true,
          ...baseRequest,
          latencyMs: Date.now() - started,
          requestUrl: url,
          result,
        });
      }

      const msg = upstream.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
      return fail(msg, {
        status: res.status,
        requestUrl: url,
        upstream,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, {
        requestUrl: url,
        code: "NETWORK_ERROR",
      });
    }
  }

  // All other tests require an API key
  if (!apiKey) {
    const msg = "Gemini API Key not configured.";
    return c.json({
      ok: false,
      ...baseRequest,
      latencyMs: Date.now() - started,
      error: {
        message: msg,
        hint: "Set the API key in Settings first.",
      },
    });
  }

  const headers = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };

  if (target === "apiKey" || target === "listModels") {
    const url = `${requestRoot}/models`;
    try {
      const res = await fetchJson(url, { headers, method: "GET", timeoutMs: 15000 });
      const upstream = extractUpstreamError(res.json as any);
      if (res.status >= 400 || upstream.message) {
        const msg = upstream.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
        return fail(msg, {
          status: res.status,
          requestUrl: url,
          upstream,
        });
      }

      const models = (res.json as any)?.models;
      const names = Array.isArray(models)
        ? models
            .map((m: any) => (typeof m?.name === "string" ? m.name : null))
            .filter(Boolean)
        : [];

      const list = target === "listModels" ? names : names.slice(0, 20);

      const isProd = process.env.NODE_ENV === "production";
      const result =
        target === "listModels"
          ? { modelCount: names.length, models: list, truncated: list.length !== names.length }
          : isProd
            ? { modelCount: names.length }
            : { modelCount: names.length, models: list, truncated: list.length !== names.length };
      return c.json({
        ok: true,
        ...baseRequest,
        latencyMs: Date.now() - started,
        requestUrl: url,
        result,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, {
        requestUrl: url,
        code: "NETWORK_ERROR",
      });
    }
  }

  // Resolve model name (override > setting > fallback)
  const resolveModel = async (key: string, fallback: string) => {
    const override = (parsed.data.model ?? "").trim();
    if (override) return override;
    const stored = (await getSetting(key)).trim();
    return stored || fallback;
  };

  if (target === "generalModel") {
    const model = await resolveModel("general_model", "gemini-2.5-flash");
    const url = `${requestRoot}/models/${encodeURIComponent(model)}:generateContent`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: 'Return JSON only: {"ok": true, "n": 1}',
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
      },
    };

    try {
      const res = await fetchJson(url, {
        headers,
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: 20000,
      });
      const upstream = extractUpstreamError(res.json as any);
      if (res.status >= 400 || upstream.message) {
        const msg = upstream.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
        return fail(msg, {
          status: res.status,
          requestUrl: url,
          model,
          upstream,
        });
      }

      const text = extractGeminiText(res.json as any);
      const candidate = extractJsonCandidate(text);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(candidate);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return fail(`JSON.parse failed: ${reason}`, {
          requestUrl: url,
          model,
          rawText: text.slice(0, 220),
        });
      }

      const isProd = process.env.NODE_ENV === "production";
      const parsedType = Array.isArray(parsedJson) ? "array" : typeof parsedJson;
      const result = isProd
        ? { parsedType }
        : { rawText: text.slice(0, 220), parsedType, parsedJson };
      return c.json({
        ok: true,
        ...baseRequest,
        latencyMs: Date.now() - started,
        requestUrl: url,
        model,
        result,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, {
        requestUrl: url,
        model,
        code: "NETWORK_ERROR",
      });
    }
  }

  if (target === "storyModel") {
    const model = await resolveModel("story_model", "gemini-2.5-pro");
    const url = `${requestRoot}/models/${encodeURIComponent(model)}:generateContent`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/png",
                data: SAMPLE_IMAGE_PNG_BASE64,
              },
            },
            {
              text: "Reply with exactly: OK",
            },
          ],
        },
      ],
      tools: [{ googleSearch: {} }],
    };

    try {
      const res = await fetchJson(url, {
        headers,
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: 30000,
      });
      const upstream = extractUpstreamError(res.json as any);
      if (res.status >= 400 || upstream.message) {
        const msg = upstream.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
        return fail(msg, {
          status: res.status,
          requestUrl: url,
          model,
          upstream,
        });
      }

      const text = extractGeminiText(res.json as any);
      if (!text.trim()) {
        return fail("Model returned empty text.", {
          requestUrl: url,
          model,
        });
      }

      const isProd = process.env.NODE_ENV === "production";
      const result = isProd ? { ok: true } : { text: text.slice(0, 220) };
      return c.json({
        ok: true,
        ...baseRequest,
        latencyMs: Date.now() - started,
        requestUrl: url,
        model,
        result,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, {
        requestUrl: url,
        model,
        code: "NETWORK_ERROR",
      });
    }
  }

  if (target === "ttsModel") {
    const model = await resolveModel("tts_model", "gemini-2.5-flash-preview-tts");
    const url = `${requestRoot}/models/${encodeURIComponent(model)}:generateContent`;

    const voiceName = (await getSetting("gemini_tts_voice")).trim() || "Zephyr";
    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: "Say OK" }],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    };

    try {
      const res = await fetchJson(url, {
        headers,
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: 30000,
      });
      const upstream = extractUpstreamError(res.json as any);
      if (res.status >= 400 || upstream.message) {
        const msg = upstream.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
        return fail(msg, {
          status: res.status,
          requestUrl: url,
          model,
          upstream,
        });
      }

      const parts = (res.json as any)?.candidates?.[0]?.content?.parts;
      const first = Array.isArray(parts) ? parts[0] : null;
      const inline = first?.inlineData;
      const data = typeof inline?.data === "string" ? inline.data : "";

      if (!data) {
        const text = extractGeminiText(res.json as any);
        return fail(
          "No audio returned (inlineData.data missing).",
          {
            requestUrl: url,
            model,
            rawText: text.slice(0, 220),
          },
        );
      }

      const mimeType = typeof inline?.mimeType === "string" ? inline.mimeType : "";

      const isProd = process.env.NODE_ENV === "production";
      const result = isProd
        ? { mimeType }
        : { mimeType, audioBase64Length: data.length };
      return c.json({
        ok: true,
        ...baseRequest,
        latencyMs: Date.now() - started,
        requestUrl: url,
        model,
        result,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, {
        requestUrl: url,
        model,
        code: "NETWORK_ERROR",
      });
    }
  }

  return c.json({
    ok: false,
    ...baseRequest,
    latencyMs: Date.now() - started,
    error: {
      message: `Unsupported test target: ${target}`,
    },
  });
});
