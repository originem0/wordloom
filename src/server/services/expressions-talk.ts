import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { encounters, talkTurns } from "../db/schema.js";
import { failureReason } from "./ai-shared.js";
import { answerReview, chooseReview } from "./expressions-review.js";
import { attemptResponse } from "./expressions-try.js";
import { coachConversation, converse, replyConversation, type ConversationMaterial } from "./expressions-ai.js";
import { isMasked, loadLibrary, toSummary, type Entry } from "./expressions-view.js";
import {
  EXPRESSION_LIMITS, TALK_HISTORY_TURNS, type Rewrite, type Suggestion, type TalkFailure, type TalkHit, type TalkRequest, type TalkThread,
  type TalkTurn,
} from "../../shared/expressions.js";

// 对谈: the user talks with a partner who answers in English, and the library
// listens in. The model writes the reply and the coaching; what of that may be
// shown, and as what, is decided here. It names entries by id only, it is never
// shown the English of an entry that is masked, and every turn is written down
// before it is answered.

/** What duplicates are found by: the focus, or the whole text without one. */
export const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Source of a pattern that matches `phrase` however it is spaced and
 *  whichever apostrophe it is typed with. */
export const phrasePattern = (phrase: string) =>
  phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+").replace(/['‘’]/g, "['‘’]");

const BLANK = "____";
// For an entry with no word in it: matches nothing, not even the empty string (which /$^/ does).
const NEVER = /(?!)/g;

/**
 * Finds the targets of a library in running text. A target is `norm` without
 * the punctuation around a whole sentence, taken as whole words; a word ends
 * where the Latin letters do, since Chinese quotes English unspaced.
 */
function reader(library: Entry[]) {
  const targets = new Map<Entry, RegExp>();
  for (const e of library) {
    const target = e.row.norm.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (target) targets.set(e, new RegExp(`(?<![\\p{Script=Latin}\\p{N}])${phrasePattern(target)}(?![\\p{Script=Latin}\\p{N}])`, "giu"));
  }
  const spans = (s: string, hidden: Entry[]) => hidden
    .flatMap((e) => [...s.matchAll(targets.get(e) ?? NEVER)].map((m) => [m.index, m.index + m[0].length]))
    .sort((a, b) => a[0] - b[0]);
  return {
    /** Whether `s` says the target of `e`. */
    says: (s: string, e: Entry) => s.search(targets.get(e) ?? NEVER) >= 0,
    /** `s` with the target of every entry of `hidden` blanked out. They are all
     *  found in `s` as it stands and blanked together: taken one after another,
     *  a target inside or across another would leave part of that one standing. */
    veil: (s: string, hidden: Entry[]) => {
      let out = "";
      let at = 0;
      for (const [from, to] of spans(s, hidden)) {
        if (from >= at) out += s.slice(at, from) + BLANK;
        at = Math.max(at, to);
      }
      return out + s.slice(at);
    },
    cut: (s: string, hidden: Entry[], at: number) => {
      for (const [from, to] of spans(s, hidden)) if (from < at && to > at) at = from;
      return at;
    },
  };
}

// Characters of index per call. What does not fit is not searched this time,
// and the answer says how much was.
const INDEX_BUDGET = 60_000;
const MAX_HITS = 5;
const MAX_REWRITES = 3;
const MAX_FRESH = 2;
const cell = (s: string | null, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The library as the model reads it, one line an entry: 想用 first, then 见过
 *  from the newest, then what was shelved. A masked entry goes without its
 *  English: what the model was never shown it cannot give away. */
function buildIndex(library: Entry[]) {
  const lines: string[] = [];
  const indexed = new Map<number, Entry>();
  const { veil } = reader(library);
  const masked = library.filter(isMasked);
  let room = INDEX_BUDGET;
  for (const e of ["active", "seen", "retired"].flatMap((status) => library.filter(({ row }) => row.status === status))) {
    const { id, focus, text, intent, aiIntent } = e.row;
    const shown = isMasked(e) ? "" : cell(focus, EXPRESSION_LIMITS.focus) || cell(text, 80);
    // A cue may itself quote the target, even on a different entry. Every
    // text column passes the same mask; clearing just the English is not enough.
    const line = [id, ...[shown, cell(intent, 100), cell(aiIntent, 100)].map((s) => veil(s, masked))].join(" | ");
    if (line.length + 1 > room) break;
    room -= line.length + 1;
    lines.push(line);
    indexed.set(id, e);
  }
  return { index: lines.join("\n"), indexed };
}

const sentences = (s: string) => [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(s)].map((x) => x.segment.trim());

/** Where `phrase` really stands in `texts`: its sentence, and the phrase as it
 *  is written there. Null when it is nowhere, or the sentence is no entry. */
function quote(phrase: string, texts: string[]): Pick<Suggestion, "text" | "focus"> | null {
  const wanted = phrase.trim().toLowerCase();
  for (const text of wanted ? texts.flatMap(sentences) : []) {
    const at = text.toLowerCase().indexOf(wanted);
    if (at < 0 || text.length > EXPRESSION_LIMITS.text) continue;
    const focus = text.slice(at, at + wanted.length);
    return focus.length < text.length && focus.length <= EXPRESSION_LIMITS.focus ? { text, focus } : { text };
  }
  return null;
}

/** What a turn keeps besides the two messages: the coaching as it passed the
 *  checks. Blanking is done when it is read, by what is masked then. */
interface TalkNotes {
  fix: Suggestion | null;
  rewrites: Rewrite[];
  fresh: Suggestion[];
  mine: { id: number; why: string }[];
  searched: number;
  total: number;
  coachingPending?: boolean;
  coachingFailure?: TalkFailure["reason"];
  reviewCandidate?: { id: number; cue: string };
  review?: { id: number; scene: string };
  reviewAttempt?: number;
}
type TurnRow = typeof talkTurns.$inferSelect;

/**
 * A stored turn as it may be shown. `shown` are the entries whose English this
 * answer puts on screen although they are masked; the target of every other
 * masked entry is blanked wherever it is said. `live` is the answer to the
 * message itself, which comes back as it was typed; read again later, the
 * user's own words are blanked like the rest.
 */
function present(row: TurnRow, library: Entry[], shown: Set<number>, live: boolean): TalkTurn {
  const notes = JSON.parse(row.notes) as TalkNotes;
  const reviewed = library.flatMap((entry) => entry.timeline.filter((r) => r.id === notes.reviewAttempt || (r.kind === "attempt" && r.sourceType === "chat" && r.sourceLocator === `talk:${row.id}`)).map((r) => ({ entry, row: r })))[0];
  const result = reviewed ? attemptResponse(reviewed) : null;
  if (live && result?.answer && reviewed) shown.add(reviewed.entry.row.id);
  const { veil } = reader(library);
  const hidden = library.filter((e) => isMasked(e) && !shown.has(e.row.id));
  const v = (s: string) => veil(s, hidden);
  const mine: TalkHit[] = notes.mine.flatMap(({ id, why }) => {
    const e = library.find((x) => x.row.id === id);
    if (!e) return [];
    const summary = toSummary(e, shown.has(id));
    const expression = { ...summary, text: summary.text && v(summary.text), focus: summary.focus && v(summary.focus),
      intent: summary.intent && v(summary.intent), sourceTitle: summary.sourceTitle && v(summary.sourceTitle) };
    // A reason tends to quote what it is about, so a masked hit goes without one.
    return [{ expression, why: expression.masked ? null : v(why) || null }];
  });
  const offer = (s: Suggestion): Suggestion => ({ ...s, text: v(s.text), why: v(s.why) });
  // Something worth keeping that has since become an entry in 想用 is no
  // longer on offer: all that is left of it would be a blank. Nor is one that
  // runs into such an entry's words: it would name part of what the blank in
  // its sentence keeps back.
  const open = (s: Suggestion) => v(s.focus ?? s.text) === (s.focus ?? s.text) && v(s.text).includes(s.focus ?? "");
  return {
    id: row.id,
    thread: row.thread,
    createdAt: row.createdAt,
    said: live ? row.said : v(row.said),
    reply: v(row.reply),
    fix: notes.fix && offer(notes.fix),
    rewrites: notes.rewrites.map((r) => ({ from: live ? r.from : v(r.from), to: v(r.to), why: v(r.why) })),
    fresh: notes.fresh.filter(open).map(offer),
    mine,
    searched: notes.searched,
    total: notes.total,
    ...(notes.coachingPending || notes.coachingFailure ? { coachingFailure: notes.coachingFailure ?? "failed" } : {}),
    ...(notes.review ? { review: { ...notes.review, scene: v(notes.review.scene) } } : {}),
    ...(result && reviewed ? { reviewResult: !live && isMasked(reviewed.entry)
      ? { ...result, answer: null, rewrites: [], intent: result.intent && v(result.intent) }
      : { ...result, intent: result.intent && v(result.intent), answer: result.answer && {
        text: v(result.answer.text), focus: result.answer.focus && v(result.answer.focus), gloss: result.answer.gloss && v(result.answer.gloss),
      }, rewrites: result.rewrites.map((r) => ({ from: live ? r.from : v(r.from), to: v(r.to), why: v(r.why) })) } } : {}),
  };
}

/**
 * One turn. Null when `thread` names no conversation. When the model gave no
 * usable answer, the reason: nothing is written then, so sending the message
 * again leaves it on no timeline twice.
 */
export async function talk(q: TalkRequest, opts?: { onDelta: (text: string) => Promise<void>; signal?: AbortSignal }): Promise<TalkTurn | { failed: TalkFailure["reason"] } | null> {
  const library = await loadLibrary();
  const { veil } = reader(library);
  const earlier = q.thread == null ? [] : await db.select().from(talkTurns).where(eq(talkTurns.thread, q.thread)).orderBy(asc(talkTurns.id)).all();
  if (q.thread != null && !earlier.length) return null;

  // The history comes from the database, not from the page: the opening turn
  // says what the conversation is about and the latest ones where it stands.
  // The model reads it as the user would now, with what is masked blanked.
  const masked = library.filter(isMasked);
  const told = earlier.length > TALK_HISTORY_TURNS ? [earlier[0], ...earlier.slice(1 - TALK_HISTORY_TURNS)] : earlier;
  const { index, indexed } = buildIndex(library);
  const candidate = chooseReview(library, earlier.length + 1);
  const cue = candidate && veil(candidate.cue, masked);
  const material = { said: q.said, history: told.map((t) => ({ said: veil(t.said, masked), reply: veil(t.reply, masked) })), index,
    ...(cue && /\p{L}/u.test(cue) ? { reviewCue: cue } : {}) };
  if (opts) return streamTurn(q, material, library, earlier, opts);
  let out;
  try {
    out = await converse(material);
  } catch (err) {
    const failed = failureReason(err) as TalkFailure["reason"];
    console.warn(`[expressions] talk failed: ${failed}`);
    return { failed };
  }

  const previous = earlier.at(-1);
  const review = previous && (JSON.parse(previous.notes) as TalkNotes).review;
  let stored: TurnRow | undefined;
  if (review && !/\p{Script=Han}/u.test(q.said)) {
    const reply = await saveReply(q, out.reply, library, earlier.length);
    if (!reply) return null;
    stored = reply;
    const attempt = await answerReview(review, q.said, stored.id);
    if (attempt) stored.notes = JSON.stringify({ ...JSON.parse(stored.notes), reviewAttempt: attempt });
  }
  return saveTurn(q, out, library, indexed, earlier.length, stored);
}

function checkedNotes(q: TalkRequest, out: Awaited<ReturnType<typeof converse>>, library: Entry[], indexed: Map<number, Entry>) {
  const { says } = reader(library);
  // Only ids that were handed out: the model cannot make an entry up.
  const hits = new Map<Entry, string>(); // each with the reason given for it, in the order shown
  for (const m of out.mine) {
    const e = indexed.get(m.id);
    if (e && hits.size < MAX_HITS && !hits.has(e)) hits.set(e, m.why);
  }
  // Text that says an entry's target is that entry. It is a hit, shown and
  // recorded as one.
  const inLibrary = (text: string, why: string) => {
    const said = [...indexed.values()].filter((e) => says(text, e));
    for (const e of said) if (hits.size < MAX_HITS && !hits.has(e)) hits.set(e, why);
    return said.length > 0;
  };
  // A fix that changes nothing is no fix.
  const fix = out.fix && normalize(out.fix.text) !== normalize(q.said) ? out.fix : null;
  if (fix) inLibrary(fix.text, "");
  // A correction has to be of something the user wrote.
  const corrected = new Set<string>();
  const rewrites = out.rewrites.filter((r) => {
    const key = `${normalize(r.from)}\n${normalize(r.to)}`;
    if (!r.from || !r.to || normalize(r.to) === normalize(r.from) || !q.said.includes(r.from) || corrected.has(key) || (fix && normalize(r.to) === normalize(fix.text))) return false;
    corrected.add(key);
    return true;
  }).slice(0, MAX_REWRITES);
  // Something worth keeping has to be in what was just said, and is kept with
  // the sentence it stands in. One the library has already is not new.
  const fresh: Suggestion[] = [];
  const offered = new Set([...(fix ? [normalize(fix.text)] : []), ...rewrites.map((r) => normalize(r.to))]);
  for (const s of out.fresh) {
    const kept = fresh.length < MAX_FRESH ? quote(s.text, [out.reply, ...(fix ? [fix.text] : [])]) : null;
    const key = kept && normalize(kept.focus ?? kept.text);
    if (kept && key && !offered.has(key) && !inLibrary(kept.focus ?? kept.text, s.why)) {
      fresh.push({ ...kept, why: s.why });
      offered.add(key);
    }
  }

  // A message without a Chinese character is the user's own English for what
  // they meant: their attempt is made, and what the library has for it is
  // shown. After a message in Chinese a masked hit stays masked, to be tried.
  const open = !/\p{Script=Han}/u.test(q.said);
  const shown = new Set(open ? [...hits.keys()].map((e) => e.row.id) : []);
  const notes: TalkNotes = {
    fix,
    rewrites,
    fresh,
    mine: [...hits].map(([e, why]) => ({ id: e.row.id, why })),
    searched: indexed.size,
    total: library.length,
  };

  return { notes, hits, shown, open };
}

async function saveTurn(
  q: TalkRequest, out: Awaited<ReturnType<typeof converse>>, library: Entry[], indexed: Map<number, Entry>,
  earlierCount: number, stored?: TurnRow,
): Promise<TalkTurn | null> {
  const { notes: checked, hits, shown, open } = checkedNotes(q, out, library, indexed);
  const notes: TalkNotes = stored
    ? { ...JSON.parse(stored.notes), ...checked, coachingPending: undefined, coachingFailure: undefined }
    : checked;
  const candidate = notes.reviewCandidate ?? chooseReview(library, earlierCount + 1);
  const scene = out.scene?.trim();
  if (candidate && !shown.has(candidate.id) && scene && out.reply.includes(scene) && reader(library).veil(scene, library.filter(isMasked)) === scene) {
    notes.review = { id: candidate.id, scene };
  }
  const now = Date.now();
  const thread = stored?.thread ?? q.thread ?? now;
  const asked = { kind: "looked_up", text: q.said, feedback: JSON.stringify({ turn: earlierCount + 1, thread }), createdAt: now };
  const row = await db.transaction(async (tx) => {
    if (stored) {
      const current = await tx.select().from(talkTurns).where(eq(talkTurns.id, stored.id)).get();
      if (!current) return null;
      const previous = JSON.parse(current.notes) as TalkNotes;
      if (!previous.coachingPending && !previous.coachingFailure) return current;
    }
    await tx.insert(encounters).values(
      hits.size > 0
        ? [...hits.keys()].map((e) => ({ ...asked, expressionId: e.row.id, cue: isMasked(e) && !open ? "masked" : null }))
        : [{ ...asked, expressionId: null, cue: null }],
    );
    const values = { reply: out.reply, notes: JSON.stringify(notes) };
    return stored
      ? tx.update(talkTurns).set(values).where(eq(talkTurns.id, stored.id)).returning().get()
      : tx.insert(talkTurns).values({ ...values, thread, said: q.said, createdAt: now }).returning().get();
  });
  return row ? present(row, await loadLibrary(), shown, true) : null;
}

async function saveReply(q: TalkRequest, reply: string, library: Entry[], earlierCount: number): Promise<TurnRow | null> {
  const now = Date.now();
  const notes: TalkNotes = {
    fix: null, rewrites: [], fresh: [], mine: [], searched: 0, total: library.length, coachingPending: true,
    reviewCandidate: chooseReview(library, earlierCount + 1) ?? undefined,
  };
  return db.transaction(async (tx) => {
    // A conversation deleted while the model was replying stays deleted.
    if (q.thread != null && !await tx.select({ id: talkTurns.id }).from(talkTurns).where(eq(talkTurns.thread, q.thread)).limit(1).get()) return null;
    return tx.insert(talkTurns).values({ thread: q.thread ?? now, said: q.said, reply, notes: JSON.stringify(notes), createdAt: now }).returning().get();
  });
}

const coachingJobs = new Map<number, Promise<TalkTurn | null>>();

async function finishCoaching(row: TurnRow, material: ConversationMaterial, library: Entry[], earlierCount: number, signal?: AbortSignal, beforeSave?: Promise<number | null>) {
  const pending = coachingJobs.get(row.id);
  if (pending) return pending;
  const work = (async () => {
    try {
      // The coach sees the same masked text as the reader. It cannot change
      // the reply already saved, even if it sends another reply in its JSON.
      const reply = reader(library).veil(row.reply, library.filter(isMasked));
      const out = await coachConversation({ ...material, reply }, { signal });
      const attempt = await beforeSave;
      if (attempt) row.notes = JSON.stringify({ ...JSON.parse(row.notes), reviewAttempt: attempt });
      return await saveTurn({ said: row.said, thread: row.thread }, { ...out, reply: row.reply }, library, buildIndex(library).indexed, earlierCount, row);
    } catch (err) {
      const reason = failureReason(err) as TalkFailure["reason"];
      console.warn(`[expressions] coaching #${row.id} failed: ${reason}`);
      const attempt = await beforeSave;
      if (attempt) row.notes = JSON.stringify({ ...JSON.parse(row.notes), reviewAttempt: attempt });
      const notes = { ...JSON.parse(row.notes), coachingPending: undefined, coachingFailure: reason };
      const saved = await db.update(talkTurns).set({ notes: JSON.stringify(notes) }).where(eq(talkTurns.id, row.id)).returning().get();
      return saved ? present(saved, await loadLibrary(), new Set(), true) : null;
    }
  })();
  coachingJobs.set(row.id, work);
  try { return await work; } finally { coachingJobs.delete(row.id); }
}

async function streamTurn(q: TalkRequest, material: ConversationMaterial, library: Entry[], earlier: TurnRow[], opts: { onDelta: (text: string) => Promise<void>; signal?: AbortSignal }) {
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000);
  const masked = library.filter(isMasked);
  const mask = reader(library);
  // Hold a complete target's worth of trailing words, including a partial
  // word. Looking up spans before cutting also keeps overlapping targets whole.
  // A character count alone fails with long whitespace between the words.
  const reserve = Math.max(1, ...masked.map((e) => e.row.norm.trim().split(/\s+/u).length)) + 1;
  let buffer = "";
  let reply: string;
  try {
    reply = await replyConversation(material, { signal, onDelta: async (delta) => {
      signal.throwIfAborted();
      buffer += delta;
      const words = [...buffer.matchAll(/\S+/gu)];
      const cut = mask.cut(buffer, masked, words.length > reserve ? words[words.length - reserve].index : 0);
      if (cut > 0) {
        const text = mask.veil(buffer.slice(0, cut), masked);
        buffer = buffer.slice(cut);
        if (text) await opts.onDelta(text);
      }
    } });
    signal.throwIfAborted();
    if (!reply.trim() || reply.length > 8000) throw new Error("Invalid reply");
    if (buffer) await opts.onDelta(mask.veil(buffer, masked));
  } catch (err) {
    return { failed: failureReason(err) as TalkFailure["reason"] };
  }
  // Once the reply is complete it is durable. The auxiliary call may fail or
  // be interrupted; reopening the thread offers a retry on this same row.
  const row = await saveReply(q, reply, library, earlier.length);
  if (!row) return null;
  const previous = earlier.at(-1);
  const review = previous && (JSON.parse(previous.notes) as TalkNotes).review;
  if (review) {
    // Start judgement and coaching together, but finish the attempt before
    // adding looked_up: seeing the answer first would postpone its due date.
    const reviewWork = answerReview(review, q.said, row.id, signal).catch((err) => {
      console.warn(`[expressions] review failed: ${failureReason(err)}`);
      return null;
    });
    return finishCoaching(row, material, library, earlier.length, signal, reviewWork);
  }
  return finishCoaching(row, material, library, earlier.length, signal);
}

/** A missing thread is refused before opening an SSE response. */
export const hasThread = async (thread: number) => Boolean(await db.select({ id: talkTurns.id }).from(talkTurns).where(eq(talkTurns.thread, thread)).limit(1).get());

/** Retries just the notes of an already saved reply, once per turn. */
export async function retryCoaching(id: number, signal?: AbortSignal): Promise<TalkTurn | null> {
  const row = await db.select().from(talkTurns).where(eq(talkTurns.id, id)).get();
  if (!row) return null;
  const library = await loadLibrary();
  const notes = JSON.parse(row.notes) as TalkNotes;
  if (!notes.coachingPending && !notes.coachingFailure) return present(row, library, new Set(), false);
  const earlier = await db.select().from(talkTurns).where(eq(talkTurns.thread, row.thread)).orderBy(asc(talkTurns.id)).all();
  const before = earlier.filter((t) => t.id < row.id);
  const told = before.length > TALK_HISTORY_TURNS ? [before[0], ...before.slice(1 - TALK_HISTORY_TURNS)] : before;
  const mask = reader(library);
  const hidden = library.filter(isMasked);
  const material = { said: row.said, history: told.map((t) => ({ said: mask.veil(t.said, hidden), reply: mask.veil(t.reply, hidden) })), index: buildIndex(library).index, reviewCue: notes.reviewCandidate && mask.veil(notes.reviewCandidate.cue, hidden) };
  return finishCoaching(row, material, library, before.length, signal);
}

/** A conversation as the library stands now, oldest turn first. Null when there is none. */
export async function readThread(thread: number): Promise<TalkTurn[] | null> {
  const rows = await db.select().from(talkTurns).where(eq(talkTurns.thread, thread)).orderBy(asc(talkTurns.id)).all();
  if (!rows.length) return null;
  const library = await loadLibrary();
  return rows.map((row) => present(row, library, new Set(), false));
}

/** Every conversation, the latest first, each by the start of its opening message. */
export async function threads(): Promise<TalkThread[]> {
  const rows = await db.all<{ thread: number; said: string; turns: number; updatedAt: number }>(sql`
    select t.thread as thread, t.said as said, c.turns as turns, c.updated_at as updatedAt
    from talk_turns t
    join (select min(id) as first, count(*) as turns, max(created_at) as updated_at from talk_turns group by thread) c on c.first = t.id
    order by c.updated_at desc, t.thread desc`);
  const library = await loadLibrary();
  const { veil } = reader(library);
  const masked = library.filter(isMasked);
  return rows.map(({ said, ...rest }) => ({ ...rest, title: veil(said, masked).replace(/\s+/g, " ").slice(0, 60) }));
}

/** Forgets a conversation. The rows its turns left on the timelines stay: they are what happened. */
export const dropThread = (thread: number) => db.delete(talkTurns).where(eq(talkTurns.thread, thread));

/** Speech reads the reply as it may be shown now, including later masks. */
export async function speechText(turnId: number): Promise<string | null> {
  const row = await db.select().from(talkTurns).where(eq(talkTurns.id, turnId)).get();
  return row ? present(row, await loadLibrary(), new Set(), false).reply : null;
}
