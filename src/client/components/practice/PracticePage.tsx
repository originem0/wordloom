import { useState, useMemo } from "react";
import { Loader2, Trash2, Clock, Sparkles } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Card, CardContent } from "@/client/components/ui/card";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { PracticeView } from "./PracticeView";
import { usePractices } from "@/client/hooks/usePractice";
import { useTaskStore } from "@/client/store/tasks";
import type { Practice } from "@/shared/types";

const STYLE_OPTIONS = [
  { key: "documentary", label: "纪实摄影" },
  { key: "cinematic", label: "电影感" },
  { key: "watercolor", label: "水彩" },
  { key: "retro-film", label: "复古胶片" },
  { key: "anime", label: "日系动画" },
] as const;

function PracticeInner() {
  const [page, setPage] = useState(1);
  const limit = 10;
  const { practicesQuery, deleteMutation } = usePractices({ page, limit });
  const submitPractice = useTaskStore((s) => s.submitPractice);

  const tasks = useTaskStore((s) => s.tasks);
  const runningTasks = useMemo(
    () => tasks.filter((t) => t.type === "practice" && t.status === "running"),
    [tasks],
  );

  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<string>("documentary");
  const [activePractice, setActivePractice] = useState<Practice | null>(null);

  const handleGenerate = () => {
    submitPractice(topic.trim(), style);
    setTopic("");
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("确定删除这道练习题吗？对应图片也会被清理。")) return;
    await deleteMutation.mutateAsync(id);
    if (activePractice?.id === id) setActivePractice(null);
  };

  const practices = practicesQuery.data?.practices ?? [];
  const total = practicesQuery.data?.total ?? 0;
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
        <h2 className="text-2xl font-semibold">看图说话</h2>
        <p className="text-sm text-muted-foreground">
          AI 出图，你用英语描述，即时批改——练表达，对抗中式直译。
        </p>
      </section>

      {/* ---- Generation section ---- */}
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">主题（可选）</label>
          <input
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none dark:bg-input/30"
            placeholder="例：清晨的菜市场 / 雨天的咖啡馆（留空则 AI 自由出题）"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleGenerate();
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">风格</label>
          <div className="flex flex-wrap gap-1.5">
            {STYLE_OPTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStyle(s.key)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  style === s.key
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <Button type="button" onClick={handleGenerate} className="w-full md:w-auto">
          <Sparkles className="size-3.5" />
          出一道题
        </Button>
        {runningTasks.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {runningTasks.length} 道题正在生成中（生图较慢，约 1 分钟），可在任务队列查看
          </p>
        )}
      </section>

      {/* ---- Active practice ---- */}
      {activePractice && (
        <section>
          <PracticeView key={activePractice.id} practice={activePractice} />
        </section>
      )}

      {/* ---- History ---- */}
      {practices.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">历史练习</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {practices.map((p: Practice) => (
              <Card
                key={p.id}
                className={`group cursor-pointer transition-shadow hover:shadow-md ${
                  activePractice?.id === p.id ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => setActivePractice(p)}
              >
                <CardContent className="flex items-start gap-3">
                  <img
                    src={`/api/practice/${p.id}/image`}
                    alt=""
                    className="size-16 shrink-0 rounded-md object-cover"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm">
                      {p.topic || p.taskBrief || p.visualPrompt.slice(0, 80)}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      {timeAgo(p.createdAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 min-h-8 min-w-8 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(p.id);
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
              disabled={page === 1 || practicesQuery.isFetching}
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
              disabled={practicesQuery.isFetching || page >= totalPages}
            >
              下一页
            </Button>
          </div>
        </section>
      )}

      {practicesQuery.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export function PracticePage() {
  return (
    <ModuleErrorBoundary>
      <PracticeInner />
    </ModuleErrorBoundary>
  );
}
