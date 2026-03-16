import { Hono } from "hono";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { updateSettingsSchema } from "../../shared/validation.js";

export const settingRoutes = new Hono();

// GET / — read all settings (mask API key)
settingRoutes.get("/", async (c) => {
  const rows = await db.select().from(settings).all();

  const result: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === "gemini_api_key") {
      result[row.key] = row.value ? "configured" : "";
    } else {
      result[row.key] = row.value;
    }
  }

  return c.json(result);
});

// PUT / — upsert a setting
settingRoutes.put("/", async (c) => {
  const body = await c.req.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  }

  const { key, value } = parsed.data;

  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    });

  return c.json({ ok: true });
});
