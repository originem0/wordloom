import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { ApiError } from "@/client/lib/api";
import { useCapture, useMetAgain } from "@/client/hooks/useExpressions";
import type { DuplicateResponse, EncounterSource, PickResponse } from "@/shared/expressions";
import { DuplicateQuestion } from "./DuplicateQuestion";
import { errorMessage, useI18n } from "@/client/lib/i18n";

const DONE_LABELS = { saved: ["已收下", "Saved"], met: ["又一次遇到", "Met it again"] } as const;

/**
 * What the model picked out of a pasted conversation. It only points: nothing
 * is ticked for the user, and what they tick is saved one entry at a time, with
 * the tag chosen on the box.
 */
export function PickList({ picks, from, onSaved, onClose }: {
  picks: PickResponse["picks"];
  from: Pick<EncounterSource, "sourceType" | "sourceTitle">;
  onSaved: (id: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const capture = useCapture();
  const metAgain = useMetAgain();
  const [ticked, setTicked] = useState<number[]>([]);
  // How each pick ended: 已收下, or 又一次遇到 on an entry the library had.
  const [done, setDone] = useState<Record<number, keyof typeof DONE_LABELS>>({});
  // The picks whose words the library has already, each with the entries it
  // collides with. A question, as on the box: nothing was saved for them yet.
  const [held, setHeld] = useState<Record<number, DuplicateResponse["existing"]>>({});
  const [saving, setSaving] = useState(false);
  const met = (i: number) => ({ text: picks[i].text, textBefore: picks[i].before ?? undefined, ...from });

  /** One write for one pick. False when it failed: that is said, and the pick stays as it was. */
  const write = async (i: number, label: keyof typeof DONE_LABELS, request: () => Promise<unknown>) => {
    try {
      await request();
      setDone((d) => ({ ...d, [i]: label }));
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "DUPLICATE")) {
        toast.error(t(`没有存上：${errorMessage(e)}`, `Could not save: ${errorMessage(e)}`));
        return false;
      }
      setHeld((h) => ({ ...h, [i]: (e.body as DuplicateResponse).existing ?? [] }));
    }
    setTicked((t) => t.filter((x) => x !== i));
    return true;
  };
  const save = (i: number, force?: true) => write(i, "saved", async () => onSaved((await capture.mutateAsync({ ...met(i), force })).id));
  const busy = async (work: () => Promise<unknown>) => {
    setSaving(true);
    await work();
    setSaving(false);
  };
  // A duplicate is asked about under its pick and the rest go on. Anything
  // else stops here, with what was not saved still ticked.
  const keep = () =>
    busy(async () => {
      for (const i of picks.keys()) if (ticked.includes(i) && !(await save(i))) break;
    });

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      {picks.length === 0 && <p className="text-muted-foreground">{t("没有挑出来。可以自己选中一段再收下。", "No expressions were picked. Select a passage yourself to save it.")}</p>}
      {picks.map((p, i) => (
        <div key={i} className="space-y-2">
          <label className="flex items-start gap-2">
            {done[i] || held[i] ? (
              <span className="shrink-0 text-xs text-muted-foreground">{done[i] ? t(DONE_LABELS[done[i]][0], DONE_LABELS[done[i]][1]) : t("已收过", "Already saved")}</span>
            ) : (
              <input type="checkbox" className="mt-1" disabled={saving} checked={ticked.includes(i)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, i] : t.filter((x) => x !== i)))} />
            )}
            <span className="min-w-0 whitespace-pre-line">
              {p.before && <span className="block text-xs text-muted-foreground">{p.before}</span>}
              {p.text}
              <span className="block text-xs text-muted-foreground">{p.why}</span>
            </span>
          </label>
          {held[i] && !done[i] && (
            <DuplicateQuestion
              existing={held[i]}
              disabled={saving}
              onAgain={(id) => busy(() => write(i, "met", () => metAgain.mutateAsync({ id, ...met(i) })))}
              onNew={() => busy(() => save(i, true))}
            />
          )}
        </div>
      ))}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" disabled={saving} onClick={onClose}>{t("关掉", "Close")}</Button>
        {picks.length > 0 && (
          <Button size="sm" disabled={!ticked.length || saving} onClick={keep}>
            {saving && <Loader2 className="animate-spin" />}
            {t("收下选中的", "Save selected")}
          </Button>
        )}
      </div>
    </div>
  );
}
