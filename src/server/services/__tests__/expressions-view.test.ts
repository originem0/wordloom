import { describe, it, expect } from "vitest";
import { testableAt, toDetail, toSummary, type EncounterRow, type Entry, type ExpressionRow } from "../expressions-view.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);

let nextId = 1;
const encounter = (expressionId: number, kind: string, createdAt: number, extra: Partial<EncounterRow> = {}): EncounterRow => ({
  id: nextId++, expressionId, kind, text: "", textBefore: null, myAttempt: null,
  sourceType: null, sourceTitle: null, sourceLocator: null, outcome: null, cue: null, feedback: null,
  targetVersion: 0, occurredAt: null, createdAt, ...extra,
});

/** An entry met five days before T0; in 想用 since `activeSince` unless that is null. */
function entry(id: number, activeSince: number | null, rows: [kind: string, at: number, extra?: Partial<EncounterRow>][] = []): Entry {
  const row: ExpressionRow = {
    id, text: `text ${id}`, norm: `text ${id}`, focus: null, intent: "我想说…", intentBy: "self",
    aiIntent: null, gloss: null, note: null, status: activeSince == null ? "seen" : "active", activeSince,
    focusStart: null, learningHistory: null, targetVersion: 0, nextScene: null, createdAt: T0 - 5 * DAY, updatedAt: T0 - 5 * DAY,
  };
  const timeline = [encounter(id, "met", T0 - 5 * DAY), ...rows.map(([kind, at, extra]) => encounter(id, kind, at, extra))];
  // `folded` and `queued` are what loadLibrary derives; testableAt works them out for its own moment.
  return { row, timeline, folded: { level: 0, promotions: 0, graduated: false, dueAt: Infinity, answerSeenAt: -Infinity }, queued: false };
}
const ids = (entries: Entry[]) => entries.map((e) => e.row.id);
const pass = { cue: "need", outcome: "pass" };

describe("testableAt", () => {
  it("is empty until an entry has been in 想用 for a day, and never holds one that is not there", () => {
    const entries = [entry(1, T0), entry(2, null), { ...entry(3, T0), row: { ...entry(3, T0).row, status: "retired" } }];
    expect(ids(testableAt(entries, T0 + DAY - 1))).toEqual([]);
    expect(ids(testableAt(entries, T0 + DAY))).toEqual([1]);
  });

  it("puts the longest overdue first", () => {
    const entries = [entry(1, T0 + 2 * HOUR), entry(2, T0), entry(3, T0 + HOUR)];
    expect(ids(testableAt(entries, T0 + 3 * DAY))).toEqual([2, 3, 1]);
  });

  it("reads the timeline as it stood just before the moment asked about", () => {
    const at = T0 + DAY;
    // The pass at `at` moves the due time three days on, for every later moment.
    const entries = [entry(1, T0, [["attempt", at, pass]])];
    expect(ids(testableAt(entries, at))).toEqual([1]);
    expect(ids(testableAt(entries, at + 1))).toEqual([]);
    expect(ids(testableAt(entries, at + 3 * DAY))).toEqual([1]);
    // A hit shown unmasked at `at` likewise counts from the next moment on.
    const looked = [entry(2, T0, [["looked_up", at]])];
    expect(ids(testableAt(looked, at))).toEqual([2]);
    expect(ids(testableAt(looked, at + HOUR))).toEqual([]);
  });

  it("takes when the answer was shown from the feedback of the attempt", () => {
    const at = T0 + DAY;
    const judged = JSON.stringify({ prompt: "p", status: "done", judgedAt: at + HOUR });
    const entries = [entry(1, T0, [["attempt", at, { cue: "need", outcome: "fail", feedback: judged }]])];
    expect(ids(testableAt(entries, at + DAY + HOUR - 1))).toEqual([]);
    expect(ids(testableAt(entries, at + DAY + HOUR))).toEqual([1]);
    // A miss at the fresh scene shows nothing, unless the user has overturned that row.
    const miss = (feedback: object): Entry =>
      entry(2, T0, [["attempt", at, { cue: "none", outcome: "fail", feedback: JSON.stringify({ prompt: "p", status: "done", judgedAt: at + HOUR, ...feedback }) }]]);
    expect(ids(testableAt([miss({})], at + HOUR))).toEqual([2]);
    expect(ids(testableAt([miss({ modelOutcome: "pass", overturned: true })], at + DAY))).toEqual([]);
    expect(ids(testableAt([miss({ modelOutcome: "pass", overturned: true })], at + DAY + HOUR))).toEqual([2]);
  });

  it("leaves out the entries over the cap until a place is free", () => {
    const entries = Array.from({ length: 13 }, (_, i) => entry(i + 1, T0 + i));
    const later = T0 + 2 * DAY;
    expect(ids(testableAt(entries, later))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Three passes on their lower bounds take entry 1 to level 3, out of the count.
    const climbed = entry(1, T0, [["attempt", T0 + DAY, pass], ["attempt", T0 + 4 * DAY, pass], ["attempt", T0 + 11 * DAY, pass]]);
    const after = testableAt([climbed, ...entries.slice(1)], T0 + 12 * DAY);
    expect(ids(after)).toContain(13);
    expect(ids(after)).not.toContain(1); // not due again for fourteen days
    // Before the third pass the place was still taken.
    expect(ids(testableAt([climbed, ...entries.slice(1)], T0 + 11 * DAY))).not.toContain(13);
  });
});

describe("what an entry shows", () => {
  const graduated = { level: 5, promotions: 5, graduated: true, dueAt: Infinity, answerSeenAt: T0 };

  it("is everything in 见过, the intent alone in 想用, and everything again after graduating", () => {
    expect(toSummary(entry(1, null))).toMatchObject({ masked: false, text: "text 1" });
    expect(toSummary(entry(2, T0))).toMatchObject({ masked: true, text: null, focus: null, intent: "我想说…" });
    expect(toSummary({ ...entry(3, T0), folded: graduated })).toMatchObject({ masked: false, text: "text 3", graduated: true, produced: true });
  });

  it("can be told to show a masked entry this once", async () => {
    const e = entry(1, T0, [["attempt", T0 + DAY, { cue: "need", outcome: "fail", text: "my sentence", feedback: JSON.stringify({ prompt: "p", status: "done" }) }]]);
    expect((await toDetail(e)).timeline[1]).toMatchObject({ kind: "attempt", cue: "need", outcome: "fail", text: null, feedback: null });
    const shown = await toDetail(e, true);
    expect(shown).toMatchObject({ masked: false, text: "text 1" });
    expect(shown.timeline[1]).toMatchObject({ text: "my sentence", feedback: { prompt: "p", status: "done" } });
  });

  it("gives feedback for attempts only, and none when it cannot be read", async () => {
    const e = entry(1, null, [
      ["looked_up", T0, { feedback: JSON.stringify({ turn: 1, thread: T0 }) }],
      ["attempt", T0 + 1, { cue: "need", feedback: "{not json" }],
    ]);
    expect((await toDetail(e)).timeline.map((r) => r.feedback)).toEqual([null, null, null]);
  });
});
