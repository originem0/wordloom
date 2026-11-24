import { useEffect, useRef, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { useAnnotate, useExpression, usePatchExpression, useReveal } from "@/client/hooks/useExpressions";
import { ApiError } from "@/client/lib/api";
import {
  EXPRESSION_LIMITS, type Cue, type EncounterKind, type EncounterView, type ExpressionDetail, type ExpressionPatch, type IntentBy,
} from "@/shared/expressions";
import { AREA_CLASS, SOURCE_LABELS, VERDICT_LABELS, day } from "./shared";

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

const KIND_LABELS: Record<EncounterKind, string> = { met: "遇到", looked_up: "找", reveal: "看答案", attempt: "作答", used: "用出" };
// What had been on screen before an attempt was written.
const HINT_LABELS: Partial<Record<Cue, string>> = { none: "只有新情境", need: "有提示句", scene: "看了原场景", revealed: "看过答案" };

/**
 * One row of the timeline: what happened, when and how it counted, then what
 * the row holds. Of a masked entry the server sends only the first of the two,
 * so nothing here has to decide what may be shown.
 */
function TimelineRow({ row, own }: { row: EncounterView; own: string | null }) {
  const tried = row.kind === "attempt";
  const said = row.feedback;
  return (
    <li>
      {[
        day(row.occurredAt ?? row.createdAt), KIND_LABELS[row.kind], tried && row.cue && HINT_LABELS[row.cue],
        tried && (row.outcome === "pass" ? "算用上" : row.outcome === "fail" ? "不算" : "没判"), said?.overturned && "你改过",
        row.kind === "looked_up" && row.cue === "masked" && "遮着给的", row.kind === "reveal" && row.cue !== "masked" && "放弃",
        row.sourceType && SOURCE_LABELS[row.sourceType], row.sourceTitle,
      ].filter(Boolean).join(" · ")}
      {[
        // A `met` row repeats the entry's own sentence unless it was met in other words.
        (row.kind !== "met" || row.text !== own) && row.text, row.myAttempt && `试写：${row.myAttempt}`, said && `题面：${said.prompt}`,
        said?.status === "done" && VERDICT_LABELS[said.used ? "used" : said.conveyed ? "conveyed" : "missed"],
        ...(said?.rewrites ?? []).map((r) => `${r.from} → ${r.to}（${r.why}）`),
      ].map((line, i) => line && <span key={i} className="block pl-3">{line}</span>)}
    </li>
  );
}

function Detail({ e, glossing, draft, unsavedRef }: { e: ExpressionDetail; glossing: boolean; draft: boolean; unsavedRef: RefObject<boolean> }) {
  const patch = usePatchExpression();
  const annotate = useAnnotate();
  const reveal = useReveal();
  // What 看答案 answered with. Held here and nowhere else: the next read is
  // masked again, so leaving the dialog drops the answer, and another look is
  // another request, which writes another row.
  const [revealed, setRevealed] = useState<ExpressionDetail | null>(null);
  const full = revealed ?? e;
  const when = e.occurredAt ?? e.createdAt;
  const [note, setNote] = useState(e.note ?? "");
  const [focus, setFocus] = useState(e.focus ?? "");
  const [at, setAt] = useState(localMinute(when));
  // Oldest first: the earliest `met` row is the scene the entry came from.
  const scene = full.timeline.find((row) => row.kind === "met");
  // What the user wanted to say when the entry was kept (the need in 找, their
  // own line above a pasted passage) is offered as its 提示句, on the one line
  // the field holds. Offered, not saved: left as it is, it is no edit, and only
  // 放进想用 sends it.
  const suggested = (scene?.textBefore ?? "").replace(/\s+/g, " ").trim().slice(0, EXPRESSION_LIMITS.intent);
  const [intent, setIntent] = useState(e.intent ?? suggested);
  // Who wrote the 提示句 is kept with it: the kinds are compared by how often
  // they lead to a pass. One that 帮我起草 filled in is the AI's from then on,
  // however much of it was rewritten: the draft has been read.
  const [drafted, setDrafted] = useState(false);
  const intentBy: IntentBy =
    drafted || e.intentBy === "ai" ? "ai" : suggested && intent === suggested ? (e.sourceType === "find" ? "find" : "paste") : "self";
  const newIntent = intent !== (e.intent ?? "") && { intent: intent.trim() || null, intentBy };
  // Only what was changed is sent: an absent field is left alone, null clears it.
  const change = {
    ...(note !== (e.note ?? "") && { note: note.trim() || null }),
    ...(focus !== (e.focus ?? "") && { focus: focus.trim() || null }),
    ...(at !== localMinute(when) && !Number.isNaN(Date.parse(at)) && { occurredAt: Date.parse(at) }),
    ...(intent !== (e.intent ?? suggested) && newIntent),
  };
  const unsaved = Object.keys(change).length > 0;
  useEffect(() => {
    unsavedRef.current = unsaved;
    return () => void (unsavedRef.current = false);
  }, [unsavedRef, unsaved]);
  // A change of layer takes what was typed with it: across the mask this view
  // is mounted afresh (see its key), and what was in its fields would be gone.
  const save = (more: ExpressionPatch = {}) => {
    const body = { ...change, ...more };
    patch.mutate({ id: e.id, ...body }, {
      // Show what was stored, which is not always what was typed (trimmed).
      onSuccess: (saved) => {
        setNote(saved.note ?? "");
        setFocus(saved.focus ?? "");
        setAt(localMinute(saved.occurredAt ?? saved.createdAt));
        // Only when it was sent: a suggestion that was left alone stays in its field.
        if (body.intent !== undefined) setIntent(saved.intent ?? "");
      },
      onError: (err) => toast.error(err instanceof ApiError && err.code === "INTENT_REQUIRED" ? "先写一句提示句" : `没有改成：${err.message}`),
    });
  };

  return (
    <div className="space-y-4 text-sm">
      {full.text === null ? (
        <Button size="sm" variant="outline" disabled={reveal.isPending} onClick={() => reveal.mutate({ id: e.id, cue: "masked" }, { onSuccess: (answer) => setRevealed(answer), onError: (err) => toast.error(`没有看成：${err.message}`) })}>
          看答案
        </Button>
      ) : (
        <div className="space-y-1">
          {scene?.textBefore && <p className="whitespace-pre-line text-xs text-muted-foreground">{scene.textBefore}</p>}
          <p className="whitespace-pre-line text-base leading-relaxed">
            <Marked text={full.text} mark={full.focus} />
          </p>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="block flex-1 space-y-1 text-xs text-muted-foreground">
          提示句：想说什么的时候该想起它，用你自己的话
          <Input maxLength={EXPRESSION_LIMITS.intent} value={intent} onChange={(ev) => setIntent(ev.target.value)} />
        </label>
        {/* While the switch is off the AI's intent is not on screen in any form: it would end up in the prompts the user writes. */}
        {draft && e.aiIntent && (
          <Button size="sm" variant="outline" onClick={() => { setIntent(e.aiIntent ?? ""); setDrafted(true); }}>帮我起草</Button>
        )}
      </div>
      {/* An entry in 想用 is not edited: its focus and note are not here to edit. After 看答案 they are shown, read-only. */}
      {!e.masked && (
        <>
          <label className="block space-y-1 text-xs text-muted-foreground">
            焦点
            <Input placeholder="原文里要记住的那个词或短语" maxLength={EXPRESSION_LIMITS.focus} value={focus} onChange={(ev) => setFocus(ev.target.value)} />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            备注
            <textarea className={AREA_CLASS} rows={3} maxLength={EXPRESSION_LIMITS.note} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </label>
        </>
      )}
      {revealed?.note && <p className="whitespace-pre-line"><span className="text-xs text-muted-foreground">备注：</span>{revealed.note}</p>}
      {/* The gloss never leads: it sits below the original and the user's own note, and says who wrote it. */}
      {(full.gloss || !e.masked) && (
        <div className="space-y-1 rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">补注 · AI 写的</p>
          {full.gloss ? (
            <p className="whitespace-pre-line">{full.gloss}</p>
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
        </div>
      )}
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
        {full.timeline.map((row) => <TimelineRow key={row.id} row={row} own={full.text} />)}
      </ol>
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {e.status === "seen" && <Button size="sm" variant="secondary" disabled={patch.isPending || !intent.trim()} onClick={() => save({ ...newIntent, status: "active" })}>放进想用</Button>}
          {e.status === "active" && <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => save({ status: "seen" })}>退回见过</Button>}
          <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => save({ status: e.status === "retired" ? "seen" : "retired" })}>
            {e.status === "retired" ? "恢复" : "收起"}
          </Button>
        </div>
        <Button size="sm" disabled={patch.isPending || !unsaved} onClick={() => save()}>保存</Button>
      </div>
      {e.status === "seen" && !intent.trim() && <p className="text-xs text-muted-foreground">放进想用之前，先写一句提示句。</p>}
    </div>
  );
}

export function ExpressionDetailDialog(props: { id: number | null; glossing: boolean; draft: boolean; onClose: () => void }) {
  const { data, error } = useExpression(props.id);
  // A click beside the dialog closes it, but not at the cost of what was being typed in it.
  const unsavedRef = useRef(false);
  return (
    <Dialog open={props.id !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined} onInteractOutside={(ev) => unsavedRef.current && ev.preventDefault()}>
        <DialogTitle className="sr-only">表达详情</DialogTitle>
        {data ? (
          // Keyed by the layer's side of the mask as well: what was typed into, or revealed for, one side says nothing of the other.
          <Detail key={`${data.id}:${data.masked}`} e={data} glossing={props.glossing} draft={props.draft} unsavedRef={unsavedRef} />
        ) : error ? (
          <p className="text-sm text-destructive">读取失败：{error.message}</p>
        ) : (
          props.id !== null && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        )}
      </DialogContent>
    </Dialog>
  );
}
