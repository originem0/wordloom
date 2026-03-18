import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { WordInput } from "./WordInput";
import { CardCollection } from "./CardCollection";

function WordForgeInner() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:space-y-8 md:p-6">
      <section className="space-y-1">
        <h2 className="text-2xl font-semibold">Word Forge</h2>
        <p className="text-sm text-muted-foreground">手输、抽词、故事点词三种入口，统一进任务队列。</p>
      </section>
      <section>
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
