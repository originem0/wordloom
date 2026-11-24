import { useEffect, useRef, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { useAnnotate, useExpression, usePatchExpression } from "@/client/hooks/useExpressions";
import { EXPRESSION_LIMITS, type ExpressionDetail } from "@/shared/expressions";
import { AREA_CLASS, SOURCE_LABELS, day, titleOf } from "./shared";

/** Local time to the minute, as a datetime-local input takes it: the UTC form of the instant moved by the zone's offset. */
const localMinute = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * A text with its focus marked. Both come from the user or the model, so they
 * are only ever text nodes: nothing in them is read as markup.
 */
export function Marked({ text, mark }: { text: string; mark: string | null }) {
  const at = mark ? text.toLowerCase().indexOf(mark.toLowerCase()) : -1;
  if (!mark || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-400/30">{text.slice(at, at + mark.length)}</mark>
      {text.slice(at + mark.length)}
    </>
  );
}

function Detail({ e, glossing, unsavedRef }: { e: ExpressionDetail; glossing: boolean; unsavedRef: RefObject<boolean> }) {
  const patch = usePatchExpression();
  const annotate = useAnnotate();
  const when = e.occurredAt ?? e.createdAt;
  const [note, setNote] = useState(e.note ?? "");
  const [focus, setFocus] = useState(e.focus ?? "");
  const [at, setAt] = useState(localMinute(when));
  // Oldest first: the earliest `met` row is the scene the entry came from.
  const scene = e.timeline.find((row) => row.kind === "met");
  // Only what was changed is sent: an absent field is left alone, null clears it.
  const change = {
    ...(note !== (e.note ?? "") && { note: note.trim() || null }),
    ...(focus !== (e.focus ?? "") && { focus: focus.trim() || null }),
    ...(at !== localMinute(when) && !Number.isNaN(Date.parse(at)) && { occurredAt: Date.parse(at) }),
  };
  const unsaved = Object.keys(change).length > 0;
  useEffect(() => {
    unsavedRef.current = unsaved;
    return () => void (unsavedRef.current = false);
  }, [unsavedRef, unsaved]);
  const failed = (err: Error) => toast.error(`没有改成：${err.message}`);
  const commit = () =>
    patch.mutate({ id: e.id, ...change }, {
      // Show what was stored, which is not always what was typed (trimmed).
      onSuccess: (saved) => {
        setNote(saved.note ?? "");
        setFocus(saved.focus ?? "");
        setAt(localMinute(saved.occurredAt ?? saved.createdAt));
      },
      onError: failed,
    });

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1">
        {scene?.textBefore && <p className="whitespace-pre-line text-xs text-muted-foreground">{scene.textBefore}</p>}
        <p className="whitespace-pre-line text-base leading-relaxed">
          <Marked text={titleOf(e)} mark={e.text ? e.focus : null} />
        </p>
        {e.text && e.intent && <p className="text-muted-foreground">{e.intent}</p>}
      </div>
      <label className="block space-y-1 text-xs text-muted-foreground">
        焦点
        <Input placeholder="原文里要记住的那个词或短语" maxLength={EXPRESSION_LIMITS.focus} value={focus} onChange={(ev) => setFocus(ev.target.value)} />
      </label>
      <label className="block space-y-1 text-xs text-muted-foreground">
        备注
        <textarea className={AREA_CLASS} rows={3} maxLength={EXPRESSION_LIMITS.note} value={note} onChange={(ev) => setNote(ev.target.value)} />
      </label>
      {/* The gloss never leads: it sits below the original and the user's own note, and says who wrote it. */}
      <div className="space-y-1 rounded-md bg-muted/50 p-3">
        <p className="text-xs text-muted-foreground">补注 · AI 写的</p>
        {e.gloss ? (
          <p className="whitespace-pre-line">{e.gloss}</p>
        ) : glossing ? (
          <p className="text-muted-foreground">补注中…</p>
        ) : (
          !e.annotated && (
            <Button size="sm" variant="outline" disabled={annotate.isPending} onClick={() => annotate.mutate(e.id, { onError: (err) => toast.error(`补注没有成功：${err.message}`) })}>
              {annotate.isPending && <Loader2 className="animate-spin" />}
              补注
            </Button>
          )
        )}
        {e.aiIntent && <p className="text-xs text-muted-foreground">想说的意思：{e.aiIntent}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          出处：{e.sourceType ? SOURCE_LABELS[e.sourceType] : "未记录"}
          {e.sourceTitle && ` · ${e.sourceTitle}`}
          {scene?.sourceLocator && ` · ${scene.sourceLocator}`}
        </span>
        <label className="flex items-center gap-2">
          遇到的时间
          <Input type="datetime-local" className="h-8 w-auto" value={at} onChange={(ev) => setAt(ev.target.value)} />
        </label>
      </div>
      <ol className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
        {e.timeline.map((row) => (
          <li key={row.id}>
            {day(row.occurredAt ?? row.createdAt)} · {row.kind === "met" ? "遇到" : row.kind}
            {row.sourceType && ` · ${SOURCE_LABELS[row.sourceType]}`}
            {row.sourceTitle && ` · ${row.sourceTitle}`}
            {row.text && row.text !== e.text && `：${row.text}`}
          </li>
        ))}
      </ol>
      <div className="flex justify-between gap-2">
        <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => patch.mutate({ id: e.id, status: e.status === "retired" ? "seen" : "retired" }, { onError: failed })}>
          {e.status === "retired" ? "恢复" : "收起"}
        </Button>
        <Button size="sm" disabled={patch.isPending || !unsaved} onClick={commit}>保存</Button>
      </div>
    </div>
  );
}

export function ExpressionDetailDialog(props: { id: number | null; glossing: boolean; onClose: () => void }) {
  const { data, error } = useExpression(props.id);
  // A click beside the dialog closes it, but not at the cost of what was being typed in it.
  const unsavedRef = useRef(false);
  return (
    <Dialog open={props.id !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined} onInteractOutside={(ev) => unsavedRef.current && ev.preventDefault()}>
        <DialogTitle className="sr-only">表达详情</DialogTitle>
        {data ? (
          <Detail key={data.id} e={data} glossing={props.glossing} unsavedRef={unsavedRef} />
        ) : error ? (
          <p className="text-sm text-destructive">读取失败：{error.message}</p>
        ) : (
          props.id !== null && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        )}
      </DialogContent>
    </Dialog>
  );
}
