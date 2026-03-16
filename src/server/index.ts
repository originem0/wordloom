import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { authMiddleware } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { storyRoutes } from "./routes/stories.js";
import { cardRoutes } from "./routes/cards.js";
import { settingRoutes } from "./routes/settings.js";

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

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: err.message, code: "INTERNAL_ERROR" }, 500);
});

export type AppType = typeof apiRoutes;

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) });
console.log(`Server running on http://localhost:${process.env.PORT ?? 3001}`);
