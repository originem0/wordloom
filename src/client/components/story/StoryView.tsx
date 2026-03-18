import { useState, useCallback } from "react";
import { Languages, ExternalLink, Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { InteractiveStory } from "./InteractiveStory";
import { TtsPlayer } from "./TtsPlayer";
import { useTranslate } from "@/client/hooks/useStories";
import type { Story } from "@/shared/types";

interface StoryViewProps {
  story: Story;
  onWordClick: (word: string) => void;
}

export function StoryView({ story, onWordClick }: StoryViewProps) {
  const [translation, setTranslation] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(false);
  const [copied, setCopied] = useState(false);
  const translateMutation = useTranslate();

  const handleCopy = useCallback(() => {
    const plain = story.story.replace(/\*\*/g, "");
    navigator.clipboard.writeText(plain).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [story.story]);

  const handleTranslate = async () => {
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
      {/* Story image */}
      <div className="overflow-hidden rounded-lg border">
        <img
          src={`/api/stories/${story.id}/image`}
          alt="Story illustration"
          className="aspect-video w-full object-cover"
          loading="lazy"
        />
      </div>

      {/* Story text -- clickable words + copy */}
      <div className="group relative rounded-lg border bg-card p-4">
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2 right-2 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
          title="复制文本"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
        <InteractiveStory story={story.story} onWordClick={onWordClick} />
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
      <TtsPlayer storyId={story.id} storyText={story.story} />

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
