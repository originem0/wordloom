import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const gemini = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContentStream: gemini };
  },
}));

import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { generateJson, generateTextStream } from "../ai-router.js";

const gateway = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const CALL = { system: "Answer in English.", user: '{"said":"A thought."}', label: "expressions.reply" };
const OPENAI = {
  openai_api_key: "dummy-key", openai_base_url: "https://gateway.test/v1", cards_provider: "openai", cards_openai_model: "cards-m",
  cards_openai_fallback_model: "fallback-m", api_timeout_ms: "5000", api_max_retries: "5",
};
async function configure(rows: Record<string, string> = OPENAI) {
  await db.delete(settings);
  await db.insert(settings).values(Object.entries(rows).map(([key, value]) => ({ key, value })));
}
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n`;
const STOP = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\n';
const END = "data: [DONE]\r\n\r\n";
function response(text: string, splits: number[] = []) {
  const bytes = new TextEncoder().encode(text);
  const points = [...new Set([0, ...splits.filter((point) => point > 0 && point < bytes.length), bytes.length])].sort((a, b) => a - b);
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 1; i < points.length; i++) controller.enqueue(bytes.slice(points[i - 1], points[i]));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}
const jsonReply = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
  headers: { "content-type": "application/json" },
});
const hang = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
  if (init?.signal?.aborted) reject(init.signal.reason);
  else init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
});
const onDelta = () => vi.fn<(text: string) => Promise<void>>(async () => {});
const sent = (n = 0) => JSON.parse(gateway.mock.calls[n][1]!.body as string) as {
  model: string; stream: boolean; messages: { role: string; content: string }[];
};
async function* parts(chunks: { text?: string; candidates?: { finishReason: string }[] }[]) {
  for (const chunk of chunks) yield chunk;
}

beforeEach(() => {
  gemini.mockReset();
  gateway.mockReset();
  vi.stubGlobal("fetch", gateway);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a conversation on the real streaming channel", () => {
  it("does not retry a quota 429 on the JSON coaching phase even when its message only says rate limited", async () => {
    await configure();
    gateway.mockImplementation(async () => new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "Rate limited" } }), { status: 429 }));
    await expect(generateJson("expressions", { ...CALL, retryFast: true })).rejects.toThrow(/quota/i);
    expect(gateway).toHaveBeenCalledTimes(1);
  });
  it("uses the borrowed cards provider and model, and parses UTF-8 and CRLF split across HTTP chunks", async () => {
    await configure();
    const raw = `: keepalive\r\n\r\n${delta("Café, ")}${delta("你好.")}${STOP}${END}`;
    const bytes = new TextEncoder().encode(raw);
    const multibyte = bytes.findIndex((byte) => byte >= 128);
    gateway.mockResolvedValueOnce(response(raw, [1, 3, 12, multibyte + 1, multibyte + 3, bytes.length - 3]));
    const received = onDelta();
    expect(await generateTextStream("expressions", { ...CALL, onDelta: received })).toBe("Café, 你好.");
    expect(received.mock.calls.map(([text]) => text)).toEqual(["Café, ", "你好."]);
    expect(gateway.mock.calls[0][0]).toBe("https://gateway.test/v1/chat/completions");
    expect(sent()).toEqual({ model: "cards-m", stream: true, messages: [{ role: "system", content: CALL.system }, { role: "user", content: CALL.user }] });
    expect(gemini).not.toHaveBeenCalled();
  });

  it("honours a separate Gemini provider and model and forwards its streamed text", async () => {
    await configure({ ...OPENAI, gemini_api_key: "dummy-gemini-key", expressions_provider: "gemini", expressions_model: "own-m" });
    gemini.mockResolvedValueOnce(parts([{ text: "Hello " }, { text: "there.", candidates: [{ finishReason: "STOP" }] }]));
    const received = onDelta();
    expect(await generateTextStream("expressions", { ...CALL, onDelta: received })).toBe("Hello there.");
    expect(received.mock.calls.map(([text]) => text)).toEqual(["Hello ", "there."]);
    expect(gemini).toHaveBeenCalledWith(expect.objectContaining({
      model: "own-m", contents: CALL.user, config: expect.objectContaining({ systemInstruction: CALL.system, abortSignal: expect.any(AbortSignal) }),
    }));
    expect(gateway).not.toHaveBeenCalled();
  });

  it("accepts a compatible gateway that returns a JSON envelope instead of a stream", async () => {
    await configure();
    gateway.mockResolvedValueOnce(jsonReply("A complete reply."));
    const received = onDelta();
    expect(await generateTextStream("expressions", { ...CALL, onDelta: received })).toBe("A complete reply.");
    expect(received).toHaveBeenCalledExactlyOnceWith("A complete reply.");
  });

  it.each(["stream", "JSON envelope"])("refuses an overlong reply from a %s", async (format) => {
    await configure();
    const long = "a".repeat(8001);
    gateway.mockResolvedValueOnce(format === "stream" ? response(`${delta(long)}${STOP}${END}`) : jsonReply(long));
    await expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta() })).rejects.toThrow();
  });

  it.each(["MAX_TOKENS", "SAFETY", "RECITATION"])("does not mistake Gemini's %s partial text for a complete reply", async (finishReason) => {
    await configure({ gemini_api_key: "dummy-gemini-key" });
    gemini.mockResolvedValueOnce(parts([{ text: "A partial reply.", candidates: [{ finishReason }] }]));
    await expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta() })).rejects.toThrow();
  });

  it.each(["length", "content_filter"])("does not mistake OpenAI's %s partial text for a complete reply", async (finishReason) => {
    await configure();
    const finish = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`;
    gateway.mockResolvedValueOnce(response(`${delta("A partial reply.")}${finish}${END}`));
    await expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta() })).rejects.toThrow();
  });
});

describe("a conversation's quick retry and deadline", () => {
  it("retries a quick transient response once before any words have arrived, on the same model and clock", async () => {
    await configure();
    gateway.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    gateway.mockResolvedValueOnce(response(`${delta("A recovered reply.")}${STOP}${END}`));
    const received = onDelta();
    expect(await generateTextStream("expressions", { ...CALL, onDelta: received, retryFast: true })).toBe("A recovered reply.");
    expect(gateway).toHaveBeenCalledTimes(2);
    expect(sent(0).model).toBe("cards-m");
    expect(sent(1).model).toBe("cards-m");
    expect(gateway.mock.calls[1][1]?.signal).toBe(gateway.mock.calls[0][1]?.signal);
    expect(received.mock.calls.map(([text]) => text)).toEqual(["A recovered reply."]);
  });

  it("retries no more than once", async () => {
    await configure();
    gateway.mockImplementation(async () => new Response("unavailable", { status: 503 }));
    await expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), retryFast: true })).rejects.toThrow(/503/);
    expect(gateway).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403])("does not retry a permanent HTTP %s response", async (status) => {
    await configure();
    gateway.mockResolvedValueOnce(new Response("denied", { status }));
    await expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), retryFast: true })).rejects.toThrow();
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("does not retry a quota error even when the gateway reports it as HTTP 429", async () => {
    await configure();
    gateway.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "insufficient_quota", message: "quota exceeded" } }), {
      status: 429, headers: { "content-type": "application/json" },
    }));
    await expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), retryFast: true })).rejects.toThrow();
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("does not retry Gemini quota failures", async () => {
    await configure({ gemini_api_key: "dummy-gemini-key" });
    gemini.mockRejectedValueOnce(new Error("429 RESOURCE_EXHAUSTED: quota exceeded"));
    await expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), retryFast: true })).rejects.toThrow();
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it("does not classify a malformed JSON reply as a transport failure from words in its body", async () => {
    await configure();
    gateway.mockResolvedValueOnce(new Response("network", { headers: { "content-type": "application/json" } }));
    await expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), retryFast: true })).rejects.toThrow();
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("does not retry a transient response that arrives after the first five seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await configure();
    gateway.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response("unavailable", { status: 503 })), 6000);
    }));
    const rejected = expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), retryFast: true })).rejects.toThrow(/503/);
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(6000);
    await rejected;
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("does not restart the 45 second clock for the retry", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    await configure();
    gateway.mockImplementationOnce(() => new Promise<Response>((resolve) => {
      setTimeout(() => resolve(new Response("unavailable", { status: 503 })), 4000);
    }));
    gateway.mockImplementationOnce(hang);
    const rejected = expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), retryFast: true })).rejects.toThrow("timeout after 45000ms");
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(gateway.mock.calls[1][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(gateway.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(gateway).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a reply after a delta was already delivered", async () => {
    await configure();
    const first = new TextEncoder().encode(delta("Already visible."));
    let sent = false;
    gateway.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) controller.error(new Error("ECONNRESET"));
        else { sent = true; controller.enqueue(first); }
      },
    }), { headers: { "content-type": "text/event-stream" } }));
    const received = onDelta();
    await expect(generateTextStream("expressions", { ...CALL, onDelta: received, retryFast: true })).rejects.toThrow(/ECONNRESET/);
    expect(received).toHaveBeenCalledExactlyOnceWith("Already visible.");
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("aborts the upstream request when the caller cancels, without retrying", async () => {
    await configure();
    gateway.mockImplementation(hang);
    const controller = new AbortController();
    const rejected = expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), signal: controller.signal, retryFast: true })).rejects.toThrow("stopped");
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(1));
    controller.abort(new Error("stopped"));
    await rejected;
    expect(gateway.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("keeps the 45 second limit and aborts the network request when it expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await configure();
    gateway.mockImplementation(hang);
    const rejected = expect(generateTextStream("expressions", { ...CALL, onDelta: onDelta(), retryFast: true })).rejects.toThrow("timeout after 45000ms");
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(44_000);
    expect(gateway.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
    expect(gateway.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("shares slots with JSON calls and spends queue time from the same 45 second limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await configure();
    gateway.mockImplementation(hang);
    const first = [1, 2, 3].map(() => generateJson("expressions", CALL).catch(() => "gave up"));
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(20_000);
    const fourth = generateTextStream("expressions", { ...CALL, onDelta: onDelta() }).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await Promise.all(first)).toEqual(["gave up", "gave up", "gave up"]);
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(4));
    expect(sent(3).stream).toBe(true);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(gateway.mock.calls[3][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await fourth).toBe("timeout after 45000ms");
    expect(gateway.mock.calls[3][1]?.signal?.aborted).toBe(true);
  });
});
