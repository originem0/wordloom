import { asc, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { encounters, expressions } from "../db/schema.js";
import { foldTimeline, type Folded } from "./expressions-fold.js";
import type {
  AttemptFeedback,
  DuplicateResponse,
  EncounterView,
  ExpressionDetail,
  ExpressionSummary,
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

function fold(row: ExpressionRow, timeline: EncounterRow[]): Folded {
  const rows = timeline.map((r) => {
    const feedback = attemptFeedback(r);
    return {
      id: r.id,
      kind: r.kind,
      cue: r.cue,
      outcome: r.outcome,
      createdAt: r.createdAt,
      judgedAt: feedback?.judgedAt,
      modelOutcome: feedback?.modelOutcome,
    };
  });
  // Leaving 想用 clears active_since, so outside it nothing is ever due.
  return foldTimeline(rows, row.activeSince);
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

/** The whole library, newest first, every timeline folded. It stays a few
 *  hundred entries for a long time, so no route reads less than all of it. */
export async function loadLibrary(from: Reader = db): Promise<Entry[]> {
  const rows = await from.select().from(expressions).orderBy(desc(expressions.createdAt), desc(expressions.id)).all();
  const all = await from.select().from(encounters).orderBy(asc(encounters.createdAt), asc(encounters.id)).all();
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
  return (await loadLibrary(from)).find((e) => e.row.id === id) ?? null;
}

/**
 * What 试一条 may ask at `t`, as things stood just before it: in 想用, inside
 * the cap and past its due time, longest overdue first. One definition serves
 * the panel (t = now) and the count of days on which something could have
 * been asked (t = the moment of a past write). For a past moment it still
 * goes by the entry's present layer and `active_since`: a change of layer is
 * not on the timeline.
 */
export function testableAt(entries: Entry[], t: number): Entry[] {
  const active = entries
    .filter((e) => e.row.status === "active")
    .map((e) => ({ ...e, folded: fold(e.row, e.timeline.filter((r) => r.createdAt < t)) }));
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

export function toDetail(e: Entry, unmask = false): ExpressionDetail {
  const summary = toSummary(e, unmask);
  const { masked } = summary;
  return {
    ...summary,
    note: masked ? null : e.row.note,
    gloss: masked ? null : e.row.gloss,
    aiIntent: masked ? null : e.row.aiIntent,
    annotated: e.row.gloss != null,
    activeSince: e.row.activeSince,
    timeline: e.timeline.map((r) => toEncounterView(r, masked)),
  };
}

/** An entry as the "already saved" answer names it. */
export function toDuplicate(e: Entry): DuplicateResponse["existing"][number] {
  const { id, masked, text, intent, createdAt } = toSummary(e);
  return { id, masked, text, intent, createdAt };
}
