import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { createHmac } from "crypto";
import { db } from "../db/index.js";
import { sessions } from "../db/schema.js";
import { eq } from "drizzle-orm";

const getSecret = () => process.env.AUTH_SECRET || "dev-secret";

export function hashSessionId(sessionId: string): string {
  return createHmac("sha256", getSecret()).update(sessionId).digest("hex");
}

export async function verifySession(sessionValue: string): Promise<boolean> {
  const token = process.env.AUTH_TOKEN;
  if (!token) return true; // No auth configured = dev mode
  const hashed = hashSessionId(sessionValue);
  const row = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionId, hashed))
    .get();
  if (!row) return false;
  if (row.revokedAt != null) return false;
  if (row.expiresAt <= Date.now()) return false;
  return true;
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const token = process.env.AUTH_TOKEN;
  if (!token) return next(); // No auth configured = dev mode

  const session = getCookie(c, "session");
  if (!session || !(await verifySession(session))) {
    return c.json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, 401);
  }
  await next();
});
