import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { ApiError } from "@/client/lib/api";
import { useAttempt, useCapture, usePatchExpression, useRetryCoaching, useReveal } from "@/client/hooks/useExpressions";
import {
  EXPRESSION_LIMITS, type AttemptResponse, type CaptureRequest, type ExpressionDetail, type ExpressionSummary, type Suggestion, type TalkHit,
  type TalkTurn,
} from "@/shared/expressions";
import { Answer, AttemptResult } from "./AttemptResult";
import { Marked } from "./ExpressionDetail";
import { sourceLabel, day, titleOf } from "./shared";
import { SpeechButton } from "./SpeechButton";
import { errorMessage, useI18n } from "@/client/lib/i18n";

const MUTED = "text-sm text-muted-foreground";

const where = (e: ExpressionSummary) =>
  `${sourceLabel(e.sourceType)}${e.sourceTitle ? ` · ${e.sourceTitle}` : ""} · ${day(e.occurredAt ?? e.createdAt)}`;

/** A hit whose English this answer may show. */
function Hit({ hit: { expression: e, why }, said }: { hit: TalkHit; said: string }) {
  const { t } = useI18n();
  const patch = usePatchExpression();
  const [moved, setMoved] = useState(false);
  // 想用 takes no entry without an intent. One the user wrote stays; otherwise
  // the message that found the entry is what they wanted to say with it, as
  // much of it as an intent holds.
  const move = () =>
    patch.mutate({ id: e.id, status: "active", ...(!e.intent && { intent: said.slice(0, EXPRESSION_LIMITS.intent), intentBy: "find" as const }) }, {
      onSuccess: () => setMoved(true),
      onError: (err) => toast.error(t(`没有放进去：${errorMessage(err)}`, `Could not move this to practice: ${errorMessage(err)}`)),
    });
  return (
    <li className="space-y-1">
      <p className="whitespace-pre-line">
        <Marked text={titleOf(e)} mark={e.focus} />
      </p>
      {why && <p className={MUTED}>{why}</p>}
      <div className={`flex flex-wrap items-center gap-2 ${MUTED}`}>
        <span>{where(e)}</span>
        {e.status === "retired" && <span>{t("已收起", "Archived")}</span>}
        {/* The hit keeps the text this answer showed, although the entry is masked from now on. */}
        {e.status === "seen" && (moved ? <span>{t("已放进想用", "Added to To use")}</span> : <Button size="xs" variant="outline" disabled={patch.isPending} onClick={move}>{t("放进想用", "Add to practice")}</Button>)}
      </div>
    </li>
  );
}

/**
 * A hit in 想用 that came without its English: the user's chance to produce it.
 * A sentence first, or a look at the answer; either way the server writes a row
 * before the English leaves it, and what it answers is held here only. Neither
 * is asked for: the conversation goes on without them.
 */
function Masked({ e, said }: { e: ExpressionSummary; said: string }) {
  const { t } = useI18n();
  const reveal = useReveal();
  const attempt = useAttempt();
  const [own, setOwn] = useState("");
  const [shown, setShown] = useState<ExpressionDetail | null>(null);
  const [result, setResult] = useState<AttemptResponse | null>(null);
  const busy = reveal.isPending || attempt.isPending;
  const look = () =>
    reveal.mutate({ id: e.id, cue: "masked" }, { onSuccess: setShown, onError: (err) => toast.error(t(`没有看成：${errorMessage(err)}`, `Could not reveal the answer: ${errorMessage(err)}`)) });
  // The question the user is answering is their own message, so that is the hint level and the prompt.
  const submit = () =>
    attempt.mutate({ id: e.id, targetVersion: e.targetVersion, text: own.trim(), cue: "need", prompt: said }, {
      onSuccess: setResult,
      onError: (err) => toast.error(t(`没有交上：${errorMessage(err)}`, `Could not submit: ${errorMessage(err)}`)),
    });
  return (
    <li className="space-y-2">
      <p className="whitespace-pre-line">{titleOf(e)}</p>
      <p className={MUTED}>{where(e)}</p>
      {result && <AttemptResult result={result} onChange={setResult} />}
      {shown && !result?.answer && <Answer text={titleOf(shown)} focus={shown.focus} gloss={shown.gloss} />}
      {/* A judgement that did not come back leaves the English unseen: looking at it stays possible. */}
      {!shown && !result?.answer && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!result && (
            <>
              <Input aria-label={t("先试着写一句", "Try a sentence first")} className="h-8 min-w-0 flex-1" placeholder={t("先试着用它写一句", "Try using it in a sentence")} maxLength={EXPRESSION_LIMITS.attempt} value={own} onChange={(ev) => setOwn(ev.target.value)} />
              <Button size="sm" disabled={!own.trim() || busy} onClick={submit}>{t("提交", "Submit")}</Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={look}>{t("看答案", "Show answer")}</Button>
        </div>
      )}
    </li>
  );
}

/** Something the partner wrote. Kept, it becomes an entry whose scene is the message of its turn. */
function Offer({ s, found }: { s: Suggestion; found: CaptureRequest["found"] }) {
  const { t } = useI18n();
  const capture = useCapture();
  const [kept, setKept] = useState<"saved" | "duplicate" | null>(null);
  const keep = () =>
    capture.mutate({ text: s.text, focus: s.focus, found }, {
      onSuccess: () => setKept("saved"),
      // The library has the same words already: nothing was saved, and nothing went wrong.
      onError: (e) => {
        if (!(e instanceof ApiError && e.code === "DUPLICATE")) toast.error(t(`没有存上：${errorMessage(e)}`, `Could not save: ${errorMessage(e)}`));
        else {
          toast.info(t("已经收过同样的", "This expression is already saved"));
          setKept("duplicate");
        }
      },
    });
  return (
    <div className="flex items-start justify-between gap-2">
      <p className="min-w-0 whitespace-pre-line">
        <Marked text={s.text} mark={s.focus ?? null} />
        {s.why && <span className={`block ${MUTED}`}>{s.why}</span>}
      </p>
      {kept ? <span className={`shrink-0 ${MUTED}`}>{kept === "saved" ? t("已收下", "Saved") : t("已收过", "Already saved")}</span> : <Button size="sm" variant="outline" disabled={capture.isPending} onClick={keep}>{t("收", "Save")}</Button>}
    </div>
  );
}

const BLANK = "____";

/**
 * One turn of a conversation: the message, the reply, and under it what came
 * with the reply. Reveals and judgements are held by the components that show
 * them for as long as the turn is on the page, and nowhere else.
 */
export function TurnView({ turn: stored }: { turn: TalkTurn }) {
  const { t } = useI18n();
  const retry = useRetryCoaching();
  const turn = retry.data ?? stored;
  const [judged, setJudged] = useState<AttemptResponse | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const { said, reply, fix, rewrites, fresh, mine } = turn;
  const groups = [
    ["produced", t("你库里的 · 用出过的", "From your library · Used before"), mine.filter((h) => h.expression.produced)],
    ["saved", t("你库里的 · 存过没用出的", "From your library · Saved but not used"), mine.filter((h) => !h.expression.produced)],
  ] as const;
  // The server blanks whatever would give away an entry in 想用, the partner's own words included.
  const blanked = [said, reply, fix?.text, ...fresh.map((s) => s.text)].some((s) => s?.includes(BLANK));
  const notes = rewrites.length > 0 || fix || fresh.length > 0 || mine.length > 0 || blanked || turn.searched < turn.total;
  const hasFeedback = !!(notes || turn.review || turn.reviewResult || turn.coachingFailure);
  return (
    <li className="space-y-3">
      <p className="ml-auto w-fit max-w-[85%] break-words whitespace-pre-line rounded-lg bg-muted px-3 py-2">{said}</p>
      <div className="flex flex-wrap items-center gap-2">
        <SpeechButton turnId={turn.id} />
        {hasFeedback && <Button size="sm" className="min-h-11" variant="outline" onClick={() => {
          feedback.current?.scrollIntoView?.({ block: "start" });
          feedback.current?.focus({ preventScroll: true });
        }}>{t("查看学习反馈", "See learning feedback")}</Button>}
      </div>
      <p className="break-words whitespace-pre-line leading-relaxed">{reply}</p>
      {hasFeedback && <div ref={feedback} tabIndex={-1} className="space-y-3 scroll-mt-4 outline-none" role="region" aria-label={t("学习反馈", "Learning feedback")}>
      {turn.coachingFailure && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
          <span>{t("回复已保存，批注暂时没完成。", "The reply is saved. Its coaching is not ready yet.")}</span>
          <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(turn.id, { onError: () => toast.error(t("批注还没完成，可以稍后再试。", "Coaching is still unavailable. Try again later.")) })}>{t("重试批注", "Retry coaching")}</Button>
        </div>
      )}
      {turn.review && <p className={MUTED}>{t("这句也可以接着练，你下一句用英文回答就会记入回顾。", "You can practise this situation next. An English reply will count as a review attempt.")}</p>}
      {turn.reviewResult && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p className={MUTED}>{t("上一句的回顾", "Review of your previous reply")}</p>
          <AttemptResult result={judged ?? turn.reviewResult} onChange={setJudged} />
        </div>
      )}
      {notes && (
        <div className="space-y-3 rounded-md border p-3 text-sm">
          {rewrites.length > 0 && (
            <div className="space-y-2">
              <p className={MUTED}>{t("可以改的地方", "Ways to improve")}</p>
              {rewrites.map((r, i) => (
                <div key={i} className="space-y-0.5">
                  <p className="text-muted-foreground line-through">{r.from}</p>
                  <Offer s={{ text: r.to, why: r.why }} found={{ need: said, attempt: r.from }} />
                </div>
              ))}
            </div>
          )}
          {fix && (
            <div className="space-y-1">
              <p className={MUTED}>{t("整句更自然的说法", "A more natural way to say it")}</p>
              <Offer s={fix} found={{ need: said }} />
            </div>
          )}
          {groups.map(([key, title, hits]) => hits.length > 0 && (
            <fieldset key={key} className="min-w-0 space-y-2">
              <legend className={MUTED}>{title}</legend>
              <ul className="space-y-3">
                {hits.map((h) =>
                  h.expression.masked ? <Masked key={h.expression.id} e={h.expression} said={said} /> : <Hit key={h.expression.id} hit={h} said={said} />,
                )}
              </ul>
            </fieldset>
          ))}
          {fresh.length > 0 && (
            <div className="space-y-2">
              <p className={MUTED}>{t("值得留下 · AI 建议", "Worth keeping · AI suggestions")}</p>
              {fresh.map((s, i) => <Offer key={i} s={s} found={{ need: said }} />)}
            </div>
          )}
          {blanked && <p className={MUTED}>{t(`${BLANK} 是你「想用」里的一条，遮着等你自己说出来。`, `${BLANK} is an expression in To use, kept hidden for you to recall.`)}</p>}
          {turn.searched < turn.total && <p className={MUTED}>{t(`这次只搜了 ${turn.searched} / ${turn.total} 条。`, `Searched ${turn.searched} of ${turn.total} expressions this time.`)}</p>}
        </div>
      )}
      </div>}
    </li>
  );
}
