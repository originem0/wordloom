import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { WordInput } from "./WordInput";
import { CardCollection } from "./CardCollection";

function WordForgeInner() {
  const [searchParams, setSearchParams] = useSearchParams();
  const prefill = searchParams.get("prefill") || "";
  const [input, setInput] = useState(prefill);
  const [debouncedInput, setDebouncedInput] = useState(prefill);

  // 300ms debounce — shared by card grid filter AND exact-match probe in WordInput.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedInput(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  // Consume the prefill URL param once on mount.
  useEffect(() => {
    if (!prefill) return;
    const next = new URLSearchParams(searchParams);
    next.delete("prefill");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:space-y-8 md:p-6">
      <section className="space-y-1">
        <h2 className="text-2xl font-semibold">Word Forge</h2>
        <p className="text-sm text-muted-foreground">
          一个输入框：搜不到就生成。多词用逗号或空格分隔。
        </p>
      </section>
      <section>
        <WordInput
          input={input}
          setInput={setInput}
          debouncedInput={debouncedInput}
        />
      </section>
      <section>
        <CardCollection searchInput={debouncedInput} />
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
