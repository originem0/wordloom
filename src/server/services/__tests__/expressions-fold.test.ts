import { describe, it, expect } from "vitest";
import { foldTimeline, type TimelineRow } from "../expressions-fold.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// The entry entered the 想用 layer at T0 and was first met well before that.
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);

let nextId = 1;
const row = (kind: string, createdAt: number, extra: Partial<TimelineRow> = {}): TimelineRow => ({
  id: nextId++,
  kind,
  cue: null,
  outcome: null,
  createdAt,
  ...extra,
});
const met = (t = T0 - 5 * DAY) => row("met", t);
const attempt = (t: number, cue: string, outcome: string | null, judgedAt?: number) =>
  row("attempt", t, { cue, outcome, judgedAt });
const reveal = (t: number, cue: string) => row("reveal", t, { cue });
const lookedUp = (t: number, cue: string | null) => row("looked_up", t, { cue });

// Passes placed exactly on the lower bounds: after n of them the level is n.
const INTERVALS = [1, 3, 7, 14, 30];
function climbed(n: number): { rows: TimelineRow[]; last: number } {
  const rows = [met()];
  let t = T0;
  for (let i = 0; i < n; i++) {
    t += INTERVALS[i] * DAY;
    rows.push(attempt(t, "need", "pass"));
  }
  return { rows, last: t };
}

describe("foldTimeline", () => {
  it("a: a fresh 想用 entry can be tested only after 24 hours", () => {
    const rows = [met()];
    expect(foldTimeline(rows, T0)).toMatchObject({ level: 0, promotions: 0, dueAt: T0 + DAY });
    expect(foldTimeline([...rows, attempt(T0 + DAY - MIN, "need", "pass")], T0).level).toBe(0);
    expect(foldTimeline([...rows, attempt(T0 + DAY, "need", "pass")], T0).level).toBe(1);
  });

  it("b: right at 23:59 and again at 00:02 — the second pass does not promote", () => {
    const lateEvening = Date.UTC(2026, 0, 12, 23, 59);
    const afterMidnight = Date.UTC(2026, 0, 13, 0, 2);
    const rows = [met(), attempt(lateEvening, "need", "pass"), attempt(afterMidnight, "need", "pass")];
    expect(foldTimeline(rows, T0)).toMatchObject({ level: 1, promotions: 1 });
  });

  it("c: a pass within 24 hours of a reveal in 找 is recorded but does not promote", () => {
    const revealedAt = T0 + 2 * DAY;
    const rows = [met(), reveal(revealedAt, "masked"), attempt(revealedAt + 5 * HOUR, "need", "pass")];
    expect(foldTimeline(rows, T0)).toMatchObject({ level: 0, promotions: 0 });
    // The same pass a day after the reveal counts.
    const later = [met(), reveal(revealedAt, "masked"), attempt(revealedAt + DAY, "need", "pass")];
    expect(foldTimeline(later, T0).level).toBe(1);
  });

  it("d: missing it with only the new scene changes nothing: level, due time, answer-seen", () => {
    const { rows, last } = climbed(1);
    const before = foldTimeline(rows, T0);
    const after = foldTimeline([...rows, attempt(last + 3 * DAY + HOUR, "none", "fail")], T0);
    expect(after).toEqual(before);
  });

  it("e: missing it after the hint drops to zero, testable again in 24 hours; promotions are kept", () => {
    const { rows, last } = climbed(1);
    const failedAt = last + 3 * DAY;
    expect(foldTimeline([...rows, attempt(failedAt, "need", "fail")], T0)).toMatchObject({
      level: 0,
      promotions: 1,
      dueAt: failedAt + DAY,
    });
  });

  it("f: using it only after seeing the original scene steps down one level, never below zero; missing it resets", () => {
    const two = climbed(2);
    const at = two.last + 7 * DAY;
    expect(foldTimeline([...two.rows, attempt(at, "scene", "pass")], T0)).toMatchObject({ level: 1, dueAt: at + DAY });
    expect(foldTimeline([...two.rows, attempt(at, "scene", "fail")], T0).level).toBe(0);
    expect(foldTimeline([met(), attempt(T0 + DAY, "scene", "pass")], T0).level).toBe(0);
  });

  it("g: giving up inside 试一条 resets; a reveal elsewhere keeps the level and pushes the due time 24 hours", () => {
    const { rows, last } = climbed(2);
    const at = last + 7 * DAY; // exactly when it became due
    expect(foldTimeline([...rows, reveal(at, "need")], T0)).toMatchObject({ level: 0, promotions: 2, dueAt: at + DAY });
    expect(foldTimeline([...rows, reveal(at, "masked")], T0)).toMatchObject({ level: 2, dueAt: at + DAY });
  });

  it("h: an attempt that has not been judged affects nothing", () => {
    const { rows, last } = climbed(2);
    const before = foldTimeline(rows, T0);
    expect(foldTimeline([...rows, attempt(last + 7 * DAY, "need", null)], T0)).toEqual(before);
    expect(foldTimeline([...rows, attempt(last + 7 * DAY, "scene", null)], T0)).toEqual(before);
  });

  it("i: overturning a judgement changes the outcome on the same row, and the result follows", () => {
    const judged = attempt(T0 + DAY, "need", "fail");
    expect(foldTimeline([met(), judged], T0)).toMatchObject({ level: 0, promotions: 0 });
    expect(foldTimeline([met(), { ...judged, outcome: "pass" }], T0)).toMatchObject({ level: 1, promotions: 1 });
  });

  it("j: one pass exactly at 1, 3, 7, 14 and 30 days: level 5, graduated", () => {
    const { rows } = climbed(5);
    expect(foldTimeline(rows, T0)).toMatchObject({ level: 5, promotions: 5, graduated: true, dueAt: Infinity });
    expect(foldTimeline(climbed(4).rows, T0)).toMatchObject({ level: 4, graduated: false });
  });

  it("k: intervals are real elapsed time: an hour short does not promote, and that early attempt pushes the due time", () => {
    const { rows, last } = climbed(1);
    const early = last + 3 * DAY - HOUR;
    expect(foldTimeline([...rows, attempt(early, "need", "pass")], T0)).toMatchObject({
      level: 1,
      promotions: 1,
      dueAt: early + DAY,
    });
  });

  it("l: after a drop, a pass climbs the normal ladder again", () => {
    const { rows, last } = climbed(2);
    const failedAt = last + 7 * DAY;
    const passedAt = failedAt + DAY;
    const all = [...rows, attempt(failedAt, "need", "fail"), attempt(passedAt, "need", "pass")];
    expect(foldTimeline(all, T0)).toMatchObject({ level: 1, promotions: 3, dueAt: passedAt + 3 * DAY });
  });

  it("m: back to 见过 and in again keeps the level; only attempts 24 hours after re-entry promote", () => {
    const { rows } = climbed(1); // earned under the first activation
    const reentered = T0 + 40 * DAY;
    expect(foldTimeline(rows, reentered)).toMatchObject({ level: 1, promotions: 1, dueAt: reentered + DAY });
    expect(foldTimeline([...rows, attempt(reentered + 23 * HOUR, "need", "pass")], reentered).level).toBe(1);
    expect(foldTimeline([...rows, attempt(reentered + DAY, "need", "pass")], reentered).level).toBe(2);
  });

  it("n: answering with the answer in view moves the level neither way", () => {
    const { rows, last } = climbed(1);
    const at = last + 3 * DAY;
    expect(foldTimeline([...rows, attempt(at, "revealed", "pass")], T0)).toMatchObject({ level: 1, promotions: 1 });
    expect(foldTimeline([...rows, attempt(at, "revealed", "fail")], T0)).toMatchObject({ level: 1, promotions: 1 });
  });

  it("o: a hit served masked does not restart the 24 hours; an unmasked one does", () => {
    const at = T0 + 2 * DAY;
    expect(foldTimeline([met(), lookedUp(at, "masked")], T0).dueAt).toBe(T0 + DAY);
    expect(foldTimeline([met(), lookedUp(at, null)], T0).dueAt).toBe(at + DAY);
    // Meeting it again puts the English on screen just the same.
    expect(foldTimeline([met(), met(at)], T0).dueAt).toBe(at + DAY);
  });

  it("p: the answer was seen when the judgement came back, not when the attempt was saved", () => {
    const at = T0 + DAY;
    const folded = foldTimeline([met(), attempt(at, "need", "fail", at + 10 * MIN)], T0);
    expect(folded.answerSeenAt).toBe(at + 10 * MIN);
    expect(folded.dueAt).toBe(at + 10 * MIN + DAY);
  });

  it("q: an entry in the 见过 layer is never due", () => {
    expect(foldTimeline([met()], null).dueAt).toBe(Infinity);
    expect(foldTimeline(climbed(2).rows, null)).toMatchObject({ level: 2, dueAt: Infinity });
  });

  it("r: the order of the input rows does not matter", () => {
    const { rows, last } = climbed(3);
    const all = [
      ...rows,
      lookedUp(last + DAY, "masked"),
      attempt(last + 14 * DAY, "scene", "pass"),
      reveal(last + 20 * DAY, "masked"),
      attempt(last + 22 * DAY, "need", "pass", last + 22 * DAY + MIN),
    ];
    const expected = foldTimeline(all, T0);
    expect(foldTimeline([...all].reverse(), T0)).toEqual(expected);
    expect(foldTimeline([all[4], all[0], all[7], all[2], all[5], all[1], all[6], all[3]], T0)).toEqual(expected);
    // Rows saved in the same millisecond fall back to id order.
    const same = T0 + DAY;
    const first = attempt(same, "need", "pass");
    const second = attempt(same, "need", "fail");
    expect(foldTimeline([met(), second, first], T0)).toEqual(foldTimeline([met(), first, second], T0));
    expect(foldTimeline([met(), second, first], T0)).toMatchObject({ level: 0, promotions: 1 });
  });
});
