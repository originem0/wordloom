import { Hono, type Context } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { encounters, expressions } from "../db/schema.js";
import { failureReason } from "../services/ai-shared.js";
import { annotate, pick } from "../services/expressions-ai.js";
import { find, normalize } from "../services/expressions-find.js";
import {
  attemptResponse, judgeAttempt, loadAttempt, overturn, recordAttempt, sceneOf, stats, tryItems,
} from "../services/expressions-try.js";
import { isMasked, loadEntry, loadLibrary, toDetail, toDuplicate, toSummary } from "../services/expressions-view.js";
import {
  attemptRequestSchema, captureRequestSchema, encounterRequestSchema, expressionPatchSchema, findRequestSchema,
  overturnRequestSchema, pickRequestSchema, revealRequestSchema,
} from "../../shared/validation.js";
import type {
  CaptureRequest, DuplicateResponse, EncounterSource, ExpressionListResponse, PickResponse, TryResponse,
} from "../../shared/expressions.js";

// The admin's private text. Nothing here logs it or puts it in an error: a log
// line carries an id and a reason from a fixed list, and an error that escapes
// a handler is logged by the app without its message. No route takes private
// text in a query string either, because the request logger prints the URL.
export const expressionRoutes = new Hono();

const invalid = (c: Context) => c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
const notFound = (c: Context, what = "Expression") => c.json({ error: `${what} not found`, code: "NOT_FOUND" }, 404);
const blank = (s: string | null | undefined) => (s && s.trim() ? s : null);
const oldestFirst = [asc(encounters.createdAt), asc(encounters.id)];

/** One entry as its own routes answer with it: masked while it is in 想用. */
async function detailOf(id: number) {
  const entry = await loadEntry(id);
  return entry && toDetail(entry);
}

/** The scene an entry came from. Capture writes it, so it is the oldest. */
const firstMet = (id: number) =>
  db
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
    .where(eq(expressions.id, id));
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
  const focus = blank(parsed.data.focus);
  const norm = normalize(focus ?? text);

  // The check has to live here: for an entry in 想用 the page does not hold
  // the text to compare with, and is told only its intent and date.
  if (!force && (await db.select({ id: expressions.id }).from(expressions).where(eq(expressions.norm, norm)).get())) {
    const existing = (await loadLibrary()).filter((e) => e.row.norm === norm).map(toDuplicate);
    return c.json({ error: "Already saved", code: "DUPLICATE", existing } satisfies DuplicateResponse, 409);
  }

  const now = Date.now();
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expressions)
      .values({ text, norm, focus, createdAt: now, updatedAt: now })
      .returning({ id: expressions.id });
    await tx.insert(encounters).values(metRow(row.id, text, parsed.data, now, found));
    return row.id;
  });
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
  const row = await db.select().from(expressions).where(eq(expressions.id, id)).get();
  if (!row) return notFound(c);

  const patch = parsed.data;
  const now = Date.now();
  const set: Partial<typeof expressions.$inferInsert> = { updatedAt: now };
  if (patch.note !== undefined) set.note = blank(patch.note);
  if (patch.focus !== undefined) {
    set.focus = blank(patch.focus);
    set.norm = normalize(set.focus ?? row.text);
  }
  if (patch.intent !== undefined) {
    set.intent = blank(patch.intent);
    set.intentBy = set.intent ? (patch.intentBy ?? "self") : null;
  }
  const status = patch.status ?? row.status;
  // In 想用 an entry is asked for by its intent, in the user's own words.
  if (status === "active" && !(set.intent !== undefined ? set.intent : row.intent)) {
    return c.json({ error: "An entry in 想用 needs an intent", code: "INTENT_REQUIRED" }, 400);
  }
  if (status !== row.status) {
    set.status = status;
    // Entering starts the first 24 hours. Leaving is not kept anywhere, so
    // coming back starts them again: whatever was shown in between is unknown.
    set.activeSince = status === "active" ? now : null;
  }
  const met = patch.occurredAt === undefined ? undefined : await firstMet(id);
  await db.transaction(async (tx) => {
    await tx.update(expressions).set(set).where(eq(expressions.id, id));
    if (met) await tx.update(encounters).set({ occurredAt: patch.occurredAt }).where(eq(encounters.id, met.id));
  });
  return c.json(await detailOf(id));
});

// POST /:id/encounters — met again
expressionRoutes.post("/:id{[0-9]+}/encounters", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = encounterRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const row = await db.select({ id: expressions.id }).from(expressions).where(eq(expressions.id, id)).get();
  if (!row) return notFound(c);
  await db.insert(encounters).values(metRow(id, parsed.data.text, parsed.data, Date.now()));
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
  const entry = await loadEntry(id);
  if (!entry) return notFound(c);
  if (!isMasked(entry)) return c.json(toDetail(entry));
  // The row and the read after it are one transaction: the answer never leaves
  // without the timeline saying so, and no row says so when it did not leave.
  const revealed = await db.transaction(async (tx) => {
    await tx.insert(encounters).values({ expressionId: id, kind: "reveal", text: "", cue: parsed.data.cue, createdAt: Date.now() });
    return loadEntry(id, tx);
  });
  return revealed ? c.json(toDetail(revealed, true)) : notFound(c);
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
  return c.json({ items: tryItems(await loadLibrary(), Date.now(), exclude) } satisfies TryResponse);
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
  if (!isMasked(entry)) return c.json({ error: "Not in 想用", code: "NOT_ACTIVE" }, 409);
  // The page reports the hint level. "none" can be checked: it means the
  // question was the stored scene, which is cleared once asked.
  if (parsed.data.cue === "none" && parsed.data.prompt !== entry.row.nextScene) return invalid(c);
  const row = await recordAttempt(id, parsed.data);
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

// POST /find — what the library has for a need, and what else would say it
expressionRoutes.post("/find", async (c) => {
  const parsed = findRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const found = await find(parsed.data);
  return found ? c.json(found) : c.json({ error: "Search failed", code: "FIND_FAILED" }, 502);
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
