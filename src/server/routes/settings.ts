import { z } from "zod";
import { randomUUID } from "node:crypto";
import { providerOrigin } from "../services/ai-shared.js";
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
  const batch = z.object({ changes: z.array(updateSettingsSchema).min(1).max(80), expectedRevision: z.string().optional() });
  const parsed = z.union([batch, updateSettingsSchema]).safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
  const changes = "changes" in parsed.data ? parsed.data.changes : [parsed.data];
  const expected = "changes" in parsed.data ? parsed.data.expectedRevision : undefined;
  if (changes.some(({ key }) => key === "_revision") || new Set(changes.map((p) => p.key)).size !== changes.length) return c.json({ error: "Invalid setting", code: "VALIDATION_ERROR" }, 400);
  if (changes.some(({ key, value }) => (isBaseUrl(key) || isApiKey(key)) && value.trim() === "configured")) return c.json({ error: "Masked placeholder", code: "MASKED_LITERAL" }, 400);
  return db.transaction(async (tx) => {
    const stored = Object.fromEntries((await tx.select().from(settings)).map(({ key, value }) => [key, value]));
    if (expected !== undefined && expected !== (stored._revision ?? "")) return c.json({ error: "Settings changed. Reload before saving.", code: "SETTINGS_CONFLICT" }, 409);
    const edits = Object.fromEntries(changes.map(({ key, value }) => [key, value]));
    for (const provider of ["gemini", "openai"]) {
      const url = provider + "_base_url", key = provider + "_api_key";
      if (!(url in edits)) continue;
      const next = providerOrigin(provider, edits[url]);
      if (next === null) return c.json({ error: "Invalid service URL", code: "INVALID_URL" }, 400);
      if (stored[key] && next !== providerOrigin(provider, stored[url] ?? "") && !(key in edits)) return c.json({ error: "Enter a key for the new service origin", code: "NEW_ORIGIN_KEY_REQUIRED" }, 400);
    }
    const revision = randomUUID();
    for (const { key, value } of [...changes, { key: "_revision", value: revision }]) await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
    return c.json({ ok: true, revision });
  });
});

// POST /test — connectivity and model-capability probes (see settingsTest.ts)
settingRoutes.route("/", settingTestRoutes);
