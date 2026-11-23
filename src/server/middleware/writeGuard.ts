import { createMiddleware } from "hono/factory";
import { authMiddleware } from "./auth.js";

// Default-deny for state-changing requests.
//
// The app used to be "open unless a route remembers to add authMiddleware";
// when the global auth layer was removed to allow public visitors, every
// DELETE/PATCH silently became anonymous. The polarity is now inverted: a
// non-GET request needs an admin session unless its route is listed here.
// Adding a new write route therefore fails closed.
//
// The only write a visitor still makes is signing in or out. Generation used
// to be listed here too: it let anyone overwrite a chunk row by re-analysing
// its form, feed arbitrarily long text into a prompt, and read the upstream
// provider's raw error text — so it is admin-only now.
const PUBLIC_WRITES: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ["POST", /^\/api\/auth\/(login|logout)$/],
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isPublicWrite(method: string, path: string): boolean {
  return PUBLIC_WRITES.some(([m, re]) => m === method && re.test(path));
}

export const requireAuthForWrites = createMiddleware(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (SAFE_METHODS.has(method) || isPublicWrite(method, c.req.path)) {
    return next();
  }
  return authMiddleware(c, next);
});
