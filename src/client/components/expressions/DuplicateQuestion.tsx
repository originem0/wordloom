import { Button } from "@/client/components/ui/button";
import type { DuplicateResponse } from "@/shared/expressions";
import { day, titleOf } from "./shared";

/**
 * What a 409 from capture asks. Nothing was saved: the library has the same
 * words already, and only the user knows whether they met them again or mean
 * something else by them. Asked wherever a sentence the user met is kept: on
 * the box, and under a pick.
 */
export function DuplicateQuestion({ existing, disabled, onAgain, onNew }: {
  existing: DuplicateResponse["existing"];
  disabled: boolean;
  onAgain: (id: number) => void;
  onNew: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p>已经收过同样的。是又一次遇到，还是另一个意思？</p>
      {existing.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate">
            {titleOf(e)} <span className="text-xs text-muted-foreground">{day(e.createdAt)}</span>
          </span>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAgain(e.id)}>又一次遇到</Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" disabled={disabled} onClick={onNew}>另存</Button>
    </div>
  );
}
