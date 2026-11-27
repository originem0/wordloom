import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => vi.fn());
vi.mock("../expressions-ai.js", () => ({
  judge: model, converse: vi.fn(), replyConversation: vi.fn(), coachConversation: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { encounters, expressions } from "../../db/schema.js";
import { answerReview, chooseReview } from "../expressions-review.js";
import { attemptResponse, judgeAttempt, loadAttempt } from "../expressions-try.js";
import { attemptFeedback, loadEntry, loadLibrary } from "../expressions-view.js";

const DAY = 86_400_000;
const NOW = 1_900_000_000_000;
const SCENE = "A colleague asks for help while you have two deadlines. What would you say?";
const PASSED = { used: true, conveyed: true, rewrites: [], nextScene: null };
type NewEntry = Partial<typeof expressions.$inferInsert>;

async function seed(over: NewEntry = {}) {
  const text = over.text ?? "I'm kind of swamped right now.";
  const focus = over.focus === undefined ? "kind of swamped" : over.focus;
  const createdAt = over.createdAt ?? NOW - 10 * DAY;
  const row = await db.insert(expressions).values({
    createdAt, updatedAt: createdAt, status: "active", activeSince: NOW - 5 * DAY,
    intent: "我想说手头很忙", ...over, text, focus,
    norm: over.norm ?? (focus ?? text).trim().toLowerCase().replace(/\s+/g, " "),
  }).returning().get();
  await db.insert(encounters).values({ expressionId: row.id, kind: "met", text, createdAt });
  return row;
}
const attempts = () => db.select().from(encounters).where(eq(encounters.kind, "attempt")).all();

beforeEach(async () => {
  await db.delete(encounters);
  await db.delete(expressions);
  model.mockReset().mockResolvedValue(PASSED);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => vi.restoreAllMocks());

describe("conversation recall selection", () => {
  it("asks occasionally and chooses the oldest due expression", async () => {
    const older = await seed({ activeSince: NOW - 8 * DAY, nextScene: SCENE });
    await seed({ activeSince: NOW - 2 * DAY, intent: "另一个意思" });
    const library = await loadLibrary();
    for (const turn of [1, 2, 4, 5, 6, 8]) expect(chooseReview(library, turn)).toBeNull();
    for (const turn of [3, 7, 11]) expect(chooseReview(library, turn)).toEqual({ id: older.id, cue: SCENE });
  });

  it("does not ask before the 24-hour due time, outside active, or after graduation", async () => {
    await seed({ activeSince: NOW - 2 * 3_600_000 });
    await seed({ status: "seen", activeSince: null });
    await seed({ status: "retired", activeSince: null });
    const since = NOW - 120 * DAY;
    const graduated = await seed({ activeSince: since, createdAt: since - DAY });
    let at = since;
    for (const days of [1, 3, 7, 14, 30]) {
      at += days * DAY;
      await db.insert(encounters).values({ expressionId: graduated.id, kind: "attempt", text: "My answer", cue: "none", outcome: "pass", createdAt: at });
    }
    expect((await loadEntry(graduated.id))!.folded.graduated).toBe(true);
    expect(chooseReview(await loadLibrary(), 3)).toBeNull();
  });

  it("respects the active cap even when only a queued expression has a cue", async () => {
    for (let i = 0; i < 12; i++) await seed({ activeSince: NOW - 20 * DAY + i, intent: " ", aiIntent: null, nextScene: null });
    const queued = await seed({ activeSince: NOW - 20 * DAY + 12, nextScene: SCENE });
    const library = await loadLibrary();
    expect(library.find((entry) => entry.row.id === queued.id)!.queued).toBe(true);
    expect(chooseReview(library, 3)).toBeNull();
  });

  it("falls back to a safe cue and skips expressions without one", async () => {
    const entry = await seed({ nextScene: "Use KIND OF SWAMPED here", intent: " ", aiIntent: "表示你有很多事情要忙" });
    expect(chooseReview(await loadLibrary(), 3)).toEqual({ id: entry.id, cue: "表示你有很多事情要忙" });
    await db.update(expressions).set({ aiIntent: " " }).where(eq(expressions.id, entry.id));
    expect(chooseReview(await loadLibrary(), 3)).toBeNull();
  });
});

it("cannot judge an old scene against a replacement focus", async () => {
  const entry = await seed({ targetVersion: 2 });
  expect(await answerReview({ id: entry.id, scene: SCENE, version: 1 }, "my reply", 42)).toBeNull();
  expect(await attempts()).toEqual([]);
  expect(model).not.toHaveBeenCalled();
});

describe("answering a conversation recall scene", () => {
  it("records and judges the actual English message with no answer hint", async () => {
    const entry = await seed();
    const said = "I'm kind of swamped today, so I can't help just yet.";
    const controller = new AbortController();
    const id = await answerReview({ id: entry.id, scene: SCENE }, said, 101, controller.signal);
    const rows = await attempts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, expressionId: entry.id, kind: "attempt", text: said, cue: "none", outcome: "pass", sourceType: "chat", sourceLocator: "talk:101" });
    expect(attemptFeedback(rows[0])).toMatchObject({ prompt: SCENE, status: "done" });
    expect(model).toHaveBeenCalledWith({ text: entry.text, focus: entry.focus, prompt: SCENE, answer: said }, { signal: controller.signal });
    expect((await loadEntry(entry.id))!.folded.promotions).toBe(1);
    expect((await db.select().from(encounters).all()).map((row) => row.kind)).toEqual(["met", "attempt"]);
  });

  it("continues neutrally when the next message is Chinese, mixed, or not language", async () => {
    const entry = await seed();
    for (const said of ["我还想聊这件事", "I'm 忙 today", "123... 🙂", "  "]) {
      expect(await answerReview({ id: entry.id, scene: SCENE }, said, 201)).toBeNull();
    }
    expect(await attempts()).toEqual([]);
    expect(model).not.toHaveBeenCalled();
    expect((await loadEntry(entry.id))!.folded.promotions).toBe(0);
  });

  it("rejects a scene containing the target, including curly quotes and irregular spacing", async () => {
    const entry = await seed({ text: "Please don't push it.", focus: "don't push it" });
    expect(await answerReview({ id: entry.id, scene: "同事说 DON’T\n  PUSH IT，你怎么回应？" }, "I understand.", 301)).toBeNull();
    expect(await attempts()).toEqual([]);
    expect(model).not.toHaveBeenCalled();
  });

  it("does not count a recall after the entry left active or graduated", async () => {
    const entry = await seed({ status: "retired", activeSince: null });
    expect(await answerReview({ id: entry.id, scene: SCENE }, "I'm kind of swamped today.", 401)).toBeNull();
    expect(await answerReview({ id: 99999, scene: SCENE }, "I'm kind of swamped today.", 402)).toBeNull();
    const since = NOW - 120 * DAY;
    const graduated = await seed({ activeSince: since, createdAt: since - DAY });
    let at = since;
    for (const days of [1, 3, 7, 14, 30]) {
      at += days * DAY;
      await db.insert(encounters).values({ expressionId: graduated.id, kind: "attempt", text: "My answer", cue: "none", outcome: "pass", createdAt: at });
    }
    expect(await answerReview({ id: graduated.id, scene: SCENE }, "I'm kind of swamped today.", 403)).toBeNull();
    expect(model).not.toHaveBeenCalled();
  });

  it("keeps a failed judgement on the same row for the existing retry route", async () => {
    const entry = await seed();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    model.mockRejectedValueOnce(new Error("private upstream sentence"));
    const id = await answerReview({ id: entry.id, scene: SCENE }, "I'm kind of swamped today.", 501);
    const failed = (await loadAttempt(id!))!;
    expect(attemptResponse(failed)).toMatchObject({ status: "failed", outcome: null, answer: null });
    expect((await loadEntry(entry.id))!.folded.promotions).toBe(0);
    expect(warning.mock.calls.flat().join(" ")).not.toContain("private upstream sentence");
    expect(await answerReview({ id: entry.id, scene: SCENE }, "A repeated delivery", 501)).toBe(id);
    expect(model).toHaveBeenCalledTimes(1);
    model.mockResolvedValue(PASSED);
    await judgeAttempt(failed);
    expect(attemptResponse((await loadAttempt(id!))!)).toMatchObject({ status: "done", outcome: "pass" });
    expect(await answerReview({ id: entry.id, scene: SCENE }, "A repeated delivery", 501)).toBe(id);
    expect(await attempts()).toHaveLength(1);
    expect((await attempts())[0].sourceLocator).toBe("talk:501");
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("shares a pending judgement and does not record a repeated turn twice", async () => {
    const entry = await seed();
    let resolve!: (value: typeof PASSED) => void;
    model.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = answerReview({ id: entry.id, scene: SCENE }, "I'm kind of swamped today.", 601);
    const second = answerReview({ id: entry.id, scene: SCENE }, "I'm kind of swamped today.", 601);
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(1));
    resolve(PASSED);
    const ids = await Promise.all([first, second]);
    expect(ids[0]).toBe(ids[1]);
    expect(await attempts()).toHaveLength(1);
    expect(await answerReview({ id: entry.id, scene: SCENE }, "Changed text in a repeated delivery", 601)).toBe(ids[0]);
    expect((await attempts())[0].text).toBe("I'm kind of swamped today.");
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("writes nothing if the request was cancelled before the attempt", async () => {
    const entry = await seed();
    const controller = new AbortController();
    controller.abort();
    await expect(answerReview({ id: entry.id, scene: SCENE }, "I'm kind of swamped today.", 701, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(await attempts()).toEqual([]);
    expect(model).not.toHaveBeenCalled();
  });
});
