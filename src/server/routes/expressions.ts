import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, readSnapshot } from "../db/index.js";
import { encounters, expressionPassageNotes, expressions } from "../db/schema.js";
import { failureReason } from "../services/ai-shared.js";
import { annotate, pick } from "../services/expressions-ai.js";
import { dropThread, hasThread, normalize, readThread, retryCoaching, talk, threads } from "../services/expressions-talk.js";
import { expressionSpeechRoutes } from "./expressions-speech.js";
import {
  attemptResponse, judgeAttempt, loadAttempt, overturn, recordAttempt, recordDay, sceneOf, stats, tryItems,
} from "../services/expressions-try.js";
import { currentState, isMasked, loadEntry, loadLibrary, toDetail, toDuplicate, toSummary } from "../services/expressions-view.js";
import {
  attemptRequestSchema, captureRequestSchema, encounterRequestSchema, expressionPatchSchema, overturnRequestSchema, pickRequestSchema,
  passageNoteChangeSchema, revealRequestSchema, talkRequestSchema,
} from "../../shared/validation.js";
import type {
  CaptureRequest, DuplicateResponse, EncounterSource, ExpressionListResponse, PassageNoteContent, PickResponse, TalkFailure, TalkListResponse,
  TalkThreadResponse, TryResponse,
} from "../../shared/expressions.js";

// The admin's private text. Nothing here logs it or puts it in an error: a log
// line carries an id and a reason from a fixed list, and an error that escapes
// a handler is logged by the app without its message. No route takes private
// text in a query string either, because the request logger prints the URL.
export const expressionRoutes = new Hono();
expressionRoutes.route("/", expressionSpeechRoutes);

const invalid = (c: Context) => c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
const notFound = (c: Context, what = "Expression") => c.json({ error: `${what} not found`, code: "NOT_FOUND" }, 404);
const blank = (s: string | null | undefined) => (s && s.trim() ? s : null);
const oldestFirst = [asc(encounters.createdAt), asc(encounters.id)];

/** One entry as its own routes answer with it: masked while it is in 想用. */
async function detailOf(id: number) {
  return readSnapshot(async (tx) => {
    const entry = await loadEntry(id, tx);
    return entry && toDetail(entry, false, tx);
  });
}

/** The scene an entry came from. Capture writes it, so it is the oldest. */
const firstMet = (id: number, from: Pick<typeof db, "select"> = db) =>
  from
    .select()
    .from(encounters)
    .where(and(eq(encounters.expressionId, id), eq(encounters.kind, "met")))
    .orderBy(...oldestFirst)
    .get();

const metRow = (
  expressionId: number, text: string, source: EncounterSource, now: number, found?: CaptureRequest["found"],
) => ({
  expressionId,
  kind: "met",
  text, // verbatim, like the entry's own
  // An entry kept from 找 has that turn as its scene: what the user needed to
  // say, and the English they had tried.
  textBefore: blank(found ? found.need : source.textBefore),
  myAttempt: blank(found?.attempt),
  sourceType: found ? "find" : (source.sourceType ?? null),
  sourceTitle: blank(source.sourceTitle),
  sourceLocator: blank(source.sourceLocator),
  occurredAt: source.occurredAt ?? now,
  createdAt: now,
});

/** Fills whichever of gloss, ai_intent and next_scene are still empty. */
async function annotateEntry(id: number): Promise<void> {
  const row = await db.select().from(expressions).where(eq(expressions.id, id)).get();
  if (!row || (row.gloss != null && row.aiIntent != null && row.nextScene != null)) return;
  const met = await firstMet(id);
  const out = await annotate({ text: row.text, focus: row.focus, textBefore: met?.textBefore ?? null });
  // coalesce in the statement rather than a check on `row`: the call capture
  // started and a manual retry can overlap, and ai_intent is written once.
  await db
    .update(expressions)
    .set({
      gloss: sql`coalesce(${expressions.gloss}, ${out.gloss})`,
      aiIntent: sql`coalesce(${expressions.aiIntent}, ${out.aiIntent})`,
      nextScene: sql`coalesce(${expressions.nextScene}, ${out.scene})`,
    })
    .where(and(eq(expressions.id, id), eq(expressions.targetVersion, row.targetVersion)));
}

const annotateFailed = (id: number, err: unknown) =>
  console.warn(`[expressions] annotate #${id} failed: ${failureReason(err)}`);

// GET / — every entry, newest first
expressionRoutes.get("/", async (c) => {
  const library = await loadLibrary();
  return c.json({ expressions: library.map((e) => toSummary(e)) } satisfies ExpressionListResponse);
});

// POST / — capture. The entry is stored before the model hears of it.
expressionRoutes.post("/", async (c) => {
  const parsed = captureRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const { text, force, found } = parsed.data;
  const focus = blank(parsed.data.focusRange ? parsed.data.focus : parsed.data.focus?.trim());
  const norm = normalize(focus ?? text);

  const now = Date.now();
  const range = parsed.data.focusRange;
  if (range && (!focus || text.slice(range.start, range.end) !== focus || range.end > text.length)) return invalid(c);
  const result = await db.transaction(async (tx) => {
    if (!force) {
      const matches = await tx.select({ id: expressions.id }).from(expressions).where(eq(expressions.norm, norm)).orderBy(desc(expressions.createdAt), desc(expressions.id));
      if (matches.length) {
        const existing = await Promise.all(matches.map(async ({ id }) => toDuplicate((await loadEntry(id, tx))!)));
        return { existing };
      }
    }
    const [row] = await tx.insert(expressions).values({ text, norm, focus, focusStart: range?.start, createdAt: now, updatedAt: now,
      learningHistory: [{ at: now, status: "seen", activeSince: null, focus, version: 0 }],
    }).returning({ id: expressions.id });
    await recordDay(tx, now, "met");
    await tx.insert(encounters).values(metRow(row.id, text, parsed.data, now, found));
    return { id: row.id };
  });
  if (result.existing) return c.json({ error: "Already saved", code: "DUPLICATE", existing: result.existing } satisfies DuplicateResponse, 409);
  const id = result.id!;
  const detail = await detailOf(id);
  // Not awaited, and not a job: a job row would keep the sentence as its input.
  void annotateEntry(id).catch((err) => annotateFailed(id, err));
  return c.json(detail, 201);
});

// GET /:id — one entry with its timeline
expressionRoutes.get("/:id{[0-9]+}", async (c) => {
  const detail = await detailOf(Number(c.req.param("id")));
  return detail ? c.json(detail) : notFound(c);
});

// PATCH /:id — the user's own edits. None is an event: no timeline row.
expressionRoutes.patch("/:id{[0-9]+}", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = expressionPatchSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const patch = parsed.data;
  return db.transaction(async (tx) => {
    const row = await tx.select().from(expressions).where(eq(expressions.id, id)).get();
    if (!row) return notFound(c);
    if (patch.expectedUpdatedAt != null && row.updatedAt !== patch.expectedUpdatedAt) return c.json({ error: "Entry changed. Reopen it before saving.", code: "EDIT_CONFLICT" }, 409);
    const now = Date.now();
    const set: Partial<typeof expressions.$inferInsert> = { updatedAt: Math.max(now, row.updatedAt + 1) };
    if (patch.note !== undefined) set.note = blank(patch.note);
    const focus = patch.focus === undefined ? row.focus : blank(patch.focusRange ? patch.focus : patch.focus?.trim());
    const start = patch.focusRange === undefined ? (focus === row.focus ? row.focusStart : null) : patch.focusRange?.start ?? null;
    if (patch.focusRange && (!focus || patch.focusRange.end > row.text.length || row.text.slice(start!, patch.focusRange.end) !== focus)) return invalid(c);
    const changed = focus !== row.focus || start !== row.focusStart;
    if (changed) Object.assign(set, { focus, focusStart: start, norm: normalize(focus ?? row.text), targetVersion: row.targetVersion + 1,
      gloss: null, aiIntent: null, nextScene: null, intent: null, intentBy: null });
    if (patch.intent !== undefined) {
      set.intent = blank(patch.intent);
      set.intentBy = set.intent ? patch.intentBy ?? "self" : null;
    }
    const status = patch.status ?? (changed && row.status === "active" && !set.intent ? "seen" : row.status);
    const intent = set.intent === undefined ? row.intent : set.intent;
    if (status === "active" && !intent) return c.json({ error: "An entry in 想用 needs an intent", code: "INTENT_REQUIRED" }, 400);
    if (changed || status !== row.status) {
      set.status = status;
      set.activeSince = status === "active" ? now : null;
      set.learningHistory = [...(row.learningHistory ?? [{ ...currentState(row), estimated: true }]), { at: now, status: status as ReturnType<typeof currentState>["status"], activeSince: set.activeSince, focus, version: set.targetVersion ?? row.targetVersion }];
    }
    await tx.update(expressions).set(set).where(eq(expressions.id, id));
    if (patch.occurredAt !== undefined) {
      const met = await firstMet(id, tx);
      if (met) await tx.update(encounters).set({ occurredAt: patch.occurredAt }).where(eq(encounters.id, met.id));
    }
    return c.json(await toDetail((await loadEntry(id, tx))!, false, tx));
  });
});

const sameContent = (a: PassageNoteContent | null, b: PassageNoteContent | null) =>
  a?.body === b?.body && a?.examples?.[0] === b?.examples?.[0] && a?.examples?.[1] === b?.examples?.[1];

// Native browser selections count UTF-16 code units. Keep those offsets even
// across repeated words and line breaks, without accepting half an emoji.
const splitsSurrogate = (text: string, at: number) =>
  /[\uD800-\uDBFF]/.test(text.charAt(at - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(at));

expressionRoutes.patch("/:id{[0-9]+}/passage-notes", async (c) => {
  const parsed = passageNoteChangeSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const id = Number(c.req.param("id"));
  const { start, end, before, after } = parsed.data;
  return db.transaction(async (tx) => {
    const entry = await loadEntry(id, tx);
    if (!entry) return notFound(c);
    // Check before inspecting the range: even a validation result must not
    // give away the length or contents of a masked original.
    if (isMasked(entry)) return c.json({ error: "Expression is masked", code: "EXPRESSION_MASKED" }, 409);
    const { text } = entry.row;
    if (end > text.length || !text.slice(start, end).trim() || splitsSurrogate(text, start) || splitsSurrogate(text, end)) return invalid(c);

    const notes = expressionPassageNotes;
    const key = and(eq(notes.expressionId, id), eq(notes.start, start), eq(notes.end, end));
    const saved = await tx.select().from(notes).where(key).get() ?? null;
    if (!sameContent(saved, after)) {
      if (!sameContent(saved, before)) return c.json({ error: "Passage note changed", code: "PASSAGE_NOTE_CHANGED" }, 409);
      if (after) {
        await tx.insert(notes).values({ expressionId: id, start, end, ...after })
          .onConflictDoUpdate({ target: [notes.expressionId, notes.start, notes.end], set: after });
      } else {
        await tx.delete(notes).where(key);
      }
      entry.row.updatedAt = Math.max(Date.now(), entry.row.updatedAt + 1);
      await tx.update(expressions).set({ updatedAt: entry.row.updatedAt }).where(eq(expressions.id, id));
    }
    return c.json(await toDetail(entry, false, tx));
  });
});

// DELETE /:id — permanent removal, unlike moving an entry to retired.
expressionRoutes.delete("/:id{[0-9]+}", async (c) => {
  // SQLite cascades the timeline in the same statement. Conversations remain;
  // their reads already leave out hits whose entry no longer exists.
  const [deleted] = await db.delete(expressions).where(eq(expressions.id, Number(c.req.param("id")))).returning({ id: expressions.id });
  return deleted ? c.body(null, 204) : notFound(c);
});

// POST /:id/encounters — met again
expressionRoutes.post("/:id{[0-9]+}/encounters", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = encounterRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const row = await db.select({ id: expressions.id }).from(expressions).where(eq(expressions.id, id)).get();
  if (!row) return notFound(c);
  await db.transaction(async (tx) => {
    const now = Date.now();
    await recordDay(tx, now, "met");
    await tx.insert(encounters).values(metRow(id, parsed.data.text, parsed.data, now));
  });
  return c.json(await detailOf(id), 201);
});

// POST /:id/annotate — the retry for an entry whose annotation never arrived
expressionRoutes.post("/:id{[0-9]+}/annotate", async (c) => {
  const id = Number(c.req.param("id"));
  try {
    await annotateEntry(id);
  } catch (err) {
    annotateFailed(id, err);
    return c.json({ error: "Annotation failed", code: "ANNOTATE_FAILED" }, 502);
  }
  const detail = await detailOf(id);
  return detail ? c.json(detail) : notFound(c);
});

// POST /:id/reveal — the English of a masked entry, this once and on record
expressionRoutes.post("/:id{[0-9]+}/reveal", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = revealRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  // The row and the read after it are one transaction: the answer never leaves
  // without the timeline saying so, and no row says so when it did not leave.
  return db.transaction(async (tx) => {
    const entry = await loadEntry(id, tx);
    if (!entry) return notFound(c);
    if (!isMasked(entry)) return c.json(await toDetail(entry, false, tx));
    await tx.insert(encounters).values({ expressionId: id, kind: "reveal", targetVersion: entry.row.targetVersion, text: "", cue: parsed.data.cue, createdAt: Date.now() });
    const revealed = await loadEntry(id, tx);
    return revealed ? c.json(await toDetail(revealed, true, tx)) : notFound(c);
  });
});

// GET /:id/scene — the second hint; reading it writes nothing
expressionRoutes.get("/:id{[0-9]+}/scene", async (c) => {
  const entry = await loadEntry(Number(c.req.param("id")));
  if (!entry) return notFound(c);
  const scene = sceneOf(entry);
  return scene ? c.json(scene) : c.json({ error: "No scene to show", code: "NO_SCENE" }, 404);
});

// GET /try?exclude=1,2 — what to ask now. Ids are all the query string holds.
expressionRoutes.get("/try", async (c) => {
  const exclude = new Set((c.req.query("exclude") ?? "").split(",").map(Number));
  return c.json({ items: tryItems(await loadLibrary(db, true), Date.now(), exclude) } satisfies TryResponse);
});

/** The attempt row as it stands now, in the shape all three routes answer with. */
async function attemptOf(c: Context, encounterId: number, status: 200 | 201 = 200) {
  const attempt = await loadAttempt(encounterId);
  return attempt ? c.json(attemptResponse(attempt), status) : notFound(c, "Attempt");
}

// POST /:id/attempts — a sentence for an entry in 想用, stored and then judged
expressionRoutes.post("/:id{[0-9]+}/attempts", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = attemptRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const entry = await loadEntry(id);
  if (!entry) return notFound(c);
  // Out of 想用, or graduated: nothing an answer could move. A queued entry
  // is taken, since the user ran into it in 找 by themselves.
  if ((parsed.data.targetVersion ?? 0) !== entry.row.targetVersion) return c.json({ error: "Practice target changed", code: "TARGET_CHANGED" }, 409);
  if (!isMasked(entry)) return c.json({ error: "Not in 想用", code: "NOT_ACTIVE" }, 409);
  // The page reports the hint level. "none" can be checked: it means the
  // question was the stored scene, which is cleared once asked.
  if (parsed.data.cue === "none" && parsed.data.prompt !== entry.row.nextScene) return invalid(c);
  const row = await recordAttempt(id, parsed.data, undefined, entry.row.targetVersion);
  if (!row) return c.json({ error: "Practice target changed", code: "TARGET_CHANGED" }, 409);
  await judgeAttempt({ entry, row });
  return attemptOf(c, row.id, 201);
});

// POST /attempts/:encounterId/judge — the retry, on the same row
expressionRoutes.post("/attempts/:encounterId{[0-9]+}/judge", async (c) => {
  const encounterId = Number(c.req.param("encounterId"));
  const attempt = await loadAttempt(encounterId);
  if (attempt && attempt.row.outcome == null) await judgeAttempt(attempt);
  return attemptOf(c, encounterId);
});

// POST /attempts/:encounterId/overturn — the user's verdict replaces the model's
expressionRoutes.post("/attempts/:encounterId{[0-9]+}/overturn", async (c) => {
  const encounterId = Number(c.req.param("encounterId"));
  const parsed = overturnRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const attempt = await loadAttempt(encounterId);
  if (!attempt) return notFound(c, "Attempt");
  if (attempt.row.outcome == null) return c.json({ error: "Not judged yet", code: "NOT_JUDGED" }, 409);
  await overturn(attempt.row, parsed.data.outcome);
  return attemptOf(c, encounterId);
});

// POST /talk — one turn of 对谈: the partner's reply, and what the library has for what was said
expressionRoutes.post("/talk", async (c) => {
  const parsed = talkRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  if (/text\/event-stream/i.test(c.req.header("accept") ?? "")) {
    if (parsed.data.thread != null && !await hasThread(parsed.data.thread)) return notFound(c, "Conversation");
    c.header("X-Accel-Buffering", "no");
    const controller = new AbortController();
    const response = streamSSE(c, async (stream) => {
      stream.onAbort(() => controller.abort());
      try {
        const turn = await talk(parsed.data, {
          signal: AbortSignal.any([controller.signal, c.req.raw.signal]),
          onDelta: (text) => stream.writeSSE({ event: "delta", data: JSON.stringify({ text }) }),
        });
        if (controller.signal.aborted) return;
        const failure = !turn ? { error: "Conversation not found", code: "NOT_FOUND" }
          : "failed" in turn ? { error: "No answer", code: "TALK_FAILED", reason: turn.failed } : null;
        await stream.writeSSE({ event: failure ? "error" : "done", data: JSON.stringify(failure ?? { turn }) });
      } catch (err) {
        if (controller.signal.aborted) return;
        const reason = failureReason(err);
        console.warn(`[expressions] stream failed: ${reason}`);
        await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "Reply interrupted", code: "STREAM_FAILED", reason }) });
      }
    });
    // Hono's SSE helper sets no-cache, overriding the private-route header.
    c.header("Cache-Control", "no-store");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const turn = await talk(parsed.data);
  if (!turn) return notFound(c, "Conversation");
  if (!("failed" in turn)) return c.json(turn, 201);
  // The reason is one of a fixed list: the page tells "no model set up" from "try again".
  return c.json({ error: "No answer", code: "TALK_FAILED", reason: turn.failed } satisfies TalkFailure, 502);
});

// A retry changes only the notes of this saved reply and records each hit once.
expressionRoutes.post("/talk/turn/:id{[0-9]+}/coach", async (c) => {
  const turn = await retryCoaching(Number(c.req.param("id")), c.req.raw.signal);
  return turn ? c.json(turn) : notFound(c, "Turn");
});

// GET /talk — every conversation, the latest first
expressionRoutes.get("/talk", async (c) => c.json({ threads: await threads() } satisfies TalkListResponse));

// GET /talk/:thread — its turns, as the library stands now
expressionRoutes.get("/talk/:thread{[0-9]+}", async (c) => {
  const turns = await readThread(Number(c.req.param("thread")));
  return turns ? c.json({ turns } satisfies TalkThreadResponse) : notFound(c, "Conversation");
});

// DELETE /talk/:thread — forget a conversation; what it wrote on the timelines stays
expressionRoutes.delete("/talk/:thread{[0-9]+}", async (c) => {
  await dropThread(Number(c.req.param("thread")));
  return c.body(null, 204);
});

// POST /pick — what in a pasted conversation is worth saving; stores nothing
expressionRoutes.post("/pick", async (c) => {
  const parsed = pickRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  try {
    return c.json({ picks: await pick(parsed.data.text) } satisfies PickResponse);
  } catch (err) {
    console.warn(`[expressions] pick failed: ${failureReason(err)}`);
    return c.json({ error: "Picking failed", code: "PICK_FAILED" }, 502);
  }
});

// GET /stats — the number on the home page and the two day counts
expressionRoutes.get("/stats", async (c) => c.json(await stats()));
