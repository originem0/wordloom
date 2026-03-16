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
import { readFileSync, existsSync } from "fs";

const app = new Hono();

app.use("*", logger());
app.use("/api/*", cors());

// Health check (no auth)
app.get("/api/health", (c) => c.json({ ok: true }));

// Auth routes (no auth middleware)
app.route("/api/auth", authRoutes);

// Protected routes
app.use("/api/*", authMiddleware);
const apiRoutes = app
  .route("/api/stories", storyRoutes)
  .route("/api/cards", cardRoutes)
  .route("/api/settings", settingRoutes);

// --- Static file serving (production) ---
// Serve built client assets
app.use("/assets/*", serveStatic({ root: "./dist/client" }));
app.use("/sw.js", serveStatic({ root: "./dist/client" }));
app.use("/workbox-*", serveStatic({ root: "./dist/client" }));
app.use("/manifest.json", serveStatic({ root: "./dist/client" }));
app.use("/manifest.webmanifest", serveStatic({ root: "./dist/client" }));
app.use("/icon*", serveStatic({ root: "./dist/client" }));
app.use("/favicon*", serveStatic({ root: "./dist/client" }));
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
