import { useEffect } from "react";
import { X, Trash2, Loader2, Heart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  useDeleteChunk,
  useIncrementChunkUsage,
} from "@/client/hooks/useChunks";
import type { Chunk } from "@/shared/types";
import { ChunkCardBody, getCategoryColor } from "./ChunkCardBody";

interface ChunkDetailProps {
  chunk: Chunk;
  onClose: () => void;
  onFillerClick?: (filler: string) => void;
  onContrastClick?: (form: string) => void;
}

/** Full-screen overlay (not Dialog) — mirrors WordLoom card-detail pattern. */
export function ChunkDetail({
  chunk,
  onClose,
  onFillerClick,
  onContrastClick,
}: ChunkDetailProps) {
  const del = useDeleteChunk();
  const bumpUsage = useIncrementChunkUsage();
  const color = getCategoryColor(chunk.category);

  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Lock body scroll while overlay is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  async function handleDelete() {
    if (!confirm("Delete this chunk?")) return;
    try {
      await del.mutateAsync(chunk.id);
      toast.success("Chunk deleted");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      toast.error(msg);
    }
  }

  async function handleBumpUsage() {
    try {
      await bumpUsage.mutateAsync(chunk.id);
      toast.success("+1 用过了 ❤");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast.error(msg);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
    >
      {/* Top accent strip */}
      <div
        aria-hidden
        className="h-1 shrink-0"
        style={{ backgroundColor: color }}
      />

      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Chunk
          </span>
          {chunk.usageCount > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600"
              title={`你已经用过 ${chunk.usageCount} 次`}
            >
              <Heart className="size-3 fill-current" />
              {chunk.usageCount}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-2xl">
          <ChunkCardBody
            chunk={chunk}
            onFillerClick={onFillerClick}
            onContrastClick={onContrastClick}
          />
        </div>
      </div>

      <footer className="sticky bottom-0 z-10 border-t bg-background/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <Button
            type="button"
            onClick={handleBumpUsage}
            disabled={bumpUsage.isPending}
            className="bg-emerald-600 text-white hover:bg-emerald-600/90"
            title="我刚刚用过一次这个 chunk"
          >
            {bumpUsage.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Heart className="mr-2 size-4 fill-current" />
            )}
            用过了 +1
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDelete}
            disabled={del.isPending}
          >
            {del.isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 className="mr-2 size-4" />
                Delete
              </>
            )}
          </Button>
        </div>
      </footer>
    </div>
  );
}
