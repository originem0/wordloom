import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useJudge, useOverturn } from "@/client/hooks/useExpressions";
import type { AttemptResponse } from "@/shared/expressions";
import { Marked } from "./ExpressionDetail";
import { verdictLabel } from "./shared";
import { errorMessage, useI18n } from "@/client/lib/i18n";

/** The English of an entry with its gloss, as a judgement or a reveal brought it. */
export function Answer({ text, focus, gloss }: NonNullable<AttemptResponse["answer"]>) {
  const { t } = useI18n();
  return (
    <div className="space-y-1 rounded-md bg-muted/50 p-3">
      <p className="whitespace-pre-line">
        <Marked text={text} mark={focus} />
      </p>
      {gloss && <p className="whitespace-pre-line text-xs text-muted-foreground">{t("补注 · AI 写的：", "Annotation · Written by AI: ")}{gloss}</p>}
    </div>
  );
}

/**
 * What came back for a sentence the user wrote, in 试一条 or against a masked
 * hit in 找. The caller holds the result and gets every later state of it (a
 * second judgement, an overturn) through onChange. The wording is ours, picked
 * by the two booleans the model returned; what the model and the user wrote is
 * only ever a text node.
 */
export function AttemptResult({ result, onChange }: { result: AttemptResponse; onChange: (next: AttemptResponse) => void }) {
  const { t } = useI18n();
  const judge = useJudge();
  const overturn = useOverturn();
  const busy = judge.isPending || overturn.isPending;

  if (result.status === "failed") {
    const again = () =>
      judge.mutate(result.encounterId, {
        onSuccess: (next) => {
          onChange(next);
          if (next.status === "failed") toast.error(t("判定还是没有回来，过一会儿再试", "The judgement is still unavailable. Try again later."));
        },
        onError: (e) => toast.error(t(`没有判成：${errorMessage(e)}`, `Could not judge: ${errorMessage(e)}`)),
      });
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">{t("判定没有回来。这一句已经存下，不计次数，也不算错。", "The judgement is unavailable. Your sentence is saved and does not count as an attempt or a mistake.")}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={again}>
          {busy && <Loader2 className="animate-spin" />}
          {t("再判一次", "Judge again")}
        </Button>
      </div>
    );
  }

  const pass = result.outcome === "pass";
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="font-medium">{result.verdict && verdictLabel(result.verdict)}</span>
        {result.overturned && <span className="text-muted-foreground">{pass ? t("（你改成了：算用上）", " (You changed it to: counts as used)") : t("（你改成了：不算用上）", " (You changed it to: does not count as used)")}</span>}
      </p>
      {result.rewrites.map((r, i) => (
        <p key={i}>
          <span className="text-muted-foreground">{r.from}</span> → {r.to}
          <span className="block text-xs text-muted-foreground">{r.why}</span>
        </p>
      ))}
      {result.answer ? (
        <Answer {...result.answer} />
      ) : (
        result.intent && <p className="text-muted-foreground">{t("没用上要练的那个说法。给你一句提示再试：", "The target expression was not used. Try again with this cue: ")}{result.intent}</p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          overturn.mutate(
            { encounterId: result.encounterId, outcome: pass ? "fail" : "pass" },
            { onSuccess: (next) => onChange(next), onError: (e) => toast.error(t(`没有改成：${errorMessage(e)}`, `Could not change the result: ${errorMessage(e)}`)) },
          )
        }
      >
        {pass ? t("其实没用上", "I did not use it") : t("判错了，我用上了", "I used it; the judgement is wrong")}
      </Button>
    </div>
  );
}
