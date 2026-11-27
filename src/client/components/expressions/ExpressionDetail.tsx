import { useEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { DropdownMenu } from "radix-ui";
import { Ellipsis, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { useAnnotate, useDeleteExpression, useExpression, usePatchExpression, useReveal, useWritePassageNote } from "@/client/hooks/useExpressions";
import { ApiError } from "@/client/lib/api";
import {
  EXPRESSION_LIMITS, type Cue, type EncounterKind, type EncounterView, type ExpressionDetail, type ExpressionPatch, type IntentBy, type PassageNoteChange,
} from "@/shared/expressions";
import { AREA_CLASS, sourceLabel, verdictLabel, day } from "./shared";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import { ExpressionNotes } from "./ExpressionNotes";
import { PassageReader } from "./PassageReader";
import "./expression-detail.css";

/** Local time to the minute, as a datetime-local input takes it: the UTC form of the instant moved by the zone's offset. */
const localMinute = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

// Some imported notes consist entirely of the source labels and the original
// quoted verbatim. Only fold that exact format; keep any learner commentary visible.
function isSourceExcerpt(note: string | null, original: string | null) {
  if (!note || !original) return false;
  const match = /^例句性质：[^\n]+\n笔记摘录：([\s\S]+)\n原遇见日期未记录。$/.exec(note.replace(/\r\n/g, "\n").trim());
  return match?.[1] === original.replace(/\r\n/g, "\n");
}

/**
 * A text with its focus marked. Both come from the user or the model, so they
 * are only ever text nodes: nothing in them is read as markup.
 */
export function Marked({ text, mark, start }: { text: string; mark: string | null; start?: number }) {
  const at = mark ? start ?? text.toLowerCase().indexOf(mark.toLowerCase()) : -1;
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
        row.previousFocus !== undefined && (row.previousFocus ?? t("整句", "Whole sentence")),
        day(row.occurredAt ?? row.createdAt), t(...KIND_LABELS[row.kind]), tried && hint && t(...hint),
        tried && (row.outcome === "pass" ? t("算用上", "Counts as used") : row.outcome === "fail" ? t("不算", "Does not count") : t("没判", "Not judged")), said?.overturned && t("你改过", "Changed by you"),
        row.kind === "looked_up" && row.cue === "masked" && t("遮着给的", "Shown masked"), row.kind === "reveal" && row.cue !== "masked" && t("放弃", "Gave up"),
        row.sourceType && sourceLabel(row.sourceType), row.sourceTitle, row.sourceLocator,
      ].filter(Boolean).join(" · ")}
      {[
        // The first scene is already available alongside the original.
        !first && row.textBefore && `${t("上文：", "Context: ")}${row.textBefore}`,
        // A `met` row repeats the entry's own sentence unless it was met in other words.
        (row.kind !== "met" || row.text !== own) && row.text, row.myAttempt && `${t("试写：", "Your attempt: ")}${row.myAttempt}`, said && `${t("题面：", "Prompt: ")}${said.prompt}`,
        said?.status === "done" && verdictLabel(said.used ? "used" : said.conveyed ? "conveyed" : "missed"),
        ...(said?.rewrites ?? []).map((r) => `${r.from} → ${r.to}${t("（", " (")}${r.why}${t("）", ")")}`),
      ].map((line, i) => line && <span key={i} className="block pl-3">{line}</span>)}
    </li>
  );
}

function DetailToolbar({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <div className="expression-toolbar">
    <DialogTitle className="text-sm font-medium">{t("表达详情", "Expression details")}</DialogTitle>
    <div className="flex items-center gap-1">
      {children}
      <DialogClose asChild><Button size="icon" className="min-h-11 min-w-11" variant="ghost" aria-label={t("关闭", "Close")}><X aria-hidden="true" /></Button></DialogClose>
    </div>
  </div>;
}

function Detail({ e, glossing, draft, focusCue, unsavedRef, passageDirty, reload, onDeleted }: {
  e: ExpressionDetail; glossing: boolean; draft: boolean; focusCue: boolean; unsavedRef: RefObject<boolean>;
  passageDirty: RefObject<boolean>; reload: () => void; onDeleted: () => void;
}) {
  const { t } = useI18n();
  const patch = usePatchExpression();
  const annotate = useAnnotate();
  const reveal = useReveal();
  const remove = useDeleteExpression();
  const passage = useWritePassageNote();
  const [passageEditing, setPassageEditing] = useState(false);
  const busy = patch.isPending || remove.isPending || passage.isPending;
  const writing = busy || passageEditing;
  // What 看答案 answered with. Held here and nowhere else: the next read is
  // masked again, so leaving the dialog drops the answer, and another look is
  // another request, which writes another row.
  const [revealed, setRevealed] = useState<ExpressionDetail | null>(null);
  const full = revealed && e.masked && revealed.targetVersion === e.targetVersion ? revealed : e;
  const answerStart = useRef<HTMLElement>(null);
  const readingAnswer = full === revealed;
  useEffect(() => {
    if (readingAnswer) answerStart.current?.focus();
  }, [readingAnswer]);
  const when = e.occurredAt ?? e.createdAt;
  const [base, setBase] = useState(e);
  const [focusRange, setFocusRange] = useState(e.focusRange ?? null);
  const [note, setNote] = useState(e.note ?? "");
  const [focus, setFocus] = useState(e.focus ?? "");
  const [at, setAt] = useState(localMinute(when));
  const [editing, setEditing] = useState(false);
  const [cueEditing, setCueEditing] = useState(focusCue && !e.masked);
  const cueToggle = useRef<HTMLButtonElement>(null);
  const [customFocus, setCustomFocus] = useState(false);
  // After a reveal the local form still belongs to the masked entry. Read the
  // answer itself, without making its withheld fields editable or cacheable.
  const visibleFocus = e.masked ? full.focus : focus;
  const visibleRange = e.masked ? full.focusRange : focusRange;
  const visibleNote = e.masked ? full.note : note;
  const excerptOnly = isSourceExcerpt(e.masked ? full.note : base.note, full.text);
  const passageNotes = full.passageNotes ?? [];
  const original = full.text;
  const practiceOptions = original === null ? [] : passageNotes.map(({ start, end }) => ({ start, end, text: original.slice(start, end) })).filter((o) => o.text.length <= EXPRESSION_LIMITS.focus);
  const optionKey = (o: typeof practiceOptions[number]) => `${o.start}:${o.end}`;
  const selected = practiceOptions.find((o) => o.text === visibleFocus && (visibleRange == null || o.start === visibleRange.start));
  // Oldest first: the earliest `met` row is the scene the entry came from.
  const scene = full.timeline.find((row) => row.kind === "met");
  // What the user wanted to say when the entry was kept (the need in 找, their
  // own line above a pasted passage) is offered as its 提示句, on the one line
  // the field holds. Offered, not saved: left as it is, it is no edit, and only
  // 放进想用 sends it.
  const suggested = (e.masked ? "" : scene?.textBefore ?? "").replace(/\s+/g, " ").trim().slice(0, EXPRESSION_LIMITS.intent);
  const [intent, setIntent] = useState(e.intent ?? suggested);
  // Who wrote the 提示句 is kept with it: the kinds are compared by how often
  // they lead to a pass. One that 帮我起草 filled in is the AI's from then on,
  // however much of it was rewritten: the draft has been read.
  const [drafted, setDrafted] = useState(false);
  const changeFocus = (text: string, range: ExpressionDetail["focusRange"] = null) => {
    if (text === focus && range?.start === focusRange?.start) return;
    // A saved or model-drafted cue describes the previous practice target.
    if (intent === (base.intent ?? suggested) || drafted) setIntent("");
    setDrafted(false);
    setFocus(text);
    setFocusRange(range);
  };
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
  const focusChanged = focus !== (base.focus ?? "") || focusRange?.start !== base.focusRange?.start;
  const newIntent = (focusChanged || intent !== (base.intent ?? "")) && { intent: intent.trim() || null, intentBy };
  // Changing the focus clears the saved cue on the server. A nonempty cue
  // explicitly kept for the new target must travel even if its words match.
  const intentChanged = intent !== (base.intent ?? suggested) || (focusChanged && !!intent.trim());
  // Only what was changed is sent: an absent field is left alone, null clears it.
  const change = {
    ...(note !== (base.note ?? "") && { note: note.trim() || null }),
    ...(focusChanged && { focus: focus || null, focusRange }),
    ...(at !== localMinute(base.occurredAt ?? base.createdAt) && !Number.isNaN(Date.parse(at)) && { occurredAt: Date.parse(at) }),
    ...(intentChanged && { intent: intent.trim() || null, intentBy }),
  };
  const unsaved = Object.keys(change).length > 0;
  function loadFields(saved: ExpressionDetail) {
    setBase(saved);
    setFocusRange(saved.focusRange ?? null);
    setFocus(saved.focus ?? "");
    setNote(saved.note ?? "");
    setAt(localMinute(saved.occurredAt ?? saved.createdAt));
  }
  // An idle reader follows an edit from another tab. An editor keeps both
  // their draft and its revision so a conflicting save can still be rejected.
  if (e.updatedAt > base.updatedAt && !unsaved && !editing && !cueEditing && !writing) {
    loadFields(e);
    setIntent(e.intent ?? suggested);
    setCustomFocus(false);
    setDrafted(false);
  }
  useEffect(() => {
    unsavedRef.current = unsaved;
    return () => void (unsavedRef.current = false);
  }, [unsavedRef, unsaved]);
  // A change of layer takes what was typed with it: across the mask this view
  // is mounted afresh (see its key), and what was in its fields would be gone.
  const save = (more: ExpressionPatch = {}) => {
    const body = { ...change, ...more, expectedUpdatedAt: base.updatedAt };
    patch.mutate({ id: e.id, ...body }, {
      // Show what was stored, which is not always what was typed (trimmed).
      onSuccess: (saved) => {
        loadFields(saved);
        // Only when it was sent: a suggestion that was left alone stays in its field.
        if (body.intent !== undefined || body.focus !== undefined) {
          setIntent(saved.intent ?? "");
          setDrafted(false);
        }
        if (cueEditing) {
          setCueEditing(false);
          if (!more.status) cueToggle.current?.focus({ preventScroll: true });
        }
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

  const savePassage = (change: PassageNoteChange) => passage.mutateAsync({ id: e.id, ...change }, {
    onSuccess: (saved) => {
      // The note uses its own compare-and-swap. Advance the ordinary form's
      // revision only if none of its baseline fields changed in another tab.
      const fields = ["note", "focus", "intent", "intentBy", "status", "occurredAt", "targetVersion"] as const;
      if (fields.every((key) => saved[key] === base[key])
        && saved.focusRange?.start === base.focusRange?.start) setBase(saved);
    },
    onError: (err) => { if (err instanceof ApiError && err.status === 409) reload(); },
  });
  const editNote = !e.masked && <Button size="sm" className="min-h-11" variant="ghost" disabled={writing} aria-pressed={editing} onClick={() => setEditing(!editing)}>
    {editing ? t("预览笔记", "Preview notes") : visibleNote?.trim() ? t("编辑笔记", "Edit notes") : t("写笔记", "Add study note")}
  </Button>;
  const noteSection = full.text !== null && (visibleNote?.trim() || editing) && <section aria-label={excerptOnly ? t("原笔记摘录", "Original note excerpt") : t("学习笔记", "Study notes")}>
    <div className="expression-section-heading">
      <h4>{excerptOnly ? t("原笔记摘录", "Original note excerpt") : t("学习笔记", "Study notes")}</h4>
      {editNote}
    </div>
    {editing ? <label className="expression-editor block space-y-2 text-sm text-muted-foreground">
      {t("备注", "Note")}
      <textarea autoFocus disabled={writing} className={AREA_CLASS} rows={9} maxLength={EXPRESSION_LIMITS.note} value={note} onChange={(ev) => setNote(ev.target.value)} />
    </label> : visibleNote?.trim() && <ExpressionNotes text={visibleNote} />}
  </section>;

  const customSelected = customFocus || (!!focus && !selected);
  const showAnswer = () => reveal.mutate({ id: e.id, cue: "masked" }, {
    onSuccess: (answer) => { setCueEditing(false); setRevealed(answer); },
    onError: (err) => toast.error(t(`没有看成：${errorMessage(err)}`, `Could not reveal the answer: ${errorMessage(err)}`)),
  });
  const emptyCue = e.status === "seen"
    ? t("放进想用之前，先写一句提示句。", "Write a cue before moving this to To use.")
    : t("还没有提示句。", "No recall cue yet.");
  const cue = <div className="expression-cue">
    {cueEditing ? <div className="expression-cue-fields">
      {!e.masked && practiceOptions.length > 0 && <label>
        {t("练习焦点", "Practice focus")}
        <select className="passage-select" disabled={writing || annotate.isPending} value={customSelected ? "custom" : selected ? optionKey(selected) : ""} onChange={(ev) => {
          const key = ev.target.value;
          setCustomFocus(key === "custom");
          if (key === "custom") return;
          const option = practiceOptions.find((o) => optionKey(o) === key);
          changeFocus(option?.text ?? "", option ? { start: option.start, end: option.end } : null);
        }}>
          <option value="">{t("整句", "Whole sentence")}</option>
          {practiceOptions.map((o) => <option key={optionKey(o)} value={optionKey(o)}>{o.text}{practiceOptions.some((other) => other !== o && other.text === o.text) ? ` (${o.start + 1}–${o.end})` : ""}</option>)}
          <option value="custom">{t("自填焦点", "Custom focus")}</option>
        </select>
      </label>}
      {!e.masked && (!practiceOptions.length || customSelected) && <label>
        {practiceOptions.length ? t("自填焦点", "Custom focus") : t("练习焦点", "Practice focus")}
        <Input disabled={writing || annotate.isPending} placeholder={t("留空练整句，或填入原文中的词或短语", "Leave blank for the whole sentence, or enter a word or phrase from it")} maxLength={EXPRESSION_LIMITS.focus} value={focus} onChange={(ev) => changeFocus(ev.target.value)} />
      </label>}
      <label>
        {t("提示句：想说什么的时候该想起它，用你自己的话", "Cue: describe when you would use it, in your own words")}
        <Input autoFocus disabled={writing || annotate.isPending} maxLength={EXPRESSION_LIMITS.intent} value={intent} onChange={(ev) => setIntent(ev.target.value)} />
      </label>
      {/* An AI draft is offered only when enabled, and only for the saved target. */}
      {draft && !e.masked && <Button className="min-h-11 justify-self-start" size="sm" variant="outline" disabled={annotate.isPending || glossing || writing || focusChanged} onClick={drawUp}>{t("帮我起草", "Draft a cue")}</Button>}
    </div> : <>
      {!base.intent && suggested && intent === suggested && <p className="text-sm text-muted-foreground">{t("取自上文的提示", "Suggested cue from context")}</p>}
      {intent.trim() && <p className="expression-cue-text">{intent}</p>}
      {full.text !== null && <dl className="expression-practice-focus"><dt>{t("练习焦点", "Practice focus")}</dt><dd>{visibleFocus || t("整句", "Whole sentence")}</dd></dl>}
    </>}
    {!intent.trim() && <p className="text-sm text-muted-foreground">{emptyCue}</p>}
    <div className="expression-cue-actions">
      {full.text === null && <Button className="min-h-11" disabled={reveal.isPending || busy} onClick={showAnswer}>{t("看答案", "Show answer")}</Button>}
      {e.status === "seen" && <Button className="min-h-11" disabled={writing || !intent.trim()} onClick={() => save({ ...newIntent, status: "active" })}>{t("放进想用", "Move to To use")}</Button>}
      <Button ref={cueToggle} size="sm" className="expression-edit-cue" variant="link" disabled={writing} aria-expanded={cueEditing} onClick={() => setCueEditing(!cueEditing)}>
        {cueEditing ? t("预览提示", "Preview cue") : e.masked ? t("编辑提示句", "Edit cue") : t("编辑提示与焦点", "Edit cue and focus")}
      </Button>
      {e.status === "active" && <Button size="sm" className="min-h-11" variant="ghost" disabled={writing} onClick={() => save({ status: "seen" })}>{t("退回见过", "Move back to Seen")}</Button>}
    </div>
  </div>;

  const hasAnswer = full.text !== null;
  return <>
    <DetailToolbar>
      {(editing || cueEditing || unsaved) && <Button size="sm" className="min-h-11" disabled={writing || !unsaved} onClick={() => save()}>{t("保存", "Save changes")}</Button>}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button size="icon" className="min-h-11 min-w-11" variant="ghost" aria-label={t("更多", "More")}><Ellipsis aria-hidden="true" /></Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" sideOffset={4} className="expression-menu">
          <DropdownMenu.Item disabled={writing} onSelect={() => save({ status: e.status === "retired" ? "seen" : "retired" })}>
            {e.status === "retired" ? t("恢复", "Restore") : t("收起", "Archive")}
          </DropdownMenu.Item>
          <DropdownMenu.Item className="text-destructive" disabled={writing || annotate.isPending || reveal.isPending} onSelect={deleteEntry}>
            {t("永久删除", "Delete permanently")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </DetailToolbar>
    <article className="expression-reading">
      {full.text !== null ? <section ref={answerStart} tabIndex={-1} aria-label={t("原句", "Original sentence")}>
        <PassageReader text={full.text} notes={passageNotes} preferred={selected} busy={busy || annotate.isPending} save={e.masked ? undefined : savePassage}
          onEditing={setPassageEditing} dirtyRef={passageDirty} noteAction={!visibleNote?.trim() && !editing && editNote}>
          <Marked text={full.text} mark={visibleFocus} start={visibleRange?.start} />
        </PassageReader>
        {scene?.textBefore && <details className="reading-help">
          <summary>{t("查看上文", "Show context")}</summary>
          <p className="expression-context">{scene.textBefore}</p>
        </details>}
      </section> : <section className="expression-recall-first">
        <h3>{t("先回想这条表达", "Recall this expression")}</h3>
        {cue}
      </section>}
      {!excerptOnly && noteSection}
      {hasAnswer && <details className="reading-details expression-annotation" open>
        <summary><span>{t("补注", "Annotation")}<small>{t(" · AI 写的", " · Written by AI")}</small></span></summary>
        {full.gloss?.trim() ? <div className="expression-gloss">{full.gloss.split(/\r?\n/).filter((line) => line.trim()).map((line, i) => <p key={i}>{line}</p>)}</div>
          : glossing || annotate.isPending ? <p role="status">{t("补注中…", "Annotating…")}</p>
          : e.masked && e.annotated ? <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="text-sm text-muted-foreground">{t("补注已生成。", "Your annotation is ready.")}</p>
              <Button size="sm" className="min-h-11" variant="outline" disabled={reveal.isPending || busy} onClick={showAnswer}>{t("看含补注的答案", "Show answer with annotation")}</Button>
            </div>
          : <Button size="sm" className="min-h-11" variant="outline" disabled={writing || focusChanged} onClick={() => annotate.mutate(e.id, {
            onError: (err) => toast.error(t(`补注没有成功：${errorMessage(err)}`, `Annotation failed: ${errorMessage(err)}`)),
          })}>{t("生成补注", "Generate annotation")}</Button>}
      </details>}
      {hasAnswer && <details className="reading-details expression-practice" open>
        <summary>{t("回想与练习", "Recall and practice")}</summary>
        {cue}
      </details>}
      <div className="expression-meta">
        <details className="reading-details">
          <summary><span>{excerptOnly ? t("出处与原笔记", "Source and original note") : t("出处与时间", "Source and time")}</span><span className="expression-source-preview">{e.sourceTitle || sourceLabel(e.sourceType)}</span></summary>
          <div className="expression-source-content">
            <p>{t("出处：", "Source: ")}{sourceLabel(e.sourceType)}{e.sourceTitle && ` · ${e.sourceTitle}`} · {day(when)}</p>
            {scene?.sourceLocator && <p className="whitespace-pre-line">{scene.sourceLocator}</p>}
            {excerptOnly && noteSection}
            <label className="block space-y-2">
              {t("遇到的时间", "When you met it")}
              <Input type="datetime-local" disabled={writing} className="h-11 w-auto min-w-0 max-w-full" value={at} onChange={(ev) => setAt(ev.target.value)} />
            </label>
          </div>
        </details>
        <details className="reading-details">
          <summary>{t("学习记录", "Learning history")}</summary>
          {e.legacyHistory && <p>{t("旧记录缺少完整的分层时间，早期成绩是估算值。", "Early progress is estimated from incomplete historical dates.")}</p>}
          <ol className="space-y-2 pt-3 text-sm text-muted-foreground">
            {full.timeline.map((row) => <TimelineRow key={row.id} row={row} own={full.text} first={row === scene} />)}
          </ol>
        </details>
      </div>
    </article>
  </>;
}

function DraftGuard({ dirty, confirmDiscard }: { dirty: () => boolean; confirmDiscard: () => boolean }) {
  const blocker = useBlocker(({ nextLocation }) => nextLocation.pathname !== "/login" && dirty());
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (confirmDiscard()) blocker.proceed();
    else blocker.reset();
  }, [blocker, confirmDiscard]);
  useBeforeUnload((event) => {
    if (dirty()) { event.preventDefault(); event.returnValue = ""; }
  });
  return null;
}

export function ExpressionDetailDialog(props: { id: number | null; glossing: boolean; draft: boolean; focusCue?: boolean; onClose: () => void; onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"] }) {
  const { t } = useI18n();
  const { data, error, refetch } = useExpression(props.id);
  // A click beside the dialog closes it, but not at the cost of what was being typed in it.
  const unsavedRef = useRef(false);
  const passageDirty = useRef(false);
  const dirty = () => unsavedRef.current || passageDirty.current;
  const confirmDiscard = () => !dirty() || window.confirm(t("放弃未保存的编辑？", "Discard unsaved edits?"));
  return (
    <Dialog open={props.id !== null} onOpenChange={(open) => {
      if (!open && confirmDiscard()) { unsavedRef.current = false; passageDirty.current = false; props.onClose(); }
    }}>
      {props.id !== null && <DraftGuard dirty={dirty} confirmDiscard={confirmDiscard} />}
      <DialogContent className="expression-dialog" showCloseButton={false} aria-describedby={undefined} onCloseAutoFocus={props.onCloseAutoFocus} onInteractOutside={(ev) => (unsavedRef.current || passageDirty.current) && ev.preventDefault()}>
        {!data && <DetailToolbar />}
        {data ? (
          // Keyed by the layer's side of the mask as well: what was typed into, or revealed for, one side says nothing of the other.
          <Detail key={`${data.id}:${data.masked}`} e={data} glossing={props.glossing} draft={props.draft} focusCue={!!props.focusCue}
            unsavedRef={unsavedRef} passageDirty={passageDirty} reload={() => void refetch()} onDeleted={props.onClose} />
        ) : error ? (
          <p className="px-5 py-8 text-sm text-destructive md:px-9">{t("读取失败：", "Could not load: ")}{errorMessage(error)}</p>
        ) : (
          props.id !== null && <div role="status" className="flex min-h-40 items-center justify-center p-8">
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />
            <span className="sr-only">{t("读取中…", "Loading expression…")}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
