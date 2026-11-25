import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({ reply: vi.fn(), coach: vi.fn(), converse: vi.fn(), judge: vi.fn() }));
vi.mock("../../services/expressions-ai.js", async (original) => ({
  ...await original<typeof import("../../services/expressions-ai.js")>(),
  replyConversation: model.reply, coachConversation: model.coach, converse: model.converse, judge: model.judge,
}));

import { eq } from "drizzle-orm";
import { app } from "../../app.js";
import { db } from "../../db/index.js";
import { encounters, expressions, sessions, settings, talkTurns } from "../../db/schema.js";
import { hashSessionId } from "../../middleware/auth.js";
import { loadEntry } from "../../services/expressions-view.js";
import { readSSE } from "../../../shared/sse.js";
import type { TalkThreadResponse, TalkTurn } from "../../../shared/expressions.js";

const HOST = "wordloom.test";
const SESSION = "review-session";
const DAY = 86_400_000;
const NOW = 1_900_000_000_000;
const SCENE = "A colleague asks for help while you have two deadlines. What would you say?";
const originalEnv = { ...process.env };
type Material = { said: string; reply: string; reviewCue?: string };
type ReplyOptions = { onDelta: (text: string) => Promise<void> };
type NewEntry = Partial<typeof expressions.$inferInsert>;

function request(path: string, body?: unknown, method?: string, stream = false) {
  const headers = new Headers({ host: HOST, origin: `https://${HOST}`, cookie: `session=${SESSION}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (stream) headers.set("accept", "text/event-stream");
  return app.request(`/api/expressions${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"), headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function say(said: string, thread?: number): Promise<TalkTurn> {
  const response = await request("/talk", { said, ...(thread == null ? {} : { thread }) }, "POST", true);
  expect(response.status).toBe(200);
  for await (const event of readSSE(response.body!)) {
    if (event.event === "error") throw new Error(event.data);
    if (event.event === "done") return (JSON.parse(event.data) as { turn: TalkTurn }).turn;
  }
  throw new Error("Missing saved turn");
}
async function history(thread: number) {
  const response = await request(`/talk/${thread}`);
  expect(response.status).toBe(200);
  return await response.json() as TalkThreadResponse;
}

async function seed(over: NewEntry = {}) {
  const text = over.text ?? "I'm kind of swamped right now.";
  const focus = over.focus === undefined ? "kind of swamped" : over.focus;
  const createdAt = NOW - 10 * DAY;
  const row = await db.insert(expressions).values({
    text, focus, norm: (focus ?? text).toLowerCase(), createdAt, updatedAt: createdAt,
    status: "active", activeSince: NOW - 5 * DAY, intent: "表示手头事情太多", ...over,
  }).returning().get();
  await db.insert(encounters).values({ expressionId: row.id, kind: "met", text: row.text, createdAt });
  return row;
}

async function reachReview() {
  const first = await say("Let's explore an idea together.");
  const second = await say("There is something else to consider.", first.thread);
  const third = await say("I wonder what you think about it.", first.thread);
  expect(first.review).toBeUndefined();
  expect(second.review).toBeUndefined();
  expect(third.review?.scene).toBe(SCENE);
  return third;
}

beforeEach(async () => {
  process.env.AUTH_TOKEN = "review-token";
  process.env.AUTH_SECRET = "review-secret";
  delete process.env.EXPRESSIONS_OPEN_LOCALLY;
  delete process.env.ALLOWED_ORIGINS;
  for (const table of [talkTurns, encounters, expressions, sessions, settings]) await db.delete(table);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  await db.insert(sessions).values({ sessionId: hashSessionId(SESSION), createdAt: NOW, expiresAt: NOW + DAY, revokedAt: null });
  for (const call of Object.values(model)) call.mockReset();
  model.reply.mockImplementation(async (material: Material, opts: ReplyOptions) => {
    const reply = material.reviewCue ? SCENE : "Let's think about it together.";
    await opts.onDelta(reply);
    return reply;
  });
  model.coach.mockImplementation(async (material: Material) => ({
    reply: material.reply, fix: null, rewrites: [], fresh: [], mine: [],
    ...(material.reviewCue ? { scene: SCENE } : {}),
  }));
  model.judge.mockResolvedValue({ used: true, conveyed: true, rewrites: [], nextScene: null });
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("recall woven into a real conversation route", () => {
  it("promotes the English answer before a matching lookup can postpone it", async () => {
    const target = await seed();
    const review = await reachReview();
    expect(review.review?.id).toBe(target.id);
    model.coach.mockResolvedValueOnce({
      reply: "Keep going.", fix: null, rewrites: [], fresh: [], mine: [{ id: target.id, why: "It says you have too much on." }],
    });
    const answered = await say("I'm kind of swamped today, so I can't help just yet.", review.thread);
    expect(answered.reviewResult).toMatchObject({ status: "done", verdict: "used", outcome: "pass", answer: { text: target.text } });
    expect((await loadEntry(target.id))!.folded.promotions).toBe(1);
    const rows = await db.select().from(encounters).where(eq(encounters.expressionId, target.id)).orderBy(encounters.id).all();
    expect(rows.map((row) => [row.kind, row.cue])).toEqual([["met", null], ["attempt", "none"], ["looked_up", null]]);
    expect(rows[1].createdAt).toBe(rows[2].createdAt);
    expect(rows[1].id).toBeLessThan(rows[2].id);
    expect(rows[1].sourceLocator).toBe(`talk:${answered.id}`);
    expect(model.judge).toHaveBeenCalledTimes(1);
  });

  it("reapplies masks to a past review result, including other targets in its text and gloss", async () => {
    const target = await seed({ text: "I'm kind of swamped and on the fence today.", gloss: "kind of swamped describes workload; on the fence describes indecision." });
    const other = await seed({ text: "I am on the fence about it.", focus: "on the fence", norm: "on the fence", status: "seen", activeSince: null, intent: "表示还拿不定主意" });
    const review = await reachReview();
    model.coach.mockResolvedValueOnce({
      reply: "Keep going.", fix: null, rewrites: [], fresh: [], mine: [{ id: target.id, why: "It describes your workload." }],
    });
    const answered = await say("I'm kind of swamped today, and I'm uncertain.", review.thread);
    expect(answered.reviewResult?.answer?.text).toContain("on the fence");
    expect((await request(`/${target.id}`, { status: "seen" }, "PATCH")).status).toBe(200);
    expect((await request(`/${other.id}`, { status: "active" }, "PATCH")).status).toBe(200);
    const partlyMasked = (await history(review.thread)).turns.find((turn) => turn.id === answered.id)!;
    expect(partlyMasked.reviewResult?.answer?.text).toContain("kind of swamped");
    expect(partlyMasked.reviewResult?.answer?.text).toContain("____");
    expect(partlyMasked.reviewResult?.answer?.text).not.toContain("on the fence");
    expect(partlyMasked.reviewResult?.answer?.gloss).toContain("____");
    expect(partlyMasked.reviewResult?.answer?.gloss).not.toContain("on the fence");
    expect(JSON.stringify(partlyMasked)).not.toContain("on the fence");
    expect((await request(`/${target.id}`, { status: "active" }, "PATCH")).status).toBe(200);
    const fullyMasked = await history(review.thread);
    expect(fullyMasked.turns.find((turn) => turn.id === answered.id)!.reviewResult).toMatchObject({ outcome: "pass", answer: null, rewrites: [] });
    expect(JSON.stringify(fullyMasked)).not.toContain("kind of swamped");
    expect(JSON.stringify(fullyMasked)).not.toContain("on the fence");
  });

  it("leaves a pending recall neutral when the next message continues in Chinese", async () => {
    const target = await seed();
    const review = await reachReview();
    const continued = await say("我还想谈刚才的想法，先不练这一句。", review.thread);
    expect(continued.reviewResult).toBeUndefined();
    const rows = await db.select().from(encounters).where(eq(encounters.kind, "attempt")).all();
    expect(rows).toEqual([]);
    expect(model.judge).not.toHaveBeenCalled();
    expect((await loadEntry(target.id))!.folded.promotions).toBe(0);
  });
});
