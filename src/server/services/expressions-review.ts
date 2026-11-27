import { phrasePattern } from "./expressions-talk.js";
import { judgeAttempt, recordAttempt } from "./expressions-try.js";
import { attemptFeedback, loadEntry, testableAt, type Entry } from "./expressions-view.js";
import { EXPRESSION_LIMITS } from "../../shared/expressions.js";

/** A scene may invite recall, but may not supply the expression it tests. */
function givesAnswer(scene: string, entry: Entry): boolean {
  const target = entry.row.norm.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return Boolean(target && new RegExp(`(?<![\\p{Script=Latin}\\p{N}])${phrasePattern(target)}(?![\\p{Script=Latin}\\p{N}])`, "iu").test(scene));
}

/** Recall is occasional: third turn, then at most once every four turns. The
 *  same due/cap/graduation rules as 试一条 choose the expression, never the model. */
export function chooseReview(library: Entry[], turnNumber: number): { id: number; cue: string; version?: number } | null {
  if (turnNumber < 3 || (turnNumber - 3) % 4 !== 0) return null;
  for (const entry of testableAt(library, Date.now())) {
    const cue = [entry.row.nextScene, entry.row.intent, entry.row.aiIntent]
      .map((s) => s?.trim() ?? "")
      .find((s) => s && s.length <= EXPRESSION_LIMITS.intent && !givesAnswer(s, entry));
    if (cue) return { id: entry.row.id, cue, ...(entry.row.targetVersion && { version: entry.row.targetVersion }) };
  }
  return null;
}

// A retried request must not start two judgements of the same saved turn.
// The persistent source link in recordAttempt also survives a server restart.
const answering = new Map<number, Promise<number | null>>();

/** The next English message is an attempt; continuing in Chinese is neutral.
 *  A failed judgement stays on its row and is retried by the existing judge route. */
export function answerReview(
  review: { id: number; scene: string; version?: number }, said: string, talkTurnId: number, signal?: AbortSignal,
): Promise<number | null> {
  const pending = answering.get(talkTurnId);
  if (pending) return pending;
  const work = (async () => {
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(talkTurnId) || talkTurnId <= 0 || !said.trim() || /\p{Script=Han}/u.test(said) || !/\p{Script=Latin}/u.test(said)) return null;
    const entry = await loadEntry(review.id);
    if (!entry || entry.row.targetVersion !== (review.version ?? 0) || entry.row.status !== "active" || entry.folded.graduated || !review.scene.trim() || review.scene.length > EXPRESSION_LIMITS.intent || givesAnswer(review.scene, entry)) return null;
    signal?.throwIfAborted();
    const row = await recordAttempt(review.id, { text: said, cue: "none", prompt: review.scene }, talkTurnId, entry.row.targetVersion);
    if (!row) return null;
    // A repeated delivery returns its original attempt, even when the model
    // failed. It must not consume another call or replace the original answer.
    if (row.expressionId === entry.row.id && row.outcome == null && attemptFeedback(row)?.status === "pending" && !signal?.aborted) {
      await judgeAttempt({ entry, row }, signal);
    }
    return row.id;
  })();
  answering.set(talkTurnId, work);
  void work.finally(() => answering.delete(talkTurnId)).catch(() => {});
  return work;
}
