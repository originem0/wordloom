import { useEffect, useRef, useState, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { useAnnotate, useDeleteExpression, useExpression, usePatchExpression, useReveal } from "@/client/hooks/useExpressions";
import { ApiError } from "@/client/lib/api";
import {
  EXPRESSION_LIMITS, type Cue, type EncounterKind, type EncounterView, type ExpressionDetail, type ExpressionPatch, type IntentBy,
} from "@/shared/expressions";
import { AREA_CLASS, sourceLabel, verdictLabel, day } from "./shared";
import { errorMessage, useI18n } from "@/client/lib/i18n";

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

const KIND_LABELS: Record<EncounterKind, readonly [string, string]> = {
  met: ["遇到", "Met"], looked_up: ["找", "Looked up"], reveal: ["看答案", "Answer shown"], attempt: ["作答", "Attempted"], used: ["用出", "Used"],
};
// What had been on screen before an attempt was written.
const HINT_LABELS: Partial<Record<Cue, readonly [string, string]>> = {
  none: ["只有新情境", "Only a new situation"], need: ["有提示句", "Cue provided"], scene: ["看了原场景", "Original context shown"], revealed: ["看过答案", "Answer seen"],
};

/**
 * One row of the timeline: what happened, when and how it counted, then what
 * the row holds. Of a masked entry the server sends only the first of the two,
 * so nothing here has to decide what may be shown.
 */
function TimelineRow({ row, own, first }: { row: EncounterView; own: string | null; first: boolean }) {
  const { t } = useI18n();
  const tried = row.kind === "attempt";
  const said = row.feedback;
  const hint = row.cue ? HINT_LABELS[row.cue] : undefined;
  return (
    <li>
      {[
        day(row.occurredAt ?? row.createdAt), t(...KIND_LABELS[row.kind]), tried && hint && t(...hint),
        tried && (row.outcome === "pass" ? t("算用上", "Counts as used") : row.outcome === "fail" ? t("不算", "Does not count") : t("没判", "Not judged")), said?.overturned && t("你改过", "Changed by you"),
        row.kind === "looked_up" && row.cue === "masked" && t("遮着给的", "Shown masked"), row.kind === "reveal" && row.cue !== "masked" && t("放弃", "Gave up"),
        row.sourceType && sourceLabel(row.sourceType), row.sourceTitle, row.sourceLocator,
      ].filter(Boolean).join(" · ")}
      {[
        // What came before the scene the entry is from stands above its sentence, at the top of the dialog.
        !first && row.textBefore && `${t("上文：", "Context: ")}${row.textBefore}`,
        // A `met` row repeats the entry's own sentence unless it was met in other words.
        (row.kind !== "met" || row.text !== own) && row.text, row.myAttempt && `${t("试写：", "Your attempt: ")}${row.myAttempt}`, said && `${t("题面：", "Prompt: ")}${said.prompt}`,
        said?.status === "done" && verdictLabel(said.used ? "used" : said.conveyed ? "conveyed" : "missed"),
        ...(said?.rewrites ?? []).map((r) => `${r.from} → ${r.to}${t("（", " (")}${r.why}${t("）", ")")}`),
      ].map((line, i) => line && <span key={i} className="block pl-3">{line}</span>)}
    </li>
  );
}

function Detail({ e, glossing, draft, focusCue, unsavedRef, onDeleted }: { e: ExpressionDetail; glossing: boolean; draft: boolean; focusCue: boolean; unsavedRef: RefObject<boolean>; onDeleted: () => void }) {
  const { t } = useI18n();
  const patch = usePatchExpression();
  const annotate = useAnnotate();
  const reveal = useReveal();
  const remove = useDeleteExpression();
  const writing = patch.isPending || remove.isPending;
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
  const fill = (text: string) => {
    setIntent(text);
    setDrafted(true);
  };
  // An entry can have its gloss and still no intent of the AI's: one that gave
  // the target away was dropped. 帮我起草 is then the retry of 补注, which
  // fills only what is empty.
  const drawUp = () =>
    e.aiIntent
      ? fill(e.aiIntent)
      : annotate.mutate(e.id, {
          onSuccess: (now) => (now.aiIntent ? fill(now.aiIntent) : toast.info(t("这次没有起草出来：可以再点一次，或者自己写一句", "No cue was drafted. Try again or write one yourself."))),
          onError: (err) => toast.error(t(`没有起草成：${errorMessage(err)}`, `Could not draft a cue: ${errorMessage(err)}`)),
        });
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
      onError: (err) => toast.error(err instanceof ApiError && err.code === "INTENT_REQUIRED" ? t("先写一句提示句", "Write a cue first") : t(`没有改成：${errorMessage(err)}`, `Could not save changes: ${errorMessage(err)}`)),
    });
  };

  const deleteEntry = () => {
    if (!window.confirm(t("永久删除这条表达及其学习记录？删除后无法恢复。", "Permanently delete this expression and its learning history? This cannot be undone."))) return;
    remove.mutate(e.id, {
      onSuccess: () => { unsavedRef.current = false; onDeleted(); },
      onError: (err) => toast.error(t(`删除失败：${errorMessage(err)}`, `Could not delete: ${errorMessage(err)}`)),
    });
  };

  return (
    <div className="space-y-4 text-sm">
      {full.text === null ? (
        <Button size="sm" variant="outline" disabled={reveal.isPending || remove.isPending} onClick={() => reveal.mutate({ id: e.id, cue: "masked" }, { onSuccess: (answer) => setRevealed(answer), onError: (err) => toast.error(t(`没有看成：${errorMessage(err)}`, `Could not reveal the answer: ${errorMessage(err)}`)) })}>
          {t("看答案", "Show answer")}
        </Button>
      ) : (
        <div className="space-y-1">
          {scene?.textBefore && <p className="whitespace-pre-line text-xs text-muted-foreground">{scene.textBefore}</p>}
          <p className="whitespace-pre-line pr-10 text-base leading-relaxed">
            <Marked text={full.text} mark={full.focus} />
          </p>
        </div>
      )}
      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
        <label className="block space-y-2 text-sm text-muted-foreground">
          {t("提示句：想说什么的时候该想起它，用你自己的话", "Cue: describe when you would use it, in your own words")}
          <Input autoFocus={focusCue && !e.masked} maxLength={EXPRESSION_LIMITS.intent} value={intent} onChange={(ev) => setIntent(ev.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {e.status === "seen" && <Button className="min-h-11" disabled={writing || !intent.trim()} onClick={() => save({ ...newIntent, status: "active" })}>{t("放进想用", "Move to To use")}</Button>}
          {e.status === "active" && <Button className="min-h-11" variant="outline" disabled={writing} onClick={() => save({ status: "seen" })}>{t("退回见过", "Move back to Seen")}</Button>}
          {/* With the switch off the AI's cue must not leak into the user's own words. */}
          {draft && !e.masked && <Button className="min-h-11" size="sm" variant="outline" disabled={annotate.isPending || glossing || remove.isPending} onClick={drawUp}>{t("帮我起草", "Draft a cue")}</Button>}
        </div>
        {e.status === "seen" && <p className="text-sm text-muted-foreground">{intent.trim() ? t("放进想用后，隔一天再来试写一句。", "Move it to To use, then return after a day to try a sentence.") : t("放进想用之前，先写一句提示句。", "Write a cue before moving this to To use.")}</p>}
      </div>
      <details className="reading-details">
        <summary>{t("备注与出处", "Notes and source")}</summary>
        <div className="space-y-4 pt-3">
      {/* An entry in 想用 is not edited: its focus and note are not here to edit. After 看答案 they are shown, read-only. */}
      {!e.masked && (
        <>
          <label className="block space-y-1 text-xs text-muted-foreground">
            {t("焦点", "Focus")}
            <Input placeholder={t("原文里要记住的那个词或短语", "The word or phrase to remember")} maxLength={EXPRESSION_LIMITS.focus} value={focus} onChange={(ev) => setFocus(ev.target.value)} />
          </label>
          <label className="block space-y-1 text-xs text-muted-foreground">
            {t("备注", "Note")}
            <textarea className={AREA_CLASS} rows={3} maxLength={EXPRESSION_LIMITS.note} value={note} onChange={(ev) => setNote(ev.target.value)} />
          </label>
        </>
      )}
      {revealed?.note && <p className="whitespace-pre-line"><span className="text-xs text-muted-foreground">{t("备注：", "Note: ")}</span>{revealed.note}</p>}
      {/* The gloss never leads: it sits below the original and the user's own note, and says who wrote it. */}
      {(full.gloss || !e.masked) && (
        <div className="space-y-1 rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">{t("补注 · AI 写的", "Annotation · Written by AI")}</p>
          {full.gloss ? (
            <p className="whitespace-pre-line">{full.gloss}</p>
          ) : glossing ? (
            <p className="text-muted-foreground">{t("补注中…", "Annotating…")}</p>
          ) : (
            !e.annotated && (
              <Button size="sm" variant="outline" disabled={annotate.isPending || remove.isPending} onClick={() => annotate.mutate(e.id, { onError: (err) => toast.error(t(`补注没有成功：${errorMessage(err)}`, `Annotation failed: ${errorMessage(err)}`)) })}>
                {annotate.isPending && <Loader2 className="animate-spin" />}
                {t("补注", "Annotate")}
              </Button>
            )
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {t("出处：", "Source: ")}{sourceLabel(e.sourceType)}
          {e.sourceTitle && ` · ${e.sourceTitle}`}
          {scene?.sourceLocator && ` · ${scene.sourceLocator}`}
        </span>
        <label className="flex flex-wrap items-center gap-2">
          {t("遇到的时间", "When you met it")}
          <Input type="datetime-local" className="h-11 min-w-0 max-w-full" value={at} onChange={(ev) => setAt(ev.target.value)} />
        </label>
      </div>
        </div>
      </details>
      <details className="reading-details">
        <summary>{t("学习记录", "Learning history")}</summary>
      <ol className="space-y-2 pt-3 text-sm text-muted-foreground">
        {full.timeline.map((row) => <TimelineRow key={row.id} row={row} own={full.text} first={row === scene} />)}
      </ol>
      </details>
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="min-h-11" variant="outline" disabled={writing} onClick={() => save({ status: e.status === "retired" ? "seen" : "retired" })}>
            {e.status === "retired" ? t("恢复", "Restore") : t("收起", "Archive")}
          </Button>
          <Button size="sm" className="min-h-11" variant="destructive" disabled={writing || annotate.isPending || reveal.isPending} onClick={deleteEntry}>
            {remove.isPending ? t("删除中…", "Deleting…") : t("永久删除", "Delete permanently")}
          </Button>
        </div>
        <Button size="sm" className="min-h-11" disabled={writing || !unsaved} onClick={() => save()}>{t("保存", "Save changes")}</Button>
      </div>
    </div>
  );
}

export function ExpressionDetailDialog(props: { id: number | null; glossing: boolean; draft: boolean; focusCue?: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { data, error } = useExpression(props.id);
  // A click beside the dialog closes it, but not at the cost of what was being typed in it.
  const unsavedRef = useRef(false);
  return (
    <Dialog open={props.id !== null} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto" aria-describedby={undefined} onInteractOutside={(ev) => unsavedRef.current && ev.preventDefault()}>
        <DialogTitle className="sr-only">{t("表达详情", "Expression details")}</DialogTitle>
        {data ? (
          // Keyed by the layer's side of the mask as well: what was typed into, or revealed for, one side says nothing of the other.
          <Detail key={`${data.id}:${data.masked}`} e={data} glossing={props.glossing} draft={props.draft} focusCue={!!props.focusCue} unsavedRef={unsavedRef} onDeleted={props.onClose} />
        ) : error ? (
          <p className="text-sm text-destructive">{t("读取失败：", "Could not load: ")}{errorMessage(error)}</p>
        ) : (
          props.id !== null && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        )}
      </DialogContent>
    </Dialog>
  );
}
