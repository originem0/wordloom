import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { WordInput } from "./WordInput";
import { CardCollection } from "./CardCollection";

function WordForgeInner() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-6">
      <section>
        <h2 className="mb-4 text-2xl font-semibold">Word Forge</h2>
        <WordInput />
      </section>
      <section>
        <CardCollection />
      </section>
    </div>
  );
}

export function WordForgePage() {
  return (
    <ModuleErrorBoundary>
      <WordForgeInner />
    </ModuleErrorBoundary>
  );
}
