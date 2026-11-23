import { Hono } from "hono";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { updateSettingsSchema } from "../../shared/validation.js";
import { authMiddleware } from "../middleware/auth.js";
import { settingTestRoutes } from "./settingsTest.js";

export const settingRoutes = new Hono();

// Matched by suffix, not by a list of names: rows outlive the feature that
// wrote them (image_api_key is still in the table after image generation was
// removed), and a key that fell off a list would be served in the clear.
const isApiKey = (key: string) => key.endsWith("_api_key");
const isBaseUrl = (key: string) => key.endsWith("_base_url");

// GET / — read all settings. Admin only (the API guard does not list it as
// public). Even so a stored key never travels back to a browser: the admin
// gets to know that one is set, not what it is.
settingRoutes.get("/", async (c) => {
  const rows = await db.select().from(settings).all();

  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = isApiKey(row.key) ? (row.value ? "configured" : "") : row.value;
  }

  return c.json(result);
});

// PUT / — upsert a setting. The API guard already refuses visitors; this route
// writes credentials, so it keeps a check of its own as well.
settingRoutes.put("/", authMiddleware, async (c) => {
  const body = await c.req.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  const { key, value } = parsed.data;

  // The GET handler above answers "configured" in place of an api key, and
  // used to do the same for base URLs when the reader was anonymous. A client
  // that echoes a masked read back through save silently destroys the real
  // value (this actually happened to gemini_base_url and image_base_url), so
  // refuse the mask literal at the write boundary.
  if (value.trim() === "configured" && (isBaseUrl(key) || isApiKey(key))) {
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
