import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// AI calls are the only external dependency of these routes; everything else
// (Hono wiring, middleware order, SQLite) is the real thing on an in-memory DB.
const mockExtract = vi.fn<(text: string) => Promise<string[]>>(async () => ["alpha"]);
const NOT_CHUNK = { verdict: "not_chunk", confidence: 0.9, reason: "n/a", payload: null };
const mockChunk = vi.fn<(input: string) => Promise<typeof NOT_CHUNK>>(async () => NOT_CHUNK);
vi.mock("../services/ai-router.js", () => ({
  generateStory: vi.fn(),
  generateTTS: vi.fn(),
  translateText: vi.fn(async () => "译文"),
  generateCards: vi.fn(),
  generateDeepLayer: vi.fn(),
  extractWords: (text: string) => mockExtract(text),
  generateChunk: (input: string) => mockChunk(input),
  generatePracticeImage: vi.fn(),
  generatePracticeBrief: vi.fn(),
  gradePracticeDescription: vi.fn(async () => ({ overall: "ok" })),
}));

import { app } from "../app.js";
import { db } from "../db/index.js";
import { cards, chunks, jobs, sessions, settings, stories, practices } from "../db/schema.js";
import { hashSessionId } from "../middleware/auth.js";
import { eq } from "drizzle-orm";

const HOST = "wordloom.test";
const ORIGIN = `https://${HOST}`;

/** Same-origin browser-like request (Host + matching Origin + nginx X-Real-IP). */
function req(path: string, init: RequestInit & { ip?: string; origin?: string | null } = {}) {
  const { ip = "203.0.113.7", origin = ORIGIN, headers, ...rest } = init;
  const h = new Headers(headers);
  h.set("host", HOST);
  h.set("x-real-ip", ip);
  if (origin) h.set("origin", origin);
  return app.request(path, { ...rest, headers: h });
}

async function seedCard(word = "anchor") {
  const now = Date.now();
  const [row] = await db
    .insert(cards)
    .values({ word, usageCount: 0, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

async function seedChunk() {
  const now = Date.now();
  const [row] = await db
    .insert(chunks)
    .values({
      form: "in terms of X",
      category: "prep-intuition",
      coreMeaning: "with respect to",
      register: "neutral",
      frequency: "high",
      examples: JSON.stringify([{ sentence: "In terms of cost, it wins.", register: "neutral" }]),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return row;
}

async function adminCookie() {
  const raw = "admin-session";
  const now = Date.now();
  await db.insert(sessions).values({
    sessionId: hashSessionId(raw),
    createdAt: now,
    expiresAt: now + 60_000,
    revokedAt: null,
  });
  return `session=${raw}`;
}

const originalEnv = { ...process.env };

beforeEach(async () => {
  process.env.AUTH_TOKEN = "secret-token";
  process.env.AUTH_SECRET = "secret";
  delete process.env.ALLOWED_ORIGINS;
  for (const t of [cards, chunks, jobs, sessions, settings, stories, practices]) {
    await db.delete(t);
  }
  mockExtract.mockClear();
  mockChunk.mockReset();
  mockChunk.mockImplementation(async () => NOT_CHUNK);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("anonymous visitors cannot destroy or rewrite library data", () => {
  it("DELETE /api/cards/:id is refused and the card survives", async () => {
    const card = await seedCard();
    const res = await req(`/api/cards/${card.id}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await db.select().from(cards).where(eq(cards.id, card.id)).get()).toBeTruthy();
  });

  it("DELETE /api/chunks/:id is refused and the chunk survives", async () => {
    const chunk = await seedChunk();
    const res = await req(`/api/chunks/${chunk.id}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await db.select().from(chunks).where(eq(chunks.id, chunk.id)).get()).toBeTruthy();
  });

  it("PATCH /api/chunks/:id is refused and the chunk is unchanged", async () => {
    const chunk = await seedChunk();
    const res = await req(`/api/chunks/${chunk.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coreMeaning: "defaced" }),
    });
    expect(res.status).toBe(401);
    const row = await db.select().from(chunks).where(eq(chunks.id, chunk.id)).get();
    expect(row?.coreMeaning).toBe("with respect to");
  });

  it("DELETE on stories and practices is refused", async () => {
    expect((await req("/api/stories/1", { method: "DELETE" })).status).toBe(401);
    expect((await req("/api/practice/1", { method: "DELETE" })).status).toBe(401);
  });

  it("a write route nobody remembered to whitelist is refused by default", async () => {
    const res = await req("/api/cards/anything/new-endpoint", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("the job list (other visitors' inputs and results) is admin-only", async () => {
    expect((await req("/api/jobs")).status).toBe(401);
    const cookie = await adminCookie();
    expect((await req("/api/jobs", { headers: { cookie } })).status).toBe(200);
  });
});

describe("what stays open", () => {
  it("the admin can delete a card", async () => {
    const card = await seedCard();
    const cookie = await adminCookie();
    const res = await req(`/api/cards/${card.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await db.select().from(cards).where(eq(cards.id, card.id)).get()).toBeUndefined();
  });

  it("visitors can still read, count usage and call public generators", async () => {
    const card = await seedCard();
    expect((await req("/api/cards")).status).toBe(200);
    expect((await req(`/api/cards/${card.id}/usage`, { method: "PATCH" })).status).toBe(200);
    const res = await req("/api/cards/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "alpha beta" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ words: ["alpha"] });
  });

  it("a visitor can poll and cancel a job by its unguessable id", async () => {
    const now = Date.now();
    await db.insert(jobs).values({
      id: "0b5c7f0e-job", type: "cards", status: "running", input: "{}",
      createdAt: now, updatedAt: now,
    });
    expect((await req("/api/jobs/0b5c7f0e-job")).status).toBe(200);
    const res = await req("/api/jobs/0b5c7f0e-job/cancel", { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("cross-site writes", () => {
  it("rejects a write whose Origin is another site when no allowlist is configured", async () => {
    const card = await seedCard();
    const res = await req(`/api/cards/${card.id}/usage`, {
      method: "PATCH",
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
    const row = await db.select().from(cards).where(eq(cards.id, card.id)).get();
    expect(row?.usageCount).toBe(0);
  });

  it("accepts the same site on a non-default port (nginx also listens on 8443)", async () => {
    const card = await seedCard();
    const res = await req(`/api/cards/${card.id}/usage`, {
      method: "PATCH",
      origin: `https://${HOST}:8443`,
    });
    expect(res.status).toBe(200);
  });

  it("does not hand out credentialed CORS to arbitrary origins", async () => {
    const res = await req("/api/cards", { origin: "https://evil.example" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("usage limits cannot be reset by the client", () => {
  async function extract(headers: Record<string, string>, ip: string) {
    return req("/api/cards/extract", {
      method: "POST",
      ip,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ text: "alpha beta" }),
    });
  }

  it("a forged X-Forwarded-For does not buy a fresh daily allowance", async () => {
    await db.insert(settings).values({ key: "daily_utility_limit", value: "2" });
    expect((await extract({ "x-forwarded-for": "1.1.1.1" }, "198.51.100.1")).status).toBe(200);
    expect((await extract({ "x-forwarded-for": "2.2.2.2" }, "198.51.100.1")).status).toBe(200);
    const third = await extract({ "x-forwarded-for": "3.3.3.3" }, "198.51.100.1");
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: "DAILY_LIMIT" });
    expect(mockExtract).toHaveBeenCalledTimes(2);
  });

  it("a different real client keeps its own allowance", async () => {
    await db.insert(settings).values({ key: "daily_utility_limit", value: "1" });
    expect((await extract({}, "198.51.100.2")).status).toBe(200);
    expect((await extract({}, "198.51.100.2")).status).toBe(429);
    expect((await extract({}, "198.51.100.3")).status).toBe(200);
  });

  it("story translation draws on the same utility allowance", async () => {
    await db.insert(settings).values({ key: "daily_utility_limit", value: "1" });
    const [story] = await db
      .insert(stories)
      .values({ imagePath: "data/images/x.jpg", story: "A quiet harbour.", createdAt: Date.now() })
      .returning();
    const call = () => req(`/api/stories/${story.id}/translate`, { method: "POST", ip: "198.51.100.4" });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  it("chunk analysis has a daily allowance", async () => {
    await db.insert(settings).values({ key: "daily_chunks_limit", value: "1" });
    const call = () =>
      req("/api/chunks/generate", {
        method: "POST",
        ip: "198.51.100.5",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "in terms of" }),
      });
    expect((await call()).status).toBe(200);
    const second = await call();
    expect(second.status).toBe(429);
    expect(await second.json()).toMatchObject({ code: "DAILY_LIMIT" });
  });

  it("practice grading has a daily allowance", async () => {
    await db.insert(settings).values({ key: "daily_grade_limit", value: "1" });
    const [practice] = await db
      .insert(practices)
      .values({ imagePath: "data/images/p.jpg", visualPrompt: "a harbour at dawn", createdAt: Date.now() })
      .returning();
    const call = () =>
      req(`/api/practice/${practice.id}/grade`, {
        method: "POST",
        ip: "198.51.100.6",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "Boats are moored along the quay." }),
      });
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });
});

describe("response hardening", () => {
  function directive(csp: string, name: string): string[] {
    const d = csp.split(";").map((x) => x.trim()).find((x) => x.startsWith(`${name} `));
    return d ? d.split(/\s+/).slice(1) : [];
  }

  it("serves a CSP under which injected inline script cannot run", async () => {
    const csp = (await req("/api/health")).headers.get("content-security-policy") ?? "";
    const scriptSrc = directive(csp, "script-src");
    expect(scriptSrc).toContain("'self'");
    for (const banned of ["'unsafe-inline'", "'unsafe-eval'", "*", "data:", "blob:", "https:"]) {
      expect(scriptSrc).not.toContain(banned);
    }
  });

  // Cloudflare injects its Web Analytics beacon into HTML served to browsers;
  // a CSP that blocks it silently kills the site's visitor statistics.
  it("lets Cloudflare's analytics beacon load and report", async () => {
    const csp = (await req("/api/health")).headers.get("content-security-policy") ?? "";
    expect(directive(csp, "script-src")).toContain("https://static.cloudflareinsights.com");
    expect(directive(csp, "connect-src")).toContain("https://cloudflareinsights.com");
  });

  it("does not echo internal error text to the client", async () => {
    const res = await req("/api/cards/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = await res.text();
    expect(text).not.toMatch(/JSON|Unexpected|position|SyntaxError/i);
  });
});

describe("async generation, end to end", () => {
  async function submit() {
    const res = await req("/api/chunks/generate?async=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "in terms of" }),
    });
    expect(res.status).toBe(202);
    return ((await res.json()) as { jobId: string }).jobId;
  }

  async function poll(jobId: string) {
    return (await (await req(`/api/jobs/${jobId}`)).json()) as {
      status: string;
      result: unknown;
      error: string | null;
    };
  }

  it("a submitted job becomes pollable as done with the generator's result", async () => {
    const jobId = await submit();
    await vi.waitFor(async () => expect((await poll(jobId)).status).toBe("done"));
    expect((await poll(jobId)).result).toEqual(NOT_CHUNK);
  });

  it("a generator failure surfaces to the poller as a failed job, not a hung one", async () => {
    mockChunk.mockRejectedValue(new Error("model unavailable"));
    const jobId = await submit();
    await vi.waitFor(async () => expect((await poll(jobId)).status).toBe("failed"));
    expect((await poll(jobId)).error).toBe("model unavailable");
  });
});
