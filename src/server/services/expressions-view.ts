import { and, asc, desc, eq, lte, sql, or, type SQL, getTableColumns } from "drizzle-orm";
import { db } from "../db/index.js";
import { encounters, expressionPassageNotes, expressions } from "../db/schema.js";
import { foldTimeline, type Folded } from "./expressions-fold.js";
import type {
  AttemptFeedback,
  DuplicateResponse,
  EncounterView,
  ExpressionDetail,
  ExpressionSummary,
  LearningState,
} from "../../shared/expressions.js";

// Reading the expression library. Every route answers through this file,
// because what an entry may show is decided here: one in the 想用 layer is
// served without its English until the user asks for it in a request that is
// written down. That, and nothing the page reports about what it displayed,
// is what "had not seen the answer" rests on.

export type ExpressionRow = typeof expressions.$inferSelect;
export type EncounterRow = typeof encounters.$inferSelect;

export interface Entry {
  row: ExpressionRow;
  /** Oldest first. */
  timeline: EncounterRow[];
  folded: Folded;
  /** In 想用 but over the cap: not asked for now. */
  queued: boolean;
}

// 想用 takes any number of entries, but of those still below level 3 only the
// twelve that entered first are asked. The rest wait; there is no queue table,
// the order is `active_since`. Counted by current level and not by promotions
// ever earned: an entry that fell back to zero needs its place again.
const ACTIVE_CAP = 12;
const CAP_BELOW_LEVEL = 3;

/** What an attempt row keeps in `feedback`. */
export function attemptFeedback(r: EncounterRow): AttemptFeedback | null {
  if (r.kind !== "attempt" || !r.feedback) return null;
  try {
    return JSON.parse(r.feedback) as AttemptFeedback;
  } catch {
    return null;
  }
}

export function currentState(row: ExpressionRow): LearningState {
  return { at: row.activeSince ?? row.createdAt, status: row.status as LearningState["status"], activeSince: row.activeSince, focus: row.focus, version: row.targetVersion ?? 0 };
}

function lastBefore<T>(values: T[] | undefined | null, matches: (value: T) => boolean) {
  if (values) for (let i = values.length - 1; i >= 0; i--) if (matches(values[i])) return values[i];
  return undefined;
}

function stateAt(row: ExpressionRow, at: number) {
  return lastBefore(row.learningHistory, (state) => state.at <= at) ?? row.learningHistory?.[0] ?? currentState(row);
}

function fold(row: ExpressionRow, timeline: EncounterRow[], at = Infinity): Folded {
  const state = stateAt(row, at);
  const rows = timeline.filter((r) => r.createdAt < at && (r.kind === "met" || (r.targetVersion ?? 0) === state.version)).map((r) => {
    const feedback = attemptFeedback(r);
    return {
      id: r.id,
      kind: r.kind,
      cue: r.cue,
      outcome: at === Infinity || !feedback ? r.outcome : lastBefore(feedback.judgments, (j) => j.at < at)?.outcome ?? ((feedback.judgedAt ?? r.createdAt) < at ? r.outcome : null),
      createdAt: r.createdAt,
      judgedAt: feedback?.judgedAt,
      shownAt: feedback?.shownAt?.filter((t) => t < at),
      activeAtAttempt: feedback?.activeSince !== undefined ? feedback.activeSince : stateAt(row, r.createdAt).activeSince,
      modelOutcome: feedback?.modelOutcome,
    };
  });
  // Leaving 想用 clears active_since, so outside it nothing is ever due.
  return foldTimeline(rows, state.activeSince);
}

/** Of the entries in 想用, the ids of those over the cap. */
function overCap(entries: Pick<Entry, "row" | "folded">[]): Set<number> {
  const climbing = entries
    .filter((e) => e.row.status === "active" && e.folded.level < CAP_BELOW_LEVEL)
    .sort((a, b) => (a.row.activeSince ?? 0) - (b.row.activeSince ?? 0) || a.row.id - b.row.id);
  return new Set(climbing.slice(ACTIVE_CAP).map((e) => e.row.id));
}

/** What a read needs: the database, or a transaction on it. */
type Reader = Pick<typeof db, "select">;

// An inactive entry without a successful attempt cannot have earned a promotion.
// Its original encounter supplies the source. Other unlinked activity and the
// private text of lookups are unnecessary for any summary or candidate index.
export const hasPassed = sql`exists (select 1 from encounters p where p.expression_id = ${expressions.id} and p.target_version = ${expressions.targetVersion} and p.kind = 'attempt' and p.outcome = 'pass')`;

export async function loadLibrary(from: Reader = db, activeOnly = false, subset?: SQL): Promise<Entry[]> {
  const scope = and(activeOnly ? eq(expressions.status, "active") : undefined, subset);
  const rows = await from.select().from(expressions).where(scope).orderBy(desc(expressions.createdAt), desc(expressions.id)).all();
  if (!rows.length) return [];
  const firstMet = sql`${encounters.id} = (select m.id from encounters m where m.expression_id = ${expressions.id} and m.kind = 'met' order by m.created_at, m.id limit 1)`;
  const history = activeOnly || subset === hasPassed ? undefined : or(eq(expressions.status, "active"), hasPassed, firstMet, and(eq(encounters.kind, "attempt"), eq(encounters.sourceType, "chat")));
  const all = await from.select({
    ...getTableColumns(encounters),
    text: sql<string>`case when ${encounters.kind} = 'met' then ${encounters.text} else '' end`,
    textBefore: sql<string | null>`case when ${encounters.kind} = 'met' then ${encounters.textBefore} end`,
    myAttempt: sql<null>`null`,
    feedback: sql<string | null>`case when ${encounters.kind} = 'attempt' then ${encounters.feedback} end`,
  }).from(expressions).innerJoin(encounters, eq(encounters.expressionId, expressions.id))
    .where(and(scope, history)).orderBy(asc(encounters.createdAt), asc(encounters.id)).all();
  const timelines = new Map<number, EncounterRow[]>();
  for (const r of all) {
    if (r.expressionId == null) continue; // a question that matched nothing
    const timeline = timelines.get(r.expressionId);
    if (timeline) timeline.push(r);
    else timelines.set(r.expressionId, [r]);
  }
  const entries = rows.map((row) => {
    const timeline = timelines.get(row.id) ?? [];
    return { row, timeline, folded: fold(row, timeline), queued: false };
  });
  const queued = overCap(entries);
  for (const e of entries) e.queued = queued.has(e.row.id);
  return entries;
}

export async function loadEntry(id: number, from: Reader = db): Promise<Entry | null> {
  const row = await from.select().from(expressions).where(eq(expressions.id, id)).get();
  if (!row) return null;
  const timeline = await from.select().from(encounters).where(eq(encounters.expressionId, id)).orderBy(encounters.createdAt, encounters.id).all();
  const folded = fold(row, timeline);
  let queued = false;
  if (row.status === "active" && folded.level < CAP_BELOW_LEVEL && row.activeSince != null) {
    const earlier = await from.select({ id: expressions.id }).from(expressions).where(and(eq(expressions.status, "active"), lte(expressions.activeSince, row.activeSince))).limit(ACTIVE_CAP + 1);
    if (earlier.length > ACTIVE_CAP) queued = (await loadLibrary(from, true, lte(expressions.activeSince, row.activeSince))).some((e) => e.row.id === id && e.queued);
  }
  return { row, timeline, folded, queued };
}

/**
 * What 试一条 may ask at `t`, as things stood just before it: in 想用, inside
 * the cap and past its due time, longest overdue first. One definition serves
 * the panel (t = now) and the count of days on which something could have
 * been asked (t = the moment of a past write). Stored state transitions and judgement times determine what counted at a past write.
 */
export function testableAt(entries: Entry[], t: number): Entry[] {
  const active = entries
    .filter((e) => e.row.createdAt <= t && stateAt(e.row, t).status === "active")
    .map((e) => ({ ...e, row: { ...e.row, ...stateAt(e.row, t) }, folded: fold(e.row, e.timeline, t) }));
  const queued = overCap(active);
  return active
    .filter((e) => !queued.has(e.row.id) && e.folded.dueAt <= t)
    .map((e) => ({ ...e, queued: false }))
    .sort((a, b) => a.folded.dueAt - b.folded.dueAt || a.row.id - b.row.id);
}

/** Whether the English is withheld: in 想用 and not graduated. */
export const isMasked = (e: Entry) => e.row.status === "active" && !e.folded.graduated;

/** `unmask` is for the one answer that follows a reveal, or an attempt. */
export function toSummary(e: Entry, unmask = false): ExpressionSummary {
  const { row } = e;
  const masked = !unmask && isMasked(e);
  // Where it was first met. Capture writes that row, so it is the oldest.
  const met = e.timeline.find((r) => r.kind === "met");
  return {
    id: row.id,
    ...(row.targetVersion && { targetVersion: row.targetVersion }),
    status: row.status as ExpressionSummary["status"],
    masked,
    text: masked ? null : row.text,
    focus: masked ? null : row.focus,
    intent: row.intent,
    intentBy: row.intentBy as ExpressionSummary["intentBy"],
    sourceType: (met?.sourceType ?? null) as ExpressionSummary["sourceType"],
    sourceTitle: met?.sourceTitle ?? null,
    occurredAt: met?.occurredAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    produced: e.folded.promotions > 0,
    graduated: e.folded.graduated,
    queued: e.queued,
  };
}

// Field by field rather than spread: a column added later stays on the server
// until someone decides it should leave, masked or not.
function toEncounterView(r: EncounterRow, masked: boolean): EncounterView {
  return {
    id: r.id,
    kind: r.kind as EncounterView["kind"],
    createdAt: r.createdAt,
    // A time is not private text. Withheld, the row would be dated by when it
    // was written, and move to another day once the answer is looked at.
    occurredAt: r.occurredAt,
    cue: r.cue as EncounterView["cue"],
    outcome: r.outcome as EncounterView["outcome"],
    text: masked ? null : r.text,
    textBefore: masked ? null : r.textBefore,
    myAttempt: masked ? null : r.myAttempt,
    sourceType: masked ? null : (r.sourceType as EncounterView["sourceType"]),
    sourceTitle: masked ? null : r.sourceTitle,
    sourceLocator: masked ? null : r.sourceLocator,
    feedback: masked ? null : attemptFeedback(r),
  };
}

export async function toDetail(e: Entry, unmask = false, from: Reader = db): Promise<ExpressionDetail> {
  const summary = toSummary(e, unmask);
  const { masked } = summary;
  const notes = expressionPassageNotes;
  return {
    ...summary,
    focusRange: !masked && e.row.focusStart != null && e.row.focus ? { start: e.row.focusStart, end: e.row.focusStart + e.row.focus.length } : null,
    legacyHistory: !!e.row.learningHistory?.[0]?.estimated || !e.row.learningHistory || e.row.learningHistory[0]?.at !== e.row.createdAt,
    note: masked ? null : e.row.note,
    passageNotes: masked ? [] : await from.select({ start: notes.start, end: notes.end, body: notes.body, examples: notes.examples })
      .from(notes).where(eq(notes.expressionId, e.row.id)).orderBy(notes.start, notes.end).all(),
    gloss: masked ? null : e.row.gloss,
    aiIntent: masked ? null : e.row.aiIntent,
    annotated: e.row.gloss != null,
    activeSince: e.row.activeSince,
    timeline: e.timeline.map((r) => ({ ...toEncounterView(r, masked), ...(!masked && r.kind === "attempt" && r.targetVersion !== e.row.targetVersion ? { previousFocus: e.row.learningHistory?.find((state) => state.version === r.targetVersion)?.focus ?? null } : {}) })),
  };
}

/** An entry as the "already saved" answer names it. */
export function toDuplicate(e: Entry): DuplicateResponse["existing"][number] {
  const { id, masked, text, intent, createdAt } = toSummary(e);
  return { id, masked, text, intent, createdAt };
}
