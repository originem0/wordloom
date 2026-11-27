import { randomUUID } from "crypto";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { jobs } from "../db/schema.js";

export type JobType = "cards" | "deep" | "deep-batch";
const controllers = new Map<string, AbortController>();
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

// Anything JSON.stringify can take. (The old Record<string, unknown> alias
// rejected plain interfaces, forcing `as unknown as` casts at every call site.)
type JsonLike = object;

const ACTIVE: JobStatus[] = ["queued", "running"];

function now() {
  return Date.now();
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function serializeJson(value: JsonLike): string {
  return JSON.stringify(value);
}

export function parseJob(row: typeof jobs.$inferSelect) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    input: safeParse(row.input),
    result: safeParse(row.result),
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export async function pruneJobs() {
  await db.delete(jobs).where(lt(jobs.completedAt, Date.now() - 14 * 86_400_000));
}

export async function claimJob(type: JobType, workKey: string, input: JsonLike, batchId?: string) {
  await pruneJobs();
  return db.transaction(async (tx) => {
    if (batchId) {
      const batch = await tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, batchId)).get();
      if (batch?.status !== "running") throw new Error("Batch stopped");
    }
    const active = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.workKey, workKey)).get();
    if (active) return { id: active.id, created: false };
    const id = randomUUID(), ts = now();
    await tx.insert(jobs).values({ id, type, workKey, status: "queued", input: serializeJson(batchId ? { ...input, batchId } : input), createdAt: ts, updatedAt: ts });
    return { id, created: true };
  });
}

export async function createJob(type: JobType, input: JsonLike): Promise<string> {
  await pruneJobs();
  const id = randomUUID();
  const ts = now();
  await db.insert(jobs).values({
    id,
    type,
    status: "queued",
    input: serializeJson(input),
    result: null,
    error: null,
    createdAt: ts,
    updatedAt: ts,
    startedAt: null,
    completedAt: null,
  });
  return id;
}

// The three transitions below only apply to a job that is still active. A
// cancel that lands while the work is in flight therefore wins by construction
// — there is no window between "check cancelled" and "write result".

/** Returns false if the job is no longer active (e.g. cancelled while queued). */
export async function setJobRunning(jobId: string): Promise<boolean> {
  const ts = now();
  const rows = await db
    .update(jobs)
    .set({ status: "running", updatedAt: ts, startedAt: ts })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function setJobDone(jobId: string, result: JsonLike, writer: Pick<typeof db, "update"> = db) {
  const ts = now();
  await writer
    .update(jobs)
    .set({
      status: "done", workKey: null,
      result: serializeJson(result),
      error: null,
      updatedAt: ts,
      completedAt: ts,
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ACTIVE)));
}

export async function setJobFailed(jobId: string, error: string) {
  const ts = now();
  await db
    .update(jobs)
    .set({
      status: "failed", workKey: null,
      error,
      updatedAt: ts,
      completedAt: ts,
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ACTIVE)));
}

export async function setJobCancelled(jobId: string) {
  const ts = now();
  // Cancel work started by this batch in the same statement as its parent.
  // A job the batch merely joined keeps its original owner.
  const ownedByBatch = and(eq(jobs.type, "deep"), sql`CASE WHEN json_valid(${jobs.input}) THEN json_extract(${jobs.input}, '$.batchId') END = ${jobId}`);
  const stopped = await db
    .update(jobs)
    .set({ status: "cancelled", workKey: null, updatedAt: ts, completedAt: ts })
    .where(and(or(eq(jobs.id, jobId), ownedByBatch), inArray(jobs.status, ACTIVE)))
    .returning({ id: jobs.id });
  for (const job of stopped) controllers.get(job.id)?.abort();
}

/**
 * Runs a job's work and records the outcome. Never rejects.
 *
 * Routes fire this with `void runJob(...)` after answering 202, so a rejection
 * here would be unhandled — and Node exits on unhandled rejections, taking the
 * server and every other in-flight job with it. All bookkeeping failures are
 * therefore caught and logged; the row is reconciled by failOrphanedJobs() on
 * the next start.
 */
export async function runJob(jobId: string, work: (signal: AbortSignal) => Promise<JsonLike>): Promise<void> {
  const controller = new AbortController();
  controllers.set(jobId, controller);
  try {
    if (!(await setJobRunning(jobId))) return;
    let result: JsonLike;
    try {
      result = await work(controller.signal);
    } catch (err) {
      await setJobFailed(jobId, err instanceof Error ? err.message : "Job failed");
      return;
    }
    await setJobDone(jobId, result);
  } catch (err) {
    console.error(`[jobs] could not record outcome of job ${jobId}:`, err instanceof Error ? err.name : "Error");
  } finally {
    controllers.delete(jobId);
  }
}

/**
 * Jobs execute inside this process, so any row still queued/running at startup
 * belongs to a process that no longer exists. Mark them failed so polling
 * clients get an answer instead of waiting forever.
 */
export async function failOrphanedJobs(): Promise<number> {
  await pruneJobs();
  const ts = now();
  const rows = await db
    .update(jobs)
    .set({
      status: "failed", workKey: null,
      error: "Interrupted by a server restart — please try again",
      updatedAt: ts,
      completedAt: ts,
    })
    .where(inArray(jobs.status, ACTIVE))
    .returning({ id: jobs.id });
  return rows.length;
}
