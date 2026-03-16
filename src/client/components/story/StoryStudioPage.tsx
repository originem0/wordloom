import { useState, useCallback, useMemo } from "react";
import { Loader2, Trash2, Clock } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Card, CardContent } from "@/client/components/ui/card";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { ImageUploader } from "./ImageUploader";
import { StoryView } from "./StoryView";
import { useStories } from "@/client/hooks/useStories";
import type { Story } from "@/shared/types";

function StoryStudioInner() {
  const { storiesQuery, generateMutation, deleteMutation } = useStories();

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [activeStory, setActiveStory] = useState<Story | null>(null);

  const handleImageSelect = useCallback((file: File) => {
    setImageFile(file);
    // Revoke previous blob URL to avoid memory leak
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const handleGenerate = async () => {
    if (!imageFile) return;
    const result = await generateMutation.mutateAsync({
      image: imageFile,
      prompt,
    });
    setActiveStory(result);
  };

  const handleWordClick = useCallback((word: string) => {
    // For now, log to console. Word Forge integration will come later.
    console.log("Word clicked:", word);
  }, []);

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    if (activeStory?.id === id) setActiveStory(null);
  };

  const stories = storiesQuery.data ?? [];

  // Format relative time in Chinese
  const timeAgo = useMemo(
    () => (ts: number) => {
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60_000);
      if (mins < 1) return "刚刚";
      if (mins < 60) return `${mins}分钟前`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}小时前`;
      const days = Math.floor(hours / 24);
      return `${days}天前`;
    },
    [],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-6">
      {/* ---- Generation section ---- */}
      <section className="grid gap-4 md:grid-cols-2">
        <ImageUploader
          onImageSelect={handleImageSelect}
          imagePreview={imagePreview}
        />
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">
            描述 / 指令 (可选)
          </label>
          <Input
            placeholder="例：Write a story about this place for a B1 English learner..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
              }
            }}
          />
          <Button
            onClick={handleGenerate}
            disabled={!imageFile || generateMutation.isPending}
            className="w-full md:w-auto"
          >
            {generateMutation.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {generateMutation.isPending ? "生成中..." : "生成故事"}
          </Button>

          {generateMutation.isError && (
            <p className="text-sm text-destructive">
              {generateMutation.error.message}
            </p>
          )}
        </div>
      </section>

      {/* ---- Active story ---- */}
      {activeStory && (
        <section>
          <StoryView story={activeStory} onWordClick={handleWordClick} />
        </section>
      )}

      {/* ---- Story history ---- */}
      {stories.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">历史故事</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {stories.map((s) => (
              <Card
                key={s.id}
                className={`group cursor-pointer transition-shadow hover:shadow-md ${
                  activeStory?.id === s.id ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => setActiveStory(s)}
              >
                <CardContent className="flex items-start gap-3">
                  <img
                    src={`/api/stories/${s.id}/image`}
                    alt=""
                    className="size-16 shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm">
                      {s.story.slice(0, 120)}...
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      {timeAgo(s.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 min-h-8 min-w-8 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(s.id);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Loading state for stories list */}
      {storiesQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export function StoryStudioPage() {
  return (
    <ModuleErrorBoundary>
      <StoryStudioInner />
    </ModuleErrorBoundary>
  );
}
