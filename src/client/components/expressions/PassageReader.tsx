import { Fragment, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { PencilLine } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { ApiError } from "@/client/lib/api";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import { EXPRESSION_LIMITS, type PassageNote, type PassageNoteChange, type PassageNoteContent, type PassageRange } from "@/shared/expressions";
import { AREA_CLASS } from "./shared";

const rangeKey = (r: PassageRange) => `${r.start}-${r.end}`;
type Group = PassageRange & { notes: PassageNote[] };

// Intersecting ranges share one inline control: nested buttons would be
// inaccessible. Its margin offers each exact passage separately.
function groupRanges(notes: PassageNote[]) {
  const groups: Group[] = [];
  for (const note of notes) {
    const last = groups.at(-1);
    if (last && note.start < last.end) {
      last.end = Math.max(last.end, note.end);
      last.notes.push(note);
    } else {
      groups.push({ start: note.start, end: note.end, notes: [note] });
    }
  }
  return groups;
}

function selectedPassage(original: HTMLElement | null): PassageRange | null {
  const selection = window.getSelection();
  if (!original || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!original.contains(range.commonAncestorContainer) || !range.toString().trim()) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(original);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { start, end: start + range.toString().length };
}

// A textarea normalizes CRLF to LF; the immutable database text does not.
function originalOffset(text: string, offset: number) {
  let i = 0;
  for (let n = 0; n < offset; n++, i++) {
    if (text[i] === "\r" && text[i + 1] === "\n") i++;
  }
  return i;
}

function PassagePicker({ text, onPick, onCancel }: { text: string; onPick: (r: PassageRange) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const picker = useRef<HTMLTextAreaElement>(null);
  const [needsSelection, setNeedsSelection] = useState(false);
  function pickSelection() {
    const el = picker.current;
    if (!el) return;
    // Mobile selection handles can move without React dispatching onSelect.
    // Read the browser's native range at the moment the reader confirms it.
    if (el.value.slice(el.selectionStart, el.selectionEnd).trim()) {
      onPick({ start: originalOffset(text, el.selectionStart), end: originalOffset(text, el.selectionEnd) });
    } else {
      setNeedsSelection(true);
      el.focus();
    }
  }
  return <div className="passage-picker space-y-2">
    <label className="block space-y-2">
      <span className="text-sm font-medium">{t("选择原句中的片段", "Select a passage in the original")}</span>
      <textarea ref={picker} readOnly autoFocus rows={3} className={AREA_CLASS} value={text} />
    </label>
    {needsSelection && <p role="status" className="text-sm">{t("先选中想批注的文字。", "Select the words you want to annotate.")}</p>}
    <div className="passage-actions">
      <Button size="sm" onClick={pickSelection}>{t("批注选中片段", "Annotate selection")}</Button>
      <Button size="sm" variant="outline" onClick={() => onPick({ start: 0, end: text.length })}>{t("批注整句", "Annotate whole sentence")}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>{t("取消", "Cancel")}</Button>
    </div>
  </div>;
}

type SaveNote = (change: PassageNoteChange) => Promise<unknown>;
type Editing = { range: PassageRange; before: PassageNoteContent | null };

function PassageEditor({ text, edit, save, finish, busy, dirtyRef }: {
  text: string; edit: Editing; save: SaveNote; finish: (selection: PassageRange | null) => void; busy: boolean; dirtyRef: RefObject<boolean>;
}) {
  const { t } = useI18n();
  const { range, before } = edit;
  const [body, setBody] = useState(before?.body ?? "");
  const [examples, setExamples] = useState<[string, string] | null>(before?.examples ?? null);
  const [error, setError] = useState("");
  const dirty = body !== (before?.body ?? "") || examples?.[0] !== before?.examples?.[0] || examples?.[1] !== before?.examples?.[1];
  useEffect(() => {
    dirtyRef.current = dirty;
    return () => { dirtyRef.current = false; };
  }, [dirty, dirtyRef]);
  async function submit(after: PassageNoteContent | null) {
    setError("");
    try {
      await save({ ...range, before, after });
      finish(after ? range : null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "PASSAGE_NOTE_CHANGED"
        ? t("这条批注已在别处修改。可以复制这里的草稿，取消后查看最新内容。", "This note changed elsewhere. Copy your draft, then cancel to see the latest version.")
        : t(`批注保存失败：${errorMessage(err)}`, `Could not save this note: ${errorMessage(err)}`));
    }
  }
  return <fieldset className="passage-editor space-y-3" disabled={busy}>
    <legend className="passage-quote">{text.slice(range.start, range.end)}</legend>
    <label className="block space-y-1">
      <span className="text-sm font-medium">{t("我的理解", "My note")}</span>
      <textarea autoFocus className={AREA_CLASS} rows={3} maxLength={EXPRESSION_LIMITS.note} value={body} onChange={(ev) => setBody(ev.target.value)} />
    </label>
    {examples && <div className="space-y-2">{examples.map((example, i) => <label key={i} className="block space-y-1">
      <span className="text-sm">{t(`对照例句 ${i + 1}`, `Example ${i + 1}`)}</span>
      <textarea className={AREA_CLASS} rows={2} maxLength={EXPRESSION_LIMITS.note} value={example} onChange={(ev) => {
        const next: [string, string] = [...examples];
        next[i] = ev.target.value;
        setExamples(next);
      }} />
    </label>)}</div>}
    <button type="button" className="passage-link" onClick={() => setExamples(examples ? null : ["", ""])}>
      {examples ? t("移除对照例句", "Remove example pair") : t("加一组对照例句", "Add a pair of examples")}
    </button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="passage-actions">
      <Button size="sm" disabled={!body.trim() || examples?.some((line) => !line.trim())} onClick={() => void submit({
        body: body.trim(), examples: examples && [examples[0].trim(), examples[1].trim()],
      })}>{t("保存批注", "Save passage note")}</Button>
      <Button size="sm" variant="ghost" onClick={() => finish(range)}>{t("取消", "Cancel")}</Button>
      {before && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void submit(null)}>{t("删除批注", "Delete passage note")}</Button>}
    </div>
  </fieldset>;
}

export function PassageReader({ text, notes, preferred, children, save, busy, onEditing, dirtyRef, noteAction }: {
  text: string; notes: PassageNote[]; preferred?: PassageRange; children: ReactNode; save?: SaveNote; busy: boolean; onEditing: (value: boolean) => void; dirtyRef: RefObject<boolean>; noteAction?: ReactNode;
}) {
  const { t } = useI18n();
  const panelId = useId();
  const original = useRef<HTMLParagraphElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingSelection = useRef<PassageRange | null>(null);
  const [selected, setSelected] = useState("");
  const [edit, setEdit] = useState<Editing | "pick" | null>(null);
  const groups = groupRanges(notes);
  const active = notes.find((n) => rangeKey(n) === selected)
    ?? notes.find((n) => n.start === preferred?.start && n.end === preferred.end)
    ?? notes[0];
  const activeGroup = active && groups.find((group) => group.notes.includes(active));
  function begin(range: PassageRange | null) {
    const found = range && notes.find((n) => rangeKey(n) === rangeKey(range));
    setEdit(range ? { range: { start: range.start, end: range.end }, before: found ? { body: found.body, examples: found.examples } : null } : "pick");
    onEditing(true);
  }
  function finish(range: PassageRange | null) {
    if (range) setSelected(rangeKey(range));
    setEdit(null);
    onEditing(false);
    requestAnimationFrame(() => {
      const opener = original.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      (opener ?? addButton.current)?.focus({ preventScroll: true });
    });
  }

  if (edit === "pick") return <PassagePicker text={text} onPick={begin} onCancel={() => finish(null)} />;
  const hasMargin = !!(edit || active);
  const addNote = save && !edit && <Button ref={addButton} size="sm" variant="ghost" className="passage-write" disabled={busy}
    onPointerDown={() => { pendingSelection.current = selectedPassage(original.current); }}
    onClick={() => {
      begin(pendingSelection.current ?? selectedPassage(original.current));
      pendingSelection.current = null;
    }}>{!active && <PencilLine aria-hidden="true" />}{t("写批注", "Add passage note")}</Button>;
  return <div className={hasMargin ? "passage-reader has-margin" : "passage-reader"}>
    <div className="passage-source">
      <p ref={original} className="expression-original">
        {groups.length ? groups.map((group, i) => <Fragment key={rangeKey(group)}>
          {text.slice(i ? groups[i - 1].end : 0, group.start)}
          <button type="button" className="passage-mark" aria-controls={panelId} aria-pressed={group === activeGroup}
            disabled={!!edit} onClick={() => {
              if (!selectedPassage(original.current)) setSelected(rangeKey(group.notes[0]));
            }}>{group === activeGroup && active ? <>
              {text.slice(group.start, active.start)}<mark>{text.slice(active.start, active.end)}</mark>{text.slice(active.end, group.end)}
            </> : text.slice(group.start, group.end)}</button>
          {i === groups.length - 1 && text.slice(group.end)}
        </Fragment>) : children}
      </p>
    </div>
    {hasMargin && <aside id={panelId} className="passage-margin" aria-label={t("片段批注", "Passage note")}>
      {edit && save ? <PassageEditor text={text} edit={edit} save={save} finish={finish} busy={busy} dirtyRef={dirtyRef} /> : active && <>
        <div className="passage-margin-heading">
          <span>{t("片段批注", "Passage note")}</span>
          {save && <div className="passage-actions">
            <button type="button" disabled={busy} className="passage-link" aria-label={t("编辑批注", "Edit passage note")} onClick={() => begin(active)}>{t("编辑", "Edit")}</button>
            {addNote}
          </div>}
        </div>
        {activeGroup && activeGroup.notes.length > 1 && <select className="passage-select" aria-label={t("选择重叠片段", "Select overlapping passage")}
          value={rangeKey(active)} onChange={(ev) => setSelected(ev.target.value)}>
          {activeGroup.notes.map((n) => <option key={rangeKey(n)} value={rangeKey(n)}>{text.slice(n.start, n.end)}</option>)}
        </select>}
        <div aria-live="polite" aria-atomic="true">
          {(active.start !== 0 || active.end !== text.length) && <span className="sr-only">{text.slice(active.start, active.end)}</span>}
          <p className="passage-body">{active.body}</p>
          {active.examples && <figure className="passage-examples" aria-labelledby={`${panelId}-examples`}>
            <figcaption id={`${panelId}-examples`}>{t("对照例句", "Example pair")}</figcaption>
            {active.examples.map((line, i) => <p key={i}>{line}</p>)}
          </figure>}
        </div>
      </>}
    </aside>}
    {save && !edit && (!active || noteAction) && <div className="passage-actions passage-add">{!active && addNote}{noteAction}</div>}
  </div>;
}
