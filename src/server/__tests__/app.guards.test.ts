import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// AI calls are the only external dependency of these routes; everything else
// (Hono wiring, middleware order, SQLite) is the real thing on an in-memory DB.
const mockExtract = vi.fn<(text: string) => Promise<string[]>>(async () => ["alpha"]);
// Stands in for the model: one bare card per word it is asked for.
const writeCards = async (words: string[]) => ({
  success: words.map((word) => ({ word })),
  failed: [] as { word: string; error: string }[],
});
const mockCards = vi.fn(writeCards);
vi.mock("../services/ai-router.js", () => ({
  generateStory: vi.fn(),
  generateTTS: vi.fn(),
  translateText: vi.fn(async () => "译文"),
  generateCards: (words: string[]) => mockCards(words),
  generateDeepLayer: vi.fn(),
  extractWords: (text: string) => mockExtract(text),
}));

import { app } from "../app.js";
import { db } from "../db/index.js";
import { cards, jobs, sessions, settings, stories } from "../db/schema.js";
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
  for (const t of [cards, jobs, sessions, settings, stories]) {
    await db.delete(t);
  }
  mockExtract.mockClear();
  mockCards.mockReset();
  mockCards.mockImplementation(writeCards);
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

  it("DELETE on stories is refused", async () => {
    expect((await req("/api/stories/1", { method: "DELETE" })).status).toBe(401);
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

  it("visitors can still read cards", async () => {
    const card = await seedCard();
    expect((await req("/api/cards")).status).toBe(200);
    expect((await req(`/api/cards/${card.id}`)).status).toBe(200);
  });
});

describe("generation and its bookkeeping are admin-only", () => {
  it.each([
    ["POST", "/api/stories/generate"],
    ["GET", "/api/stories/1/tts"],
    ["POST", "/api/stories/1/tts"],
    ["POST", "/api/stories/1/translate"],
    ["POST", "/api/cards/generate"],
    ["POST", "/api/cards/extract"],
    ["POST", "/api/cards/1/deep"],
  ])("%s %s is refused without a session", async (method, path) => {
    const res = await req(path, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });
    expect(res.status).toBe(401);
  });

  it("a refused extraction never reaches the model, and the admin's still does", async () => {
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "alpha beta" }),
    };
    expect((await req("/api/cards/extract", init)).status).toBe(401);
    expect(mockExtract).not.toHaveBeenCalled();

    const cookie = await adminCookie();
    const res = await req("/api/cards/extract", { ...init, headers: { ...init.headers, cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ words: ["alpha"] });
  });

  it("a job cannot be polled or cancelled without a session, even by its id", async () => {
    const now = Date.now();
    await db.insert(jobs).values({
      id: "0b5c7f0e-job", type: "cards", status: "running", input: "{}",
      createdAt: now, updatedAt: now,
    });
    expect((await req("/api/jobs/0b5c7f0e-job")).status).toBe(401);
    expect((await req("/api/jobs/0b5c7f0e-job/cancel", { method: "POST" })).status).toBe(401);
    expect((await db.select().from(jobs).where(eq(jobs.id, "0b5c7f0e-job")).get())?.status).toBe("running");

    const cookie = await adminCookie();
    expect((await req("/api/jobs/0b5c7f0e-job", { headers: { cookie } })).status).toBe(200);
    const res = await req("/api/jobs/0b5c7f0e-job/cancel", { method: "POST", headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it("the list of cards still missing a deep layer is admin-only", async () => {
    expect((await req("/api/cards/missing-deep")).status).toBe(401);
    const cookie = await adminCookie();
    expect((await req("/api/cards/missing-deep", { headers: { cookie } })).status).toBe(200);
  });
});

describe("cross-site writes", () => {
  // Sent with the admin's cookie, so the Origin check is the only thing that
  // can be refusing them.
  it("rejects a write whose Origin is another site when no allowlist is configured", async () => {
    const card = await seedCard();
    const cookie = await adminCookie();
    const res = await req(`/api/cards/${card.id}`, {
      method: "DELETE",
      origin: "https://evil.example",
      headers: { cookie },
    });
    expect(res.status).toBe(403);
    expect(await db.select().from(cards).where(eq(cards.id, card.id)).get()).toBeTruthy();
  });

  it("accepts the same site on a non-default port (nginx also listens on 8443)", async () => {
    const card = await seedCard();
    const cookie = await adminCookie();
    const res = await req(`/api/cards/${card.id}`, {
      method: "DELETE",
      origin: `https://${HOST}:8443`,
      headers: { cookie },
    });
    expect(res.status).toBe(200);
  });

  it("does not hand out credentialed CORS to arbitrary origins", async () => {
    const res = await req("/api/cards", { origin: "https://evil.example" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// The login is the one write a visitor can still make, and its throttle is all
// that stands between a guesser and AUTH_TOKEN.
describe("the login throttle cannot be reset by the client", () => {
  function attempt(ip: string, forwardedFor: string) {
    return req("/api/auth/login", {
      method: "POST",
      ip,
      headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
      body: JSON.stringify({ token: "wrong" }),
    });
  }

  it("a forged X-Forwarded-For does not buy fresh attempts", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await attempt("198.51.100.1", `10.0.0.${i}`)).status);
    }
    expect(statuses[0]).toBe(401);
    expect(statuses.at(-1)).toBe(429);
  });

  it("a different real client keeps its own attempts", async () => {
    for (let i = 0; i < 25; i++) await attempt("198.51.100.2", "10.0.0.1");
    expect((await attempt("198.51.100.2", "10.0.0.1")).status).toBe(429);
    expect((await attempt("198.51.100.3", "10.0.0.1")).status).toBe(401);
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
      headers: { "content-type": "application/json", cookie: await adminCookie() },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toMatch(/JSON|Unexpected|position|SyntaxError/i);
  });
});

describe("reading settings", () => {
  // The image_* rows stand for a feature that is gone: nothing reads them any
  // more, but they are still in the table.
  async function seedSettings() {
    const rows = {
      gemini_api_key: "g-secret",
      image_api_key: "i-secret",
      openai_base_url: "https://gw.internal/v1",
      image_base_url: "https://img.internal/v1",
      explanation_language: "zh",
    };
    await db.insert(settings).values(Object.entries(rows).map(([key, value]) => ({ key, value })));
  }

  async function readSettings(cookie?: string) {
    const res = await req("/api/settings", cookie ? { headers: { cookie } } : {});
    return (await res.json()) as Record<string, string>;
  }

  it("never returns a stored api key, not even to the admin", async () => {
    await seedSettings();
    for (const body of [await readSettings(), await readSettings(await adminCookie())]) {
      expect(body).toMatchObject({ gemini_api_key: "configured", image_api_key: "configured" });
      expect(JSON.stringify(body)).not.toContain("secret");
    }
  });

  it("hides base URLs from visitors and shows them to the admin", async () => {
    await seedSettings();
    expect(await readSettings()).toMatchObject({
      openai_base_url: "configured",
      image_base_url: "configured",
      explanation_language: "zh",
    });
    expect(await readSettings(await adminCookie())).toMatchObject({
      openai_base_url: "https://gw.internal/v1",
      image_base_url: "https://img.internal/v1",
    });
  });
});

describe("async generation, end to end", () => {
  async function submit(cookie: string) {
    const res = await req("/api/cards/generate?async=1", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ words: ["alpha"] }),
    });
    expect(res.status).toBe(202);
    return ((await res.json()) as { jobId: string }).jobId;
  }

  async function poll(jobId: string, cookie: string) {
    return (await (await req(`/api/jobs/${jobId}`, { headers: { cookie } })).json()) as {
      status: string;
      result: unknown;
      error: string | null;
    };
  }

  it("a submitted job becomes pollable as done with the generator's result", async () => {
    const cookie = await adminCookie();
    const jobId = await submit(cookie);
    await vi.waitFor(async () => expect((await poll(jobId, cookie)).status).toBe("done"));
    expect((await poll(jobId, cookie)).result).toMatchObject({ success: [{ word: "alpha" }], failed: [] });
    expect(await db.select().from(cards).where(eq(cards.word, "alpha")).get()).toBeTruthy();
  });

  it("a generator failure surfaces to the poller as a failed job, not a hung one", async () => {
    mockCards.mockRejectedValue(new Error("model unavailable"));
    const cookie = await adminCookie();
    const jobId = await submit(cookie);
    await vi.waitFor(async () => expect((await poll(jobId, cookie)).status).toBe("failed"));
    expect((await poll(jobId, cookie)).error).toBe("model unavailable");
  });
});
