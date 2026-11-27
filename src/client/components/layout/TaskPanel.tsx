import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  ChevronUp,
  ChevronDown,
  Layers,
  Ban,
} from "lucide-react";
import { taskError, taskLabel, useTaskStore, type Task } from "@/client/store/tasks";
import { Button } from "@/client/components/ui/button";
import { useI18n } from "@/client/lib/i18n";

function StatusBadge({ status }: { status: Task["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />;
    case "done":
      return <CheckCircle2 className="size-3.5 shrink-0 text-green-500" />;
    case "failed":
      return <XCircle className="size-3.5 shrink-0 text-red-500" />;
    case "cancelled":
      return <Ban className="size-3.5 shrink-0 text-muted-foreground" />;
  }
}

function TaskItem({ task }: { task: Task }) {
  const { t } = useI18n();
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const removeTask = useTaskStore((s) => s.removeTask);

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      <Layers className="size-3.5 shrink-0 text-muted-foreground" />
      <StatusBadge status={task.status} />
      <span className="min-w-0 flex-1 truncate">
        {taskLabel(task)}
        {task.status === "failed" && task.error && (
          <span className="ml-1 text-xs text-destructive"> · {taskError(task)}</span>
        )}
        {task.status === "cancelled" && (
          <span className="ml-1 text-xs text-muted-foreground"> · {t("已取消", "Cancelled")}</span>
        )}
      </span>
      {task.status === "running" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          disabled={task.cancelRequested}
          onClick={() => cancelTask(task.id)}
          title={t("取消", "Cancel")}
          aria-label={t("取消任务", "Cancel task")}
        >
          <X className="size-3" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          onClick={() => removeTask(task.id)}
          title={t("移除", "Remove")}
          aria-label={t("移除任务", "Remove task")}
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}

export function TaskPanel() {
  const { t } = useI18n();
  const tasks = useTaskStore((s) => s.tasks);
  const clearDone = useTaskStore((s) => s.clearDone);
  const [collapsed, setCollapsed] = useState(false);

  if (tasks.length === 0) return null;

  const running = tasks.filter((t) => t.status === "running").length;
  const finished = tasks.filter((t) => t.status !== "running").length;

  return (
    <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] left-2 right-2 z-50 mx-auto w-auto max-w-sm rounded-lg border bg-background shadow-lg md:bottom-4 md:left-auto md:right-4 md:w-80">
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 border-b select-none"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          {running > 0 && (
            <Loader2 className="size-3.5 animate-spin text-blue-500" />
          )}
          {t("任务队列", "Tasks")}
          {running > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {t(`${running} 进行中`, `${running} running`)}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1">
          {finished > 0 && (
            <span
              role="button"
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                clearDone();
              }}
            >
              {t("清除", "Clear")}
            </span>
          )}
          {collapsed ? (
            <ChevronUp className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </span>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="max-h-60 overflow-y-auto divide-y">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
