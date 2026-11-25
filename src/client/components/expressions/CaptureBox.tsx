import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { ApiError } from "@/client/lib/api";
import { useCapture, useMetAgain, usePick } from "@/client/hooks/useExpressions";
import { EXPRESSION_LIMITS, SOURCE_TYPES, type DuplicateResponse, type EncounterRequest, type PickResponse, type SourceType } from "@/shared/expressions";
import { DuplicateQuestion } from "./DuplicateQuestion";
import { PickList } from "./PickList";
import { AREA_CLASS, sourceLabel, readBox, useLastSource } from "./shared";
import { errorMessage, useI18n } from "@/client/lib/i18n";

/** A save the server held back: what was sent, and the entries it collides with. */
type Held = { met: EncounterRequest; focus?: string; existing: DuplicateResponse["existing"] };

export function CaptureBox({ onSaved }: { onSaved: (id: number) => void }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  // Prefill comes in the fragment (/#text=…&focus=…), never the query string:
  // a fragment is not sent to the server, so it reaches no access log.
  const [prefill] = useState(() => new URLSearchParams(location.hash.slice(1)));
  const [box, setBox] = useState(prefill.get("text") || prefill.get("focus") || "");
  const [given, setGiven] = useState(prefill.get("focus") ?? "");
  const [sel, setSel] = useState<[number, number]>([0, 0]);
  const [before, setBefore] = useState<string | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const { source } = useLastSource();
  const [title, setTitle] = useState("");
  const capture = useCapture();
  const metAgain = useMetAgain();
  const busy = capture.isPending || metAgain.isPending;
  // What the model picked out of the box: state of this page and gone with it.
  const [picks, setPicks] = useState<PickResponse["picks"] | null>(null);
  const picker = usePick();
  // While the model reads the box it holds still, and so does the button that
  // would empty it: picks are of no use for a box that has moved on.
  const waiting = picker.isPending;

  // Consume the fragment once on mount. It only fills the box: nothing is
  // ever submitted on the strength of a link.
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draft = readBox(box, sel[0], sel[1]);
  const focus = [draft.focus, given].find((f) => f && f !== draft.text && f.length <= EXPRESSION_LIMITS.focus);
  const tooLong = draft.text.length > EXPRESSION_LIMITS.text;
  const from = { sourceType: source ?? undefined, sourceTitle: (source && title.trim()) || undefined };

  // The selection is kept as state so that what 收下 will make of it (the
  // focus, or the 上文 field) is on screen before the click.
  const track = (el: HTMLTextAreaElement) => {
    setSel([el.selectionStart, el.selectionEnd]);
    setBefore(null);
  };
  const clear = () => {
    setBox("");
    setGiven("");
    setSel([0, 0]);
    setBefore(null);
    setHeld(null);
    setPicks(null);
  };
  const failed = (e: Error) => toast.error(t(`没有存上：${errorMessage(e)}`, `Could not save: ${errorMessage(e)}`));
  // One click chooses a tag, a second one clears it. Its title goes with it.
  const pick = (s: SourceType) => {
    useLastSource.setState({ source: source === s ? null : s });
    setTitle("");
  };

  const save = (met: EncounterRequest, withFocus: string | undefined, force?: true) =>
    capture.mutate({ ...met, focus: withFocus, force }, {
      onSuccess: (saved) => {
        clear();
        onSaved(saved.id);
      },
      // A 409 is a question, not a refusal: nothing was saved, and the text
      // stays in the box until the user says which of the two it is.
      onError: (e) =>
        e instanceof ApiError && e.code === "DUPLICATE"
          ? setHeld({ met, focus: withFocus, existing: (e.body as DuplicateResponse).existing ?? [] })
          : failed(e),
    });
  const submit = () =>
    save({
      text: draft.text,
      textBefore: (draft.before === undefined ? "" : (before ?? draft.before)).trim() || undefined,
      ...from,
    }, focus);
  const again = (id: number, met: EncounterRequest) =>
    metAgain.mutate({ id, ...met }, {
      onSuccess: () => {
        clear();
        toast.success(t("记下了：又一次遇到", "Saved: met it again"));
      },
      onError: failed,
    });

  // Sent as it is, not trimmed: a pick has to be found in the box word for word.
  const choose = () => {
    setPicks(null);
    picker.mutate(box, { onSuccess: (r) => setPicks(r.picks), onError: (e) => toast.error(t(`没有挑成：${errorMessage(e)}`, `Could not pick expressions: ${errorMessage(e)}`)) });
  };

  return (
    <section className="space-y-2">
      <details className="reading-help">
        <summary>{t("怎样留下原文与焦点", "How to save text and focus")}</summary>
        <p>{t("一句话里选中的是焦点，整句仍会保存。一段对话里选中的是要留下的原文，上文可以再改。", "Selecting part of one sentence marks its focus while keeping the whole sentence. Selecting from a conversation keeps that passage; you can edit its context.")}</p>
      </details>
      <textarea
        aria-label={t("原文", "Original text")}
        className={`${AREA_CLASS} min-h-[120px]`}
        placeholder={t("贴一句话，或一段对话。可以选中想记住的部分。", "Paste a sentence or a conversation. Select the part you want to remember.")}
        value={box}
        readOnly={waiting}
        onChange={(e) => {
          setBox(e.target.value);
          track(e.target);
          setHeld(null);
          setPicks(null);
        }}
        onSelect={(e) => track(e.currentTarget)}
      />
      {draft.before !== undefined && (
        <label className="block space-y-1 text-xs text-muted-foreground">
          {t("上文（选中的那一段是原文，这是它前面的一段，可改）", "Context before the selected passage (you can edit it)")}
          <textarea className={AREA_CLASS} rows={2} maxLength={EXPRESSION_LIMITS.text} value={before ?? draft.before} onChange={(e) => setBefore(e.target.value)} />
        </label>
      )}
      {tooLong && <p className="text-xs text-destructive">{t(`原文超过 ${EXPRESSION_LIMITS.text} 字。选中要收的那一段再收下。`, `The text exceeds ${EXPRESSION_LIMITS.text} characters. Select the passage you want to save.`)}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {SOURCE_TYPES.map((s) => (
          <Button key={s} size="sm" variant={source === s ? "default" : "outline"} aria-pressed={source === s} onClick={() => pick(s)}>
            {sourceLabel(s)}
            {source === s && <X />}
          </Button>
        ))}
        {source ? (
          <Input aria-label={t("出处", "Source")} className="h-8 w-40" placeholder={t("书名、片名…（可不填）", "Book, film, etc. (optional)")} maxLength={EXPRESSION_LIMITS.sourceTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
        ) : (
          <span className="text-xs text-muted-foreground">{sourceLabel(null)}</span>
        )}
        {focus && (
          <Button size="sm" variant="secondary" className="max-w-full" title={t("清掉焦点", "Clear focus")} onClick={() => { setGiven(""); setSel([0, 0]); }}>
            <span className="truncate">{t("焦点：", "Focus: ")}{focus}</span>
            <X />
          </Button>
        )}
        <div className="ml-auto flex gap-1.5">
          {box.trim().includes("\n") && (
            <Button variant="ghost" disabled={box.length > EXPRESSION_LIMITS.paste || waiting} onClick={choose}>
              {picker.isPending && <Loader2 className="animate-spin" />}
              {t("帮我挑", "Pick for me")}
            </Button>
          )}
          <Button disabled={!draft.text || tooLong || busy || waiting} onClick={submit}>
            {busy && <Loader2 className="animate-spin" />}
            {t("收下", "Save")}
          </Button>
        </div>
      </div>
      {/* Told, not stopped: it leaves through the provider the user set up themselves. */}
      <p className="text-xs text-muted-foreground">{t("「帮我挑」会把框里的整段对话发给你配置的模型。想说却说不出来的，去「对谈」里说。", "Pick for me sends the whole conversation in this box to your configured model. Use Conversation when you need help expressing an idea.")}</p>
      {held && (
        <DuplicateQuestion existing={held.existing} disabled={busy || waiting} onAgain={(id) => again(id, held.met)} onNew={() => save(held.met, held.focus, true)} />
      )}
      {picks && <PickList picks={picks} from={from} onSaved={onSaved} onClose={() => setPicks(null)} />}
    </section>
  );
}
