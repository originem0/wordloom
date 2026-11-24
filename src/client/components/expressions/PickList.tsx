import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { ApiError } from "@/client/lib/api";
import { useCapture } from "@/client/hooks/useExpressions";
import type { EncounterSource, PickResponse } from "@/shared/expressions";

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
  const capture = useCapture();
  const [ticked, setTicked] = useState<number[]>([]);
  // How each pick ended: 已收下, or 已收过 when the library had the same words.
  const [done, setDone] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const keep = async () => {
    setSaving(true);
    for (const [i, p] of picks.entries()) {
      if (!ticked.includes(i)) continue;
      try {
        const saved = await capture.mutateAsync({ text: p.text, textBefore: p.before ?? undefined, ...from });
        onSaved(saved.id);
        setDone((d) => ({ ...d, [i]: "已收下" }));
      } catch (e) {
        // A duplicate is said on that pick and the rest go on. Anything else
        // stops here, with what was not saved still ticked.
        if (!(e instanceof ApiError && e.code === "DUPLICATE")) {
          toast.error(`没有存上：${e instanceof Error ? e.message : e}`);
          break;
        }
        setDone((d) => ({ ...d, [i]: "已收过" }));
      }
      setTicked((t) => t.filter((x) => x !== i));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      {picks.length === 0 && <p className="text-muted-foreground">没有挑出来。可以自己选中一段再收下。</p>}
      {picks.map((p, i) => (
        <label key={i} className="flex items-start gap-2">
          {done[i] ? (
            <span className="shrink-0 text-xs text-muted-foreground">{done[i]}</span>
          ) : (
            <input type="checkbox" className="mt-1" disabled={saving} checked={ticked.includes(i)} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, i] : t.filter((x) => x !== i)))} />
          )}
          <span className="min-w-0 whitespace-pre-line">
            {p.before && <span className="block text-xs text-muted-foreground">{p.before}</span>}
            {p.text}
            <span className="block text-xs text-muted-foreground">{p.why}</span>
          </span>
        </label>
      ))}
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onClose}>关掉</Button>
        {picks.length > 0 && (
          <Button size="sm" disabled={!ticked.length || saving} onClick={keep}>
            {saving && <Loader2 className="animate-spin" />}
            收下选中的
          </Button>
        )}
      </div>
    </div>
  );
}
