import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useAttempt, useReveal, useScene, useTry } from "@/client/hooks/useExpressions";
import { ApiError } from "@/client/lib/api";
import { EXPRESSION_LIMITS, type AttemptResponse, type ExpressionDetail, type TryItem } from "@/shared/expressions";
import { Answer, AttemptResult } from "./AttemptResult";
import { AREA_CLASS } from "./shared";
import { errorMessage, useI18n } from "@/client/lib/i18n";

const HOUR = 3_600_000;

/**
 * One question. The level is how much was on screen before the answer: the
 * fresh scene alone (none), the intent (need), the original scene with its
 * target blanked (scene), the answer (revealed). It only goes up, and it is
 * sent with the attempt, where it decides what a pass or a miss does. Until a
 * reveal or a judgement brings it the English is not in the page, and at level
 * none neither is the intent.
 */
function TryCard({ item, onGone }: { item: TryItem; onGone: () => void }) {
  const { t } = useI18n();
  const attempt = useAttempt();
  const reveal = useReveal();
  const [text, setText] = useState("");
  const [hinted, setHinted] = useState(false);
  // The judgement on screen, and the sentence it is about: the box may hold a later draft by then.
  const [result, setResult] = useState<AttemptResponse | null>(null);
  const [said, setSaid] = useState("");
  // What giving up answered. Kept here and nowhere else: the next read of the entry is masked again.
  const [answer, setAnswer] = useState<ExpressionDetail | null>(null);

  // The original-scene rung, the second hint, is all in this block. To drop
  // it, delete the block, then `original` from `level`, `askScene` from `hint`
  // and {sceneHint} from the markup.
  const [wantScene, setWantScene] = useState(false);
  const scene = useScene(item.id, wantScene);
  // Not before this card asked: a scene an earlier card left in the cache is not a hint this one gave.
  const original = wantScene ? scene.data : undefined;
  const askScene = item.hasScene && !wantScene ? () => setWantScene(true) : null;
  const sceneHint = original ? (
    <div className="space-y-1 rounded-md bg-muted/50 p-3">
      {original.before && <p className="whitespace-pre-line text-xs text-muted-foreground">{original.before}</p>}
      <p className="whitespace-pre-line">{original.scene}</p>
    </div>
  ) : (
    // Answered, and nothing to show: refused. Not `isError`, which is off again whenever the scene is read anew.
    wantScene && (scene.isFetched ? <p className="text-muted-foreground">{t("这一条没有原场景", "No original context is available for this expression")}</p> : <Loader2 className="size-4 animate-spin text-muted-foreground" />)
  );

  // A miss that had only the fresh scene comes back without the answer: the
  // card stays open, and the next try is made with the intent, which
  // AttemptResult has just printed. Read off the result rather than set when
  // it arrives, so an overturn that brings the answer closes the card and a
  // late judgement that withholds it opens the card again.
  const missed = result?.status === "done" && !result.answer;
  const open = !result || missed;
  const level = original ? "scene" : hinted || missed || item.cue === "need" ? "need" : "none";
  const hint = level === "none" ? () => setHinted(true) : level === "need" ? askScene : null;
  const busy = attempt.isPending || reveal.isPending;

  const submit = () =>
    // The question goes as it was shown, whatever hints were added: the server knows a fresh scene by it.
    attempt.mutate({ id: item.id, text: text.trim(), cue: answer ? "revealed" : level, prompt: item.prompt }, {
      onSuccess: (next, sent) => {
        setResult(next);
        setSaid(sent.text);
      },
      onError: (e) => {
        const left = e instanceof ApiError && e.code === "NOT_ACTIVE";
        toast.error(left ? t("这一条已经不在想用里了", "This expression is no longer in To use") : t(`没有交上：${errorMessage(e)}`, `Could not submit: ${errorMessage(e)}`));
        // A 400 is a question gone stale (its scene was used up): asking it again cannot work either.
        if (left || (e instanceof ApiError && e.status === 400)) onGone();
      },
    });
  // Giving up is recorded at the level it happened at.
  const giveUp = () =>
    reveal.mutate({ id: item.id, cue: level }, { onSuccess: (entry) => setAnswer(entry), onError: (e) => toast.error(t(`没有揭开：${errorMessage(e)}`, `Could not reveal the answer: ${errorMessage(e)}`)) });

  return (
    <li className="space-y-2 rounded-lg border bg-card p-4 text-sm shadow-sm">
      <p className="whitespace-pre-line">{item.prompt}</p>
      {hinted && <p className="whitespace-pre-line text-muted-foreground">{t("提示：", "Cue: ")}{item.intent}</p>}
      {sceneHint}
      {/* Once the box is gone, the sentence the judgement is about stays readable. */}
      {!open && <p className="whitespace-pre-line text-muted-foreground">{t("你写的：", "You wrote: ")}{said}</p>}
      {result && <AttemptResult result={result} onChange={setResult} />}
      {answer && !result?.answer && <Answer text={answer.text ?? ""} focus={answer.focus} gloss={answer.gloss} />}
      {open && (
        <>
          {answer && <p className="text-xs text-muted-foreground">{t("看过答案再写一句，不计档位", "Write another sentence after seeing the answer; it will not change your level")}</p>}
          <textarea aria-label={t("你的句子", "Your sentence")} className={AREA_CLASS} rows={2} placeholder={t("用一句英文说出来", "Express it in one English sentence")} maxLength={EXPRESSION_LIMITS.attempt} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" disabled={!text.trim() || busy} onClick={submit}>
              {attempt.isPending && <Loader2 className="animate-spin" />}
              {t("提交", "Submit")}
            </Button>
            {!answer && hint && <Button size="sm" variant="outline" disabled={busy} onClick={hint}>{t("给点提示", "Give me a hint")}</Button>}
            {!answer && <Button size="sm" variant="ghost" disabled={busy} onClick={giveUp}>{t("看答案", "Show answer")}</Button>}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * 试一条: at most three entries of the 想用 layer that are due, each asked for
 * with a fresh scene or with its intent. Sits under the capture box. It shows
 * no count of what is due, no streak and no reminder: more comes when asked for.
 */
export function TryPanel({ onChooseSaved }: { onChooseSaved?: () => void } = {}) {
  const { t } = useI18n();
  const more = useTry();
  // Everything put on this screen, in order; null until the first answer.
  const [items, setItems] = useState<TryItem[] | null>(null);
  // Cards taken off again. Their ids stay in `items`: what was shown once is not asked for a second time.
  const [gone, setGone] = useState<number[]>([]);
  // How many times the panel has started over. Its cards are keyed by it: none carries over into the next round.
  const [round, setRound] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const drafting = () => [...panel.current!.querySelectorAll("textarea")].some((box) => box.value.trim());

  const load = () =>
    more.mutate([], {
      onSuccess: (r) => {
        // A sentence begun while this was on its way keeps its card.
        if (drafting()) return;
        setItems(r.items);
        setGone([]);
        setRound((n) => n + 1);
      },
    });
  // Asked on mount, and anew when the page comes back into view an hour or
  // more after the panel last asked: left open overnight, it would go on
  // showing yesterday's judgements, keep those entries from being asked again,
  // and say nothing is due when something is. Never over a half-written
  // sentence, and not a query, which would reload with the list after every
  // write: the question must not change under a sentence being typed. (Twice
  // under StrictMode in development; the second answer is the one kept.)
  useEffect(() => {
    const look = () => document.visibilityState === "visible" && Date.now() - more.submittedAt >= HOUR && !drafting() && load();
    look();
    document.addEventListener("visibilitychange", look);
    return () => document.removeEventListener("visibilitychange", look);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [more.submittedAt]);
  const another = (shown: TryItem[]) =>
    more.mutate(shown.map((i) => i.id), {
      onSuccess: ({ items: [next] }) => (next ? setItems([...shown, next]) : toast.info(t("没有到时间的了", "Nothing else is due yet."))),
      onError: (e) => toast.error(t(`没有取到：${errorMessage(e)}`, `Could not load an expression: ${errorMessage(e)}`)),
    });

  return (
    <section ref={panel} className="space-y-2">
      <h3 className="font-medium">{t("试一条", "Try one")}</h3>
      {!items ? (
        more.isError ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {t("没有取到要试的条目。", "Could not load expressions to practise.")}
            <Button size="sm" variant="outline" onClick={load}>{t("再试一次", "Try again")}</Button>
          </p>
        ) : (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )
      ) : (
        <>
          {items.length ? (
            <ul key={round} className="space-y-2">
              {items.filter((i) => !gone.includes(i.id)).map((item) => (
                <TryCard key={item.id} item={item} onGone={() => setGone((ids) => [...ids, item.id])} />
              ))}
            </ul>
          ) : (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">{t("现在没有到时间的。放进「想用」的条目，隔一天会出现在这里。", "Nothing is due yet. Expressions in To use appear here after a day.")}</p>
              {onChooseSaved && <>
                <p className="text-sm">{t("先选一条见过的表达，写一句自己的提示句，再放进想用。", "Choose an expression you have seen, write a cue in your own words, then move it to To use.")}</p>
                <Button variant="outline" onClick={onChooseSaved}>{t("从见过选一条", "Choose an expression from Seen")}</Button>
              </>}
            </div>
          )}
          {/* Always offered: what is not due now will be later, with the page still open. */}
          <Button size="sm" variant="outline" disabled={more.isPending} onClick={() => (items.length ? another(items) : load())}>
            {more.isPending && <Loader2 className="animate-spin" />}
            {items.length ? t("再来一条", "Try another") : t("再看一次", "Check again")}
          </Button>
        </>
      )}
    </section>
  );
}
