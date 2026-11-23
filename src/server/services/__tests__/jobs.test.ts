import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { jobs } from "../../db/schema.js";
import { createJob, runJob, failOrphanedJobs, setJobCancelled } from "../jobs.js";

async function read(id: string) {
  const row = await db.select().from(jobs).where(eq(jobs.id, id)).get();
  if (!row) throw new Error("job row missing");
  return row;
}

beforeEach(async () => {
  await db.delete(jobs);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runJob", () => {
  it("records the result of work that succeeds", async () => {
    const id = await createJob("cards", { words: ["a"] });
    await runJob(id, async () => ({ success: [1], failed: [] }));
    const row = await read(id);
    expect(row.status).toBe("done");
    expect(JSON.parse(row.result!)).toEqual({ success: [1], failed: [] });
    expect(row.startedAt).not.toBeNull();
    expect(row.completedAt).not.toBeNull();
  });

  it("records the error of work that throws", async () => {
    const id = await createJob("story", {});
    await runJob(id, async () => {
      throw new Error("upstream said no");
    });
    const row = await read(id);
    expect(row.status).toBe("failed");
    expect(row.error).toBe("upstream said no");
  });

  it("does not start work for a job cancelled while still queued", async () => {
    const id = await createJob("cards", {});
    await setJobCancelled(id);
    const work = vi.fn(async () => ({}));
    await runJob(id, work);
    expect(work).not.toHaveBeenCalled();
    expect((await read(id)).status).toBe("cancelled");
  });

  it("keeps a job cancelled when the work finishes after the cancel", async () => {
    const id = await createJob("cards", {});
    await runJob(id, async () => {
      await setJobCancelled(id);
      return { late: true };
    });
    const row = await read(id);
    expect(row.status).toBe("cancelled");
    expect(row.result).toBeNull();
  });

  it("keeps a job cancelled when the work fails after the cancel", async () => {
    const id = await createJob("cards", {});
    await runJob(id, async () => {
      await setJobCancelled(id);
      throw new Error("too late to matter");
    });
    expect((await read(id)).status).toBe("cancelled");
  });

  // Routes start jobs with `void runJob(...)`. A rejection there is unhandled,
  // and Node terminates the process on unhandled rejections — one failed
  // bookkeeping write would take the whole server (and every other job) down.
  it("never rejects, even when the database fails underneath it", async () => {
    const id = await createJob("cards", {});
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(db, "update").mockImplementation(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });
    await expect(runJob(id, async () => ({}))).resolves.toBeUndefined();
  });

  it("never rejects when both the work and the failure bookkeeping throw", async () => {
    const id = await createJob("cards", {});
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const realUpdate = db.update.bind(db);
    let calls = 0;
    vi.spyOn(db, "update").mockImplementation(((table: Parameters<typeof db.update>[0]) => {
      calls += 1;
      if (calls === 1) return realUpdate(table); // setJobRunning succeeds
      throw new Error("SQLITE_BUSY: database is locked");
    }) as typeof db.update);
    await expect(
      runJob(id, async () => {
        throw new Error("work failed");
      }),
    ).resolves.toBeUndefined();
  });
});

describe("failOrphanedJobs", () => {
  // Jobs run in-process. After a restart nothing is working on a row that
  // still says queued/running, and a client polling it would wait forever.
  it("fails jobs left queued or running by a previous process and reports how many", async () => {
    const queued = await createJob("cards", {});
    const running = await createJob("story", {});
    await db.update(jobs).set({ status: "running" }).where(eq(jobs.id, running));

    expect(await failOrphanedJobs()).toBe(2);

    for (const id of [queued, running]) {
      const row = await read(id);
      expect(row.status).toBe("failed");
      expect(row.error).toMatch(/restart/i);
      expect(row.completedAt).not.toBeNull();
    }
  });

  it("leaves finished jobs exactly as they were", async () => {
    const done = await createJob("cards", {});
    await runJob(done, async () => ({ ok: true }));
    const cancelled = await createJob("cards", {});
    await setJobCancelled(cancelled);

    expect(await failOrphanedJobs()).toBe(0);
    expect((await read(done)).status).toBe("done");
    expect((await read(cancelled)).status).toBe("cancelled");
  });
});
