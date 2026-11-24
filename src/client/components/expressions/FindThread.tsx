import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { ApiError } from "@/client/lib/api";
import { useAttempt, useCapture, usePatchExpression, useReveal } from "@/client/hooks/useExpressions";
import {
  EXPRESSION_LIMITS, type AttemptResponse, type CaptureRequest, type ExpressionDetail, type ExpressionSummary, type FindHit, type FindResponse, type Suggestion,
} from "@/shared/expressions";
import { AttemptResult } from "./AttemptResult";
import { Marked } from "./ExpressionDetail";
import { SOURCE_LABELS, day, titleOf } from "./shared";

/** One question of a 找 thread and what came back for it. */
export type Turn = { need: string; attempt?: string; answer: FindResponse };

const MUTED = "text-xs text-muted-foreground";

const where = (e: ExpressionSummary) =>
  `${e.sourceType ? SOURCE_LABELS[e.sourceType] : "未记录"}${e.sourceTitle ? ` · ${e.sourceTitle}` : ""} · ${day(e.occurredAt ?? e.createdAt)}`;

/** A hit whose English this answer may show. */
function Hit({ hit: { expression: e, why }, need }: { hit: FindHit; need: string }) {
  const patch = usePatchExpression();
  const [moved, setMoved] = useState(false);
  // 想用 takes no entry without an intent. One the user wrote stays; otherwise
  // the need that found the entry is what they wanted to say with it.
  const move = () =>
    patch.mutate({ id: e.id, status: "active", ...(!e.intent && { intent: need, intentBy: "find" as const }) }, {
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
 * before the English leaves it, and what it answers is held here only.
 */
function Masked({ e, need, onResolved }: { e: ExpressionSummary; need: string; onResolved: () => void }) {
  const reveal = useReveal();
  const attempt = useAttempt();
  const [own, setOwn] = useState("");
  const [shown, setShown] = useState<ExpressionDetail | null>(null);
  const [result, setResult] = useState<AttemptResponse | null>(null);
  const busy = reveal.isPending || attempt.isPending;
  const look = () =>
    reveal.mutate({ id: e.id, cue: "masked" }, {
      onSuccess: (detail) => {
        setShown(detail);
        onResolved();
      },
      onError: (err) => toast.error(`没有看成：${err.message}`),
    });
  // The question the user is answering is their own need, so that is the hint level and the prompt.
  const submit = () =>
    attempt.mutate({ id: e.id, text: own.trim(), cue: "need", prompt: need }, {
      onSuccess: (judged) => {
        setResult(judged);
        onResolved();
      },
      onError: (err) => toast.error(`没有交上：${err.message}`),
    });
  return (
    <li className="space-y-2">
      <p className="whitespace-pre-line">{titleOf(e)}</p>
      <p className={MUTED}>{where(e)}</p>
      {result && <AttemptResult result={result} onChange={setResult} />}
      {shown && !result?.answer && (
        <div className="space-y-1 rounded-md bg-muted/50 p-3">
          <p className="whitespace-pre-line">
            <Marked text={titleOf(shown)} mark={shown.focus} />
          </p>
          {shown.gloss && <p className={`whitespace-pre-line ${MUTED}`}>补注 · AI 写的：{shown.gloss}</p>}
        </div>
      )}
      {/* A judgement that did not come back leaves the English unseen: looking at it stays possible. */}
      {!shown && !result?.answer && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!result && (
            <>
              <Input aria-label="先试着写一句" className="h-8 min-w-0 flex-1" placeholder="先试着写一句" maxLength={EXPRESSION_LIMITS.attempt} value={own} onChange={(ev) => setOwn(ev.target.value)} />
              <Button size="sm" disabled={!own.trim() || busy} onClick={submit}>提交</Button>
            </>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={look}>看答案</Button>
        </div>
      )}
    </li>
  );
}

/** Something the model wrote. Kept, it becomes an entry whose scene is the need and the attempt of its turn. */
function Offer({ s, found, onSaved }: { s: Suggestion; found: CaptureRequest["found"]; onSaved: (id: number) => void }) {
  const capture = useCapture();
  const [kept, setKept] = useState("");
  const keep = () =>
    capture.mutate({ text: s.text, found }, {
      onSuccess: (saved) => {
        setKept("已收下");
        onSaved(saved.id);
      },
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
        {s.text}
        <span className={`block ${MUTED}`}>{s.why}</span>
      </p>
      {kept ? <span className={`shrink-0 ${MUTED}`}>{kept}</span> : <Button size="sm" variant="outline" disabled={capture.isPending} onClick={keep}>收</Button>}
    </div>
  );
}

function TurnView({ turn: { need, attempt, answer }, onSaved }: { turn: Turn; onSaved: (id: number) => void }) {
  // The masked hits tried or looked at so far. What the model suggests waits
  // for all of them: shown first, it would be an answer to copy.
  const [resolved, setResolved] = useState<number[]>([]);
  const waiting = answer.mine.some((h) => h.expression.masked && !resolved.includes(h.expression.id));
  const groups = [
    ["用出过的", answer.mine.filter((h) => h.expression.produced)],
    ["存过没用出的", answer.mine.filter((h) => !h.expression.produced)],
  ] as const;
  const found = { need, attempt };
  return (
    <li className="space-y-3 rounded-md border p-3 text-sm">
      <p className="whitespace-pre-line font-medium">{need}</p>
      {attempt && <p className={MUTED}>我写的：{attempt}</p>}
      {answer.card && (
        // The one piece of a question that goes into a URL: a single word that already has a card.
        <Link className="block text-primary underline" to={`/cards?prefill=${encodeURIComponent(answer.card.word)}`}>词卡：{answer.card.word}</Link>
      )}
      {!answer.card && !answer.mine.length && <p className="text-muted-foreground">这次没在你存过的里面找到。</p>}
      {groups.map(([title, hits]) => hits.length > 0 && (
        <fieldset key={title} className="min-w-0 space-y-2">
          <legend className={MUTED}>{title}</legend>
          <ul className="space-y-3">
            {hits.map((h) =>
              h.expression.masked ? (
                <Masked key={h.expression.id} e={h.expression} need={need} onResolved={() => setResolved((ids) => [...ids, h.expression.id])} />
              ) : (
                <Hit key={h.expression.id} hit={h} need={need} />
              ),
            )}
          </ul>
        </fieldset>
      ))}
      {answer.fix && (
        <div className="space-y-1">
          <p className={MUTED}>把你那句改成</p>
          <Offer s={answer.fix} found={found} onSaved={onSaved} />
        </div>
      )}
      {answer.fresh.length > 0 && (waiting ? (
        <p className={MUTED}>新说法等上面遮着的试过或看过之后再给。</p>
      ) : (
        <div className="space-y-2">
          <p className={MUTED}>新说法 · AI 建议</p>
          {answer.fresh.map((s, i) => <Offer key={i} s={s} found={found} onSaved={onSaved} />)}
        </div>
      ))}
      {answer.searched < answer.total && <p className={MUTED}>这次只搜了 {answer.searched} / {answer.total} 条。</p>}
    </li>
  );
}

/**
 * The answers to what was asked in the box, newest first. Hits, reveals and
 * judgements are held by the components that show them for as long as the
 * thread is on the page, and nowhere else: not in the query cache, not in a URL.
 */
export function FindThread({ turns, busy, onSaved, onReset }: { turns: Turn[]; busy: boolean; onSaved: (id: number) => void; onReset: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onReset}>新话题</Button>
      </div>
      {/* Keyed by its place in the thread: a new turn on top must not take over the state of the one below. */}
      <ul className="space-y-2">{turns.map((t, i) => <TurnView key={i} turn={t} onSaved={onSaved} />).reverse()}</ul>
    </div>
  );
}
