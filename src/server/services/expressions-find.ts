import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { cards, encounters } from "../db/schema.js";
import { failureReason } from "./ai-shared.js";
import { findInIndex } from "./expressions-ai.js";
import { isMasked, loadLibrary, toSummary, type Entry } from "./expressions-view.js";
import { EXPRESSION_LIMITS, type FindHit, type FindRequest, type FindResponse, type Suggestion } from "../../shared/expressions.js";

// 找: the user says what they want to say and the library answers first. The
// model reads an index of it and names entries by id. Whatever is shown as an
// entry comes from the database, and every question is written down.

/** What duplicates are found by: the focus, or the whole text without one. */
export const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Source of a pattern that matches `phrase` however it is spaced and
 *  whichever apostrophe it is typed with. */
export const phrasePattern = (phrase: string) =>
  phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+").replace(/['‘’]/g, "['‘’]");

/** Whether `s` says the target of `e`, as whole words. `norm` is that target;
 *  the punctuation around a whole sentence is not part of it. */
function says(s: string, e: Entry): boolean {
  const target = e.row.norm.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return target !== "" && new RegExp(`(?<![\\p{L}\\p{N}])${phrasePattern(target)}(?![\\p{L}\\p{N}])`, "iu").test(s);
}

// Characters of index per call. What does not fit is not searched this time,
// and the answer says how much was.
const INDEX_BUDGET = 60_000;
const MAX_HITS = 5;
const ONE_WORD = /^[A-Za-z][A-Za-z'’-]*$/;
const cell = (s: string | null, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The library as the model reads it, one line an entry: 想用 first, then 见过
 *  from the newest, then what was shelved. */
function buildIndex(library: Entry[]) {
  const lines: string[] = [];
  const indexed = new Map<number, Entry>();
  let room = INDEX_BUDGET;
  for (const e of ["active", "seen", "retired"].flatMap((status) => library.filter(({ row }) => row.status === status))) {
    const { id, focus, text, intent, aiIntent } = e.row;
    const line = [id, cell(focus, EXPRESSION_LIMITS.focus) || cell(text, 80), cell(intent, 100), cell(aiIntent, 100)].join(" | ");
    if (line.length + 1 > room) break;
    room -= line.length + 1;
    lines.push(line);
    indexed.set(id, e);
  }
  return { index: lines.join("\n"), indexed };
}

/** Null when the model did not answer; nothing is written then, so asking
 *  again does not leave the question on the timeline twice. */
export async function find(q: FindRequest): Promise<FindResponse | null> {
  const library = await loadLibrary();
  const attempt = q.attempt?.trim() ? q.attempt : null;
  const word = q.need.toLowerCase();
  const card = ONE_WORD.test(q.need)
    ? ((await db.select({ id: cards.id, word: cards.word }).from(cards).where(sql`lower(${cards.word}) = ${word}`).get()) ?? null)
    : null;
  // A hit in 想用 keeps its English back unless the question came with some:
  // an attempt, or a word with a card, which the user has typed out themselves.
  const open = attempt != null || card != null;
  const hits = new Map<Entry, string>(); // each with the reason given for it, in the order shown
  let fix: Suggestion | null = null;
  let fresh: Suggestion[] = [];
  let searched = library.length;

  if (card) {
    for (const e of library) if (e.row.norm === word) hits.set(e, "");
  } else {
    const { index, indexed } = buildIndex(library);
    searched = indexed.size;
    let out;
    try {
      out = await findInIndex({ need: q.need, ...(attempt ? { attempt } : {}), history: q.history, index });
    } catch (err) {
      console.warn(`[expressions] find failed: ${failureReason(err)}`);
      return null;
    }
    // Only ids that were handed out: the model cannot make an entry up.
    for (const m of out.mine) {
      const e = indexed.get(m.id);
      if (e && hits.size < MAX_HITS && !hits.has(e)) hits.set(e, m.why);
    }
    // A suggestion that contains an entry's target is that entry, not a new
    // way of saying it. Passed on as written, it would put the English of a
    // masked entry on screen with no row to say so.
    const inLibrary = (text: string, why: string) => {
      const said = library.filter((e) => says(text, e));
      for (const e of said) if (!hits.has(e)) hits.set(e, why);
      return said.length > 0;
    };
    fresh = out.fresh.filter((s) => !inLibrary(s.text, s.why));
    // The fix stays, being the user's own sentence put right; an entry it
    // uses is shown and recorded with it.
    fix = attempt ? out.fix : null;
    if (fix) inLibrary(fix.text, "");
  }

  // A reason tends to quote what it is about, so a masked hit goes without
  // one, and no reason may name an entry whose English this answer holds
  // back: every masked entry, but for the hits of a question that brought
  // English, which are shown and each get a row for it.
  const hidden = library.filter((e) => isMasked(e) && !(open && hits.has(e)));
  const quiet = (why: string) => (hidden.some((e) => says(why, e)) ? "" : why);
  const mine: FindHit[] = [...hits].map(([e, why]) => {
    const expression = toSummary(e, open);
    return { expression, why: expression.masked ? null : quiet(why) || null };
  });
  fresh = fresh.map((s) => ({ ...s, why: quiet(s.why) }));
  if (fix) fix = { ...fix, why: quiet(fix.why) };

  // Written before the answer leaves. One row a hit, all at the same moment;
  // a question that found nothing is still a question.
  const asked = {
    kind: "looked_up",
    text: q.need,
    myAttempt: attempt,
    feedback: JSON.stringify({ turn: q.turn, thread: q.thread }),
    createdAt: Date.now(),
  };
  await db.insert(encounters).values(
    mine.length > 0
      ? mine.map(({ expression }) => ({ ...asked, expressionId: expression.id, cue: expression.masked ? "masked" : null }))
      : [{ ...asked, expressionId: null, cue: null }],
  );
  return { card, mine, fix, fresh, searched, total: library.length };
}
