import { useState, useCallback } from "react";
import {
  Languages,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  Sparkles,
  ArrowRight,
  Puzzle,
} from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { InteractiveStory } from "./InteractiveStory";
import { TtsPlayer } from "./TtsPlayer";
import { SceneFramePanel } from "./SceneFramePanel";
import { useTranslate } from "@/client/hooks/useStories";
import type { Story, StoryKeyExpression } from "@/shared/types";

interface StoryViewProps {
  story: Story;
  /** Single-word activation → look up / generate a word card. */
  onWordClick: (word: string) => void;
  /** Multi-word chunk activation → send the phrase to Chunk Forge. */
  onChunkClick: (phrase: string) => void;
}

export function StoryView({ story, onWordClick, onChunkClick }: StoryViewProps) {
  const [translation, setTranslation] = useState<string | null>(
    story.artifact?.translation || null,
  );
  const [showTranslation, setShowTranslation] = useState(false);
  const [copied, setCopied] = useState(false);
  const translateMutation = useTranslate();

  // Description used in TTS / copy / clickable view. Prefer artifact's
  // (always the source of truth for the new structured output).
  const description = story.artifact?.description || story.story;

  const handleCopy = useCallback(() => {
    const plain = description.replace(/\*\*/g, "");
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [description]);

  const handleTranslate = async () => {
    // Artifact already has translation — no API roundtrip needed.
    if (translation) {
      setShowTranslation((v) => !v);
      return;
    }
    const result = await translateMutation.mutateAsync(story.id);
    setTranslation(result.translation);
    setShowTranslation(true);
  };

  return (
    <div className="space-y-4">
      {/* Story image + optional title */}
      <div className="space-y-2">
        <div className="overflow-hidden rounded-lg border">
          <img
            src={`/api/stories/${story.id}/image`}
            alt={story.artifact?.title ?? "Story illustration"}
            className="aspect-video w-full object-cover"
            loading="lazy"
          />
        </div>
        {story.artifact?.title && (
          <h3 className="text-base font-medium tracking-tight">
            {story.artifact.title}
          </h3>
        )}
      </div>

      {/* Description (clickable words + copy) */}
      <div className="group relative rounded-lg border bg-card p-4">
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2 right-2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
          title="复制文本"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
        <InteractiveStory story={description} onWordClick={onWordClick} />
      </div>

      {/* Translation toggle */}
      <div className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTranslate}
          disabled={translateMutation.isPending}
        >
          {translateMutation.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Languages className="size-3.5" />
          )}
          {showTranslation ? "隐藏翻译" : "中文翻译"}
        </Button>

        {showTranslation && translation && (
          <p className="rounded-md bg-muted/50 p-3 text-sm leading-relaxed text-muted-foreground">
            {translation}
          </p>
        )}
      </div>

      {/* TTS */}
      <TtsPlayer storyId={story.id} storyText={description} />

      {/* Scene frame — concrete scaffold the learner can pull from when describing the image themselves */}
      {story.artifact?.sceneFrame && (
        <SceneFramePanel frame={story.artifact.sceneFrame} />
      )}

      {/* Key expressions — the teaching artifact's payload */}
      {story.artifact?.keyExpressions &&
        story.artifact.keyExpressions.length > 0 && (
          <KeyExpressionsPanel
            expressions={story.artifact.keyExpressions}
            onActivate={onWordClick}
            onChunkActivate={onChunkClick}
          />
        )}

      {/* Grounding sources */}
      {story.sources.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">参考来源</p>
          <div className="flex flex-wrap gap-1.5">
            {story.sources.map((src, i) =>
              src.web ? (
                <Badge key={i} variant="outline" asChild>
                  <a
                    href={src.web.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1"
                  >
                    <ExternalLink className="size-3" />
                    {src.web.title}
                  </a>
                </Badge>
              ) : null,
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KeyExpressions — the heart of the teaching artifact. Each row maps to a
// learner action: click "📖" to open an existing card, or "✨" to generate
// a new one. Items marked fromVocab are highlighted as "your vocab".
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<StoryKeyExpression["type"], string> = {
  collocation: "搭配",
  idiom: "习语",
  "sentence-pattern": "句型",
  "phrasal-verb": "短语动词",
  "single-word": "单词",
};

const TYPE_COLORS: Record<StoryKeyExpression["type"], string> = {
  collocation: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  idiom: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  "sentence-pattern": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "phrasal-verb": "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "single-word": "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

function KeyExpressionsPanel({
  expressions,
  onActivate,
  onChunkActivate,
}: {
  expressions: StoryKeyExpression[];
  onActivate: (word: string) => void;
  onChunkActivate: (phrase: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-medium">表达精选</h4>
        <span className="text-[11px] text-muted-foreground">
          多词组块送入 Chunk Forge；单词进词卡
        </span>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {expressions.map((expr, i) => (
          <ExpressionRow
            key={`${expr.phrase}-${i}`}
            expr={expr}
            onActivate={onActivate}
            onChunkActivate={onChunkActivate}
          />
        ))}
      </ul>
    </div>
  );
}

function ExpressionRow({
  expr,
  onActivate,
  onChunkActivate,
}: {
  expr: StoryKeyExpression;
  onActivate: (word: string) => void;
  onChunkActivate: (phrase: string) => void;
}) {
  const isFromVocab = expr.fromVocab != null;
  const isSingleWord = expr.type === "single-word";
  const hasCard = isSingleWord && expr.existingCardId != null;

  return (
    <li className="flex flex-wrap items-start gap-2 p-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm font-medium">{expr.phrase}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[expr.type]}`}
            title={expr.type}
          >
            {TYPE_LABELS[expr.type]}
          </span>
          {expr.register !== "neutral" && (
            <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {expr.register}
            </span>
          )}
          {isFromVocab && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              <Sparkles className="size-2.5" />
              你刚学的
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="text-foreground">{expr.zh}</span>
          {expr.whyUseful && (
            <span className="ml-2 text-muted-foreground/80">· {expr.whyUseful}</span>
          )}
        </p>
      </div>
      {isSingleWord ? (
        <Button
          type="button"
          size="sm"
          variant={hasCard ? "outline" : "default"}
          onClick={() => onActivate(expr.headword)}
          className="shrink-0"
          title={hasCard ? "查看已有词卡" : "生成新词卡"}
        >
          {hasCard ? (
            <>
              <ArrowRight className="size-3.5" />
              查看
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              生成
            </>
          )}
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={() => onChunkActivate(expr.phrase)}
          className="shrink-0"
          title="送入 Chunk Forge 分析"
        >
          <Puzzle className="size-3.5" />
          分析
        </Button>
      )}
    </li>
  );
}
