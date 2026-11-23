import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { jobs } from "../db/schema.js";

export type JobType = "cards";
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

export async function createJob(type: JobType, input: JsonLike): Promise<string> {
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
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ACTIVE)))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export async function setJobDone(jobId: string, result: JsonLike) {
  const ts = now();
  await db
    .update(jobs)
    .set({
      status: "done",
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
      status: "failed",
      error,
      updatedAt: ts,
      completedAt: ts,
    })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ACTIVE)));
}

export async function setJobCancelled(jobId: string) {
  const ts = now();
  await db
    .update(jobs)
    .set({ status: "cancelled", updatedAt: ts, completedAt: ts })
    .where(eq(jobs.id, jobId));
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
export async function runJob(jobId: string, work: () => Promise<JsonLike>): Promise<void> {
  try {
    if (!(await setJobRunning(jobId))) return;
    let result: JsonLike;
    try {
      result = await work();
    } catch (err) {
      await setJobFailed(jobId, err instanceof Error ? err.message : "Job failed");
      return;
    }
    await setJobDone(jobId, result);
  } catch (err) {
    console.error(`[jobs] could not record outcome of job ${jobId}:`, err);
  }
}

/**
 * Jobs execute inside this process, so any row still queued/running at startup
 * belongs to a process that no longer exists. Mark them failed so polling
 * clients get an answer instead of waiting forever.
 */
export async function failOrphanedJobs(): Promise<number> {
  const ts = now();
  const rows = await db
    .update(jobs)
    .set({
      status: "failed",
      error: "Interrupted by a server restart — please try again",
      updatedAt: ts,
      completedAt: ts,
    })
    .where(inArray(jobs.status, ACTIVE))
    .returning({ id: jobs.id });
  return rows.length;
}
