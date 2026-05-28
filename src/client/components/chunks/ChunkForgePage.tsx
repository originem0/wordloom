import { useState } from "react";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { ChunkInput } from "./ChunkInput";
import { ChunkCollection } from "./ChunkCollection";

function ChunkForgeInner() {
  // Lift "prefill" state so empty-state suggestions in ChunkCollection
  // can populate ChunkInput's textarea.
  const [prefill, setPrefill] = useState("");

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:space-y-8 md:p-6">
      <section className="space-y-1">
        <h2 className="text-2xl font-semibold">Chunk Forge</h2>
        <p className="text-sm text-muted-foreground">
          Paste a candidate multi-word pattern. AI judges if it's a chunk and
          fills the card.
        </p>
      </section>
      <section>
        <ChunkInput
          prefill={prefill}
          onPrefillConsumed={() => setPrefill("")}
        />
      </section>
      <section>
        <ChunkCollection onSuggest={setPrefill} />
      </section>
    </div>
  );
}

export function ChunkForgePage() {
  return (
    <ModuleErrorBoundary>
      <ChunkForgeInner />
    </ModuleErrorBoundary>
  );
}
