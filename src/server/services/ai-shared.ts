import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Semaphore } from "./semaphore.js";
import { parseJsonLenient } from "./ai-normalize.js";
import { DEFAULT_API_MAX_RETRIES, DEFAULT_API_TIMEOUT_MS } from "../../shared/defaults.js";

// Re-export so providers can create their own instances
export { Semaphore };

// ---------------------------------------------------------------------------
// Unified error code — replaces provider-specific "GEMINI_BUSY" etc.
// ---------------------------------------------------------------------------

export const AI_BUSY = "AI_BUSY";

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string> {
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  return row?.value ?? "";
}

export async function getFirstSetting(keys: string[]): Promise<string> {
  for (const key of keys) {
    const value = (await getSetting(key)).trim();
    if (value) return value;
  }
  return "";
}

export function parsePositiveInt(raw: string, fallback: number, min: number, max: number): number {
  // An unset setting reads as "", and Number("") is 0, not NaN: taken for a
  // number it would be clamped up to `min` instead of falling back.
  if (!raw.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function getRuntimeSettings(): Promise<{ timeoutMs: number; maxRetries: number }> {
  return {
    timeoutMs: parsePositiveInt(await getSetting("api_timeout_ms"), DEFAULT_API_TIMEOUT_MS, 5_000, 300_000),
    maxRetries: parsePositiveInt(await getSetting("api_max_retries"), DEFAULT_API_MAX_RETRIES, 1, 6),
  };
}

// ---------------------------------------------------------------------------
// Retry with exponential back-off
// ---------------------------------------------------------------------------

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const msg =
        error instanceof Error ? error.message : String(error);
      // Only retry on transient errors
      const shouldRetry =
        /502|503|overloaded|429|rate.limit|UNAVAILABLE|network|timeout|fetch|ECONNRESET|socket|SSL|TLS|eof|abort|getoxsrf/i.test(
          msg,
        );
      // Never retry on quota/billing/auth errors
      const noRetry =
        /exceeded|quota|billing|insufficient|unauthorized|forbidden|invalid.api.key|RPD|RPM|TPM|TPD/i.test(msg);
      if (!shouldRetry || noRetry || attempt === maxRetries - 1) throw error;
      const delayMs = initialDelay * Math.pow(2, attempt);
      console.log(`Retry ${attempt + 1}/${maxRetries} in ${delayMs}ms — ${msg.slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Timeout wrapper
// ---------------------------------------------------------------------------

// The deadline does not just stop waiting — it aborts the work. A bare
// Promise.race left the upstream request running (and billing) after we gave
// up on it, and each retry then stacked another live request on top, so the
// semaphore's concurrency cap stopped meaning anything.
export async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`timeout after ${timeoutMs}ms`);
      controller.abort(err);
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([work(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runWithRetries<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMultiplier = 1,
): Promise<T> {
  const { timeoutMs, maxRetries } = await getRuntimeSettings();
  const effectiveTimeout = Math.round(timeoutMs * timeoutMultiplier);
  return await retryWithBackoff(
    () => withTimeout(fn, effectiveTimeout),
    maxRetries,
  );
}

// ---------------------------------------------------------------------------
// Model preference + fallback runner
// ---------------------------------------------------------------------------

export async function getModelPreference(
  primaryKeys: string[],
  primaryFallback: string,
  fallbackKeys: string[],
): Promise<{ primary: string; fallback: string | null }> {
  const primary = ((await getFirstSetting(primaryKeys)) || primaryFallback).trim();
  const fallback = (await getFirstSetting(fallbackKeys)).trim();
  return {
    primary,
    fallback: fallback && fallback !== primary ? fallback : null,
  };
}

export async function runWithModelFallback<T>(opts: {
  primaryKeys: string[];
  primaryFallback: string;
  fallbackKeys: string[];
  label: string;
  /** `signal` aborts when this attempt times out — pass it to the HTTP call. */
  run: (model: string, signal: AbortSignal) => Promise<T>;
  timeoutMultiplier?: number;
}): Promise<T> {
  const pref = await getModelPreference(opts.primaryKeys, opts.primaryFallback, opts.fallbackKeys);
  const mult = opts.timeoutMultiplier ?? 1;

  if (!pref.primary) {
    throw new Error(`No model configured for ${opts.label}. Set it in AI Providers.`);
  }

  try {
    return await runWithRetries((signal) => opts.run(pref.primary, signal), mult);
  } catch (primaryError) {
    if (!pref.fallback) throw primaryError;
    const pMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`${opts.label}: primary model ${pref.primary} failed (${pMsg.slice(0, 150)}), trying fallback ${pref.fallback}`);
    try {
      return await runWithRetries((signal) => opts.run(pref.fallback!, signal), mult);
    } catch (fallbackError) {
      const p = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const f = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${opts.label} failed on primary (${pref.primary}): ${p}; fallback (${pref.fallback}): ${f}`);
    }
  }
}

// ---------------------------------------------------------------------------
// One attempt — for calls an HTTP request is waiting on
// ---------------------------------------------------------------------------

/** A call that returns whatever JSON the model wrote; the caller validates it. */
export interface JsonCall {
  /** Settings prefix. Keys left empty fall back to the cards route's. */
  route: string;
  system: string;
  user: string;
  label: string;
}

// The request waiting on this sits behind a reverse proxy, and nginx gives up
// after 60 s by default. So this path ignores api_timeout_ms, api_max_retries
// and the fallback models: one attempt, and past the cap it has failed.
const JSON_CALL_TIMEOUT_MS = 45_000;

export async function runJsonCall(opts: {
  modelKeys: string[];
  defaultModel: string;
  label: string;
  run: (model: string, signal: AbortSignal) => Promise<string>;
}): Promise<unknown> {
  const model = (await getFirstSetting(opts.modelKeys)) || opts.defaultModel;
  if (!model) throw new Error(`No model configured for ${opts.label}. Set it in AI Providers.`);
  const text = await withTimeout((signal) => opts.run(model, signal), JSON_CALL_TIMEOUT_MS);
  try {
    return parseJsonLenient(text);
  } catch {
    // parseJsonLenient quotes the output in its message, and the output of
    // these calls can quote the private text they were given.
    throw new Error(`${opts.label}: model output was not JSON`);
  }
}

/** Why a call failed, from a fixed list. This is what to log for a call that
 *  carried private text: an upstream error's own message can quote its input. */
export function failureReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (msg === AI_BUSY) return "busy";
  return /timeout/i.test(msg) ? "timeout" : /configured/i.test(msg) ? "not configured" : "failed";
}

// ---------------------------------------------------------------------------
// Semaphore acquire helper — throws AI_BUSY on queue full/timeout
// ---------------------------------------------------------------------------

export async function acquireSemaphore(semaphore: Semaphore): Promise<void> {
  try {
    await semaphore.acquire();
  } catch (err) {
    if (err instanceof Error && (err.message === "QUEUE_FULL" || err.message === "QUEUE_TIMEOUT")) {
      throw new Error(AI_BUSY);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedCard {
  word: string;
  ipa?: string;
  pos?: string;
  cefr?: string;
  cefrConfidence?: string;
  coreMeaning?: string;
  wad?: number;
  wap?: number;
  etymology?: string;
  collocations: string[];
  examples: { level: string; sentence: string; translation: string }[];
  contextLadder: { level: number; sentence: string; context: string }[];
  phrases: string[];
  synonyms: string[];
  antonyms: string[];
  minPair?: string;
}
