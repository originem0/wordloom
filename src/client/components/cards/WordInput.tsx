import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/client/components/ui/tabs";
import { Input } from "@/client/components/ui/input";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { useExtractWords } from "@/client/hooks/useCards";
import { useTaskStore } from "@/client/store/tasks";

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
  const submitCards = useTaskStore((s) => s.submitCards);

  const words = parseWords(input);

  const handleGenerate = () => {
    if (words.length === 0) return;
    submitCards(words);
    setInput("");
  };

  return (
    <div className="space-y-3">
      <Input
        placeholder="输入单词（逗号或空格分隔）"
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
          已识别 {words.length} 个词
          {words.length >= MAX_WORDS && "（最多 10 个）"}
        </p>
      )}
      <Button
        type="button"
        onClick={handleGenerate}
        className="w-full sm:w-auto"
        disabled={words.length === 0}
      >
        生成词卡
      </Button>
    </div>
  );
}

// --- Tab 2: Extract from Text ---

function ExtractInput() {
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
  };

  return (
    <div className="space-y-3">
      <textarea
        className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none dark:bg-input/30"
        placeholder="粘贴英文文本，自动抽取候选单词…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        type="button"
        onClick={handleExtract}
        variant="outline"
        className="w-full sm:w-auto"
        disabled={!text.trim() || extract.isPending}
      >
        {extract.isPending && <Loader2 className="size-4 animate-spin" />}
        {extract.isPending ? "抽取中…" : "抽取单词"}
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
            <Button type="button" onClick={handleGenerate}>
              {`生成 ${selected.size} 张词卡`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// --- Tab 3: From Story ---

function FromStory() {
  return (
    <div className="space-y-2 py-4 text-sm text-muted-foreground">
      <p>在故事页面双击任意单词即可生成词卡。</p>
      <Link to="/" className="text-primary underline-offset-4 hover:underline">
        前往 Story Studio &rarr;
      </Link>
    </div>
  );
}

// --- Main export ---

export function WordInput() {
  return (
    <Tabs defaultValue="manual">
      <TabsList className="w-full overflow-x-auto sm:w-fit">
        <TabsTrigger value="manual">手动输入</TabsTrigger>
        <TabsTrigger value="extract">从文本抽取</TabsTrigger>
        <TabsTrigger value="story">从故事点词</TabsTrigger>
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
