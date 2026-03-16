import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { createHmac } from "crypto";

const getSecret = () => process.env.AUTH_SECRET || "dev-secret";

export function signToken(token: string): string {
  return createHmac("sha256", getSecret()).update(token).digest("hex");
}

export function verifySession(sessionValue: string): boolean {
  const token = process.env.AUTH_TOKEN;
  if (!token) return true; // No auth configured = dev mode
  return sessionValue === signToken(token);
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const token = process.env.AUTH_TOKEN;
  if (!token) return next(); // No auth configured = dev mode

  const session = getCookie(c, "session");
  if (!session || !verifySession(session)) {
    return c.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, 401);
  }
  await next();
});
