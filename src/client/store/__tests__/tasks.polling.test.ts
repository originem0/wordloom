// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { useTaskStore } from "../tasks";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** Answers the submit with a job id, then every poll with `pollResponse()`. */
function stubServer(pollResponse: () => Response | Promise<Response>) {
  const polls = vi.fn(pollResponse);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/cards/generate")) return json({ jobId: "job-1", status: "queued" }, 202);
      if (url === "/api/jobs/job-1") return polls();
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return polls;
}

const task = (id: string) => useTaskStore.getState().tasks.find((t) => t.id === id)!;

beforeEach(() => {
  vi.useFakeTimers();
  useTaskStore.setState({ tasks: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("job polling", () => {
  it("keeps polling through a transient server error and completes", async () => {
    let n = 0;
    stubServer(() => (++n === 1 ? json({ error: "bad gateway" }, 502) : json({ id: "job-1", type: "cards", status: "done", result: { success: [], failed: [] } })));
    const id = useTaskStore.getState().submitCards(["anchor"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task(id).status).toBe("done");
  });

  // The server forgets nothing on its own, so 404 means the job is gone for
  // good (wrong DB, pruned row). Retrying it every 2.5s forever helps nobody.
  it("stops and reports failure when the server no longer knows the job", async () => {
    const polls = stubServer(() => json({ error: "Job not found", code: "NOT_FOUND" }, 404));
    const id = useTaskStore.getState().submitCards(["anchor"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task(id).status).toBe("failed");
    const settled = polls.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls.mock.calls.length).toBe(settled);
  });

  it("gives up after the server has been unreachable for a sustained stretch", async () => {
    const polls = stubServer(() => {
      throw new TypeError("Failed to fetch");
    });
    const id = useTaskStore.getState().submitCards(["anchor"]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(task(id).status).toBe("failed");
    const settled = polls.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(polls.mock.calls.length).toBe(settled);
  });
});
