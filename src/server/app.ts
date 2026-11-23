import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import { requireAuthForWrites } from "./middleware/writeGuard.js";
import { authRoutes } from "./routes/auth.js";
import { storyRoutes } from "./routes/stories.js";
import { cardRoutes } from "./routes/cards.js";
import { settingRoutes } from "./routes/settings.js";
import { jobRoutes } from "./routes/jobs.js";
import { practiceRoutes } from "./routes/practice.js";
import { readFileSync, existsSync } from "fs";

// App assembly lives here (not in index.ts) so tests can import the fully
// wired app — middleware order and route guards included — without binding
// a port.
const app = new Hono();

app.use("*", logger());

// Inline <script> and unlisted origins are forbidden outright: AI-generated
// text and SVG end up in the page, and a prompt-injected payload must not be
// able to run even if a rendering sink slips through review. Styles stay
// 'unsafe-inline' because React style attributes and Tailwind need it.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // The one third-party script: Cloudflare injects its Web Analytics
      // beacon into HTML it proxies. It already terminates all our traffic,
      // so allowing it adds no trust; blocking it kills visitor statistics.
      scriptSrc: ["'self'", "https://static.cloudflareinsights.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "https://cloudflareinsights.com"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
);

function getAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

// Without an explicit allowlist the only acceptable Origin is our own site.
// Compared by hostname, not host: nginx forwards $host (no port) while the
// browser's Origin carries one when the site is reached on :8443.
function isSameSite(origin: string, hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  try {
    return new URL(origin).hostname === new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
}

app.use(
  "/api/*",
  cors({
    // Same-origin requests need no CORS headers at all, so with no allowlist
    // nothing is granted (this used to reflect any Origin with credentials).
    origin: (origin) => (origin && getAllowedOrigins().includes(origin) ? origin : ""),
    credentials: true,
  }),
);

app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return next();
  }
  const origin = c.req.header("origin");
  if (!origin) return c.json({ error: "Missing Origin", code: "CSRF_BLOCKED" }, 403);
  const allowed = getAllowedOrigins();
  const ok = allowed.length > 0 ? allowed.includes(origin) : isSameSite(origin, c.req.header("host"));
  if (!ok) {
    return c.json({ error: "Origin not allowed", code: "CSRF_BLOCKED" }, 403);
  }
  return next();
});

app.use("/api/*", requireAuthForWrites);

// Health check (no auth)
app.get("/api/health", (c) => c.json({ ok: true }));

// Auth routes
app.route("/api/auth", authRoutes);

// Reads are public; writes pass requireAuthForWrites above. Daily limits are
// enforced inside each public generate route.
// Chained (not separate app.route calls) so the route types accumulate into
// AppType for a future Hono RPC client.
export const apiRoutes = app
  .route("/api/stories", storyRoutes)
  .route("/api/cards", cardRoutes)
  .route("/api/settings", settingRoutes)
  .route("/api/jobs", jobRoutes)
  .route("/api/practice", practiceRoutes);

// --- Static file serving (production) ---
// One catch-all serveStatic replaces the old per-file routes: the previous
// "/workbox-*" pattern never matched (Hono has no mid-segment wildcard), so
// the workbox runtime fell through to the HTML fallback and the service
// worker could not install at all.
const staticFiles = serveStatic({ root: "./dist/client" });
app.use("*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
  const res = await staticFiles(c, next);
  if (res instanceof Response && res.status === 200) {
    // Vite content-hashes /assets/* so they can cache forever; everything else
    // (sw.js, workbox runtime, manifest, icons) must revalidate on every load
    // or service-worker/manifest updates would never reach the browser.
    res.headers.set(
      "Cache-Control",
      c.req.path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
  }
  return res;
});

// SPA fallback: any non-API route returns index.html
app.get("*", (c) => {
  // Asset-like paths must 404 instead of falling back: HTML under a .js URL
  // breaks SW importScripts (wrong MIME) and can get edge-cached by extension.
  if (/\.\w+$/.test(c.req.path)) {
    return c.text("Not found", 404);
  }
  const indexPath = "./dist/client/index.html";
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf-8");
    // index.html references hashed assets — a cached stale copy points at
    // deleted files and sends the app into the lazy-import reload loop.
    c.header("Cache-Control", "no-cache");
    return c.html(html);
  }
  return c.text("Not found", 404);
});

// Global error handler. The real error goes to the journal; the client gets a
// fixed string, because err.message here can carry upstream URLs, SQL, or
// parser internals to anonymous callers.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof SyntaxError) {
    return c.json({ error: "Malformed request body", code: "BAD_REQUEST" }, 400);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
});

export { app };
export type AppType = typeof apiRoutes;
