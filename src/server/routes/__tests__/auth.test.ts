import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { authRoutes } from "../../routes/auth.js";
import { authMiddleware, signToken } from "../../middleware/auth.js";

function buildApp() {
  const app = new Hono();
  app.route("/auth", authRoutes);
  app.use("/api/*", authMiddleware);
  app.get("/api/protected", (c) => c.json({ ok: true }));
  return app;
}

describe("auth middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clean slate per test
    delete process.env.AUTH_TOKEN;
    delete process.env.AUTH_SECRET;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows all requests when AUTH_TOKEN is not set (dev mode)", async () => {
    const app = buildApp();
    const res = await app.request("/api/protected");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 401 when AUTH_TOKEN is set but no session cookie", async () => {
    process.env.AUTH_TOKEN = "secret-token";
    const app = buildApp();
    const res = await app.request("/api/protected");
    expect(res.status).toBe(401);
  });

  it("returns 200 with a valid session cookie", async () => {
    process.env.AUTH_TOKEN = "secret-token";
    const signed = signToken("secret-token");
    const app = buildApp();
    const res = await app.request("/api/protected", {
      headers: { Cookie: `session=${signed}` },
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 with an invalid session cookie", async () => {
    process.env.AUTH_TOKEN = "secret-token";
    const app = buildApp();
    const res = await app.request("/api/protected", {
      headers: { Cookie: "session=bogus" },
    });
    expect(res.status).toBe(401);
  });

  describe("login endpoint", () => {
    it("returns ok in dev mode regardless of token", async () => {
      const app = buildApp();
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "anything" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("sets session cookie on correct token", async () => {
      process.env.AUTH_TOKEN = "secret-token";
      const app = buildApp();
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "secret-token" }),
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("session=");
    });

    it("returns 401 on wrong token", async () => {
      process.env.AUTH_TOKEN = "secret-token";
      const app = buildApp();
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "wrong" }),
      });
      expect(res.status).toBe(401);
    });
  });
});
