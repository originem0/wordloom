import { and, asc, desc, eq, lt, inArray, count, sql } from "drizzle-orm";
import { db, readSnapshot } from "../db/index.js";
import { encounters, expressions, talkTurns, talkThreads, talkReceipts } from "../db/schema.js";
import { failureReason } from "./ai-shared.js";
import { answerReview, chooseReview } from "./expressions-review.js";
import { attemptResponse, recordDay } from "./expressions-try.js";
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
const readers = new WeakMap<Entry[], ReturnType<typeof createReader>>();
function reader(library: Entry[]) {
  let result = readers.get(library);
  if (!result) { result = createReader(library); readers.set(library, result); }
  return result;
}
function createReader(library: Entry[]) {
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
const INDEX_BUDGET = 12_000;
const MAX_HITS = 5;
const MAX_REWRITES = 3;
const MAX_FRESH = 2;
const cell = (s: string | null, max: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function indexTerms(text: string) {
  const terms = new Set<string>();
  for (const [part] of normalize(text).matchAll(/[\p{Script=Han}]+|[\p{Script=Latin}\d]+(?:['’][\p{Script=Latin}]+)*/gu)) {
    const chars = [...part];
    if (/\p{Script=Han}/u.test(part) && chars.length > 1) {
      for (let i = 1; i < chars.length; i++) terms.add(chars[i - 1] + chars[i]);
    } else {
      terms.add(part);
    }
  }
  return terms;
}

/** Rank matches to the message first, breaking ties by layer and recency.
 *  A masked entry contributes only its cues to the model's index. */
function buildIndex(library: Entry[], message: string) {
  const lines: string[] = [];
  const indexed = new Map<number, Entry>();
  const { veil } = reader(library);
  const masked = library.filter(isMasked);
  let room = INDEX_BUDGET;
  const tokens = indexTerms(message);
  const ordered = library.map((entry) => {
    const { text, focus, intent, aiIntent, status } = entry.row;
    const searchable = indexTerms([text, focus, intent, aiIntent].join(" "));
    let relevance = 0;
    for (const token of tokens) if (searchable.has(token)) relevance++;
    return { entry, relevance, priority: status === "active" ? 0 : status === "seen" ? 1 : 2 };
  }).sort((a, b) => b.relevance - a.relevance || a.priority - b.priority);
  for (const { entry: e } of ordered) {
    const { id, focus, text, intent, aiIntent } = e.row;
    const shown = isMasked(e) ? "" : cell(focus, EXPRESSION_LIMITS.focus) || cell(text, 80);
    // A cue may itself quote the target, even on a different entry. Every
    // text column passes the same mask; clearing just the English is not enough.
    const line = [id, ...[shown, cell(intent, 100), cell(aiIntent, 100)].map((s) => veil(s, masked))].join(" | ");
    if (line.length + 1 > room) continue;
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
  mine: { id: number; why: string; version?: number }[];
  searched: number;
  total: number;
  coachingPending?: boolean;
  coachingFailure?: TalkFailure["reason"];
  reviewCandidate?: { id: number; cue: string; version?: number };
  review?: { id: number; scene: string; version?: number };
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
function indexAttempts(library: Entry[]) {
  const entries = new Map(library.map((e) => [e.row.id, e]));
  const byId = new Map<number, { entry: Entry; row: Entry["timeline"][number] }>();
  const bySource = new Map<string, { entry: Entry; row: Entry["timeline"][number] }>();
  for (const entry of library) for (const row of entry.timeline) if (row.kind === "attempt") {
    byId.set(row.id, { entry, row });
    if (row.sourceType === "chat" && row.sourceLocator) bySource.set(row.sourceLocator, { entry, row });
  }
  return { entries, byId, bySource };
}
const attemptIndexes = new WeakMap<Entry[], ReturnType<typeof indexAttempts>>();
function present(row: TurnRow, library: Entry[], shown: Set<number>, live: boolean): TalkTurn {
  const notes = JSON.parse(row.notes) as TalkNotes;
  let attempts = attemptIndexes.get(library);
  if (!attempts) { attempts = indexAttempts(library); attemptIndexes.set(library, attempts); }
  const reviewed = attempts.byId.get(notes.reviewAttempt ?? -1) ?? attempts.bySource.get(`talk:${row.id}`);
  const result = reviewed ? attemptResponse(reviewed) : null;
  const hits = notes.mine.filter((hit) => attempts.entries.get(hit.id)?.row.targetVersion === (hit.version ?? 0));
  const visible = new Set(hits.filter((hit) => shown.has(hit.id)).map((hit) => hit.id));
  if (live && result?.answer && reviewed && reviewed.row.targetVersion === reviewed.entry.row.targetVersion) visible.add(reviewed.entry.row.id);
  const { veil } = reader(library);
  const hidden = library.filter((e) => isMasked(e) && !visible.has(e.row.id));
  const v = (s: string) => veil(s, hidden);
  const mine: TalkHit[] = hits.map(({ id, why }) => {
    const e = attempts.entries.get(id)!;
    const summary = toSummary(e, visible.has(id));
    const expression = { ...summary, text: summary.text && v(summary.text), focus: summary.focus && v(summary.focus),
      intent: summary.intent && v(summary.intent), sourceTitle: summary.sourceTitle && v(summary.sourceTitle) };
    // A reason tends to quote what it is about, so a masked hit goes without one.
    return { expression, why: expression.masked ? null : v(why) || null };
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
    ...(notes.review && attempts.entries.get(notes.review.id)?.row.targetVersion === (notes.review.version ?? 0)
      ? { review: { id: notes.review.id, scene: v(notes.review.scene) } } : {}),
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
type TalkOptions = { onDelta: (text: string) => Promise<void>; signal?: AbortSignal };
const pendingMessages = new Map<string, { said: string; thread?: number; result: ReturnType<typeof talkOnce> }>();
export async function talk(q: TalkRequest, opts?: TalkOptions) {
  if (!q.messageId) return talkOnce(q, opts);
  const pending = pendingMessages.get(q.messageId);
  if (pending) return pending.said === q.said && pending.thread === q.thread ? pending.result : null;
  const result = talkOnce(q, opts);
  pendingMessages.set(q.messageId, { said: q.said, thread: q.thread, result });
  try { return await result; } finally { pendingMessages.delete(q.messageId); }
}

async function history(thread?: number, before?: number) {
  if (thread == null) return { turns: [] as TurnRow[], total: 0 };
  const condition = and(eq(talkTurns.thread, thread), before == null ? undefined : lt(talkTurns.id, before));
  return readSnapshot(async (tx) => {
    const size = await tx.select({ n: count() }).from(talkTurns).where(condition).get();
    const total = size?.n ?? 0;
    const recent = await tx.select().from(talkTurns).where(condition).orderBy(desc(talkTurns.id)).limit(TALK_HISTORY_TURNS).all();
    const turns = recent.reverse();
    if (total > TALK_HISTORY_TURNS) turns[0] = (await tx.select().from(talkTurns).where(condition).orderBy(asc(talkTurns.id)).limit(1).get())!;
    return { turns, total };
  });
}

async function talkOnce(q: TalkRequest, opts?: TalkOptions): Promise<TalkTurn | { failed: TalkFailure["reason"] } | null> {
  const library = await loadLibrary();
  if (q.messageId && await db.select().from(talkReceipts).where(eq(talkReceipts.id, q.messageId)).get()) {
    const row = await db.select().from(talkTurns).where(eq(talkTurns.messageId, q.messageId)).get();
    return row && row.said === q.said && (q.thread == null || row.thread === q.thread) ? present(row, library, new Set(), false) : null;
  }
  const { veil } = reader(library);
  const { turns: earlier, total } = await history(q.thread);
  if (q.thread != null && !total) return null;

  // The history comes from the database, not from the page: the opening turn
  // says what the conversation is about and the latest ones where it stands.
  // The model reads it as the user would now, with what is masked blanked.
  const masked = library.filter(isMasked);
  const told = earlier;
  const { index, indexed } = buildIndex(library, q.said);
  const candidate = chooseReview(library, total + 1);
  const cue = candidate && veil(candidate.cue, masked);
  const material = { said: q.said, history: told.map((t) => ({ said: veil(t.said, masked), reply: veil(t.reply, masked) })), index,
    ...(cue && /\p{L}/u.test(cue) ? { reviewCue: cue } : {}) };
  if (opts) return streamTurn(q, material, library, indexed, earlier, total, opts);
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
  const stored = await saveReply(q, out.reply, library, total);
  if (!stored) return null;
  if (review && !/\p{Script=Han}/u.test(q.said)) {
    const attempt = await answerReview(review, q.said, stored.id);
    if (attempt) stored.notes = JSON.stringify({ ...JSON.parse(stored.notes), reviewAttempt: attempt });
  }
  return saveTurn(q, out, library, indexed, total, stored);
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
    mine: [...hits].map(([e, why]) => ({ id: e.row.id, why, ...(e.row.targetVersion && { version: e.row.targetVersion }) })),
    searched: indexed.size,
    total: library.length,
  };

  return { notes, hits, shown, open };
}

async function saveTurn(
  q: TalkRequest, out: Awaited<ReturnType<typeof converse>>, library: Entry[], indexed: Map<number, Entry>,
  earlierCount: number, stored: TurnRow,
): Promise<TalkTurn | null> {
  const { notes: checked, hits, shown, open } = checkedNotes(q, out, library, indexed);
  const notes: TalkNotes = { ...JSON.parse(stored.notes), ...checked, coachingPending: undefined, coachingFailure: undefined };
  const candidate = notes.reviewCandidate ?? chooseReview(library, earlierCount + 1);
  const scene = out.scene?.trim();
  if (candidate && !shown.has(candidate.id) && scene && out.reply.includes(scene) && reader(library).veil(scene, library.filter(isMasked)) === scene) {
    notes.review = { id: candidate.id, scene, version: candidate.version };
  }
  const now = Date.now();
  const thread = stored.thread;
  const asked = { kind: "looked_up", text: q.said, feedback: JSON.stringify({ turn: earlierCount + 1, thread }), createdAt: now };
  const row = await db.transaction(async (tx) => {
    {
      const current = await tx.select().from(talkTurns).where(eq(talkTurns.id, stored.id)).get();
      if (!current) return null;
      const previous = JSON.parse(current.notes) as TalkNotes;
      if (!previous.coachingPending && !previous.coachingFailure) return current;
    }
    // An entry may have been deleted while the model was answering. Recheck
    // under the write transaction so its old hit cannot recreate a timeline
    // or make an otherwise valid conversation fail its foreign-key check.
    const relevant = [...hits.keys()].map((e) => e.row.id).concat([notes.review?.id, notes.reviewCandidate?.id].filter((id): id is number => id != null));
    const live = relevant.length ? await tx.select({ id: expressions.id, version: expressions.targetVersion }).from(expressions).where(inArray(expressions.id, relevant)).all() : [];
    const liveIds = new Set(live.filter((r) => library.find((e) => e.row.id === r.id)?.row.targetVersion === r.version).map((r) => r.id));
    const liveHits = [...hits.keys()].filter((entry) => liveIds.has(entry.row.id));
    notes.mine = notes.mine.filter((hit) => liveIds.has(hit.id));
    if (notes.review && !liveIds.has(notes.review.id)) delete notes.review;
    if (notes.reviewCandidate && !liveIds.has(notes.reviewCandidate.id)) delete notes.reviewCandidate;
    await recordDay(tx, now, "looked_up");
    await tx.insert(encounters).values(
      liveHits.length > 0
        ? liveHits.map((e) => ({ ...asked, expressionId: e.row.id, targetVersion: e.row.targetVersion, cue: isMasked(e) && !open ? "masked" : null }))
        : [{ kind: "looked_up", text: "", expressionId: null, createdAt: now }],
    );
    const values = { reply: out.reply, notes: JSON.stringify(notes) };
    return tx.update(talkTurns).set(values).where(eq(talkTurns.id, stored.id)).returning().get();
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
    if (q.messageId) {
      const receipt = await tx.insert(talkReceipts).values({ id: q.messageId }).onConflictDoNothing().returning().get();
      if (!receipt) return null;
    }
    const thread = q.thread ?? (await tx.insert(talkThreads).values({}).returning().get()).id;
    return tx.insert(talkTurns).values({ thread, messageId: q.messageId, said: q.said, reply, notes: JSON.stringify(notes), createdAt: now }).returning().get();
  });
}

const coachingJobs = new Map<number, Promise<TalkTurn | null>>();

async function finishCoaching(row: TurnRow, material: ConversationMaterial, library: Entry[], indexed: Map<number, Entry>, earlierCount: number, signal?: AbortSignal, beforeSave?: Promise<number | null>) {
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
      return await saveTurn({ said: row.said, thread: row.thread }, { ...out, reply: row.reply }, library, indexed, earlierCount, row);
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

async function streamTurn(q: TalkRequest, material: ConversationMaterial, library: Entry[], indexed: Map<number, Entry>, earlier: TurnRow[], total: number, opts: TalkOptions) {
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
  const row = await saveReply(q, reply, library, total);
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
    return finishCoaching(row, material, library, indexed, total, signal, reviewWork);
  }
  return finishCoaching(row, material, library, indexed, total, signal);
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
  const { turns: told, total } = await history(row.thread, row.id);
  const mask = reader(library);
  const hidden = library.filter(isMasked);
  const { index, indexed } = buildIndex(library, row.said);
  const material = { said: row.said, history: told.map((t) => ({ said: mask.veil(t.said, hidden), reply: mask.veil(t.reply, hidden) })), index, reviewCue: notes.reviewCandidate && mask.veil(notes.reviewCandidate.cue, hidden) };
  return finishCoaching(row, material, library, indexed, total, signal);
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
  const library = await loadLibrary(db, true);
  const { veil } = reader(library);
  const masked = library.filter(isMasked);
  return rows.map(({ said, ...rest }) => ({ ...rest, title: veil(said, masked).replace(/\s+/g, " ").slice(0, 60) }));
}

/** Forgets a conversation. The rows its turns left on the timelines stay: they are what happened. */
export const dropThread = (thread: number) => db.transaction(async (tx) => {
  await tx.delete(talkTurns).where(eq(talkTurns.thread, thread));
  await tx.delete(talkThreads).where(eq(talkThreads.id, thread));
});

/** Speech reads the reply as it may be shown now, including later masks. */
export async function speechText(turnId: number): Promise<string | null> {
  const row = await db.select().from(talkTurns).where(eq(talkTurns.id, turnId)).get();
  if (!row) return null;
  const active = await loadLibrary(db, true);
  return reader(active).veil(row.reply, active.filter(isMasked));
}
