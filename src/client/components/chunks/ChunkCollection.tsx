import { useEffect, useMemo, useState } from "react";
import { Search, X, Sparkles } from "lucide-react";
import { Input } from "@/client/components/ui/input";
import { useChunks } from "@/client/hooks/useChunks";
import type { Chunk } from "@/shared/types";
import { ChunkCard } from "./ChunkCard";
import { ChunkDetail } from "./ChunkDetail";
import { getCategoryColor, getCategoryLabel } from "./ChunkCardBody";

const CATEGORIES = [
  "prep-intuition",
  "sentence-stem",
  "verb-collocation",
  "noun-prep",
  "discourse-marker",
] as const;

const FREQUENCIES = ["high", "mid", "low"] as const;

// Seed suggestions shown when the user has no chunks yet — one per category
// so the cold-start exposes the 5 chunk types.
const SEED_SUGGESTIONS: Array<{ form: string; hint: string }> = [
  { form: "attach importance to", hint: "verb-collocation" },
  { form: "make a difference", hint: "verb-collocation" },
  { form: "for all their X", hint: "sentence-stem" },
  { form: "with a growing sense of", hint: "noun-prep" },
  { form: "that being said", hint: "discourse-marker" },
];

interface ChunkCollectionProps {
  /** Called when a list-side action wants to populate ChunkInput. */
  onSuggest?: (form: string) => void;
}

export function ChunkCollection({ onSuggest }: ChunkCollectionProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [category, setCategory] = useState<string>("");
  const [frequency, setFrequency] = useState<string>("");
  const [openId, setOpenId] = useState<number | null>(null);

  // 300ms debounce — typing "discourse marker" should not fire 17 requests.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useChunks({
    search: debouncedSearch || undefined,
    category: category || undefined,
    frequency: frequency || undefined,
    limit: 200,
  });

  const chunks = data?.chunks ?? [];
  const total = data?.total ?? 0;
  const hasFilters = !!(debouncedSearch || category || frequency);
  const showEmptySeed = !isLoading && !hasFilters && total === 0;

  const openChunk = useMemo<Chunk | null>(() => {
    if (openId == null) return null;
    return chunks.find((c) => c.id === openId) ?? null;
  }, [openId, chunks]);

  function handleFillerClick(filler: string) {
    setOpenId(null);
    setSearch(filler);
  }

  function handleContrastClick(form: string) {
    setOpenId(null);
    setSearch(form);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            placeholder="Search form or meaning…"
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <FilterRow
          label="Category"
          values={CATEGORIES}
          selected={category}
          onSelect={setCategory}
          renderLabel={(v) => getCategoryLabel(v).code}
          renderTitle={(v) => getCategoryLabel(v).full}
          getColor={(v) => getCategoryColor(v)}
        />
        <FilterRow
          label="Frequency"
          values={FREQUENCIES}
          selected={frequency}
          onSelect={setFrequency}
          renderLabel={(v) => v}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        {isLoading ? "Loading…" : `${total} chunk${total === 1 ? "" : "s"}`}
      </div>

      {showEmptySeed ? (
        <EmptyState onPick={onSuggest} />
      ) : chunks.length === 0 && !isLoading ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No chunks match these filters.
        </div>
      ) : null}

      <div className="space-y-2">
        {chunks.map((c) => (
          <ChunkCard key={c.id} chunk={c} onClick={() => setOpenId(c.id)} />
        ))}
      </div>

      {openChunk && (
        <ChunkDetail
          chunk={openChunk}
          onClose={() => setOpenId(null)}
          onFillerClick={handleFillerClick}
          onContrastClick={handleContrastClick}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty-state seed suggestions — only shown when library is empty AND no
// filter is active. Clicking a chip prefills the input above (lifted state).
// ---------------------------------------------------------------------------

function EmptyState({ onPick }: { onPick?: (form: string) => void }) {
  return (
    <div className="space-y-3 rounded-lg border border-dashed bg-card/40 p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Your chunk dictionary is empty</h3>
        <p className="text-xs text-muted-foreground">
          Try one of these to feel out the flow — each covers a different chunk
          type.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SEED_SUGGESTIONS.map((s) => {
          const color = getCategoryColor(s.hint);
          return (
            <button
              key={s.form}
              type="button"
              onClick={() => onPick?.(s.form)}
              className="group inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-sm transition-colors hover:border-primary hover:bg-accent"
            >
              <Sparkles
                className="size-3 transition-colors"
                style={{ color }}
              />
              <span className="font-mono">{s.form}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface FilterRowProps<T extends string> {
  label: string;
  values: readonly T[];
  selected: string;
  onSelect: (value: string) => void;
  renderLabel: (value: T) => string;
  renderTitle?: (value: T) => string;
  getColor?: (value: T) => string;
}

function FilterRow<T extends string>({
  label,
  values,
  selected,
  onSelect,
  renderLabel,
  renderTitle,
  getColor,
}: FilterRowProps<T>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        onClick={() => onSelect("")}
        className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
          selected === ""
            ? "border-foreground bg-foreground text-background"
            : "border-border text-muted-foreground hover:bg-accent"
        }`}
      >
        All
      </button>
      {values.map((v) => {
        const isActive = selected === v;
        const color = getColor?.(v);
        return (
          <button
            key={v}
            type="button"
            title={renderTitle?.(v)}
            onClick={() => onSelect(isActive ? "" : v)}
            className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
              isActive
                ? "border-transparent text-background"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
            style={
              isActive
                ? { backgroundColor: color ?? "var(--foreground)" }
                : undefined
            }
          >
            {renderLabel(v)}
          </button>
        );
      })}
    </div>
  );
}
