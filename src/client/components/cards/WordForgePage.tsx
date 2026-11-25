import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { useIsAdmin } from "@/client/hooks/useAuth";
import { useI18n } from "@/client/lib/i18n";
import { useReadingStore } from "@/client/store/reading";
import { WordInput } from "./WordInput";
import { CardCollection } from "./CardCollection";

function WordForgeInner() {
  const { t } = useI18n();
  const isAdmin = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefill = searchParams.get("prefill") || "";
  const input = useReadingStore((s) => s.cards.input);
  const setInput = useReadingStore((s) => s.setCardInput);
  const [debouncedInput, setDebouncedInput] = useState(prefill || input.trim());

  // 300ms debounce — shared by card grid filter AND exact-match probe in WordInput.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedInput(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  // Consume the prefill URL param once on mount.
  useEffect(() => {
    if (!prefill) return;
    setInput(prefill);
    const next = new URLSearchParams(searchParams);
    next.delete("prefill");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:space-y-8 md:p-6">
      <section className="space-y-1">
        <h2 className="text-2xl font-semibold">{t("词卡", "Word Forge")}</h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? t("一个输入框：搜不到就生成。多词用逗号或空格分隔。", "Search or generate cards. Separate multiple words with commas or spaces.")
            : t("搜索词卡，先读核心意象，再展开场景、近义词对比和边界测试。", "Search cards, start with the core image, then explore contexts, word comparisons and boundary tests.")}
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
