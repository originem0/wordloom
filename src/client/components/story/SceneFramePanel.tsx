import { useMemo } from "react";
import type { StorySceneFrame } from "@/shared/types";

// ---------------------------------------------------------------------------
// SceneFrame — image scaffold (subjects / actions / setting / mood). Compact
// and collapsed by default so it stays a "stuck? peek here" reference rather
// than an answer key. Shared by Story Studio and Picture-Description Practice.
// ---------------------------------------------------------------------------

export function SceneFramePanel({ frame }: { frame: StorySceneFrame }) {
  const rows = useMemo(
    () =>
      [
        { label: "Subjects", values: frame.subjects },
        { label: "Actions", values: frame.actions },
        { label: "Setting", values: frame.setting ? [frame.setting] : [] },
        { label: "Mood", values: frame.mood ? [frame.mood] : [] },
      ].filter((r) => r.values.length > 0),
    [frame],
  );

  if (rows.length === 0) return null;

  return (
    <details className="group rounded-lg border bg-card/40 open:bg-card">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground">
        Scene scaffold{" "}
        <span className="ml-1 text-[10px] normal-case tracking-normal text-muted-foreground/70">
          看图说话脚手架
        </span>
      </summary>
      <dl className="space-y-1.5 px-3 pb-3 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-baseline gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="flex flex-wrap gap-1.5 text-foreground">
              {row.values.map((v, i) => (
                <span
                  key={i}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                >
                  {v}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
