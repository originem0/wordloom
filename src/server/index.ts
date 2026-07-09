import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { storyRoutes } from "./routes/stories.js";
import { cardRoutes } from "./routes/cards.js";
import { chunkRoutes } from "./routes/chunks.js";
import { settingRoutes } from "./routes/settings.js";
import { jobRoutes } from "./routes/jobs.js";
import { practiceRoutes } from "./routes/practice.js";
import { readFileSync, existsSync } from "fs";

if (process.env.NODE_ENV === "production") {
  if (!process.env.AUTH_SECRET || !process.env.AUTH_TOKEN) {
    console.error("Missing AUTH_SECRET or AUTH_TOKEN in production.");
    process.exit(1);
  }
}

const app = new Hono();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use("*", logger());
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) return "";
      if (allowedOrigins.length === 0) return origin;
      return allowedOrigins.includes(origin) ? origin : "";
    },
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
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    return c.json({ error: "Origin not allowed", code: "CSRF_BLOCKED" }, 403);
  }
  return next();
});

// Health check (no auth)
app.get("/api/health", (c) => c.json({ ok: true }));

// Auth routes (no auth middleware)
app.route("/api/auth", authRoutes);

// Public routes — daily limits enforced inside each route
const apiRoutes = app
  .route("/api/stories", storyRoutes)
  .route("/api/cards", cardRoutes)
  .route("/api/chunks", chunkRoutes)
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

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: err.message, code: "INTERNAL_ERROR" }, 500);
});

export type AppType = typeof apiRoutes;

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) });
console.log(`Server running on http://localhost:${process.env.PORT ?? 3001}`);
