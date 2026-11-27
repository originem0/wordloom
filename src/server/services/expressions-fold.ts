// An expression's level, its due time and whether it "has been produced" are
// not stored anywhere: they are folded from its timeline on every read. Every
// constant of the schedule lives in this file, so changing one needs no
// migration and re-judges the whole history at once.

const DAY = 86_400_000;
// Lower bound (days) before the k-th promotion; after the fifth, graduated.
const INTERVAL_DAYS = [1, 3, 7, 14, 30];
const GRADUATED = INTERVAL_DAYS.length;

export interface TimelineRow {
  id: number;
  kind: string; // met | looked_up | reveal | attempt | used
  cue: string | null;
  outcome: string | null; // pass | fail | null = not judged yet
  createdAt: number;
  /** When the judgement came back (kept in `feedback`). */
  judgedAt?: number | null;
  shownAt?: number[];
  activeAtAttempt?: number | null;
  /** What the model had said, once the user has overturned it (kept in `feedback`). */
  modelOutcome?: string | null;
}

export interface Folded {
  level: number;
  /** Passes that counted. "用出过" means promotions > 0. */
  promotions: number;
  graduated: boolean;
  /** Earliest moment the entry may be tested; Infinity = never. */
  dueAt: number;
  /** Last moment the English was on screen. */
  answerSeenAt: number;
}

/**
 * @param rows        one expression's encounters, in any order
 * @param activeSince expressions.active_since; null while the entry is in the 见过 layer
 */
export function foldTimeline(rows: TimelineRow[], activeSince: number | null): Folded {
  let level = 0;
  let promotions = 0;
  let earliestAt = -Infinity; // set by the last promotion or demotion
  let answerSeenAt = -Infinity;
  const seen = (t: number) => {
    if (t > answerSeenAt) answerSeenAt = t;
  };
  const dropTo = (next: number, t: number) => {
    level = next;
    earliestAt = t + DAY;
  };
  // (Re)entering the 想用 layer restarts the 24h clock, but only for attempts
  // made after it: leaving and re-entering is not on the timeline, so older
  // attempts keep the verdict they earned.
  const dueFor = (t: number, entered: number | null) =>
    Math.max(
      earliestAt,
      answerSeenAt + DAY,
      entered != null && t >= entered ? entered + INTERVAL_DAYS[0] * DAY : -Infinity,
    );

  // An answer seen on Friday cannot disqualify a sentence written on Thursday.
  const sightings = rows.flatMap((r) => {
    if (r.kind !== "attempt" || r.outcome == null) return [];
    const times = r.shownAt ?? (r.cue !== "none" || r.outcome === "pass" || r.modelOutcome != null ? [r.judgedAt ?? r.createdAt] : []);
    return times.map((createdAt) => ({ ...r, kind: "shown", createdAt }));
  });
  const ordered = [...rows, ...sightings].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
  for (const r of ordered) {
    const t = r.createdAt;
    if (r.kind === "met" || r.kind === "used" || r.kind === "shown") {
      seen(t);
      continue;
    }
    if (r.kind === "looked_up") {
      if (r.cue !== "masked") seen(t);
      continue;
    }
    if (r.kind === "reveal") {
      // Any cue but "masked" is the level the user gave up at inside 试一条.
      if (r.cue !== "masked") dropTo(0, t);
      seen(t);
      continue;
    }
    if (r.kind !== "attempt" || r.outcome == null) continue; // not judged yet: no effect at all
    const pass = r.outcome === "pass";
    if (r.cue === "none" || r.cue === "need") {
      if (pass) {
        // A pass that came too early stays on the timeline and changes nothing.
        if (level < GRADUATED && t >= dueFor(t, r.activeAtAttempt === undefined ? activeSince : r.activeAtAttempt)) {
          level += 1;
          promotions += 1;
          earliestAt = level < GRADUATED ? t + INTERVAL_DAYS[level] * DAY : Infinity;
        }
      } else if (r.cue === "need") {
        dropTo(0, t);
      }
      // none + fail: recorded, neutral
    } else if (r.cue === "scene") {
      dropTo(pass ? Math.max(0, level - 1) : 0, t);
    }
    // cue "revealed": no level change either way.
  }

  const graduated = level >= GRADUATED;
  const dueAt =
    graduated || activeSince == null
      ? Infinity
      : Math.max(earliestAt, answerSeenAt + DAY, activeSince + INTERVAL_DAYS[0] * DAY);
  return { level, promotions, graduated, dueAt, answerSeenAt };
}
