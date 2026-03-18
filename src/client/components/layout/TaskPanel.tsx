import { useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  ChevronUp,
  ChevronDown,
  Layers,
  BookOpen,
  Ban,
} from "lucide-react";
import { useTaskStore, type Task } from "@/client/store/tasks";
import { Button } from "@/client/components/ui/button";

function TaskIcon({ type }: { type: Task["type"] }) {
  return type === "story" ? (
    <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
  ) : (
    <Layers className="size-3.5 shrink-0 text-muted-foreground" />
  );
}

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
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const removeTask = useTaskStore((s) => s.removeTask);

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm">
      <TaskIcon type={task.type} />
      <StatusBadge status={task.status} />
      <span className="min-w-0 flex-1 truncate">
        {task.label}
        {task.status === "failed" && task.error && (
          <span className="ml-1 text-xs text-destructive">— {task.error}</span>
        )}
        {task.status === "cancelled" && (
          <span className="ml-1 text-xs text-muted-foreground">— 已取消</span>
        )}
      </span>
      {task.status === "running" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          onClick={() => cancelTask(task.id)}
          title="取消"
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
          title="移除"
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}

export function TaskPanel() {
  const tasks = useTaskStore((s) => s.tasks);
  const clearDone = useTaskStore((s) => s.clearDone);
  const [collapsed, setCollapsed] = useState(false);

  if (tasks.length === 0) return null;

  const running = tasks.filter((t) => t.status === "running").length;
  const finished = tasks.filter((t) => t.status !== "running").length;

  return (
    <div className="fixed bottom-20 left-2 right-2 z-50 mx-auto w-auto max-w-sm rounded-lg border bg-background shadow-lg md:bottom-4 md:left-auto md:right-4 md:w-80">
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
          任务队列
          {running > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              {running} 进行中
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
              清除
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
