import type { Context } from "hono";

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

function getClientKey(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return c.req.header("cf-connecting-ip") || "unknown";
}

export function rateLimit(c: Context, opts: RateLimitOptions) {
  const ip = getClientKey(c);
  const now = Date.now();
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
