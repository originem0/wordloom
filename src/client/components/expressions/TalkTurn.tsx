import { useState } from "react";
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
import { SOURCE_LABELS, day, titleOf } from "./shared";
import { SpeechButton } from "./SpeechButton";

const MUTED = "text-xs text-muted-foreground";

const where = (e: ExpressionSummary) =>
  `${e.sourceType ? SOURCE_LABELS[e.sourceType] : "未记录"}${e.sourceTitle ? ` · ${e.sourceTitle}` : ""} · ${day(e.occurredAt ?? e.createdAt)}`;

/** A hit whose English this answer may show. */
function Hit({ hit: { expression: e, why }, said }: { hit: TalkHit; said: string }) {
  const patch = usePatchExpression();
  const [moved, setMoved] = useState(false);
  // 想用 takes no entry without an intent. One the user wrote stays; otherwise
  // the message that found the entry is what they wanted to say with it, as
  // much of it as an intent holds.
  const move = () =>
    patch.mutate({ id: e.id, status: "active", ...(!e.intent && { intent: said.slice(0, EXPRESSION_LIMITS.intent), intentBy: "find" as const }) }, {
      onSuccess: () => setMoved(true),
      onError: (err) => toast.error(`没有放进去：${err.message}`),
    });
  return (
    <li className="space-y-1">
      <p className="whitespace-pre-line">
        <Marked text={titleOf(e)} mark={e.focus} />
      </p>
      {why && <p className={MUTED}>{why}</p>}
      <div className={`flex flex-wrap items-center gap-2 ${MUTED}`}>
        <span>{where(e)}</span>
        {e.status === "retired" && <span>已收起</span>}
        {/* The hit keeps the text this answer showed, although the entry is masked from now on. */}
        {e.status === "seen" && (moved ? <span>已放进想用</span> : <Button size="xs" variant="outline" disabled={patch.isPending} onClick={move}>放进想用</Button>)}
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
  const reveal = useReveal();
  const attempt = useAttempt();
  const [own, setOwn] = useState("");
  const [shown, setShown] = useState<ExpressionDetail | null>(null);
  const [result, setResult] = useState<AttemptResponse | null>(null);
  const busy = reveal.isPending || attempt.isPending;
  const look = () =>
    reveal.mutate({ id: e.id, cue: "masked" }, { onSuccess: setShown, onError: (err) => toast.error(`没有看成：${err.message}`) });
  // The question the user is answering is their own message, so that is the hint level and the prompt.
  const submit = () =>
    attempt.mutate({ id: e.id, text: own.trim(), cue: "need", prompt: said }, {
      onSuccess: setResult,
      onError: (err) => toast.error(`没有交上：${err.message}`),
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
              <Input aria-label="先试着写一句" className="h-8 min-w-0 flex-1" placeholder="先试着用它写一句" maxLength={EXPRESSION_LIMITS.attempt} value={own} onChange={(ev) => setOwn(ev.target.value)} />
              <Button size="sm" disabled={!own.trim() || busy} onClick={submit}>提交</Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={look}>看答案</Button>
        </div>
      )}
    </li>
  );
}

/** Something the partner wrote. Kept, it becomes an entry whose scene is the message of its turn. */
function Offer({ s, found }: { s: Suggestion; found: CaptureRequest["found"] }) {
  const capture = useCapture();
  const [kept, setKept] = useState("");
  const keep = () =>
    capture.mutate({ text: s.text, focus: s.focus, found }, {
      onSuccess: () => setKept("已收下"),
      // The library has the same words already: nothing was saved, and nothing went wrong.
      onError: (e) => {
        if (!(e instanceof ApiError && e.code === "DUPLICATE")) toast.error(`没有存上：${e.message}`);
        else {
          toast.info("已经收过同样的");
          setKept("已收过");
        }
      },
    });
  return (
    <div className="flex items-start justify-between gap-2">
      <p className="min-w-0 whitespace-pre-line">
        <Marked text={s.text} mark={s.focus ?? null} />
        {s.why && <span className={`block ${MUTED}`}>{s.why}</span>}
      </p>
      {kept ? <span className={`shrink-0 ${MUTED}`}>{kept}</span> : <Button size="sm" variant="outline" disabled={capture.isPending} onClick={keep}>收</Button>}
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
  const retry = useRetryCoaching();
  const turn = retry.data ?? stored;
  const [judged, setJudged] = useState<AttemptResponse | null>(null);
  const { said, reply, fix, rewrites, fresh, mine } = turn;
  const groups = [
    ["你库里的 · 用出过的", mine.filter((h) => h.expression.produced)],
    ["你库里的 · 存过没用出的", mine.filter((h) => !h.expression.produced)],
  ] as const;
  // The server blanks whatever would give away an entry in 想用, the partner's own words included.
  const blanked = [said, reply, fix?.text, ...fresh.map((s) => s.text)].some((s) => s?.includes(BLANK));
  const notes = rewrites.length > 0 || fix || fresh.length > 0 || mine.length > 0 || blanked || turn.searched < turn.total;
  return (
    <li className="space-y-3">
      <p className="ml-auto w-fit max-w-[85%] break-words whitespace-pre-line rounded-lg bg-muted px-3 py-2">{said}</p>
      <p className="break-words whitespace-pre-line leading-relaxed">{reply}</p>
      <SpeechButton turnId={turn.id} />
      {turn.coachingFailure && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
          <span>回复已保存，批注暂时没完成。</span>
          <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(turn.id, { onError: () => toast.error("批注还没完成，可以稍后再试。") })}>重试批注</Button>
        </div>
      )}
      {turn.review && <p className={MUTED}>这句也可以接着练，你下一句用英文回答就会记入回顾。</p>}
      {turn.reviewResult && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p className={MUTED}>上一句的回顾</p>
          <AttemptResult result={judged ?? turn.reviewResult} onChange={setJudged} />
        </div>
      )}
      {notes && (
        <div className="space-y-3 rounded-md border p-3 text-sm">
          {rewrites.length > 0 && (
            <div className="space-y-2">
              <p className={MUTED}>可以改的地方</p>
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
              <p className={MUTED}>整句更自然的说法</p>
              <Offer s={fix} found={{ need: said }} />
            </div>
          )}
          {groups.map(([title, hits]) => hits.length > 0 && (
            <fieldset key={title} className="min-w-0 space-y-2">
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
              <p className={MUTED}>值得留下 · AI 建议</p>
              {fresh.map((s, i) => <Offer key={i} s={s} found={{ need: said }} />)}
            </div>
          )}
          {blanked && <p className={MUTED}>{BLANK} 是你「想用」里的一条，遮着等你自己说出来。</p>}
          {turn.searched < turn.total && <p className={MUTED}>这次只搜了 {turn.searched} / {turn.total} 条。</p>}
        </div>
      )}
    </li>
  );
}
