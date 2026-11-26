import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({ reply: vi.fn(), coach: vi.fn(), converse: vi.fn(), judge: vi.fn() }));
vi.mock("../../services/expressions-ai.js", async (original) => ({
  ...await original<typeof import("../../services/expressions-ai.js")>(),
  converse: model.converse,
  replyConversation: model.reply,
  coachConversation: model.coach,
  judge: model.judge,
}));

import { eq } from "drizzle-orm";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { encounters, expressions, sessions, settings, talkTurns } from "../../db/schema.js";
import { hashSessionId } from "../../middleware/auth.js";
import { loadEntry } from "../../services/expressions-view.js";
import type { TalkTurn } from "../../../shared/expressions.js";

const HOST = "wordloom.test";
const SESSION = "stream-session";
const DAY = 86_400_000;
const MARKER = "zq-stream-private-8821";
const originalEnv = { ...process.env };
type ReplyOptions = { onDelta: (text: string) => void | Promise<void>; signal?: AbortSignal };
type Event = { event: string; data: Record<string, unknown> };

function request(path: string, body?: unknown, stream = false, cookie = true, method?: string) {
  const headers = new Headers({ host: HOST, origin: `https://${HOST}`, "x-real-ip": "203.0.113.7" });
  if (cookie) headers.set("cookie", `session=${SESSION}`);
  if (stream) headers.set("accept", "text/event-stream");
  if (body !== undefined) headers.set("content-type", "application/json");
  return app.request(`/api/expressions${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"), headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const say = (body: unknown = { said: "What do you think?" }) => request("/talk", body, true);
const turns = () => db.select().from(talkTurns).orderBy(talkTurns.id).all();
const lookups = () => db.select().from(encounters).where(eq(encounters.kind, "looked_up")).orderBy(encounters.id).all();
const feedback = (extra: Record<string, unknown> = {}) => ({ reply: "A useful answer.", fix: null, rewrites: [], fresh: [], mine: [], ...extra });
const USED = { used: true, conveyed: true, rewrites: [], nextScene: null };
const SCENE = "Imagine a coworker asks you to help, but you have deadlines. What would you say?";

function events(text: string): Event[] {
  return text.replace(/\r/g, "").split("\n\n").flatMap((part) => {
    const lines = part.split("\n");
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : [];
  });
}
const deltas = (all: Event[]) => all.filter((event) => event.event === "delta").map((event) => event.data.text).join("");
const done = (all: Event[]) => all.find((event) => event.event === "done")?.data.turn as TalkTurn;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => { resolve = ok; });
  return { promise, resolve };
}
function reply(pieces: string[]) {
  model.reply.mockImplementationOnce(async (_material: unknown, opts: ReplyOptions) => {
    for (const piece of pieces) await opts.onDelta(piece);
    return pieces.join("");
  });
}
async function seed(target: string, masked = true) {
  const createdAt = Date.now() - 10 * DAY;
  const [row] = await db.insert(expressions).values({
    text: target, norm: target.trim().toLowerCase(), focus: null, createdAt, updatedAt: createdAt,
    ...(masked ? { status: "active", intent: "我想说一种情况", activeSince: createdAt } : {}),
  }).returning();
  await db.insert(encounters).values({ expressionId: row.id, kind: "met", text: target, createdAt, occurredAt: createdAt });
  return row;
}
async function past(count: number) {
  const thread = Date.now() - DAY;
  await db.insert(talkTurns).values(Array.from({ length: count }, (_, i) => ({
    thread, said: `An earlier idea ${i}.`, reply: `An earlier answer ${i}.`, createdAt: thread + i,
    notes: JSON.stringify({ fix: null, rewrites: [], fresh: [], mine: [], searched: 0, total: 0 }),
  })));
  return thread;
}
async function reviewTurn() {
  const wanted = await seed("kind of swamped");
  const thread = await past(2);
  reply([SCENE]);
  model.coach.mockResolvedValueOnce(feedback({ scene: SCENE }));
  const turn = done(events(await (await say({ said: "Let's talk about work.", thread })).text()));
  return { wanted, thread, turn };
}

beforeEach(async () => {
  process.env.AUTH_TOKEN = "stream-token";
  process.env.AUTH_SECRET = "stream-secret";
  delete process.env.EXPRESSIONS_OPEN_LOCALLY;
  delete process.env.ALLOWED_ORIGINS;
  for (const table of [talkTurns, encounters, expressions, sessions, settings]) await db.delete(table);
  const now = Date.now();
  await db.insert(sessions).values({ sessionId: hashSessionId(SESSION), createdAt: now, expiresAt: now + DAY, revokedAt: null });
  for (const call of Object.values(model)) call.mockReset();
  model.coach.mockResolvedValue(feedback());
  model.converse.mockResolvedValue(feedback());
  model.judge.mockResolvedValue(USED);
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("对谈的流式回复", () => {
  it("keeps a completed reply when its matched expression is deleted during coaching", async () => {
    const known = await seed("call it a day", false);
    const coaching = deferred<ReturnType<typeof feedback>>();
    reply(["A useful answer."]);
    model.coach.mockReturnValueOnce(coaching.promise);
    const response = await say();
    const body = response.text();
    await vi.waitFor(() => expect(model.coach).toHaveBeenCalledTimes(1));
    expect((await request(`/${known.id}`, undefined, false, true, "DELETE")).status).toBe(204);
    coaching.resolve(feedback({ mine: [{ id: known.id, why: "it fitted before deletion" }] }));
    const all = events(await body);
    expect(done(all)).toMatchObject({ reply: "A useful answer.", mine: [] });
    expect(done(all).coachingFailure).toBeUndefined();
    expect(await turns()).toHaveLength(1);
    expect((await lookups()).every((row) => row.expressionId === null)).toBe(true);
    expect(await loadEntry(known.id)).toBeNull();
  });

  it("streams the reply before coaching finishes, writes it first, and ends with one stored turn", async () => {
    const known = await seed("Fair enough.", false);
    const coaching = deferred<ReturnType<typeof feedback>>();
    reply(["That sounds ", "like a plan."]);
    model.coach.mockReturnValueOnce(coaching.promise);
    const res = await say();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const body = res.text();
    await vi.waitFor(() => expect(model.coach).toHaveBeenCalledTimes(1));
    expect(await turns()).toMatchObject([{ reply: "That sounds like a plan.", said: "What do you think?" }]);
    coaching.resolve(feedback({ mine: [{ id: known.id, why: "it fits" }] }));
    const all = events(await body);
    expect(deltas(all)).toBe("That sounds like a plan.");
    expect(all.at(-1)?.event).toBe("done");
    expect(all.filter((event) => event.event === "done")).toHaveLength(1);
    expect(done(all)).toMatchObject({ reply: "That sounds like a plan.", mine: [{ expression: { id: known.id } }] });
    expect((await turns()).map((row) => row.id)).toEqual([done(all).id]);
    expect((await lookups()).map((row) => row.expressionId)).toEqual([known.id]);
  });

  it("keeps a masked target out of deltas even across chunk boundaries and overlapping entries", async () => {
    await seed("kind of swamped");
    await seed("swamped");
    reply(["You seem kind ", "of swa", "mped today.", " Keep going."]);
    const all = events(await (await say()).text());
    expect(deltas(all)).toBe("You seem ____ today. Keep going.");
    expect(done(all).reply).toBe(deltas(all));
    expect((await turns())[0].reply).toBe("You seem kind of swamped today. Keep going.");
  });

  it("waits for a word boundary so a longer word is not blanked as a shorter target", async () => {
    await seed("swamp");
    reply(["The swa", "mped team crossed a swa", "mp", " safely."]);
    const all = events(await (await say()).text());
    expect(deltas(all)).toBe("The swamped team crossed a ____ safely.");
    expect(done(all).reply).toBe(deltas(all));
  });

  it("recognises typographic apostrophes and whitespace between the parts of a streamed target", async () => {
    await seed("don't mind");
    reply(["I don’t", " ".repeat(512), "mind at all."]);
    const all = events(await (await say()).text());
    expect(deltas(all)).toBe("I ____ at all.");
    expect(done(all).reply).toBe(deltas(all));
  });

  it("keeps the completed reply when coaching fails, then retries coaching on the same turn", async () => {
    const known = await seed("Fair enough.", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reply(["Let's look at ", "the idea together."]);
    model.coach.mockRejectedValueOnce(new Error(`upstream echoed ${MARKER}`));
    const all = events(await (await say({ said: `A thought ${MARKER}` })).text());
    expect(all.at(-1)?.event).toBe("done");
    expect(done(all)).toMatchObject({ reply: "Let's look at the idea together.", coachingFailure: "failed" });
    expect(await turns()).toHaveLength(1);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(MARKER);
    const before = await lookups();
    model.coach.mockResolvedValueOnce(feedback({ mine: [{ id: known.id, why: "it fits" }] }));
    const retry = await request(`/talk/turn/${done(all).id}/coach`, {});
    expect(retry.status).toBe(200);
    const coached = await retry.json() as TalkTurn;
    expect(coached).toMatchObject({ id: done(all).id, reply: "Let's look at the idea together.", mine: [{ expression: { id: known.id } }] });
    expect(coached.coachingFailure).toBeUndefined();
    expect(await turns()).toHaveLength(1);
    expect(model.reply).toHaveBeenCalledTimes(1);
    const after = await lookups();
    expect(after.filter((row) => row.expressionId === known.id)).toHaveLength(1);
    // Retrying a successful coaching response is idempotent too.
    const again = await request(`/talk/turn/${done(all).id}/coach`, {});
    expect(again.status).toBe(200);
    expect(await lookups()).toEqual(after);
    expect(model.coach).toHaveBeenCalledTimes(2);
    expect(before.length).toBeLessThanOrEqual(after.length);
  });

  it("reports a reply failure with a fixed reason and writes nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    model.reply.mockRejectedValueOnce(new Error(`upstream echoed ${MARKER}`));
    const all = events(await (await say({ said: `A thought ${MARKER}` })).text());
    expect(all).toEqual([{ event: "error", data: expect.objectContaining({ code: "TALK_FAILED", reason: "failed" }) }]);
    expect(JSON.stringify(all)).not.toContain(MARKER);
    expect(warn.mock.calls.flat().join(" ")).not.toContain(MARKER);
    expect(await turns()).toEqual([]);
    expect(await lookups()).toEqual([]);
    expect(model.coach).not.toHaveBeenCalled();
  });

  it("aborts the upstream request when the reader disconnects, without writing a partial reply", async () => {
    let upstream: AbortSignal | undefined;
    model.reply.mockImplementationOnce(async (_material: unknown, opts: ReplyOptions) => {
      upstream = opts.signal;
      await opts.onDelta("Started a visible reply.");
      return new Promise<string>((_resolve, reject) => {
        if (upstream?.aborted) reject(upstream.reason);
        else upstream?.addEventListener("abort", () => reject(upstream!.reason), { once: true });
      });
    });
    const res = await say();
    const reader = res.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    await vi.waitFor(() => expect(upstream?.aborted).toBe(true));
    expect(await turns()).toEqual([]);
    expect(await lookups()).toEqual([]);
    expect(model.coach).not.toHaveBeenCalled();
  });

  it("rejects bad requests and a missing conversation before opening a stream", async () => {
    for (const body of [{ said: " " }, { said: "x".repeat(4001) }, { said: "Hello.", thread: 1.5 }]) {
      const res = await say(body);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
    }
    const missing = await say({ said: "Hello.", thread: 123456789 });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(model.reply).not.toHaveBeenCalled();
  });

  it("requires the same private guard for streaming as for ordinary conversation", async () => {
    const res = await request("/talk", { said: "Hello." }, true, false);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(model.reply).not.toHaveBeenCalled();
    expect(await turns()).toEqual([]);
  });

  it("shares one coaching retry between concurrent requests and records its hits once", async () => {
    const known = await seed("Fair enough.", false);
    reply(["A saved reply."]);
    model.coach.mockRejectedValueOnce(new Error("failed"));
    const turn = done(events(await (await say()).text()));
    const coaching = deferred<ReturnType<typeof feedback>>();
    model.coach.mockReturnValueOnce(coaching.promise);
    const retries = [request(`/talk/turn/${turn.id}/coach`, {}), request(`/talk/turn/${turn.id}/coach`, {})];
    await vi.waitFor(() => expect(model.coach).toHaveBeenCalledTimes(2));
    coaching.resolve(feedback({ mine: [{ id: known.id, why: "it fits" }] }));
    const answers = await Promise.all(retries);
    expect(answers.map((res) => res.status)).toEqual([200, 200]);
    expect(await turns()).toHaveLength(1);
    expect((await lookups()).map((row) => row.expressionId)).toEqual([known.id]);
    expect(model.coach).toHaveBeenCalledTimes(2);
  });

  it("does not recreate a deleted conversation when a coaching retry finishes", async () => {
    reply(["A saved reply."]);
    model.coach.mockRejectedValueOnce(new Error("failed"));
    const turn = done(events(await (await say()).text()));
    const coaching = deferred<ReturnType<typeof feedback>>();
    model.coach.mockReturnValueOnce(coaching.promise);
    const retried = request(`/talk/turn/${turn.id}/coach`, {});
    await vi.waitFor(() => expect(model.coach).toHaveBeenCalledTimes(2));
    expect((await request(`/talk/${turn.thread}`, undefined, false, true, "DELETE")).status).toBe(204);
    coaching.resolve(feedback());
    expect((await retried).status).toBe(404);
    expect(await turns()).toEqual([]);
    expect(await lookups()).toEqual([]);
  });

  it("does not recreate a conversation deleted while the reply was streaming", async () => {
    const thread = await past(1);
    const released = deferred<void>();
    model.reply.mockImplementationOnce(async (_material: unknown, opts: ReplyOptions) => {
      await opts.onDelta("A reply that is still ");
      await released.promise;
      await opts.onDelta("being written.");
      return "A reply that is still being written.";
    });
    const res = await say({ said: "Another thought.", thread });
    const body = res.text();
    await vi.waitFor(() => expect(model.reply).toHaveBeenCalledTimes(1));
    expect((await request(`/talk/${thread}`, undefined, false, true, "DELETE")).status).toBe(204);
    released.resolve();
    const all = events(await body);
    expect(all.at(-1)).toMatchObject({ event: "error", data: { code: "NOT_FOUND" } });
    expect(await turns()).toEqual([]);
    expect(await lookups()).toEqual([]);
    expect(model.coach).not.toHaveBeenCalled();
  });

  it("chooses a due entry on the third turn and lets a real English answer count before lookup rows", async () => {
    const { wanted, thread, turn } = await reviewTurn();
    expect(turn.review).toEqual({ id: wanted.id, scene: SCENE });
    const material = model.reply.mock.calls[0][0] as { reviewCue?: string; index: string };
    expect(material.reviewCue).toBe("我想说一种情况");
    expect(material.index).not.toContain("kind of swamped");
    const judged = deferred<typeof USED>();
    model.judge.mockReturnValueOnce(judged.promise);
    model.coach.mockResolvedValueOnce(feedback({ mine: [{ id: wanted.id, why: "it fits" }] }));
    reply(["That is a useful way to put it."]);
    const res = await say({ said: "I'm kind of swamped today.", thread });
    const body = res.text();
    await vi.waitFor(() => expect(model.judge).toHaveBeenCalledTimes(1));
    expect(model.coach).toHaveBeenCalledTimes(2);
    expect((await lookups()).filter((row) => row.expressionId === wanted.id)).toEqual([]);
    judged.resolve(USED);
    const answered = done(events(await body));
    expect(answered.reviewResult).toMatchObject({ status: "done", verdict: "used", outcome: "pass" });
    const attempted = (await db.select().from(encounters).all()).filter((row) => row.kind === "attempt");
    expect(attempted).toMatchObject([{ expressionId: wanted.id, cue: "none", sourceType: "chat", sourceLocator: `talk:${answered.id}` }]);
    expect((await loadEntry(wanted.id))?.folded.promotions).toBe(1);
    const old = await (await request(`/talk/${thread}`)).json() as { turns: TalkTurn[] };
    expect(old.turns.at(-1)?.reviewResult?.answer).toBeNull();
  });

  it("does not mark a Chinese continuation of a review scene as a failed attempt", async () => {
    const { thread } = await reviewTurn();
    reply(["That gives us a different angle."]);
    const next = done(events(await (await say({ said: "我们换个角度看看", thread })).text()));
    expect(next.reviewResult).toBeUndefined();
    expect(model.judge).not.toHaveBeenCalled();
    expect((await db.select().from(encounters).all()).filter((row) => row.kind === "attempt")).toEqual([]);
  });

  it("does not schedule recall when the same response has already revealed its target", async () => {
    const wanted = await seed("kind of swamped");
    const thread = await past(2);
    reply([SCENE]);
    model.coach.mockResolvedValueOnce(feedback({ scene: SCENE, mine: [{ id: wanted.id, why: "it fits" }] }));
    const turn = done(events(await (await say({ said: "Work feels overwhelming.", thread })).text()));
    expect(turn.mine[0].expression).toMatchObject({ id: wanted.id, masked: false, text: wanted.text });
    expect(turn.review).toBeUndefined();
  });

  it.each(["a scene absent from the reply", "a scene that names the hidden target"])("does not manufacture a review from %s", async (kind) => {
    await seed("kind of swamped");
    const thread = await past(2);
    const text = kind === "a scene absent from the reply" ? "Here is another idea." : "Imagine being kind of swamped. What would you say?";
    reply([text]);
    model.coach.mockResolvedValueOnce(feedback({ scene: kind === "a scene absent from the reply" ? SCENE : text }));
    const turn = done(events(await (await say({ said: "What about work?", thread })).text()));
    expect(turn.review).toBeUndefined();
  });
});
