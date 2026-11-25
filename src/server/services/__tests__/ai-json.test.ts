import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { format } from "node:util";

// Installed before the app is imported: hono's logger keeps the console.log it
// saw when the middleware was created, so a spy set up later would miss it.
const consoleCalls = vi.hoisted(() => {
  const calls: unknown[][] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      calls.push(args);
      original(...args);
    };
  }
  return calls;
});
const printed = () => consoleCalls.map((args) => format(...args)).join("\n");

// Real router, real provider code, real settings table and, in the last block,
// the real app on top. Replaced: the network (fetch, which the
// OpenAI-compatible path uses) and Google's SDK.
const gemini = vi.fn();
vi.mock("@google/genai", () => {
  class FakeGenAI {
    models = { generateContent: gemini };
  }
  return { GoogleGenAI: FakeGenAI };
});

import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { encounters, expressions, sessions, settings, talkTurns } from "../../db/schema.js";
import { hashSessionId } from "../../middleware/auth.js";
import { generateJson } from "../ai-router.js";
import type { ExpressionDetail } from "../../../shared/expressions.js";

type FetchInit = { body?: string; signal?: AbortSignal };
const gateway = vi.fn<(url: string, init: FetchInit) => Promise<Response>>();
const chat = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
/** Never answers, and gives up only if the caller really aborts it. */
const hang = (_url: string, init: FetchInit) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });
/** What the gateway was sent. */
const sent = (n = 0) =>
  JSON.parse(gateway.mock.calls[n][1].body!) as { model: string; messages: { role: string; content: string }[] };

async function configure(rows: Record<string, string>) {
  await db.delete(settings);
  const values = Object.entries(rows).map(([key, value]) => ({ key, value }));
  if (values.length > 0) await db.insert(settings).values(values);
}

const MARKER = "zq-marker-7731";
const GEMINI = { gemini_api_key: "k" };
const OPENAI = { openai_api_key: "k", openai_base_url: "https://gateway.test/v1" };
// Cards on the gateway, with everything the ordinary path would also use.
const GATEWAY = {
  ...OPENAI,
  cards_provider: "openai",
  cards_openai_model: "cards-m",
  cards_openai_fallback_model: "fallback-m",
  api_max_retries: "5",
};
const CALL = { system: "Return one JSON object.", user: '{"text":"kind of"}', label: "expressions.test" };

beforeEach(() => {
  gemini.mockReset();
  gateway.mockReset();
  vi.stubGlobal("fetch", gateway);
  consoleCalls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("where a route's JSON call goes", () => {
  it.each([
    ["only a key is set: the built-in default", GEMINI, "gemini-2.5-flash"],
    ["the cards route has a model: that one", { ...GEMINI, cards_model: "cards-m", general_model: "general-m" }, "cards-m"],
    ["only the general model is set", { ...GEMINI, general_model: "general-m" }, "general-m"],
    ["the route has a model of its own", { ...GEMINI, expressions_model: "own-m", cards_model: "cards-m" }, "own-m"],
    ["its own model was saved empty", { ...GEMINI, expressions_model: "  ", cards_model: "cards-m" }, "cards-m"],
    ["cards run on the gateway but the route was set back", { ...GEMINI, ...GATEWAY, expressions_provider: "gemini" }, "gemini-2.5-flash"],
  ])("to Gemini when %s", async (_when, rows, model) => {
    await configure(rows);
    gemini.mockResolvedValue({ text: '{"ok":true}' });
    expect(await generateJson("expressions", CALL)).toEqual({ ok: true });
    expect(gemini).toHaveBeenCalledTimes(1);
    const request = gemini.mock.calls[0][0];
    // The whole request, so that nothing rides along: the model is given no
    // tools, and with them no way to act on what a saved text tells it to do.
    expect(request).toEqual({
      model,
      contents: CALL.user,
      config: { systemInstruction: CALL.system, responseMimeType: "application/json", abortSignal: expect.any(AbortSignal) },
    });
    expect(gateway).not.toHaveBeenCalled();
  });

  it.each([
    ["the cards route runs there: provider and model both borrowed", GATEWAY, "cards-m"],
    ["the route has a model of its own there", { ...GATEWAY, expressions_openai_model: "own-m" }, "own-m"],
    ["the route alone was sent there", { ...OPENAI, expressions_provider: "OpenAI", expressions_openai_model: "own-m" }, "own-m"],
  ])("to the OpenAI-compatible gateway when %s", async (_when, rows, model) => {
    await configure(rows);
    gateway.mockResolvedValue(chat('```json\n{"ok":true}\n```'));
    expect(await generateJson("expressions", CALL)).toEqual({ ok: true });
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(gateway.mock.calls[0][0]).toBe("https://gateway.test/v1/chat/completions");
    expect(sent()).toEqual({
      model,
      messages: [
        { role: "system", content: expect.stringMatching(/^Return one JSON object\.\n\nRespond in JSON only/) },
        { role: "user", content: CALL.user },
      ],
    });
    expect(gemini).not.toHaveBeenCalled();
  });

  it("fails before any request when the gateway has no model to use", async () => {
    await configure({ ...OPENAI, cards_provider: "openai", cards_openai_fallback_model: "fallback-m" });
    await expect(generateJson("expressions", CALL)).rejects.toThrow(/No model configured/);
    expect(gateway).not.toHaveBeenCalled();
  });
});

// A page is waiting on this call behind a proxy that gives up at 60 s, so it
// ignores the retry count, the fallback model and the stored timeout.
describe("a JSON call is one attempt with its own deadline", () => {
  it("is not retried and not handed to the fallback model, on the gateway", async () => {
    await configure(GATEWAY);
    gateway.mockResolvedValue(new Response("upstream overloaded", { status: 503 }));
    await expect(generateJson("expressions", CALL)).rejects.toThrow(/503/);
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("is not retried and not handed to the fallback model, on Gemini", async () => {
    await configure({ ...GEMINI, cards_fallback_model: "fallback-m", api_max_retries: "5" });
    gemini.mockRejectedValue(new Error("503 UNAVAILABLE: overloaded"));
    await expect(generateJson("expressions", CALL)).rejects.toThrow(/503/);
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it.each(["5000", "300000", ""])("gives up at 45 s when api_timeout_ms is %j", async (stored) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await configure({ ...GATEWAY, api_timeout_ms: stored });
    gateway.mockImplementation(hang);
    const rejection = expect(generateJson("expressions", CALL)).rejects.toThrow("timeout after 45000ms");
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(44_000);
    expect(gateway.mock.calls[0][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(gateway.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it("spends the wait for a slot out of the same 45 s", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await configure(GATEWAY);
    gateway.mockImplementation(hang);
    // Three run at a time, so a fourth queues until one of them gives up.
    const first = [1, 2, 3].map(() => generateJson("expressions", CALL).catch(() => "gave up"));
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(20_000);
    const fourth = generateJson("expressions", CALL).catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await Promise.all(first)).toEqual(["gave up", "gave up", "gave up"]);
    await vi.waitFor(() => expect(gateway).toHaveBeenCalledTimes(4));
    // It queued for 25 s, so the request it finally sends has 20 s, not 45.
    await vi.advanceTimersByTimeAsync(19_000);
    expect(gateway.mock.calls[3][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gateway.mock.calls[3][1].signal?.aborted).toBe(true);
    expect(await fourth).toBe("timeout after 45000ms");
  });

  it("gives its slot back when it fails", async () => {
    await configure(GATEWAY);
    gateway.mockResolvedValue(new Response("no", { status: 500 }));
    // Three run at a time: a slot that leaked would leave the fourth queued.
    for (let i = 0; i < 5; i++) await expect(generateJson("expressions", CALL)).rejects.toThrow();
    gateway.mockResolvedValue(chat('{"ok":true}'));
    expect(await generateJson("expressions", CALL)).toEqual({ ok: true });
  });

  it.each([
    ["the gateway", GATEWAY, () => gateway.mockResolvedValue(chat(`Sure! "${MARKER}" is a casual way to say it.`)), "expressions.test (OpenAI)"],
    ["Gemini", GEMINI, () => gemini.mockResolvedValue({ text: `Sure! "${MARKER}" is a casual way to say it.` }), "expressions.test"],
    ["Gemini, with nothing in it", GEMINI, () => gemini.mockResolvedValue({}), "expressions.test"],
  ])("does not quote an answer it could not parse, from %s", async (_from, rows, answer, label) => {
    await configure(rows);
    answer();
    await expect(generateJson("expressions", CALL)).rejects.toThrow(
      new Error(`${label}: model output was not JSON`),
    );
  });
});

describe("the expression library on the real channel", () => {
  const SESSION = "admin-session";
  const GOOD = {
    gloss: "softens how busy you say you are\ninformal, spoken\nkind of busy / kind of tired",
    aiIntent: "我想说我现在有点忙不过来",
    scene: "同事下班前来问你能不能帮忙看一份文档。你手上还有两件事没做完。",
  };
  const originalEnv = { ...process.env };

  function post(path: string, body?: unknown) {
    return app.request(path, {
      method: "POST",
      headers: {
        host: "wordloom.test",
        origin: "https://wordloom.test",
        "x-real-ip": "203.0.113.7",
        "content-type": "application/json",
        cookie: `session=${SESSION}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  const stored = async (id: number) => (await db.select().from(expressions).all()).find((e) => e.id === id)!;

  beforeEach(async () => {
    process.env.AUTH_TOKEN = "secret-token";
    process.env.AUTH_SECRET = "secret";
    for (const t of [talkTurns, encounters, expressions, sessions]) await db.delete(t);
    const now = Date.now();
    await db.insert(sessions).values({
      sessionId: hashSessionId(SESSION), createdAt: now, expiresAt: now + 60_000, revokedAt: null,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // P1 acceptance: with the model disconnected, capture still works.
  it("captures with no provider configured at all", async () => {
    await configure({});
    const res = await post("/api/expressions", { text: `I'm kind of ${MARKER}.` });
    expect(res.status).toBe(201);
    const detail = (await res.json()) as ExpressionDetail;
    expect(detail).toMatchObject({ text: `I'm kind of ${MARKER}.`, annotated: false, gloss: null });
    await vi.waitFor(() =>
      expect(printed()).toContain(`[expressions] annotate #${detail.id} failed: not configured`),
    );

    const retry = await post(`/api/expressions/${detail.id}/annotate`);
    expect(retry.status).toBe(502);
    expect(await retry.json()).toEqual({ error: "Annotation failed", code: "ANNOTATE_FAILED" });
    expect(gateway).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
    expect(await stored(detail.id)).toMatchObject({ text: `I'm kind of ${MARKER}.`, gloss: null });
    expect(printed()).not.toContain(MARKER);
  });

  it("annotates an entry through the gateway the cards route uses", async () => {
    await configure(GATEWAY);
    gateway.mockResolvedValue(chat(JSON.stringify(GOOD)));
    const res = await post("/api/expressions", {
      text: `I'm kind of ${MARKER}.`, focus: "kind of", textBefore: `before ${MARKER}`,
    });
    const { id } = (await res.json()) as ExpressionDetail;
    await vi.waitFor(async () => expect((await stored(id)).gloss).toBe(GOOD.gloss));
    expect(await stored(id)).toMatchObject({ aiIntent: GOOD.aiIntent, nextScene: GOOD.scene });

    // The sentence went out in the user message, and only there.
    expect(gateway).toHaveBeenCalledTimes(1);
    const { model, messages } = sent();
    expect(model).toBe("cards-m");
    expect(messages[0].content).not.toContain(MARKER);
    expect(JSON.parse(messages[1].content)).toEqual({
      text: `I'm kind of ${MARKER}.`, focus: "kind of", before: `before ${MARKER}`,
    });
    expect(printed()).not.toContain(MARKER);
  });

  // P1 acceptance: a sentence that went through the server is in no log line.
  it("keeps the sentence out of the log when the upstream quotes it back", async () => {
    await configure(GATEWAY);
    // Some gateways put the request they rejected into the error they return.
    gateway.mockImplementation(async (_url, init) =>
      new Response(JSON.stringify({ error: { message: `Rejected: ${init.body}` } }), { status: 400 }),
    );
    const res = await post("/api/expressions", { text: `I'm kind of ${MARKER}.` });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as ExpressionDetail;
    await vi.waitFor(() => expect(printed()).toContain(`[expressions] annotate #${id} failed: failed`));
    expect(sent().messages[1].content).toContain(MARKER);

    // So does a model that answers in prose about the sentence.
    gateway.mockResolvedValue(chat(`"I'm kind of ${MARKER}." is informal.`));
    const retry = await post(`/api/expressions/${id}/annotate`);
    expect(retry.status).toBe(502);
    expect(await retry.text()).not.toContain(MARKER);

    expect(printed()).toContain("--> POST /api/expressions");
    expect(printed()).not.toContain(MARKER);
    expect(await stored(id)).toMatchObject({ gloss: null, aiIntent: null, nextScene: null });
  });

  // 对谈 tells the page why there is no reply, in a word it gets from this channel's own errors.
  it("tells 对谈 that no model is set up, and writes nothing", async () => {
    await configure({});
    const res = await post("/api/expressions/talk", { said: `想说 ${MARKER}` });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No answer", code: "TALK_FAILED", reason: "not configured" });
    expect(gateway).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
    expect(await db.select().from(talkTurns).all()).toEqual([]);
    expect(await db.select().from(encounters).all()).toEqual([]);
    expect(printed()).toContain("[expressions] talk failed: not configured");
    expect(printed()).not.toContain(MARKER);
  });

  it("talks through the gateway the cards route uses, and keeps a failed turn out of the log and the tables", async () => {
    await configure(GATEWAY);
    gateway.mockResolvedValue(chat(JSON.stringify({ reply: "That sounds like a long week." })));
    const res = await post("/api/expressions/talk", { said: `想说 ${MARKER}` });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ said: `想说 ${MARKER}`, reply: "That sounds like a long week.", mine: [] });

    // The message went out in the user message, and only there.
    expect(gateway).toHaveBeenCalledTimes(1);
    const { model, messages } = sent();
    expect(model).toBe("cards-m");
    expect(messages[0].content).not.toContain(MARKER);
    expect(JSON.parse(messages[1].content)).toEqual({ said: `想说 ${MARKER}`, history: [], index: "" });

    // A gateway that quotes the request it rejected, then a model that answers in prose about it.
    gateway.mockImplementation(async (_url, init) =>
      new Response(JSON.stringify({ error: { message: `Rejected: ${init.body}` } }), { status: 400 }),
    );
    for (const prose of [undefined, `You said "${MARKER}". Here is my reply.`]) {
      if (prose) gateway.mockResolvedValue(chat(prose));
      const failed = await post("/api/expressions/talk", { said: `再说 ${MARKER}` });
      expect(failed.status).toBe(502);
      expect(await failed.json()).toEqual({ error: "No answer", code: "TALK_FAILED", reason: "failed" });
    }
    expect(printed()).toContain("[expressions] talk failed: failed");
    expect(printed()).not.toContain(MARKER);
    expect(await db.select().from(talkTurns).all()).toHaveLength(1);
    expect(await db.select().from(encounters).all()).toHaveLength(1);
  });
});
