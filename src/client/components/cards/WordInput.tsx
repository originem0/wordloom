import { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/client/components/ui/tabs";
import { Input } from "@/client/components/ui/input";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { useGenerateCards, useExtractWords } from "@/client/hooks/useCards";

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

// --- Tab 1: Manual Input ---

function ManualInput() {
  const [input, setInput] = useState("");
  const generate = useGenerateCards();

  const words = parseWords(input);

  const handleGenerate = () => {
    if (words.length === 0) return;
    generate.mutate(words);
  };

  return (
    <div className="space-y-3">
      <Input
        placeholder="Enter words (comma or space separated)"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleGenerate();
          }
        }}
      />
      {words.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {words.length} word{words.length > 1 ? "s" : ""} detected
          {words.length >= MAX_WORDS && " (max 10)"}
        </p>
      )}
      <Button
        onClick={handleGenerate}
        className="w-full sm:w-auto"
        disabled={words.length === 0 || generate.isPending}
      >
        {generate.isPending && <Loader2 className="size-4 animate-spin" />}
        {generate.isPending ? "Generating..." : "Generate Cards"}
      </Button>

      <GenerateResult mutation={generate} />
    </div>
  );
}

// --- Tab 2: Extract from Text ---

function ExtractInput() {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const extract = useExtractWords();
  const generate = useGenerateCards();

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
    generate.mutate(words);
  };

  return (
    <div className="space-y-3">
      <textarea
        className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none dark:bg-input/30"
        placeholder="Paste English text here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        onClick={handleExtract}
        variant="outline"
        className="w-full sm:w-auto"
        disabled={!text.trim() || extract.isPending}
      >
        {extract.isPending && <Loader2 className="size-4 animate-spin" />}
        {extract.isPending ? "Extracting..." : "Extract Words"}
      </Button>

      {extract.isError && (
        <p className="text-sm text-destructive">{extract.error.message}</p>
      )}

      {extract.data && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
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
            <Button
              onClick={handleGenerate}
              disabled={generate.isPending}
            >
              {generate.isPending && <Loader2 className="size-4 animate-spin" />}
              {generate.isPending
                ? "Generating..."
                : `Generate ${selected.size} Card${selected.size > 1 ? "s" : ""}`}
            </Button>
          )}
          <GenerateResult mutation={generate} />
        </div>
      )}
    </div>
  );
}

// --- Tab 3: From Story ---

function FromStory() {
  return (
    <div className="space-y-2 py-4 text-sm text-muted-foreground">
      <p>Tap any word in your story to create a card.</p>
      <a href="/" className="text-primary underline-offset-4 hover:underline">
        Go to Story Studio &rarr;
      </a>
    </div>
  );
}

// --- Shared result display ---

function GenerateResult({
  mutation,
}: {
  mutation: ReturnType<typeof useGenerateCards>;
}) {
  if (mutation.isError) {
    return <p className="text-sm text-destructive">{mutation.error.message}</p>;
  }
  if (!mutation.data) return null;

  const { success, failed } = mutation.data;
  return (
    <div className="space-y-2 text-sm">
      {success.length > 0 && (
        <p className="text-emerald-600 dark:text-emerald-400">
          {success.length} card{success.length > 1 ? "s" : ""} created
        </p>
      )}
      {failed.length > 0 && (
        <div className="space-y-1">
          <p className="text-destructive">
            {failed.length} failed:
          </p>
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {failed.map((f) => (
              <li key={f.word}>
                <span className="font-medium">{f.word}</span> &mdash; {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Main export ---

export function WordInput() {
  return (
    <Tabs defaultValue="manual">
      <TabsList className="w-full overflow-x-auto sm:w-fit">
        <TabsTrigger value="manual">Manual Input</TabsTrigger>
        <TabsTrigger value="extract">Extract from Text</TabsTrigger>
        <TabsTrigger value="story">From Story</TabsTrigger>
      </TabsList>
      <TabsContent value="manual" className="pt-4">
        <ManualInput />
      </TabsContent>
      <TabsContent value="extract" className="pt-4">
        <ExtractInput />
      </TabsContent>
      <TabsContent value="story" className="pt-4">
        <FromStory />
      </TabsContent>
    </Tabs>
  );
}
