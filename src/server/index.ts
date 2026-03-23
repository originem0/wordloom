import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { storyRoutes } from "./routes/stories.js";
import { cardRoutes } from "./routes/cards.js";
import { settingRoutes } from "./routes/settings.js";
import { jobRoutes } from "./routes/jobs.js";
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
  .route("/api/settings", settingRoutes)
  .route("/api/jobs", jobRoutes);

// --- Static file serving (production) ---
// Serve built client assets
app.use("/assets/*", serveStatic({ root: "./dist/client" }));
app.use("/sw.js", serveStatic({ root: "./dist/client" }));
app.use("/workbox-*", serveStatic({ root: "./dist/client" }));
app.use("/manifest.json", serveStatic({ root: "./dist/client" }));
app.use("/manifest.webmanifest", serveStatic({ root: "./dist/client" }));
app.use("/icon.svg", serveStatic({ root: "./dist/client" }));
app.use("/icons.svg", serveStatic({ root: "./dist/client" }));
app.use("/icon-192.png", serveStatic({ root: "./dist/client" }));
app.use("/icon-512.png", serveStatic({ root: "./dist/client" }));
app.use("/favicon.svg", serveStatic({ root: "./dist/client" }));
app.use("/favicon.ico", serveStatic({ root: "./dist/client" }));
app.use("/favicon-32x32.png", serveStatic({ root: "./dist/client" }));
app.use("/registerSW.js", serveStatic({ root: "./dist/client" }));

// SPA fallback: any non-API route returns index.html
app.get("*", (c) => {
  const indexPath = "./dist/client/index.html";
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf-8");
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
