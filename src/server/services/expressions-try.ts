import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { encounters, expressions } from "../db/schema.js";
import { failureReason } from "./ai-shared.js";
import { judge } from "./expressions-ai.js";
import { phrasePattern } from "./expressions-find.js";
import { attemptFeedback, loadLibrary, testableAt, type EncounterRow, type Entry } from "./expressions-view.js";
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
    return { id: e.row.id, prompt: scene ?? intent, cue: scene ? "none" : "need", intent, hasScene: sceneOf(e) != null };
  });
}

export interface Attempt {
  entry: Entry;
  row: EncounterRow;
}

/** An attempt row and the entry it answers, as stored now. */
export async function loadAttempt(encounterId: number): Promise<Attempt | null> {
  for (const entry of await loadLibrary()) {
    const row = entry.timeline.find((r) => r.id === encounterId && r.kind === "attempt");
    if (row) return { entry, row };
  }
  return null;
}

/** Stores the sentence, not yet judged, and returns its row. */
export function recordAttempt(expressionId: number, { text, cue, prompt }: AttemptRequest): Promise<EncounterRow> {
  return db.transaction(async (tx) => {
    const feedback: AttemptFeedback = { prompt, status: "pending" };
    const [row] = await tx
      .insert(encounters)
      .values({ expressionId, kind: "attempt", text, cue, feedback: JSON.stringify(feedback), createdAt: Date.now() })
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
export async function judgeAttempt({ entry, row }: Attempt): Promise<void> {
  const prompt = attemptFeedback(row)?.prompt ?? "";
  // Only while there is no outcome: of two judgements, the first to land stands.
  const fill = (outcome: Outcome | null, feedback: AttemptFeedback) =>
    db
      .update(encounters)
      .set({ outcome, feedback: JSON.stringify(feedback) })
      .where(and(eq(encounters.id, row.id), isNull(encounters.outcome)))
      .returning({ id: encounters.id });
  let out;
  try {
    out = await judge({ text: entry.row.text, focus: entry.row.focus, prompt, answer: row.text });
  } catch (err) {
    console.warn(`[expressions] judge #${row.id} failed: ${failureReason(err)}`);
    await fill(null, { prompt, status: "failed" });
    return;
  }
  const { nextScene, ...verdict } = out;
  const [first] = await fill(out.used ? "pass" : "fail", { prompt, status: "done", ...verdict, judgedAt: Date.now() });
  // The scene for next time; one that is already waiting stays.
  if (first && nextScene) {
    await db
      .update(expressions)
      .set({ nextScene: sql`coalesce(${expressions.nextScene}, ${nextScene})` })
      .where(eq(expressions.id, entry.row.id));
  }
}

/** The user's word against the model's, on a row that has an outcome. */
export async function overturn(row: EncounterRow, outcome: Outcome): Promise<void> {
  if (row.outcome === outcome) return;
  const was: AttemptFeedback = attemptFeedback(row) ?? { prompt: "", status: "done" };
  // What the model said is written the first time only, so a second change of
  // mind lands back on it and the row no longer counts as overturned.
  const modelOutcome = was.modelOutcome ?? (row.outcome as Outcome);
  const feedback: AttemptFeedback = { ...was, modelOutcome, overturned: outcome !== modelOutcome, judgedAt: Date.now() };
  await db.update(encounters).set({ outcome, feedback: JSON.stringify(feedback) }).where(eq(encounters.id, row.id));
}

/** What the three attempt routes answer with. */
export function attemptResponse({ entry, row }: Attempt): AttemptResponse {
  const feedback = attemptFeedback(row);
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
    answer: withheld ? null : { text: entry.row.text, focus: entry.row.focus, gloss: entry.row.gloss },
    intent: withheld && outcome != null ? entry.row.intent : null,
  };
}

// Days are told apart in UTC+8, wherever the server runs.
const UTC8 = 8 * 3_600_000;
const JUDGE_AFTER = 28 * DAY;

/** The one number the home page shows, and the two day counts the four weeks
 *  after launch are read by. Computed from the timeline on every call. */
export async function stats(): Promise<StatsResponse> {
  const library = await loadLibrary();
  const produced = library.filter((e) => e.folded.promotions > 0).length;
  if (library.length === 0) return { produced, testableDays: 0, attemptDays: 0, since: null, judgeAt: null };
  // No launch date is on record: the first entry saved stands in for it.
  const since = library[library.length - 1].row.createdAt;
  const judgeAt = since + JUDGE_AFTER;
  // What the page wrote in those four weeks; a reveal is not counted. Past
  // judgeAt both numbers stand still.
  const writes = await db
    .select({ kind: encounters.kind, createdAt: encounters.createdAt })
    .from(encounters)
    .where(and(
      inArray(encounters.kind, ["met", "looked_up", "attempt"]),
      gte(encounters.createdAt, since),
      lt(encounters.createdAt, judgeAt),
    ))
    .all();
  const testable = new Set<number>();
  const attempted = new Set<number>();
  for (const w of writes) {
    const day = Math.floor((w.createdAt + UTC8) / DAY);
    if (w.kind === "attempt") attempted.add(day);
    // A day counts once something could have been asked at one of its writes.
    if (!testable.has(day) && testableAt(library, w.createdAt).length > 0) testable.add(day);
  }
  return { produced, testableDays: testable.size, attemptDays: [...testable].filter((d) => attempted.has(d)).length, since, judgeAt };
}
