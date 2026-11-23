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
  generateCards: (words: string[]) => mockCards(words),
  generateDeepLayer: vi.fn(),
  extractWords: (text: string) => mockExtract(text),
}));

import { app } from "../app.js";
import { db } from "../db/index.js";
import { cards, jobs, sessions, settings } from "../db/schema.js";
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

/** Turned away by the guard, as opposed to a handler answering 401 on its own
 *  account (a wrong login token is a 401 too). */
async function refused(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  return body.code === "AUTH_REQUIRED";
}

// Read off the Hono instance rather than listed by hand, so a route added
// later is probed without anyone remembering to add it here. Middleware and
// the 404 catch-all are registered under the method "ALL".
function registeredRoutes(): string[] {
  const found = new Set<string>();
  for (const { method, path } of app.routes) {
    if (method !== "ALL" && path.startsWith("/api/")) found.add(`${method} ${path}`);
  }
  return [...found];
}

const originalEnv = { ...process.env };

beforeEach(async () => {
  process.env.AUTH_TOKEN = "secret-token";
  process.env.AUTH_SECRET = "secret";
  delete process.env.ALLOWED_ORIGINS;
  for (const t of [cards, jobs, sessions, settings]) {
    await db.delete(t);
  }
  mockExtract.mockClear();
  mockCards.mockReset();
  mockCards.mockImplementation(writeCards);
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("what a visitor can reach", () => {
  it("is the public list and nothing else the app registers", async () => {
    const card = await seedCard();
    const routes = registeredRoutes();
    // Guards the probe itself: a table that lost the mounted routers would
    // leave the comparison below checking only the public routes.
    expect(routes).toEqual(
      expect.arrayContaining([
        "GET /api/settings",
        "PUT /api/settings",
        "POST /api/settings/test",
        "GET /api/jobs",
        "GET /api/jobs/:id",
        "POST /api/jobs/:id/cancel",
        "POST /api/cards/generate",
        "POST /api/cards/extract",
        "POST /api/cards/:id/deep",
        "GET /api/cards/missing-deep",
        "DELETE /api/cards/:id",
      ]),
    );

    const open: string[] = [];
    for (const route of routes) {
      const [method, pattern] = route.split(" ");
      const path = pattern.replace(/:\w+(\{[^}]+\})?/g, String(card.id));
      const res = await req(path, {
        method,
        ...(method === "GET" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }),
      });
      if (!(await refused(res))) open.push(route);
    }
    expect(open.sort()).toEqual([
      "GET /api/auth/me",
      "GET /api/cards",
      "GET /api/cards/:id",
      "GET /api/health",
      "POST /api/auth/login",
      "POST /api/auth/logout",
    ]);
  });

  it("includes reading the list and a single card", async () => {
    const card = await seedCard();
    const list = await req("/api/cards");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ total: 1 });
    const one = await req(`/api/cards/${card.id}`);
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ word: "anchor" });
  });

  // This is what default deny means: the answer does not depend on whether
  // anyone wrote a route, so it cannot depend on anyone remembering to guard it.
  it.each([
    ["GET", "/api/brand-new/x"],
    ["POST", "/api/brand-new/x"],
    ["DELETE", "/api/cards/anything/new-endpoint"],
    ["GET", "/api/stories"],
  ])("does not include a path no route answers: %s %s", async (method, path) => {
    expect(await refused(await req(path, { method }))).toBe(true);
  });

  it("does not include the look-alikes of a public path", async () => {
    const card = await seedCard();
    for (const path of [
      "/api/cards/",
      `/api/cards/${card.id}/`,
      `/api/cards/${card.id}/deep`,
      "/api/cards/missing-deep",
      "/api/cards/abc",
      "/api/health/x",
      "/api/auth/me/x",
    ]) {
      expect(await refused(await req(path)), path).toBe(true);
    }
  });

  it("treats HEAD as the GET it is answered by", async () => {
    expect((await req("/api/cards", { method: "HEAD" })).status).toBe(200);
    expect((await req("/api/settings", { method: "HEAD" })).status).toBe(401);
  });

  it("a refused DELETE leaves the card in place", async () => {
    const card = await seedCard();
    const res = await req(`/api/cards/${card.id}`, { method: "DELETE" });
    expect(res.status).toBe(401);
    expect(await db.select().from(cards).where(eq(cards.id, card.id)).get()).toBeTruthy();
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
});

describe("with the admin session", () => {
  it("the private reads answer", async () => {
    const cookie = await adminCookie();
    for (const path of ["/api/settings", "/api/jobs", "/api/cards/missing-deep"]) {
      expect((await req(path, { headers: { cookie } })).status, path).toBe(200);
    }
  });

  it("a card can be deleted", async () => {
    const card = await seedCard();
    const cookie = await adminCookie();
    const res = await req(`/api/cards/${card.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await db.select().from(cards).where(eq(cards.id, card.id)).get()).toBeUndefined();
  });

  // Story Studio, Chunk Forge and Practice were deleted, not hidden: behind
  // the guard there is nothing left to answer. JSON, because a GET that fell
  // through to the SPA fallback would come back as the app shell with a 200.
  it.each([
    ["GET", "/api/stories"],
    ["POST", "/api/stories/generate"],
    ["POST", "/api/stories/1/tts"],
    ["POST", "/api/stories/1/translate"],
    ["GET", "/api/chunks"],
    ["POST", "/api/chunks/generate"],
    ["GET", "/api/practice"],
    ["POST", "/api/practice/1/grade"],
    ["POST", "/api/cards/1/usage"],
    ["GET", "/api/brand-new/x"],
  ])("%s %s is a JSON 404", async (method, path) => {
    const res = await req(path, { method, headers: { cookie: await adminCookie() } });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("cross-site requests", () => {
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

  // The guard has no exemption for OPTIONS. It needs none as long as CORS
  // answers the preflight first; a browser sends that without the cookie.
  it("answers an allowed origin's preflight for a private route without a session", async () => {
    process.env.ALLOWED_ORIGINS = "https://app.example";
    const res = await req("/api/settings", {
      method: "OPTIONS",
      origin: "https://app.example",
      headers: { "access-control-request-method": "PUT" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
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

  // Generated images and speech are gone, and they were the only thing that
  // made blob: URLs or played media. An allowance nothing uses is only an
  // opening for injected content.
  it("allows no blob: content, and media only by the default rule", async () => {
    const csp = (await req("/api/health")).headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("blob:");
    expect(directive(csp, "img-src").sort()).toEqual(["'self'", "data:"]);
    expect(directive(csp, "media-src")).toEqual([]);
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
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

  it("tells a visitor nothing, not even which settings exist", async () => {
    await seedSettings();
    const res = await req("/api/settings");
    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(/secret|internal|api_key|base_url|explanation/);
  });

  it("never returns a stored api key, not even to the admin", async () => {
    await seedSettings();
    const res = await req("/api/settings", { headers: { cookie: await adminCookie() } });
    const body = (await res.json()) as Record<string, string>;
    expect(body).toMatchObject({ gemini_api_key: "configured", image_api_key: "configured" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("shows the admin everything else as stored", async () => {
    await seedSettings();
    const res = await req("/api/settings", { headers: { cookie: await adminCookie() } });
    expect(await res.json()).toMatchObject({
      openai_base_url: "https://gw.internal/v1",
      image_base_url: "https://img.internal/v1",
      explanation_language: "zh",
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
