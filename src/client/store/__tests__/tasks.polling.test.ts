// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from "sonner";
import { taskError, useTaskStore } from "../tasks";
import { useAppStore } from "..";

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
  useAppStore.setState({ uiLanguage: "zh-CN" });
  vi.useFakeTimers();
  vi.mocked(toast.error).mockClear();
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

  // So is 401. Jobs are the admin's: once the session is gone every poll is
  // refused, and five minutes of retrying would only delay saying so.
  it("stops at the first poll the server refuses for want of a session", async () => {
    const polls = stubServer(() => json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, 401));
    const id = useTaskStore.getState().submitCards(["anchor"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(task(id).status).toBe("failed");
    expect(task(id).error).toMatch(/登录/);
    useAppStore.getState().setUiLanguage("en");
    expect(taskError(task(id))).toBe("Your session has expired. Sign in again to view the results");
    expect(polls).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls).toHaveBeenCalledTimes(1);
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

it("uses the current language for submission failures and retranslates the stored error", async () => {
  useAppStore.getState().setUiLanguage("en");
  vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, 401)));
  const id = useTaskStore.getState().submitCards(["anchor"]);
  await vi.advanceTimersByTimeAsync(1_000);

  expect(task(id).status).toBe("failed");
  expect(toast.error).toHaveBeenCalledWith("Card generation failed: Please sign in as an administrator.");
  expect(taskError(task(id))).toBe("Please sign in as an administrator.");
  useAppStore.getState().setUiLanguage("zh-CN");
  expect(taskError(task(id))).toBe("请先登录管理员账号。");
});

// Signing out empties the list: the tasks were the admin's, and following
// them takes the session that has just ended.
describe("reset at sign-out", () => {
  it("drops the tasks and stops following them", async () => {
    const polls = stubServer(() => json({ id: "job-1", type: "cards", status: "running" }));
    useTaskStore.getState().submitCards(["anchor"]);
    await vi.advanceTimersByTimeAsync(5_000);
    const before = polls.mock.calls.length;
    expect(before).toBeGreaterThan(0);

    useTaskStore.getState().reset();
    expect(useTaskStore.getState().tasks).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls.mock.calls.length).toBe(before);
    expect(toast.error).not.toHaveBeenCalled();
  });

  // The poll that was already on its way comes back 401. There is no task
  // left to mark as failed, and nobody to tell.
  it("reports no failure for a poll that was in flight", async () => {
    let answer!: (res: Response) => void;
    const polls = stubServer(() => new Promise<Response>((resolve) => (answer = resolve)));
    useTaskStore.getState().submitCards(["anchor"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(polls).toHaveBeenCalledTimes(1);

    useTaskStore.getState().reset();
    answer(json({ error: "Unauthorized", code: "AUTH_REQUIRED" }, 401));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useTaskStore.getState().tasks).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(polls).toHaveBeenCalledTimes(1);
  });

  it("abandons a submission the server has not answered yet", async () => {
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    useTaskStore.getState().submitCards(["anchor"]);
    useTaskStore.getState().reset();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(aborted).toBe(true);
    expect(useTaskStore.getState().tasks).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
