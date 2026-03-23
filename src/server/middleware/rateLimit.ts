import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { verifySession } from "./auth.js";

type RateLimitOptions = {
  key: string;
  windowMs: number;
  max: number;
};

type Bucket = {
  resetAt: number;
  count: number;
};

const buckets = new Map<string, Bucket>();
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 60_000;

function getClientKey(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";

  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim() || "unknown";

  return c.req.header("cf-connecting-ip") || "unknown";
}

function cleanupExpired(now: number) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(c: Context, opts: RateLimitOptions) {
  const ip = getClientKey(c);
  const now = Date.now();
  cleanupExpired(now);

  const key = `${opts.key}:${ip}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { resetAt: now + opts.windowMs, count: 1 });
    return null;
  }

  if (bucket.count >= opts.max) {
    const retryAfter = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
    return c.json(
      { error: "Too many requests", code: "RATE_LIMITED", retryAfter },
      429,
    );
  }

  bucket.count += 1;
  return null;
}

// ---------------------------------------------------------------------------
// Daily limit — 24h sliding window, skips authenticated (admin) users
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// Lazy import to avoid circular dependency at module load time
let _getSetting: ((key: string) => Promise<string>) | null = null;
async function getSetting(key: string): Promise<string> {
  if (!_getSetting) {
    const mod = await import("../services/ai-shared.js");
    _getSetting = mod.getSetting;
  }
  return _getSetting(key);
}

export async function dailyLimit(
  c: Context,
  opts: { key: string; settingKey: string; defaultMax: number; count?: number },
): Promise<Response | null> {
  // Authenticated users (admin) bypass daily limits
  const session = getCookie(c, "session");
  if (session && (await verifySession(session))) return null;

  const ip = getClientKey(c);
  if (ip === "127.0.0.1" || ip === "::1" || ip === "unknown") {
    console.warn(`[dailyLimit] IP is "${ip}" — nginx may not be setting X-Real-IP`);
  }

  const now = Date.now();
  cleanupExpired(now);

  // Read limit from settings
  const raw = await getSetting(opts.settingKey);
  const max = raw ? Math.max(1, Math.floor(Number(raw) || opts.defaultMax)) : opts.defaultMax;

  const key = `${opts.key}:${ip}`;
  const bucket = buckets.get(key);
  const increment = opts.count ?? 1;

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { resetAt: now + DAY_MS, count: increment });
    return null;
  }

  if (bucket.count + increment > max) {
    const retryAfter = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
    const remaining = Math.max(0, max - bucket.count);
    return c.json(
      {
        error: `Daily limit reached (${max}/day)`,
        code: "DAILY_LIMIT",
        retryAfter,
        limit: max,
        remaining,
      },
      429,
    );
  }

  bucket.count += increment;
  return null;
}
