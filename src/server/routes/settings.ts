import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { updateSettingsSchema } from "../../shared/validation.js";
import { generateEdgeTtsMp3 } from "../services/edgeTts.js";
import { getSetting } from "../services/ai-shared.js";
import { extractJsonCandidate } from "../services/ai-normalize.js";
import { authMiddleware, verifySession } from "../middleware/auth.js";

export const settingRoutes = new Hono();

const GEMINI_API_VERSION = "v1beta";

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
      "cardsModel",
      "deepModel",
      "utilityModel",
      "ttsModel",
      "geminiTts",
      "edgeTts",
      "generalModel",
      "openaiListModels",
      "openaiBaseUrl",
    ]),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    provider: z.enum(["gemini", "openai"]).optional(),
    verify: z.boolean().optional(), // when true, ping each model and filter to usable ones
  })
  .strict();

// ---------------------------------------------------------------------------
// Batch model verification — ping each model with a trivial prompt,
// concurrency-limited, return only the ones that respond.
// ---------------------------------------------------------------------------

async function verifyGeminiModels(
  models: string[],
  requestRoot: string,
  headers: Record<string, string>,
  concurrency = 5,
  perModelTimeoutMs = 10_000,
): Promise<string[]> {
  const verified: string[] = [];

  // Simple semaphore for concurrency control
  let running = 0;
  let idx = 0;
  const results = new Array<boolean>(models.length);

  async function runOne(i: number) {
    const model = models[i];
    // Skip TTS / embedding / tuning models — they can't do generateContent
    if (/embed|tts|audio|speech|tuning|aqa/i.test(model)) {
      results[i] = false;
      return;
    }
    const url = `${requestRoot}/models/${encodeURIComponent(model)}:generateContent`;
    const payload = {
      contents: [{ role: "user", parts: [{ text: "Say OK" }] }],
    };
    try {
      const res = await fetchJson(url, {
        headers,
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: perModelTimeoutMs,
      });
      const text = extractGeminiText(res.json as any).trim();
      results[i] = res.status < 400 && text.length > 0;
    } catch {
      results[i] = false;
    }
  }

  // Run with concurrency limit
  await new Promise<void>((resolve) => {
    function next() {
      if (idx >= models.length && running === 0) { resolve(); return; }
      while (running < concurrency && idx < models.length) {
        const i = idx++;
        running++;
        runOne(i).finally(() => { running--; next(); });
      }
    }
    next();
  });

  for (let i = 0; i < models.length; i++) {
    if (results[i]) verified.push(models[i]);
  }
  return verified;
}

async function verifyOpenaiModels(
  models: string[],
  chatUrl: string,
  apiKey: string,
  concurrency = 5,
  perModelTimeoutMs = 10_000,
): Promise<string[]> {
  const verified: string[] = [];
  let running = 0;
  let idx = 0;
  const results = new Array<boolean>(models.length);

  async function runOne(i: number) {
    const model = models[i];
    // Skip known non-chat models
    if (/embed|tts|audio|speech|whisper|dall-e|moderation/i.test(model)) {
      results[i] = false;
      return;
    }
    try {
      const res = await fetchJson(chatUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Say OK" }],
          max_tokens: 5,
        }),
        timeoutMs: perModelTimeoutMs,
      });
      const content = (res.json as any)?.choices?.[0]?.message?.content;
      results[i] = res.status < 400 && typeof content === "string" && content.length > 0;
    } catch {
      results[i] = false;
    }
  }

  await new Promise<void>((resolve) => {
    function next() {
      if (idx >= models.length && running === 0) { resolve(); return; }
      while (running < concurrency && idx < models.length) {
        const i = idx++;
        running++;
        runOne(i).finally(() => { running--; next(); });
      }
    }
    next();
  });

  for (let i = 0; i < models.length; i++) {
    if (results[i]) verified.push(models[i]);
  }
  return verified;
}

// Sensitive keys hidden from unauthenticated users
const SENSITIVE_KEYS = new Set([
  "gemini_base_url", "openai_base_url",
]);

// GET / — read all settings (public, but hides sensitive fields for anonymous users)
settingRoutes.get("/", async (c) => {
  const rows = await db.select().from(settings).all();

  const session = getCookie(c, "session");
  const isAdmin = session ? await verifySession(session) : false;

  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === "gemini_api_key" || row.key === "openai_api_key") {
      result[row.key] = row.value ? "configured" : "";
    } else if (!isAdmin && SENSITIVE_KEYS.has(row.key)) {
      // Hide sensitive config from anonymous users
      result[row.key] = row.value ? "configured" : "";
    } else {
      result[row.key] = row.value;
    }
  }

  return c.json(result);
});

// PUT / — upsert a setting (admin only)
settingRoutes.put("/", authMiddleware, async (c) => {
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
settingRoutes.post("/test", authMiddleware, async (c) => {
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

      // When verify=true, ping each model and filter to usable ones
      const shouldVerify = parsed.data.verify === true && target === "listModels";
      const finalModels = shouldVerify
        ? await verifyGeminiModels(list, requestRoot, headers)
        : list;

      const isProd = process.env.NODE_ENV === "production";
      const result =
        target === "listModels"
          ? { modelCount: finalModels.length, models: finalModels, truncated: false, totalListed: names.length, verified: shouldVerify }
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

  // Resolve model name (override > first non-empty setting > fallback)
  const resolveModel = async (keys: string[], fallback: string) => {
    const override = (parsed.data.model ?? "").trim();
    if (override) return override;
    for (const key of keys) {
      const stored = (await getSetting(key)).trim();
      if (stored) return stored;
    }
    return fallback;
  };

  // --- OpenAI-compatible model tests ---
  // When provider=openai, handle storyModel/cardsModel/deepModel/utilityModel via chat completions
  const modelTestTargets = ["storyModel", "cardsModel", "deepModel", "utilityModel", "generalModel"];
  if (parsed.data.provider === "openai" && modelTestTargets.includes(target)) {
    const openaiKey = (parsed.data.apiKey ?? (await getSetting("openai_api_key"))).trim();
    const openaiBase = (parsed.data.baseUrl ?? (await getSetting("openai_base_url"))).trim().replace(/\/+$/, "");
    const model = (parsed.data.model ?? "").trim();

    if (!openaiKey) return c.json({ ok: false, target, latencyMs: Date.now() - started, error: { message: "OpenAI API Key not configured." } });
    if (!openaiBase) return c.json({ ok: false, target, latencyMs: Date.now() - started, error: { message: "OpenAI Base URL not configured." } });
    if (!model) return c.json({ ok: false, target, latencyMs: Date.now() - started, error: { message: "No model specified." } });

    const chatPath = /\/v1\/?$/i.test(openaiBase) ? "chat/completions" : "v1/chat/completions";
    const chatUrl = `${openaiBase}/${chatPath}`;

    // Build test prompt based on target — match actual route complexity
    let messages: Array<{ role: string; content: unknown }>;
    let expectJson = false;
    let validateShape: ((parsed: unknown) => string | null) | null = null;
    let testTimeoutMs = 30_000;

    if (target === "storyModel") {
      testTimeoutMs = 45_000;
      messages = [
        { role: "system", content: "Reply with exactly: OK" },
        { role: "user", content: [
          { type: "image_url", image_url: { url: `data:image/png;base64,${SAMPLE_IMAGE_PNG_BASE64}` } },
          { type: "text", text: "Reply with exactly: OK" },
        ]},
      ];
    } else if (target === "cardsModel") {
      messages = [
        { role: "user", content: 'Return JSON only, no markdown fences. Generate a word card for "signal": [{"word":"signal","coreMeaning":"信号","collocations":["signal to"],"examples":[{"level":"B1","sentence":"She gave the signal.","translation":"她发出了信号。"}],"contextLadder":[{"level":1,"sentence":"A signal.","context":"basic"}],"phrases":["signal fire"],"synonyms":["sign"],"antonyms":[]}]' },
      ];
      expectJson = true;
      validateShape = (parsed) => {
        const arr = Array.isArray(parsed) ? parsed : null;
        if (!arr || arr.length === 0) return "Expected JSON array, got " + typeof parsed;
        const first = arr[0];
        if (!first || typeof first !== "object") return "Array element is not an object";
        if (!("word" in first)) return "Missing 'word' field";
        if (!("coreMeaning" in first)) return "Missing 'coreMeaning' field";
        return null;
      };
    } else if (target === "deepModel") {
      testTimeoutMs = 60_000;
      messages = [
        { role: "user", content: 'Return JSON only, no markdown fences. Deep analysis for word "diverge": {"schemaAnalysis":{"coreSchema":"path","coreImageText":"branching road","metaphoricalExtensions":["opinions diverge"],"registerVariation":"formal","etymologyChain":["dis-","vergere"],"sceneActivation":["two roads"]},"familyComparison":[{"word":"diverge","pos":"verb","meaning":"to separate"}],"boundaryTests":[{"pair":"diverge vs deviate","distinction":"diverge implies gradual separation"}]}' },
      ];
      expectJson = true;
      validateShape = (parsed) => {
        if (!parsed || typeof parsed !== "object") return "Expected JSON object, got " + typeof parsed;
        const obj = parsed as Record<string, unknown>;
        if (!obj.schemaAnalysis) return "Missing 'schemaAnalysis'";
        if (!obj.familyComparison) return "Missing 'familyComparison'";
        if (!obj.boundaryTests) return "Missing 'boundaryTests'";
        const sa = obj.schemaAnalysis as Record<string, unknown>;
        if (!sa.coreSchema) return "schemaAnalysis missing 'coreSchema'";
        return null;
      };
    } else {
      // utilityModel
      messages = [
        { role: "user", content: "Translate to Simplified Chinese, output plain text only: A red kite hangs above a quiet field." },
      ];
    }

    try {
      const res = await fetchJson(chatUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
        body: JSON.stringify({ model, messages, max_tokens: 300 }),
        timeoutMs: testTimeoutMs,
      });
      if (res.status >= 400) {
        const errBody = res.json as any;
        const msg = errBody?.error?.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
        return c.json({ ok: false, target, latencyMs: Date.now() - started, model, error: { message: msg } });
      }
      const content = (res.json as any)?.choices?.[0]?.message?.content ?? "";
      if (!content) {
        return c.json({ ok: false, target, latencyMs: Date.now() - started, model, error: { message: "Empty response" } });
      }
      if (expectJson) {
        let parsed: unknown;
        try {
          const candidate = extractJsonCandidate(content);
          parsed = JSON.parse(candidate);
        } catch {
          return c.json({ ok: false, target, latencyMs: Date.now() - started, model, error: { message: "Invalid JSON response" } });
        }
        if (validateShape) {
          const shapeErr = validateShape(parsed);
          if (shapeErr) {
            return c.json({ ok: false, target, latencyMs: Date.now() - started, model, error: { message: `Schema: ${shapeErr}` } });
          }
        }
      }
      return c.json({ ok: true, target, latencyMs: Date.now() - started, model, result: { sample: content.slice(0, 120) } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ ok: false, target, latencyMs: Date.now() - started, model, error: { message: msg } });
    }
  }

  if (target === "generalModel") {
    const model = await resolveModel(["general_model"], "gemini-2.5-flash");
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

  if (target === "utilityModel") {
    const model = await resolveModel(["utility_model", "general_model"], "gemini-2.5-flash");
    const url = `${requestRoot}/models/${encodeURIComponent(model)}:generateContent`;
    const payload = {
      contents: [{ role: "user", parts: [{ text: "Translate to Simplified Chinese, output plain text only: A red kite hangs above a quiet field." }] }],
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
        return fail(msg, { status: res.status, requestUrl: url, model, upstream });
      }
      const text = extractGeminiText(res.json as any).trim();
      if (!text) return fail("Model returned empty text.", { requestUrl: url, model });
      return c.json({ ok: true, ...baseRequest, latencyMs: Date.now() - started, requestUrl: url, model, result: { mode: "plain-text", sample: text.slice(0, 120) } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, { requestUrl: url, model, code: "NETWORK_ERROR" });
    }
  }

  if (target === "cardsModel") {
    const model = await resolveModel(["cards_model", "general_model"], "gemini-2.5-flash");
    const url = `${requestRoot}/models/${encodeURIComponent(model)}:generateContent`;
    const payload = {
      contents: [{ role: "user", parts: [{ text: 'Return JSON only: [{"word":"signal","coreMeaning":"信号","collocations":[],"examples":[],"contextLadder":[],"phrases":[],"synonyms":[],"antonyms":[]}]' }] }],
      generationConfig: { responseMimeType: "application/json" },
    };
    try {
      const res = await fetchJson(url, { headers, method: "POST", body: JSON.stringify(payload), timeoutMs: 20000 });
      const upstream = extractUpstreamError(res.json as any);
      if (res.status >= 400 || upstream.message) {
        const msg = upstream.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
        return fail(msg, { status: res.status, requestUrl: url, model, upstream });
      }
      const text = extractGeminiText(res.json as any);
      const candidate = extractJsonCandidate(text);
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(candidate);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return fail(`JSON.parse failed: ${reason}`, { requestUrl: url, model, rawText: text.slice(0, 220) });
      }
      const first = Array.isArray(parsedJson) ? parsedJson[0] : null;
      const hasShape = !!first && typeof first === "object" && "word" in (first as object);
      if (!hasShape) {
        return fail("Cards probe returned unexpected JSON shape.", { requestUrl: url, model, rawText: text.slice(0, 220) });
      }
      return c.json({ ok: true, ...baseRequest, latencyMs: Date.now() - started, requestUrl: url, model, result: { mode: "json-cards", stableJson: true } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, { requestUrl: url, model, code: "NETWORK_ERROR" });
    }
  }

  if (target === "deepModel") {
    const model = await resolveModel(["deep_model", "general_model"], "gemini-2.5-flash");
    const url = `${requestRoot}/models/${encodeURIComponent(model)}:generateContent`;
    const payload = {
      contents: [{ role: "user", parts: [{ text: 'Return JSON only with keys familyComparison, schemaAnalysis, boundaryTests for word "diverge". schemaAnalysis must contain coreSchema and coreImageText.' }] }],
      generationConfig: { responseMimeType: "application/json" },
    };
    try {
      const res = await fetchJson(url, { headers, method: "POST", body: JSON.stringify(payload), timeoutMs: 60000 });
      const upstream = extractUpstreamError(res.json as any);
      if (res.status >= 400 || upstream.message) {
        const msg = upstream.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
        return fail(msg, { status: res.status, requestUrl: url, model, upstream });
      }
      const text = extractGeminiText(res.json as any);
      const candidate = extractJsonCandidate(text);
      let parsedJson: any;
      try {
        parsedJson = JSON.parse(candidate);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        return fail(`JSON.parse failed: ${reason}`, { requestUrl: url, model, rawText: text.slice(0, 220) });
      }
      const okShape = parsedJson && typeof parsedJson === "object" && parsedJson.schemaAnalysis && parsedJson.familyComparison !== undefined && parsedJson.boundaryTests !== undefined;
      if (!okShape) {
        return fail("Deep probe returned incomplete JSON structure.", { requestUrl: url, model, rawText: text.slice(0, 220) });
      }
      return c.json({ ok: true, ...baseRequest, latencyMs: Date.now() - started, requestUrl: url, model, result: { mode: "json-deep", hasSchemaAnalysis: true } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, { requestUrl: url, model, code: "NETWORK_ERROR" });
    }
  }

  if (target === "storyModel") {
    const model = await resolveModel(["story_model"], "gemini-2.5-pro");
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

  if (target === "edgeTts") {
    try {
      const audio = await generateEdgeTtsMp3("OK");
      return c.json({
        ok: true,
        ...baseRequest,
        latencyMs: Date.now() - started,
        result: { mode: "edge-tts", bytes: audio.byteLength },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return fail(msg, { code: "EDGE_TTS_ERROR" });
    }
  }

  if (target === "ttsModel" || target === "geminiTts") {
    const model = await resolveModel(["gemini_tts_model", "tts_model"], "gemini-2.5-flash-preview-tts");
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

  // --- OpenAI-compatible test targets ---

  if (target === "openaiBaseUrl" || target === "openaiListModels") {
    const openaiApiKey = (parsed.data.apiKey ?? (await getSetting("openai_api_key"))).trim();
    const openaiBaseUrlRaw = (parsed.data.baseUrl ?? (await getSetting("openai_base_url"))).trim();

    if (!openaiBaseUrlRaw) {
      return c.json({
        ok: false,
        target,
        latencyMs: Date.now() - started,
        error: { message: "OpenAI Base URL not configured.", hint: "Set the Base URL in AI Providers first." },
      });
    }

    const normalizedBase = openaiBaseUrlRaw.replace(/\/+$/, "");
    const modelsUrl = /\/v1\/?$/i.test(normalizedBase)
      ? `${normalizedBase}/models`
      : `${normalizedBase}/v1/models`;

    if (target === "openaiBaseUrl") {
      try {
        const res = await fetchJson(modelsUrl, { method: "GET", timeoutMs: 15000 });
        if (res.status === 200 || res.status === 401 || res.status === 403) {
          return c.json({
            ok: true,
            target,
            latencyMs: Date.now() - started,
            requestUrl: modelsUrl,
            result: {
              status: res.status,
              note: res.status === 200 ? "Base URL reachable." : "Base URL reachable (auth required).",
            },
          });
        }
        return c.json({
          ok: false, target, latencyMs: Date.now() - started, requestUrl: modelsUrl,
          error: { message: `HTTP ${res.status}: ${res.text.slice(0, 200)}` },
        });
      } catch (e) {
        return c.json({
          ok: false, target, latencyMs: Date.now() - started, requestUrl: modelsUrl,
          error: { message: e instanceof Error ? e.message : String(e) },
        });
      }
    }

    // openaiListModels
    if (!openaiApiKey) {
      return c.json({
        ok: false, target, latencyMs: Date.now() - started,
        error: { message: "OpenAI API Key not configured.", hint: "Set the API key in AI Providers first." },
      });
    }

    try {
      const res = await fetchJson(modelsUrl, {
        method: "GET",
        headers: { "Authorization": `Bearer ${openaiApiKey}` },
        timeoutMs: 15000,
      });
      if (res.status >= 400) {
        const errBody = res.json as any;
        const msg = errBody?.error?.message || `HTTP ${res.status}: ${res.text.slice(0, 200)}`;
        return c.json({
          ok: false, target, latencyMs: Date.now() - started, requestUrl: modelsUrl,
          error: { message: msg },
        });
      }

      // OpenAI format: { data: [{ id: "model-name" }] }
      const data = (res.json as any)?.data;
      const models = Array.isArray(data)
        ? data.map((m: any) => (typeof m?.id === "string" ? m.id : null)).filter(Boolean)
        : [];

      // When verify=true, ping each model and filter to usable ones
      const shouldVerify = parsed.data.verify === true;
      let finalModels = models as string[];
      if (shouldVerify && finalModels.length > 0) {
        const chatPath = /\/v1\/?$/i.test(normalizedBase) ? "chat/completions" : "v1/chat/completions";
        const chatUrl = `${normalizedBase}/${chatPath}`;
        finalModels = await verifyOpenaiModels(finalModels, chatUrl, openaiApiKey);
      }

      return c.json({
        ok: true,
        target,
        latencyMs: Date.now() - started,
        requestUrl: modelsUrl,
        result: { modelCount: finalModels.length, models: finalModels, truncated: false, totalListed: models.length, verified: shouldVerify },
      });
    } catch (e) {
      return c.json({
        ok: false, target, latencyMs: Date.now() - started, requestUrl: modelsUrl,
        error: { message: e instanceof Error ? e.message : String(e) },
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
