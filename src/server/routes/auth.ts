import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { randomBytes } from "crypto";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { hashSessionId } from "../middleware/auth.js";

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ token: string }>();
  const expected = process.env.AUTH_TOKEN;

  // Dev mode: no AUTH_TOKEN set, accept anything
  if (!expected) {
    return c.json({ ok: true, message: "Dev mode — no auth required" });
  }

  if (body.token !== expected) {
    return c.json({ error: "Invalid token", code: "INVALID_TOKEN" }, 401);
  }

  const isProduction = process.env.NODE_ENV === "production";
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;
  const sessionId = randomBytes(32).toString("hex");
  const hashed = hashSessionId(sessionId);

  await db.insert(sessions).values({
    sessionId: hashed,
    createdAt: now,
    expiresAt,
    revokedAt: null,
  });

  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "Strict",
    maxAge: 2592000, // 30 days
    path: "/",
  });

  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    const hashed = hashSessionId(sessionId);
    await db
      .update(sessions)
      .set({ revokedAt: Date.now() })
      .where(eq(sessions.sessionId, hashed));
  }
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});
