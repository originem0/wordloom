import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  X,
  Sparkles,
  ScanText,
  BookOpen,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { Input } from "@/client/components/ui/input";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { useCards, useExtractWords } from "@/client/hooks/useCards";
import { useTaskStore } from "@/client/store/tasks";
import { cn } from "@/client/lib/utils";

const MAX_WORDS = 10;

function parseWords(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, MAX_WORDS);
}

interface WordInputProps {
  input: string;
  setInput: (v: string) => void;
  debouncedInput: string;
}

export function WordInput({ input, setInput, debouncedInput }: WordInputProps) {
  const submitCards = useTaskStore((s) => s.submitCards);

  // Live: drives chip display the moment user types a comma/space.
  const liveWords = parseWords(input);
  // Debounced: drives the "no match → generate" CTA so it doesn't flicker per keystroke.
  const debouncedWords = parseWords(debouncedInput);
  const candidate =
    debouncedWords.length === 1 && /^[a-z0-9'-]+$/.test(debouncedWords[0])
      ? debouncedWords[0]
      : "";

  // Probe whether the candidate exists. Reuses the same search route — TanStack
  // dedupes if CardCollection happens to query the same params.
  const exactProbe = useCards({
    search: candidate || undefined,
    limit: 1,
  });
  const hasExactMatch =
    !!candidate &&
    !!exactProbe.data?.cards.some(
      (c) => c.word.toLowerCase() === candidate,
    );
  const probeSettled = !!candidate && !exactProbe.isFetching;

  const isMulti = liveWords.length > 1;
  const showGenerateCta =
    !isMulti && !!candidate && probeSettled && !hasExactMatch;

  const handleGenerate = useCallback(() => {
    const words = parseWords(input);
    if (words.length === 0) return;
    submitCards(words);
    setInput("");
  }, [input, submitCards, setInput]);

  const handleEnter = () => {
    if (isMulti) {
      handleGenerate();
      return;
    }
    if (candidate && !hasExactMatch && probeSettled) {
      handleGenerate();
    }
    // single + match: do nothing — the card is already top of the list below.
  };

  return (
    <div className="space-y-3">
      <UnifiedSearchBar
        input={input}
        setInput={setInput}
        onEnter={handleEnter}
      />

      {isMulti && (
        <MultiWordBar words={liveWords} onGenerate={handleGenerate} />
      )}

      {showGenerateCta && (
        <GenerateCta word={candidate} onGenerate={handleGenerate} />
      )}

      <SecondaryEntries />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unified input — search + generate share one box.
// ---------------------------------------------------------------------------

function UnifiedSearchBar({
  input,
  setInput,
  onEnter,
}: {
  input: string;
  setInput: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-11 pl-9 pr-9 text-base"
        placeholder="查询或生成词卡（多词用逗号/空格分隔）"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        autoFocus
      />
      {input && (
        <button
          type="button"
          onClick={() => setInput("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Clear"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-word: chips + generate button.
// ---------------------------------------------------------------------------

function MultiWordBar({
  words,
  onGenerate,
}: {
  words: string[];
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
      <span className="shrink-0 text-xs text-muted-foreground">
        将生成 {words.length} 张：
      </span>
      {words.map((w) => (
        <Badge key={w} variant="secondary" className="font-mono">
          {w}
        </Badge>
      ))}
      <Button size="sm" className="ml-auto" onClick={onGenerate}>
        <Sparkles className="size-3.5" />
        生成
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single word, no exact match → CTA.
// ---------------------------------------------------------------------------

function GenerateCta({
  word,
  onGenerate,
}: {
  word: string;
  onGenerate: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed bg-muted/30 p-3">
      <span className="text-sm text-muted-foreground">
        词库中没有{" "}
        <span className="font-mono font-semibold text-foreground">{word}</span>
        ，回车直接生成
      </span>
      <Button size="sm" onClick={onGenerate}>
        <Sparkles className="size-3.5" />
        生成词卡
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secondary entries — extract panel + link to story.
// ---------------------------------------------------------------------------

function SecondaryEntries() {
  const [extractOpen, setExtractOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          type="button"
          onClick={() => setExtractOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors",
            extractOpen
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          )}
        >
          <ScanText className="size-3.5" />
          从文本抽取
          <ChevronDown
            className={cn(
              "size-3 transition-transform",
              extractOpen && "rotate-180",
            )}
          />
        </button>
        <Link
          to="/"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <BookOpen className="size-3.5" />
          故事页双击点词
        </Link>
      </div>

      {extractOpen && <ExtractPanel onClose={() => setExtractOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extract panel — kept from the old "从文本抽取" tab; logic unchanged.
// ---------------------------------------------------------------------------

function ExtractPanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const extract = useExtractWords();
  const submitCards = useTaskStore((s) => s.submitCards);

  const handleExtract = () => {
    if (!text.trim()) return;
    extract.mutate(text, {
      onSuccess: (data) => setSelected(new Set(data.words.slice(0, MAX_WORDS))),
    });
  };

  const toggle = useCallback(
    (word: string) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(word)) next.delete(word);
        else if (next.size < MAX_WORDS) next.add(word);
        return next;
      }),
    [],
  );

  const handleGenerate = () => {
    const words = [...selected];
    if (words.length === 0) return;
    submitCards(words);
    setSelected(new Set());
    setText("");
    onClose();
  };

  return (
    <div className="space-y-3 rounded-md border bg-card/40 p-3">
      <textarea
        className="min-h-[100px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none dark:bg-input/30"
        placeholder="粘贴英文文本，自动抽取候选单词…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={handleExtract}
          variant="outline"
          size="sm"
          disabled={!text.trim() || extract.isPending}
        >
          {extract.isPending && <Loader2 className="size-3.5 animate-spin" />}
          {extract.isPending ? "抽取中…" : "抽取单词"}
        </Button>
        {extract.isError && (
          <p className="text-xs text-destructive">{extract.error.message}</p>
        )}
      </div>

      {extract.data && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {extract.data.words.map((word) => (
              <Badge
                key={word}
                variant={selected.has(word) ? "default" : "outline"}
                className="cursor-pointer select-none"
                onClick={() => toggle(word)}
              >
                {word}
              </Badge>
            ))}
          </div>
          {selected.size > 0 && (
            <Button type="button" size="sm" onClick={handleGenerate}>
              <Sparkles className="size-3.5" />
              {`生成 ${selected.size} 张词卡`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
