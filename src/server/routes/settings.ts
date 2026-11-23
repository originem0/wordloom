import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { updateSettingsSchema } from "../../shared/validation.js";
import { authMiddleware, verifySession } from "../middleware/auth.js";
import { settingTestRoutes } from "./settingsTest.js";

export const settingRoutes = new Hono();

// Sensitive keys hidden from unauthenticated users
const SENSITIVE_KEYS = new Set([
  "gemini_base_url", "openai_base_url", "image_base_url",
]);

// GET / — read all settings (public, but hides sensitive fields for anonymous users)
settingRoutes.get("/", async (c) => {
  const rows = await db.select().from(settings).all();

  const session = getCookie(c, "session");
  const isAdmin = session ? await verifySession(session) : false;

  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === "gemini_api_key" || row.key === "openai_api_key" || row.key === "image_api_key") {
      result[row.key] = row.value ? "configured" : "";
    } else if (!isAdmin && SENSITIVE_KEYS.has(row.key)) {
      // Hide sensitive config from anonymous users
      result[row.key] = row.value ? "configured" : "";
    } else {
      result[row.key] = row.value;
    }
  }

  return c.json(result);
});

// PUT / — upsert a setting (admin only)
settingRoutes.put("/", authMiddleware, async (c) => {
  const body = await c.req.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  const { key, value } = parsed.data;

  // The GET handler above masks api keys / base URLs as the literal "configured"
  // for anonymous readers. A client that echoes a masked read back through save
  // silently destroys the real value (this actually happened to gemini_base_url
  // and image_base_url), so refuse the mask literal at the write boundary.
  if (value.trim() === "configured" && (SENSITIVE_KEYS.has(key) || key.endsWith("_api_key"))) {
    return c.json({
      error: 'Refusing to save the masked placeholder "configured" — reload the page while logged in and re-enter the real value',
      code: "MASKED_LITERAL",
    }, 400);
  }

  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    });

  return c.json({ ok: true });
});

// POST /test — connectivity and model-capability probes (see settingsTest.ts)
settingRoutes.route("/", settingTestRoutes);
