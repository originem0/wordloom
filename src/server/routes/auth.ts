import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { signToken } from "../middleware/auth.js";

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

  const signed = signToken(expected);
  const isProduction = process.env.NODE_ENV === "production";

  setCookie(c, "session", signed, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "Strict",
    maxAge: 2592000, // 30 days
    path: "/",
  });

  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});
