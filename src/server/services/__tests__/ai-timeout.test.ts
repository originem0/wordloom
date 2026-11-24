import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { getRuntimeSettings, withTimeout } from "../ai-shared.js";
import {
  openaiExtractWords,
  openaiGenerateCards,
  openaiGenerateDeepLayer,
} from "../openai-compat.js";

// Real settings table (in-memory), real retry/timeout/semaphore code. Only the
// network is replaced: a fetch that never answers, and gives up only if the
// caller actually aborts it.
type FetchInit = { signal?: AbortSignal };
const hangingFetch = vi.fn(
  (_url: string, init?: FetchInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    }),
);

async function configure(extra: Record<string, string> = {}) {
  await db.delete(settings);
  const rows = {
    openai_api_key: "k",
    openai_base_url: "https://gateway.test/v1",
    utility_openai_model: "m",
    cards_openai_model: "m",
    deep_openai_model: "m",
    api_timeout_ms: "5000",
    api_max_retries: "1",
    ...extra,
  };
  await db.insert(settings).values(Object.entries(rows).map(([key, value]) => ({ key, value })));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  hangingFetch.mockClear();
  vi.stubGlobal("fetch", hangingFetch);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("withTimeout", () => {
  it("aborts the work it was timing when the deadline passes", async () => {
    let seen: AbortSignal | undefined;
    const pending = withTimeout((signal) => {
      seen = signal;
      return new Promise<never>(() => {});
    }, 1000);
    const rejection = expect(pending).rejects.toThrow("timeout after 1000ms");
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
    expect(seen?.aborted).toBe(true);
  });

  it("leaves the signal un-aborted and no timer behind when work finishes in time", async () => {
    let seen: AbortSignal | undefined;
    const value = await withTimeout(async (signal) => {
      seen = signal;
      return 42;
    }, 1000);
    expect(value).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen?.aborted).toBe(false);
  });
});

describe("a timed-out provider call is cancelled, not abandoned", () => {
  it("aborts the upstream HTTP request when the timeout fires", async () => {
    await configure();
    const call = openaiExtractWords("some text");
    const rejection = expect(call).rejects.toThrow(/timeout after 5000ms/);
    await vi.waitFor(() => expect(hangingFetch).toHaveBeenCalledTimes(1));
    expect(hangingFetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
    expect(hangingFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("a retry never overlaps the attempt it replaces", async () => {
    await configure({ api_max_retries: "2" });
    const call = openaiExtractWords("some text");
    const rejection = expect(call).rejects.toThrow(/timeout/);
    await vi.waitFor(() => expect(hangingFetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5000); // first attempt times out
    await vi.advanceTimersByTimeAsync(2000); // back-off
    await vi.waitFor(() => expect(hangingFetch).toHaveBeenCalledTimes(2));
    expect(hangingFetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(hangingFetch.mock.calls[1][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it.each([
    ["cards", () => openaiGenerateCards(["word"])],
    ["deep", () => openaiGenerateDeepLayer("word")],
  ])("%s hands its request an abort signal", async (_name, invoke) => {
    await configure();
    const call = invoke().catch((e: unknown) => e);
    await vi.waitFor(() => expect(hangingFetch).toHaveBeenCalled());
    expect(hangingFetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(60_000);
    await call;
  });
});

// A setting nobody saved, and a field saved empty, both read as "". Number("")
// is 0, so taking it for a number would clamp it to the minimum: five seconds
// and a single attempt, where the settings page promises the defaults.
describe("the timeout and the attempts a call gets", () => {
  async function network(rows: Record<string, string>) {
    await db.delete(settings);
    const values = Object.entries(rows).map(([key, value]) => ({ key, value }));
    if (values.length > 0) await db.insert(settings).values(values);
    return getRuntimeSettings();
  }

  it.each([
    ["nothing is stored", {}],
    ["the fields were saved empty", { api_timeout_ms: "", api_max_retries: "" }],
    ["the values are blank", { api_timeout_ms: "  ", api_max_retries: " " }],
    ["the values are not numbers", { api_timeout_ms: "soon", api_max_retries: "many" }],
  ])("are the defaults when %s", async (_what, rows) => {
    expect(await network(rows)).toEqual({ timeoutMs: 60_000, maxRetries: 3 });
  });

  it.each([
    [{ api_timeout_ms: "45000", api_max_retries: "2" }, { timeoutMs: 45_000, maxRetries: 2 }],
    [{ api_timeout_ms: "1", api_max_retries: "0" }, { timeoutMs: 5_000, maxRetries: 1 }],
    [{ api_timeout_ms: "999999999", api_max_retries: "99" }, { timeoutMs: 300_000, maxRetries: 6 }],
  ])("are the stored numbers, kept within bounds: %j", async (rows, expected) => {
    expect(await network(rows)).toEqual(expected);
  });

  it("reach the request: with no timeout stored it is given the default, not the minimum", async () => {
    await configure({ api_timeout_ms: "" });
    const call = openaiExtractWords("some text");
    const rejection = expect(call).rejects.toThrow(/timeout after 60000ms/);
    await vi.waitFor(() => expect(hangingFetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(hangingFetch.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });
});
