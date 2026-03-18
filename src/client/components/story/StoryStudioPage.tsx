import { useState, useCallback, useMemo } from "react";
import { Loader2, Trash2, Clock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { ImageUploader } from "./ImageUploader";
import { StoryView } from "./StoryView";
import { useStories } from "@/client/hooks/useStories";
import { useTaskStore } from "@/client/store/tasks";
import { apiFetch } from "@/client/lib/api";
import { toast } from "sonner";
import type { Story, Card as CardType } from "@/shared/types";

function StoryStudioInner() {
  const [page, setPage] = useState(1);
  const limit = 10;
  const { storiesQuery, deleteMutation } = useStories({ page, limit });
  const submitStory = useTaskStore((s) => s.submitStory);
  const submitCards = useTaskStore((s) => s.submitCards);
  const navigate = useNavigate();

  // Avoid returning a new array from the store selector (React 19 + useSyncExternalStore).
  const tasks = useTaskStore((s) => s.tasks);
  const runningStoryTasks = useMemo(
    () => tasks.filter((t) => t.type === "story" && t.status === "running"),
    [tasks],
  );

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [activeStory, setActiveStory] = useState<Story | null>(null);

  const handleImageSelect = useCallback((file: File) => {
    setImageFile(file);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const handleGenerate = () => {
    if (!imageFile) return;
    submitStory(imageFile, prompt);
    // Clear form so user can queue another
    setImageFile(null);
    setImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPrompt("");
  };

  const handleWordClick = useCallback(
    async (word: string) => {
      const cleaned = word.replace(/[^a-zA-Z'-]/g, "").trim();
      if (!cleaned) return;
      // Check if card already exists
      try {
        const res = await apiFetch<{ cards: CardType[]; total: number }>(
          `/api/cards?search=${encodeURIComponent(cleaned)}&limit=1`,
        );
        const match = res.cards.find(
          (c) => c.word.toLowerCase() === cleaned.toLowerCase(),
        );
        if (match) {
          toast.info(`"${match.word}" 已有卡片，跳转中…`);
          navigate("/cards");
          return;
        }
      } catch {
        // Network error — fall through to generate
      }
      submitCards([cleaned]);
    },
    [submitCards, navigate],
  );

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    if (activeStory?.id === id) setActiveStory(null);
  };

  const stories = storiesQuery.data?.stories ?? [];
  const total = storiesQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

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
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:space-y-8 md:p-6">
      <section className="space-y-1">
        <h2 className="text-2xl font-semibold">Story Studio</h2>
        <p className="text-sm text-muted-foreground">上传图片生成故事，双击单词直接进词卡闭环。</p>
      </section>

      {/* ---- Generation section ---- */}
      <section className="grid gap-4 md:grid-cols-2">
        <ImageUploader
          onImageSelect={handleImageSelect}
          imagePreview={imagePreview}
        />
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors text-left"
            onClick={() => setPromptOpen((v) => !v)}
          >
            <span className={`inline-block transition-transform text-xs ${promptOpen ? "rotate-90" : ""}`}>▶</span>
            自定义指令 (可选)
            {prompt && !promptOpen && <span className="text-xs text-primary ml-1">已填写</span>}
          </button>
          {promptOpen && (
            <textarea
              className="min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none dark:bg-input/30 resize-y"
              placeholder="例：用简洁有力的散文风格，像 essay 不像作文。150词以内…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          )}
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={!imageFile}
            className="w-full md:w-auto"
          >
            生成故事
          </Button>

          {runningStoryTasks.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {runningStoryTasks.length} 个故事正在生成中，可在任务队列查看进度
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
            {stories.map((s: Story) => (
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
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1 || storiesQuery.isFetching}
            >
              上一页
            </Button>
            <span className="text-xs text-muted-foreground">
              第 {page} / {totalPages} 页 · 共 {total} 条
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={storiesQuery.isFetching || page >= totalPages}
            >
              下一页
            </Button>
          </div>
        </section>
      )}

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
