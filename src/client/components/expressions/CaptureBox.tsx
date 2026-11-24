import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { ApiError } from "@/client/lib/api";
import { useCapture, useFind, useMetAgain, usePick } from "@/client/hooks/useExpressions";
import {
  EXPRESSION_LIMITS, FIND_HISTORY_TURNS, SOURCE_TYPES, type DuplicateResponse, type EncounterRequest, type FindTurn, type PickResponse, type SourceType,
} from "@/shared/expressions";
import { FindThread, type Turn } from "./FindThread";
import { PickList } from "./PickList";
import { AREA_CLASS, SOURCE_LABELS, day, readBox, titleOf, useLastSource } from "./shared";

/** A save the server held back: what was sent, and the entries it collides with. */
type Held = { met: EncounterRequest; focus?: string; existing: DuplicateResponse["existing"] };

// An earlier turn as it is sent back with the next question: the server keeps
// no session, so this is all the model is told of it. A suggestion is cut to
// the length the server takes back, or one long one would refuse the thread.
const recall = ({ need, attempt, answer }: Turn): FindTurn => ({
  need,
  attempt,
  mine: answer.mine.map((h) => h.expression.id),
  fix: answer.fix?.text.slice(0, EXPRESSION_LIMITS.attempt) ?? null,
  fresh: answer.fresh.map((s) => s.text.slice(0, EXPRESSION_LIMITS.attempt)),
});

export function CaptureBox({ onSaved }: { onSaved: (id: number) => void }) {
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
  // The box is also where a question is asked. A thread is the turns asked so
  // far and the time of the first, which is all that identifies it; like the
  // picks, it is state of this page and gone with it.
  const [own, setOwn] = useState("");
  const [thread, setThread] = useState<{ at: number; turns: Turn[] } | null>(null);
  const [picks, setPicks] = useState<PickResponse["picks"] | null>(null);
  const find = useFind();
  const picker = usePick();
  // While a model reads the box it holds still, and so does every button that
  // would empty it: an answer empties it, a failure has to find it as it was
  // sent, and picks are of no use for a box that has moved on.
  const waiting = find.isPending || picker.isPending;

  // Consume the fragment once on mount. It only fills the box: nothing is
  // ever submitted on the strength of a link.
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draft = readBox(box, sel[0], sel[1]);
  const focus = [draft.focus, given].find((f) => f && f !== draft.text && f.length <= EXPRESSION_LIMITS.focus);
  const tooLong = draft.text.length > EXPRESSION_LIMITS.text;
  // A question is the whole box: the selection is for 收下 only.
  const need = box.trim();
  const askable = need.length > 0 && need.length <= EXPRESSION_LIMITS.need;
  const from = { sourceType: source ?? undefined, sourceTitle: (source && title.trim()) || undefined };

  // The selection is kept as state so that what 收下 will make of it (the
  // focus, or the 上文 field) is on screen before the click.
  const track = (el: HTMLTextAreaElement) => {
    setSel([el.selectionStart, el.selectionEnd]);
    setBefore(null);
  };
  const clear = () => {
    setBox("");
    setOwn("");
    setGiven("");
    setSel([0, 0]);
    setBefore(null);
    setHeld(null);
    setPicks(null);
  };
  const failed = (e: Error) => toast.error(`没有存上：${e.message}`);
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
        toast.success("记下了：又一次遇到");
      },
      onError: failed,
    });

  const ask = () => {
    // The clock is read at a click, not during render. The rule reports any
    // function a rendered element holds, its handlers included.
    // eslint-disable-next-line react-hooks/purity
    const at = thread?.at ?? Date.now();
    const turns = thread?.turns ?? [];
    const attempt = own.trim() || undefined;
    // The opening turn says what the thread is about and the latest ones where
    // it stands; what lies between is left out.
    const told = turns.length > FIND_HISTORY_TURNS ? [turns[0], ...turns.slice(1 - FIND_HISTORY_TURNS)] : turns;
    find.mutate({ need, attempt, history: told.map(recall), turn: turns.length + 1, thread: at }, {
      onSuccess: (answer) => {
        clear();
        setThread({ at, turns: [...turns, { need, attempt, answer }] });
      },
      // Nothing was written: the question stays in the box, to be sent again as it is.
      onError: (e) => toast.error(`没有问成：${e.message}`),
    });
  };
  // Sent as it is, not trimmed: a pick has to be found in the box word for word.
  const choose = () => {
    setPicks(null);
    picker.mutate(box, { onSuccess: (r) => setPicks(r.picks), onError: (e) => toast.error(`没有挑成：${e.message}`) });
  };

  return (
    <section className="space-y-2">
      <textarea
        aria-label="原文"
        className={`${AREA_CLASS} min-h-[120px]`}
        placeholder="贴一句话，或一段对话。先选中一部分再收下：一句话里选中的是焦点，一段对话里选中的是原文。"
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
      {askable && (
        <label className="block space-y-1 text-xs text-muted-foreground">
          我自己的英文（只在「问」时用，可不填）
          <Input className="h-8" maxLength={EXPRESSION_LIMITS.attempt} readOnly={waiting} value={own} onChange={(e) => setOwn(e.target.value)} />
        </label>
      )}
      {draft.before !== undefined && (
        <label className="block space-y-1 text-xs text-muted-foreground">
          上文（选中的那一段是原文，这是它前面的一段，可改）
          <textarea className={AREA_CLASS} rows={2} maxLength={EXPRESSION_LIMITS.text} value={before ?? draft.before} onChange={(e) => setBefore(e.target.value)} />
        </label>
      )}
      {tooLong && <p className="text-xs text-destructive">原文超过 {EXPRESSION_LIMITS.text} 字。选中要收的那一段再收下。</p>}
      {need.length > EXPRESSION_LIMITS.need && <p className="text-xs text-muted-foreground">超过 {EXPRESSION_LIMITS.need} 字的不能拿来问。</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {SOURCE_TYPES.map((s) => (
          <Button key={s} size="sm" variant={source === s ? "default" : "outline"} aria-pressed={source === s} onClick={() => pick(s)}>
            {SOURCE_LABELS[s]}
            {source === s && <X />}
          </Button>
        ))}
        {source ? (
          <Input aria-label="出处" className="h-8 w-40" placeholder="书名、片名…（可不填）" maxLength={EXPRESSION_LIMITS.sourceTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
        ) : (
          <span className="text-xs text-muted-foreground">未记录</span>
        )}
        {focus && (
          <Button size="sm" variant="secondary" className="max-w-full" title="清掉焦点" onClick={() => { setGiven(""); setSel([0, 0]); }}>
            <span className="truncate">焦点：{focus}</span>
            <X />
          </Button>
        )}
        <div className="ml-auto flex gap-1.5">
          {need.includes("\n") && (
            <Button variant="ghost" disabled={box.length > EXPRESSION_LIMITS.paste || waiting} onClick={choose}>
              {picker.isPending && <Loader2 className="animate-spin" />}
              帮我挑
            </Button>
          )}
          <Button variant="outline" disabled={!askable || waiting} onClick={ask}>
            {find.isPending && <Loader2 className="animate-spin" />}
            {thread ? "追问" : "问"}
          </Button>
          <Button disabled={!draft.text || tooLong || busy || waiting} onClick={submit}>
            {busy && <Loader2 className="animate-spin" />}
            收下
          </Button>
        </div>
      </div>
      {held && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p>已经收过同样的。是又一次遇到，还是另一个意思？</p>
          {held.existing.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {titleOf(e)} <span className="text-xs text-muted-foreground">{day(e.createdAt)}</span>
              </span>
              <Button size="sm" variant="outline" disabled={busy || waiting} onClick={() => again(e.id, held.met)}>又一次遇到</Button>
            </div>
          ))}
          <Button size="sm" variant="ghost" disabled={busy || waiting} onClick={() => save(held.met, held.focus, true)}>另存</Button>
        </div>
      )}
      {picks && <PickList picks={picks} from={from} onSaved={onSaved} onClose={() => setPicks(null)} />}
      {thread && <FindThread turns={thread.turns} busy={find.isPending} onSaved={onSaved} onReset={() => setThread(null)} />}
    </section>
  );
}
