import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useJudge, useOverturn } from "@/client/hooks/useExpressions";
import type { AttemptResponse } from "@/shared/expressions";
import { Marked } from "./ExpressionDetail";
import { VERDICT_LABELS } from "./shared";

/** The English of an entry with its gloss, as a judgement or a reveal brought it. */
export function Answer({ text, focus, gloss }: NonNullable<AttemptResponse["answer"]>) {
  return (
    <div className="space-y-1 rounded-md bg-muted/50 p-3">
      <p className="whitespace-pre-line">
        <Marked text={text} mark={focus} />
      </p>
      {gloss && <p className="whitespace-pre-line text-xs text-muted-foreground">补注 · AI 写的：{gloss}</p>}
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
  const judge = useJudge();
  const overturn = useOverturn();
  const busy = judge.isPending || overturn.isPending;

  if (result.status === "failed") {
    const again = () =>
      judge.mutate(result.encounterId, {
        onSuccess: (next) => {
          onChange(next);
          if (next.status === "failed") toast.error("判定还是没有回来，过一会儿再试");
        },
        onError: (e) => toast.error(`没有判成：${e.message}`),
      });
    return (
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">判定没有回来。这一句已经存下，不计次数，也不算错。</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={again}>
          {busy && <Loader2 className="animate-spin" />}
          再判一次
        </Button>
      </div>
    );
  }

  const pass = result.outcome === "pass";
  return (
    <div className="space-y-2 text-sm">
      <p>
        <span className="font-medium">{result.verdict && VERDICT_LABELS[result.verdict]}</span>
        {result.overturned && <span className="text-muted-foreground">（你改成了：{pass ? "算用上" : "不算用上"}）</span>}
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
        result.intent && <p className="text-muted-foreground">没用上要练的那个说法。给你一句提示再试：{result.intent}</p>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() =>
          overturn.mutate(
            { encounterId: result.encounterId, outcome: pass ? "fail" : "pass" },
            { onSuccess: (next) => onChange(next), onError: (e) => toast.error(`没有改成：${e.message}`) },
          )
        }
      >
        {pass ? "其实没用上" : "判错了，我用上了"}
      </Button>
    </div>
  );
}
