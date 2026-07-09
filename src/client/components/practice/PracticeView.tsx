import { useState } from "react";
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  MessageSquareQuote,
} from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { SceneFramePanel } from "@/client/components/story/SceneFramePanel";
import { useGradePractice } from "@/client/hooks/usePractice";
import { toast } from "sonner";
import type { Practice, PracticeFeedback } from "@/shared/types";

// Mount with `key={practice.id}` so switching questions resets answer + feedback.
export function PracticeView({ practice }: { practice: Practice }) {
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const grade = useGradePractice();

  const handleSubmit = async () => {
    const text = description.trim();
    if (!text) return;
    try {
      const fb = await grade.mutateAsync({ id: practice.id, description: text });
      setFeedback(fb);
    } catch (e) {
      toast.error(`批改失败: ${e instanceof Error ? e.message : "未知错误"}`);
    }
  };

  const hasOpeners = practice.suggestedChunks.length > 0 || !!practice.starterLine;

  return (
    <div className="space-y-4">
      {/* The picture to describe */}
      <div className="overflow-hidden rounded-lg border">
        <img
          src={`/api/practice/${practice.id}/image`}
          alt="Describe this scene"
          className="aspect-square w-full object-cover"
          loading="lazy"
        />
      </div>

      {/* Task brief */}
      {practice.taskBrief && (
        <div className="rounded-lg border bg-card p-3 text-sm">
          <span className="mr-1 font-medium">任务</span>
          {practice.taskBrief}
        </div>
      )}

      {/* "How to start" — chunk scaffolds + a ready-made opening line */}
      {hasOpeners && (
        <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <MessageSquareQuote className="size-3.5" />
            可以这样开口
          </p>
          {practice.starterLine && (
            <p className="text-sm italic text-foreground">“{practice.starterLine}”</p>
          )}
          {practice.suggestedChunks.length > 0 && (
            <ul className="space-y-1.5">
              {practice.suggestedChunks.map((ch, i) => (
                <li key={i}>
                  <span className="font-mono text-[13px] font-medium text-foreground">
                    {ch.form}
                  </span>
                  {ch.example && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {ch.example}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Scene scaffold — collapsed; peek only when stuck */}
      {practice.sceneFrame && <SceneFramePanel frame={practice.sceneFrame} />}

      {/* Answer box */}
      <div className="space-y-2">
        <textarea
          className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none dark:bg-input/30 resize-y"
          placeholder="用英语描述这张图…（先自己写，卡住了再看上面的开口提示或脚手架）"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!description.trim() || grade.isPending}
          >
            {grade.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            提交批改
          </Button>
          {feedback && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFeedback(null);
                setDescription("");
              }}
            >
              <RotateCcw className="size-3.5" />
              再写一次
            </Button>
          )}
        </div>
      </div>

      {feedback && <FeedbackPanel feedback={feedback} />}
    </div>
  );
}

function FeedbackPanel({ feedback }: { feedback: PracticeFeedback }) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {feedback.overall && <p className="text-sm font-medium">{feedback.overall}</p>}

      {feedback.good.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-green-600 dark:text-green-400">做得好</p>
          <ul className="space-y-1">
            {feedback.good.map((g, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green-500" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.improve.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">可以更好</p>
          <ul className="space-y-2">
            {feedback.improve.map((it, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-foreground">{it.point}</p>
                  <p className="text-muted-foreground">{it.suggestion}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.usedSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
          <span className="text-xs text-muted-foreground">开口表达：</span>
          {feedback.usedSuggestions.map((t) => (
            <span
              key={t.form}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] ${
                t.used
                  ? "bg-green-500/10 text-green-700 dark:text-green-300"
                  : "bg-muted text-muted-foreground line-through"
              }`}
            >
              {t.used && <CheckCircle2 className="size-2.5" />}
              {t.form}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
