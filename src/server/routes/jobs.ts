import { pageNumber } from "../../shared/validation.js";
import { Hono } from "hono";
import { db } from "../db/index.js";
import { jobs } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { parseJob, setJobCancelled } from "../services/jobs.js";

export const jobRoutes = new Hono();

// Nothing here is on the API guard's public list: a job carries its input and
// its result, and only the admin can start one.
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
  const limit = pageNumber(c.req.query("limit"), 20, 100);
  if (!limit) return c.json({ error: "Invalid limit", code: "VALIDATION_ERROR" }, 400);
  const rows = await db.select({ id: jobs.id, type: jobs.type, status: jobs.status, createdAt: jobs.createdAt, updatedAt: jobs.updatedAt, completedAt: jobs.completedAt }).from(jobs).orderBy(desc(jobs.createdAt), desc(jobs.id)).limit(limit).all();
  return c.json({ jobs: rows });
});
