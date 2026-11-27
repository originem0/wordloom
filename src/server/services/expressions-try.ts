import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { encounters, evaluationWindow, expressions, learningDays } from "../db/schema.js";
import { failureReason } from "./ai-shared.js";
import { judge } from "./expressions-ai.js";
import { phrasePattern } from "./expressions-talk.js";
import { attemptFeedback, hasPassed, loadEntry, loadLibrary, testableAt, type EncounterRow, type Entry } from "./expressions-view.js";
import type {
  AttemptFeedback, AttemptRequest, AttemptResponse, Outcome, SceneResponse, StatsResponse, TryItem,
} from "../../shared/expressions.js";

// 试一条: what it asks, what becomes of an answer, and what it counts. The
// sentence is stored before it is judged, and the judgement, whenever it
// comes and whoever has the last word on it, is kept on that same row.

const DAY = 86_400_000;
const BLANK = "____";

/** The second hint: where the entry was first met, with the focus blanked
 *  out. Null when there is no focus, when that sentence does not have it, or
 *  when nothing but the blank would be left. */
export function sceneOf(e: Entry): SceneResponse | null {
  const met = e.timeline.find((r) => r.kind === "met");
  if (!met || !e.row.focus?.trim()) return null;
  // Every occurrence, however cased or spaced: one left standing is the answer.
  const focus = new RegExp(phrasePattern(e.row.focus), "giu");
  const scene = met.text.replace(focus, BLANK);
  const before = met.textBefore?.replace(focus, BLANK) ?? null;
  if (scene === met.text || !/\p{L}/u.test(scene + (before ?? ""))) return null;
  return { scene, before };
}

/** Up to three entries that are due, the longest overdue first. */
export function tryItems(library: Entry[], now: number, exclude: Set<number>): TryItem[] {
  const due = testableAt(library, now).filter((e) => !exclude.has(e.row.id));
  return due.slice(0, 3).map((e) => {
    const intent = e.row.intent ?? "";
    // A stored scene is the harder question and is asked first, once.
    const scene = e.row.nextScene || null;
    return { id: e.row.id, ...(e.row.targetVersion && { targetVersion: e.row.targetVersion }), prompt: scene ?? intent, cue: scene ? "none" : "need", intent, hasScene: sceneOf(e) != null };
  });
}

export interface Attempt {
  entry: Entry;
  row: EncounterRow;
}

/** An attempt row and the entry it answers, as stored now. */
export async function loadAttempt(encounterId: number): Promise<Attempt | null> {
  const row = await db.select().from(encounters).where(and(eq(encounters.id, encounterId), eq(encounters.kind, "attempt"))).get();
  if (!row?.expressionId) return null;
  const entry = await loadEntry(row.expressionId);
  return entry ? { entry, row } : null;
}

function attemptTarget({ entry, row }: Attempt) {
  if (row.targetVersion === entry.row.targetVersion) return entry.row;
  const previous = entry.row.learningHistory?.find((state) => state.version === row.targetVersion);
  return { ...entry.row, focus: previous?.focus ?? null, gloss: null, intent: null };
}

/** Stores the sentence, not yet judged, and returns its row. */
export function recordAttempt(expressionId: number, { text, cue, prompt }: AttemptRequest, talkTurnId?: number, version?: number): Promise<EncounterRow | null> {
  return db.transaction(async (tx) => {
    // One conversation turn answers at most one review. Keep its link in the
    // source columns: judging and overturning deliberately replace feedback.
    const sourceLocator = talkTurnId == null ? null : `talk:${talkTurnId}`;
    if (sourceLocator) {
      const existing = await tx.select().from(encounters).where(and(
        eq(encounters.kind, "attempt"), eq(encounters.sourceType, "chat"), eq(encounters.sourceLocator, sourceLocator),
      )).get();
      if (existing) return existing;
    }
    const current = await tx.select().from(expressions).where(eq(expressions.id, expressionId)).get();
    if (!current || current.status !== "active" || (version != null && current.targetVersion !== version)) return null;
    if (talkTurnId == null && cue === "none" && prompt !== current.nextScene) return null;
    const now = Date.now();
    await recordDay(tx, now, "attempt");
    const feedback: AttemptFeedback = { prompt, status: "pending", activeSince: current.activeSince };
    const [row] = await tx
      .insert(encounters)
      .values({ expressionId, kind: "attempt", text, cue, targetVersion: current.targetVersion, feedback: JSON.stringify(feedback), createdAt: now,
        ...(sourceLocator ? { sourceType: "chat", sourceLocator } : {}),
      })
      .returning();
    // A stored scene is asked once, whatever else was on screen with it.
    await tx
      .update(expressions)
      .set({ nextScene: null })
      .where(and(eq(expressions.id, expressionId), eq(expressions.nextScene, prompt)));
    return row;
  });
}

/** Asks for the judgement of a row that has none and fills that row in. A
 *  model failure is noted on the row, not thrown: the sentence is saved, it
 *  counts for nothing, and the same call can be made again. */
export async function judgeAttempt({ entry, row }: Attempt, signal?: AbortSignal): Promise<void> {
  const savedFeedback = attemptFeedback(row);
  const prompt = savedFeedback?.prompt ?? "";
  const basis = { prompt, activeSince: savedFeedback?.activeSince };
  // Only while there is no outcome: of two judgements, the first to land stands.
  const fill = (outcome: Outcome | null, feedback: AttemptFeedback) =>
    db
      .update(encounters)
      .set({ outcome, feedback: JSON.stringify(feedback) })
      .where(and(eq(encounters.id, row.id), isNull(encounters.outcome)))
      .returning({ id: encounters.id });
  let out;
  try {
    const target = attemptTarget({ entry, row });
    out = await judge({ text: target.text, focus: target.focus, prompt, answer: row.text }, { signal });
  } catch (err) {
    console.warn(`[expressions] judge #${row.id} failed: ${failureReason(err)}`);
    await fill(null, { ...basis, status: "failed" });
    return;
  }
  const { nextScene, ...verdict } = out;
  const judgedAt = Date.now();
  const outcome = out.used ? "pass" : "fail";
  const [first] = await fill(outcome, { ...basis, status: "done", ...verdict, judgedAt, judgments: [{ at: judgedAt, outcome }], shownAt: row.cue !== "none" || out.used ? [judgedAt] : [] });
  // The scene for next time; one that is already waiting stays.
  if (first && nextScene) {
    await db
      .update(expressions)
      .set({ nextScene: sql`coalesce(${expressions.nextScene}, ${nextScene})` })
      .where(and(eq(expressions.id, entry.row.id), eq(expressions.targetVersion, row.targetVersion)));
  }
}

/** The user's word against the model's, on a row that has an outcome. */
export async function overturn(row: EncounterRow, outcome: Outcome): Promise<void> {
  await db.transaction(async (tx) => {
    // Compare and append to the latest history while holding the write lock.
    const current = await tx.select().from(encounters).where(eq(encounters.id, row.id)).get();
    if (!current || current.outcome == null) return;
    if (current.outcome === outcome) return;
    const was: AttemptFeedback = attemptFeedback(current) ?? { prompt: "", status: "done" };
    // What the model said is written the first time only, so a second change of
    // mind lands back on it and the row no longer counts as overturned.
    const modelOutcome = was.modelOutcome ?? (current.outcome as Outcome);
    const at = Date.now();
    const first = was.judgedAt ?? current.createdAt;
    const shown = was.shownAt ?? (current.cue !== "none" || modelOutcome === "pass" ? [first] : []);
    const feedback: AttemptFeedback = { ...was, modelOutcome, overturned: outcome !== modelOutcome, judgedAt: first,
      judgments: [...(was.judgments ?? [{ at: first, outcome: modelOutcome }]), { at, outcome }], shownAt: [...shown, at] };
    await tx.update(encounters).set({ outcome, feedback: JSON.stringify(feedback) }).where(eq(encounters.id, current.id));
  });
}

/** What the three attempt routes answer with. */
export function attemptResponse({ entry, row }: Attempt): AttemptResponse {
  const feedback = attemptFeedback(row);
  const target = attemptTarget({ entry, row });
  const outcome = row.outcome as Outcome | null;
  // The English stays back while there is no judgement, and after the one
  // miss that shows nothing: only the fresh scene had been seen, and the user
  // has never disputed the result. The fold reads such a row the same way.
  const withheld = outcome == null || (row.cue === "none" && outcome === "fail" && feedback?.modelOutcome == null);
  return {
    encounterId: row.id,
    status: outcome == null ? "failed" : "done",
    verdict: outcome == null ? null : feedback?.used ? "used" : feedback?.conveyed ? "conveyed" : "missed",
    outcome,
    overturned: feedback?.overturned ?? false,
    rewrites: withheld ? [] : (feedback?.rewrites ?? []),
    answer: withheld ? null : { text: target.text, focus: target.focus, gloss: target.gloss },
    intent: withheld && outcome != null ? target.intent : null,
  };
}

// Days are told apart in UTC+8, wherever the server runs.
const UTC8 = 8 * 3_600_000;
const JUDGE_AFTER = 28 * DAY;

type DayWriter = Pick<typeof db, "insert" | "select">;

// Record the two daily flags at the time of the action. Later edits, deletes
// and overdue judgements cannot rewrite the four-week evaluation.
export async function recordDay(tx: DayWriter, at: number, kind: "met" | "looked_up" | "attempt") {
  await tx.insert(evaluationWindow).values({ id: 1, startedAt: at }).onConflictDoNothing();
  const window = await tx.select().from(evaluationWindow).where(eq(evaluationWindow.id, 1)).get();
  if (!window || at < window.startedAt || at >= window.startedAt + JUDGE_AFTER) return;
  const day = Math.floor((at + UTC8) / DAY);
  const previous = await tx.select().from(learningDays).where(eq(learningDays.day, day)).get();
  const attempted = Number(kind === "attempt") || previous?.attempted || 0;
  const testable = previous?.testable || Number(testableAt(await loadLibrary(tx, true), at).length > 0);
  await tx.insert(learningDays).values({ day, attempted, testable }).onConflictDoUpdate({ target: learningDays.day, set: { attempted, testable } });
}

export async function stats(): Promise<StatsResponse> {
  const produced = (await loadLibrary(db, false, hasPassed)).filter((e) => e.folded.promotions > 0).length;
  const window = await db.select().from(evaluationWindow).where(eq(evaluationWindow.id, 1)).get();
  const days = await db.select().from(learningDays).all();
  const since = window?.startedAt ?? null;
  return { produced, since, judgeAt: since == null ? null : since + JUDGE_AFTER, testableDays: days.filter((d) => d.testable).length,
    attemptDays: days.filter((d) => d.testable && d.attempted).length };
}
