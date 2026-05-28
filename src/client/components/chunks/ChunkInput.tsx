import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle, Trash2, Sparkles, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useGenerateChunk, useDeleteChunk } from "@/client/hooks/useChunks";
import type { ChunkGenerateResult } from "@/shared/types";
import { ChunkCardBody } from "./ChunkCardBody";

interface ChunkInputProps {
  /** When set, fills the input and focuses it. Cleared by `onPrefillConsumed`. */
  prefill?: string;
  onPrefillConsumed?: () => void;
}

export function ChunkInput({ prefill, onPrefillConsumed }: ChunkInputProps) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ChunkGenerateResult | null>(null);
  const generate = useGenerateChunk();
  const del = useDeleteChunk();
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Consume external prefill (e.g. clicked from empty-state suggestion)
  useEffect(() => {
    if (prefill && prefill !== input) {
      setInput(prefill);
      setResult(null);
      // Focus + move caret to end on the next tick
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(prefill.length, prefill.length);
        }
      });
      onPrefillConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  async function handleAnalyze() {
    const text = input.trim();
    if (!text) return;
    try {
      const res = await generate.mutateAsync(text);
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      toast.error(msg);
    }
  }

  function handleReset() {
    setResult(null);
    setInput("");
    // Re-focus for next chunk entry — the "add another" flow
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleDiscard() {
    if (result?.chunk) {
      try {
        await del.mutateAsync(result.chunk.id);
        toast.success("Chunk removed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Delete failed";
        toast.error(msg);
        return;
      }
    }
    handleReset();
  }

  function handleOpenInCards() {
    const q = encodeURIComponent(input.trim());
    navigate(`/cards?prefill=${q}`);
  }

  if (result) {
    return (
      <ChunkResultView
        result={result}
        onReset={handleReset}
        onDiscard={handleDiscard}
        onOpenInCards={handleOpenInCards}
        deleting={del.isPending}
      />
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <label htmlFor="chunk-input" className="text-sm font-medium">
          Candidate chunk
        </label>
        <p className="text-xs text-muted-foreground">
          e.g. <span className="font-mono">attach importance to</span>,{" "}
          <span className="font-mono">for all their X</span>,{" "}
          <span className="font-mono">make a difference</span>
        </p>
      </div>
      <textarea
        id="chunk-input"
        ref={textareaRef}
        rows={2}
        value={input}
        placeholder="Type a candidate multi-word pattern…"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // ⌘/Ctrl+Enter submits; plain Enter inserts a newline for long chunks
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !generate.isPending) {
            e.preventDefault();
            handleAnalyze();
          }
        }}
        className="block w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 dark:bg-input/30"
        autoComplete="off"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="hidden text-[11px] text-muted-foreground sm:block">
          ⌘/Ctrl + Enter to analyze
        </p>
        <Button
          type="button"
          onClick={handleAnalyze}
          disabled={!input.trim() || generate.isPending}
          className="ml-auto w-full sm:w-auto"
        >
          {generate.isPending ? (
            <AnalyzingLabel />
          ) : (
            <>
              <Sparkles className="mr-2 size-4" />
              Analyze
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Two-stage progress label — gives the user a sense of motion during the
// ~10-20s AI call. The phase switch is timer-based, not driven by real
// server events, but the perception of progress is what matters here.
// ---------------------------------------------------------------------------

function AnalyzingLabel() {
  const [phase, setPhase] = useState<0 | 1>(0);

  useEffect(() => {
    const t = setTimeout(() => setPhase(1), 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <Loader2 className="mr-2 size-4 animate-spin" />
      {phase === 0 ? "判断是否为 chunk…" : "解析结构与槽位…"}
    </>
  );
}

// ---------------------------------------------------------------------------
// Result view — 3 verdict branches
// ---------------------------------------------------------------------------

interface ResultViewProps {
  result: ChunkGenerateResult;
  onReset: () => void;
  onDiscard: () => void | Promise<void>;
  onOpenInCards: () => void;
  deleting: boolean;
}

function ChunkResultView({
  result,
  onReset,
  onDiscard,
  onOpenInCards,
  deleting,
}: ResultViewProps) {
  if (result.verdict === "not_chunk") {
    return (
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Not a chunk</p>
            <p className="text-sm text-muted-foreground">{result.reason}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="default" onClick={onOpenInCards}>
            Open in Cards
          </Button>
          <Button type="button" variant="outline" onClick={onReset}>
            Try another
          </Button>
        </div>
      </div>
    );
  }

  const isBorderline = result.verdict === "borderline";
  const wasExisting = result.wasExisting === true;
  const usageCount = result.chunk?.usageCount ?? 0;
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      {wasExisting && (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <div className="space-y-0.5">
            <p className="font-medium">Already in your library</p>
            <p className="text-muted-foreground">
              This chunk has the same form + category as one you've analyzed
              before. The card below is the refreshed version
              {usageCount > 0 ? ` (your ❤ count of ${usageCount} is preserved)` : ""}
              .
            </p>
          </div>
        </div>
      )}
      {isBorderline && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="space-y-0.5">
            <p className="font-medium">Borderline ({result.confidence.toFixed(2)})</p>
            <p className="text-muted-foreground">{result.reason}</p>
          </div>
        </div>
      )}
      {result.chunk ? (
        <ChunkCardBody chunk={result.chunk} />
      ) : (
        <p className="text-sm text-muted-foreground">
          (Payload missing — server returned verdict but no chunk row.)
        </p>
      )}
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button type="button" onClick={onReset}>
          Add another
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDiscard}
          disabled={deleting}
        >
          {deleting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Removing…
            </>
          ) : (
            <>
              <Trash2 className="mr-2 size-4" />
              {isBorderline ? "Skip" : "Discard"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
