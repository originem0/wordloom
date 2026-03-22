import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { Semaphore } from "./semaphore.js";

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

export async function getModel(settingKey: string, fallback: string): Promise<string> {
  return (await getSetting(settingKey)) || fallback;
}

export function parsePositiveInt(raw: string, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function getRuntimeSettings(): Promise<{ timeoutMs: number; maxRetries: number }> {
  return {
    timeoutMs: parsePositiveInt(await getSetting("api_timeout_ms"), 60_000, 5_000, 300_000),
    maxRetries: parsePositiveInt(await getSetting("api_max_retries"), 3, 1, 6),
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

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

export async function runWithRetries<T>(
  fn: () => Promise<T>,
  timeoutMultiplier = 1,
): Promise<T> {
  const { timeoutMs, maxRetries } = await getRuntimeSettings();
  const effectiveTimeout = Math.round(timeoutMs * timeoutMultiplier);
  return await retryWithBackoff(
    () => withTimeout(fn(), effectiveTimeout),
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
  run: (model: string) => Promise<T>;
  timeoutMultiplier?: number;
}): Promise<T> {
  const pref = await getModelPreference(opts.primaryKeys, opts.primaryFallback, opts.fallbackKeys);
  const mult = opts.timeoutMultiplier ?? 1;

  if (!pref.primary) {
    throw new Error(`No model configured for ${opts.label}. Set it in AI Providers.`);
  }

  try {
    return await runWithRetries(() => opts.run(pref.primary), mult);
  } catch (primaryError) {
    if (!pref.fallback) throw primaryError;
    const pMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.warn(`${opts.label}: primary model ${pref.primary} failed (${pMsg.slice(0, 150)}), trying fallback ${pref.fallback}`);
    try {
      return await runWithRetries(() => opts.run(pref.fallback!), mult);
    } catch (fallbackError) {
      const p = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const f = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${opts.label} failed on primary (${pref.primary}): ${p}; fallback (${pref.fallback}): ${f}`);
    }
  }
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
