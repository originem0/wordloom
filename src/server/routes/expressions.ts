import { Hono, type Context } from "hono";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { encounters, expressions } from "../db/schema.js";
import { failureReason } from "../services/ai-shared.js";
import { annotate } from "../services/expressions-ai.js";
import { captureRequestSchema, encounterRequestSchema, expressionPatchSchema } from "../../shared/validation.js";
import type {
  DuplicateResponse, EncounterSource, EncounterView,
  ExpressionDetail, ExpressionListResponse, ExpressionSummary,
} from "../../shared/expressions.js";

// The admin's private text. Nothing here logs it or puts it in an error: a log
// line carries an id and a reason from a fixed list, and an error that escapes
// a handler is logged by the app as its class alone. No route takes a query
// string either, because the request logger prints the URL.
export const expressionRoutes = new Hono();

type Met = Pick<typeof encounters.$inferSelect, "sourceType" | "sourceTitle" | "occurredAt">;

const invalid = (c: Context) => c.json({ error: "Invalid request", code: "VALIDATION_ERROR" }, 400);
const notFound = (c: Context) => c.json({ error: "Expression not found", code: "NOT_FOUND" }, 404);
const blank = (s: string | null | undefined) => (s && s.trim() ? s : null);
/** What duplicates are found by: the focus, or the whole text without one. */
const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const oldestFirst = [asc(encounters.createdAt), asc(encounters.id)];
// Listed rather than selected whole: `feedback`, and whatever column comes
// later, stays on the server until someone decides it should leave.
const timelineColumns = {
  id: encounters.id, kind: encounters.kind, createdAt: encounters.createdAt,
  cue: encounters.cue, outcome: encounters.outcome,
  text: encounters.text, textBefore: encounters.textBefore, myAttempt: encounters.myAttempt,
  sourceType: encounters.sourceType, sourceTitle: encounters.sourceTitle,
  sourceLocator: encounters.sourceLocator, occurredAt: encounters.occurredAt,
};

function toSummary(row: typeof expressions.$inferSelect, met: Met | undefined): ExpressionSummary {
  return {
    id: row.id,
    status: row.status as ExpressionSummary["status"],
    masked: false, // nothing is withheld before the 想用 layer exists
    text: row.text,
    focus: row.focus,
    intent: row.intent,
    intentBy: row.intentBy as ExpressionSummary["intentBy"],
    sourceType: (met?.sourceType ?? null) as ExpressionSummary["sourceType"],
    sourceTitle: met?.sourceTitle ?? null,
    occurredAt: met?.occurredAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadDetail(id: number): Promise<ExpressionDetail | null> {
  const row = await db.select().from(expressions).where(eq(expressions.id, id)).get();
  if (!row) return null;
  const timeline = (await db
    .select(timelineColumns)
    .from(encounters)
    .where(eq(encounters.expressionId, id))
    .orderBy(...oldestFirst)
    .all()) as EncounterView[];
  return {
    ...toSummary(row, timeline.find((e) => e.kind === "met")),
    note: row.note,
    gloss: row.gloss,
    aiIntent: row.aiIntent,
    annotated: row.gloss != null,
    activeSince: row.activeSince,
    timeline,
  };
}

/** The scene an entry came from. Capture writes it, so it is the oldest. */
const firstMet = (id: number) =>
  db
    .select()
    .from(encounters)
    .where(and(eq(encounters.expressionId, id), eq(encounters.kind, "met")))
    .orderBy(...oldestFirst)
    .get();

const metRow = (expressionId: number, text: string, source: EncounterSource, now: number) => ({
  expressionId,
  kind: "met",
  text, // verbatim, like the entry's own
  textBefore: blank(source.textBefore),
  sourceType: source.sourceType ?? null,
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
  const rows = await db.select().from(expressions).orderBy(desc(expressions.createdAt), desc(expressions.id)).all();
  // One pass over the met rows instead of a query per entry. Oldest first, so
  // the first one seen for an entry is where it was first met.
  const met = await db
    .select({
      expressionId: encounters.expressionId, sourceType: encounters.sourceType,
      sourceTitle: encounters.sourceTitle, occurredAt: encounters.occurredAt,
    })
    .from(encounters)
    .where(eq(encounters.kind, "met"))
    .orderBy(...oldestFirst)
    .all();
  const first = new Map<number | null, Met>();
  for (const m of met) if (!first.has(m.expressionId)) first.set(m.expressionId, m);
  return c.json({ expressions: rows.map((r) => toSummary(r, first.get(r.id))) } satisfies ExpressionListResponse);
});

// POST / — capture. The entry is stored before the model hears of it.
expressionRoutes.post("/", async (c) => {
  const parsed = captureRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const { text, force } = parsed.data;
  const focus = blank(parsed.data.focus);
  const norm = normalize(focus ?? text);

  if (!force) {
    const existing = await db
      .select({ id: expressions.id, text: expressions.text, intent: expressions.intent, createdAt: expressions.createdAt })
      .from(expressions)
      .where(eq(expressions.norm, norm))
      .orderBy(desc(expressions.createdAt), desc(expressions.id))
      .all();
    if (existing.length > 0) {
      const masked = existing.map((e) => ({ ...e, masked: false }));
      return c.json({ error: "Already saved", code: "DUPLICATE", existing: masked } satisfies DuplicateResponse, 409);
    }
  }

  const now = Date.now();
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expressions)
      .values({ text, norm, focus, createdAt: now, updatedAt: now })
      .returning({ id: expressions.id });
    await tx.insert(encounters).values(metRow(row.id, text, parsed.data, now));
    return row.id;
  });
  const detail = await loadDetail(id);
  // Not awaited, and not a job: a job row would keep the sentence as its input.
  void annotateEntry(id).catch((err) => annotateFailed(id, err));
  return c.json(detail, 201);
});

// GET /:id — one entry with its timeline
expressionRoutes.get("/:id{[0-9]+}", async (c) => {
  const detail = await loadDetail(Number(c.req.param("id")));
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
  const set: Partial<typeof expressions.$inferInsert> = { updatedAt: Date.now() };
  if (patch.note !== undefined) set.note = blank(patch.note);
  if (patch.focus !== undefined) {
    set.focus = blank(patch.focus);
    set.norm = normalize(set.focus ?? row.text);
  }
  if (patch.intent !== undefined) {
    set.intent = blank(patch.intent);
    set.intentBy = set.intent ? (patch.intentBy ?? "self") : null;
  }
  if (patch.status) set.status = patch.status;
  const met = patch.occurredAt === undefined ? undefined : await firstMet(id);
  await db.transaction(async (tx) => {
    await tx.update(expressions).set(set).where(eq(expressions.id, id));
    if (met) await tx.update(encounters).set({ occurredAt: patch.occurredAt }).where(eq(encounters.id, met.id));
  });
  return c.json(await loadDetail(id));
});

// POST /:id/encounters — met again
expressionRoutes.post("/:id{[0-9]+}/encounters", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = encounterRequestSchema.safeParse(await c.req.json());
  if (!parsed.success) return invalid(c);
  const row = await db.select({ id: expressions.id }).from(expressions).where(eq(expressions.id, id)).get();
  if (!row) return notFound(c);
  await db.insert(encounters).values(metRow(id, parsed.data.text, parsed.data, Date.now()));
  return c.json(await loadDetail(id), 201);
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
  const detail = await loadDetail(id);
  return detail ? c.json(detail) : notFound(c);
});
