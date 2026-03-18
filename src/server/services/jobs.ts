import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { jobs } from "../db/schema.js";

export type JobType = "story" | "cards";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

type JsonLike = Record<string, unknown> | unknown[];

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

export async function getJobRow(jobId: string) {
  return await db.select().from(jobs).where(eq(jobs.id, jobId)).get();
}

export async function setJobRunning(jobId: string) {
  const ts = now();
  await db
    .update(jobs)
    .set({ status: "running", updatedAt: ts, startedAt: ts })
    .where(eq(jobs.id, jobId));
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
    .where(eq(jobs.id, jobId));
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
    .where(eq(jobs.id, jobId));
}

export async function setJobCancelled(jobId: string) {
  const ts = now();
  await db
    .update(jobs)
    .set({ status: "cancelled", updatedAt: ts, completedAt: ts })
    .where(eq(jobs.id, jobId));
}

export async function isJobCancelled(jobId: string): Promise<boolean> {
  const row = await getJobRow(jobId);
  return row?.status === "cancelled";
}
