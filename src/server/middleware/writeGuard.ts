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
// Everything on this list is something a visitor legitimately does: generate
// content (each route enforces its own rate/daily limits), bump a usage
// counter, or manage their own job by its unguessable UUID.
const PUBLIC_WRITES: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ["POST", /^\/api\/auth\/(login|logout)$/],
  ["POST", /^\/api\/stories\/generate$/],
  ["POST", /^\/api\/stories\/\d+\/(tts|translate)$/],
  ["POST", /^\/api\/cards\/(generate|extract)$/],
  ["POST", /^\/api\/cards\/\d+\/deep$/],
  ["PATCH", /^\/api\/cards\/\d+\/usage$/],
  ["POST", /^\/api\/chunks\/generate$/],
  ["PATCH", /^\/api\/chunks\/\d+\/usage$/],
  ["POST", /^\/api\/practice\/generate$/],
  ["POST", /^\/api\/practice\/\d+\/grade$/],
  ["POST", /^\/api\/jobs\/[\w-]+\/cancel$/],
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
