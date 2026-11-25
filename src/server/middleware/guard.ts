import { createMiddleware } from "hono/factory";
import type { HttpBindings } from "@hono/node-server";
import { authMiddleware } from "./auth.js";

// Default-deny for the whole API.
//
// The app used to be "open unless a route remembers to add authMiddleware";
// when the global auth layer was removed to allow public visitors, every
// DELETE/PATCH silently became anonymous. Writes were turned default-deny
// first, and reads kept leaking the same way (the job list, the settings).
// Now nothing under /api is served without an admin session unless its method
// and path are listed here, so a route added without a thought for access is
// private. So is a path no route answers: a visitor gets the same 401 for
// both and cannot map the API by probing it.
//
// What a visitor may do is read the card library and sign in or out.
const PUBLIC: ReadonlyArray<readonly [method: string, path: RegExp]> = [
  ["GET", /^\/api\/health$/],
  ["GET", /^\/api\/auth\/me$/],
  ["POST", /^\/api\/auth\/(login|logout)$/],
  ["GET", /^\/api\/cards$/],
  ["GET", /^\/api\/cards\/\d+$/],
];

export const requireAuth = createMiddleware(async (c, next) => {
  // Hono answers HEAD with the GET handler, so HEAD is exactly as public as
  // GET. OPTIONS gets no exemption: cors() answers every preflight before
  // this runs, and an exemption would make any future OPTIONS handler public.
  const method = c.req.method.toUpperCase();
  const m = method === "HEAD" ? "GET" : method;
  if (PUBLIC.some(([pm, re]) => pm === m && re.test(c.req.path))) return next();
  return authMiddleware(c, next);
});

// The one way past the refusal below, for trying the library out on one's own
// machine: the switch, a server that is not a production one, and a request
// that this machine sent. It does nothing once AUTH_TOKEN is set, and index.ts
// starts no production server without AUTH_TOKEN, so a deployment cannot end up
// here by leaving something out. A reverse proxy or a tunnel in front makes
// every caller look local: the switch is not for a server that has one.
//
// The socket alone is not enough even without one. A page on any site can
// point its own name at 127.0.0.1 once it has loaded, and its requests then
// come from this machine's browser: so the request must be addressed to this
// machine by name. And the dev server passes on whatever reaches it, from the
// network too when it is started with --host: it is told to say whom it speaks
// for (vite.config.ts), and it may speak for this machine only.
const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const LOCAL_NAMES = ["localhost", "127.0.0.1", "[::1]"];
function nameOf(host: string | undefined) {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}
const openLocally = (env: Partial<HttpBindings> | undefined, host?: string, forwardedFor = "") =>
  process.env.EXPRESSIONS_OPEN_LOCALLY === "1" &&
  process.env.NODE_ENV !== "production" &&
  LOOPBACK.includes(env?.incoming?.socket?.remoteAddress ?? "") &&
  LOCAL_NAMES.includes(nameOf(host)) &&
  forwardedFor.split(",").every((from) => !from.trim() || LOOPBACK.includes(from.trim()));

// Second gate for private data. The global guard lets everything through when
// AUTH_TOKEN is unset (dev mode); private routes do the opposite and refuse to
// serve. Mount it on a pattern ending in "/*": a bare "/api/x" would leave
// every sub-path to the global guard alone.
export const requirePrivate = createMiddleware(async (c, next) => {
  if (!process.env.AUTH_TOKEN && !openLocally(c.env, c.req.header("host"), c.req.header("x-forwarded-for"))) {
    return c.json({ error: "Set AUTH_TOKEN to use private routes", code: "AUTH_NOT_CONFIGURED" }, 503);
  }
  c.header("Cache-Control", "no-store");
  return authMiddleware(c, next);
});
