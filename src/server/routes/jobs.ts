import { Hono } from "hono";
import { db } from "../db/index.js";
import { jobs } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { parseJob, setJobCancelled } from "../services/jobs.js";

export const jobRoutes = new Hono();

jobRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) {
    return c.json({ error: "Job not found", code: "NOT_FOUND" }, 404);
  }
  return c.json(parseJob(row));
});

jobRoutes.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) {
    return c.json({ error: "Job not found", code: "NOT_FOUND" }, 404);
  }

  if (row.status === "done" || row.status === "failed" || row.status === "cancelled") {
    return c.json(parseJob(row));
  }

  await setJobCancelled(id);
  const updated = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  return c.json(parseJob(updated!));
});

jobRoutes.get("/", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || "20")));
  const rows = await db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).all();
  return c.json({ jobs: rows.map(parseJob) });
});
