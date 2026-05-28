import { memo } from "react";
import { Heart } from "lucide-react";
import type { Chunk } from "@/shared/types";
import { getCategoryColor, getCategoryLabel, renderForm } from "./ChunkCardBody";

interface ChunkCardProps {
  chunk: Chunk;
  onClick?: () => void;
}

/** Compact list card — one chunk per row. */
export const ChunkCard = memo(function ChunkCard({ chunk, onClick }: ChunkCardProps) {
  const cat = getCategoryLabel(chunk.category);
  const color = getCategoryColor(chunk.category);
  const formParts = renderForm(chunk.form);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-stretch overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-primary/50 hover:bg-accent/50"
    >
      <span
        aria-hidden
        className="w-1 shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0 flex-1 space-y-1 p-3">
        <div className="flex items-start gap-2">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: color, color: "#fdf6e3" }}
            title={cat.full}
          >
            {cat.code}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-sm">
            {formParts.map((p, i) =>
              p.slot ? (
                <span key={i} style={{ color }} className="font-semibold">
                  {p.text}
                </span>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
            {chunk.frequency}
          </span>
        </div>
        <div className="line-clamp-1 text-xs text-muted-foreground">
          {chunk.coreMeaningZh || chunk.coreMeaning}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {chunk.register}
          </span>
          {chunk.usageCount > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600"
              title={`你用过 ${chunk.usageCount} 次`}
            >
              <Heart className="size-2.5 fill-current" />
              {chunk.usageCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});
