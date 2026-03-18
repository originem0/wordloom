import { create } from "zustand";
import { toast } from "sonner";
import { queryClient } from "../lib/query-client";
import type { Story, CardGenerateResult } from "../../shared/types";

export type TaskStatus = "running" | "done" | "failed" | "cancelled";
export type TaskType = "story" | "cards";

type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

type JobResponse = {
  id: string;
  type: TaskType;
  status: JobStatus;
  result?: unknown;
  error?: string | null;
};

export interface Task {
  id: string;
  type: TaskType;
  label: string;
  status: TaskStatus;
  error?: string;
  result?: Story | CardGenerateResult;
  createdAt: number;
  jobId?: string;
}

const submitControllers = new Map<string, AbortController>();
const pollTimers = new Map<string, number>();
let seq = 0;

function genId() {
  return `t-${Date.now()}-${++seq}`;
}

function updateTask(id: string, patch: Partial<Task>) {
  useTaskStore.setState((s) => ({
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

function clearPoll(taskId: string) {
  const timer = pollTimers.get(taskId);
  if (timer) clearTimeout(timer);
  pollTimers.delete(taskId);
}

function cardsDoneLabel(result: CardGenerateResult): string {
  const ok = result.success.length;
  const fail = result.failed.length;
  const existingCount = result.existing?.length ?? 0;
  const newCount = ok - existingCount;

  if (existingCount > 0 && newCount === 0) {
    return `${existingCount} 个词已存在`;
  }
  if (existingCount > 0) {
    return `${newCount} 张新卡已创建, ${existingCount} 个词已存在`;
  }
  if (fail > 0) {
    return `${ok} 张已创建, ${fail} 张失败`;
  }
  return `${ok} 张单词卡已创建`;
}

async function pollJob(taskId: string) {
  const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "running" || !task.jobId) {
    clearPoll(taskId);
    return;
  }

  try {
    const res = await fetch(`/api/jobs/${task.jobId}`, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const job = (await res.json()) as JobResponse;

    if (job.status === "queued" || job.status === "running") {
      const timer = window.setTimeout(() => pollJob(taskId), 1800);
      pollTimers.set(taskId, timer);
      return;
    }

    clearPoll(taskId);

    if (job.status === "cancelled") {
      updateTask(taskId, { status: "cancelled" });
      return;
    }

    if (job.status === "failed") {
      updateTask(taskId, {
        status: "failed",
        error: job.error || "任务失败",
      });
      toast.error(`${task.type === "story" ? "故事" : "单词卡"}生成失败: ${job.error || "未知错误"}`);
      return;
    }

    // done
    if (task.type === "story") {
      const result = job.result as Story;
      updateTask(taskId, { status: "done", result, label: "故事生成完成" });
      queryClient.invalidateQueries({ queryKey: ["stories"] });
      toast.success("故事生成完成");
      return;
    }

    const result = job.result as CardGenerateResult;
    const doneLabel = cardsDoneLabel(result);
    updateTask(taskId, { status: "done", result, label: doneLabel });
    queryClient.invalidateQueries({ queryKey: ["cards"] });

    const existingCount = result.existing?.length ?? 0;
    const newCount = result.success.length - existingCount;
    if (existingCount > 0 && newCount === 0) {
      toast.info(doneLabel);
    } else if (result.failed.length > 0) {
      toast.warning(doneLabel);
    } else {
      toast.success(doneLabel);
    }
  } catch {
    // transient network error: keep polling while task is still running
    const timer = window.setTimeout(() => pollJob(taskId), 2500);
    pollTimers.set(taskId, timer);
  }
}

function startPolling(taskId: string, jobId: string) {
  updateTask(taskId, { jobId, status: "running" });
  clearPoll(taskId);
  const timer = window.setTimeout(() => pollJob(taskId), 800);
  pollTimers.set(taskId, timer);
}

export const useTaskStore = create<{
  tasks: Task[];
  submitStory: (image: File, prompt: string) => string;
  submitCards: (words: string[]) => string;
  cancelTask: (id: string) => Promise<void> | void;
  removeTask: (id: string) => void;
  clearDone: () => void;
}>((set) => ({
  tasks: [],

  submitStory(image: File, prompt: string) {
    const id = genId();
    const ac = new AbortController();
    submitControllers.set(id, ac);

    set((s) => ({
      tasks: [
        {
          id,
          type: "story" as const,
          label: "生成故事",
          status: "running" as const,
          createdAt: Date.now(),
        },
        ...s.tasks,
      ],
    }));

    const form = new FormData();
    form.append("image", image);
    form.append("prompt", prompt);

    fetch("/api/stories/generate?async=1", {
      method: "POST",
      body: form,
      credentials: "include",
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        const body = (await res.json()) as { jobId?: string; status?: string } | Story;
        if ("jobId" in body && body.jobId) {
          startPolling(id, body.jobId);
          return;
        }

        // fallback for any unexpected sync response
        updateTask(id, { status: "done", result: body as Story, label: "故事生成完成" });
        queryClient.invalidateQueries({ queryKey: ["stories"] });
        toast.success("故事生成完成");
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          updateTask(id, { status: "cancelled" });
        } else {
          updateTask(id, { status: "failed", error: err.message });
          toast.error(`故事生成失败: ${err.message}`);
        }
      })
      .finally(() => submitControllers.delete(id));

    return id;
  },

  submitCards(words: string[]) {
    const id = genId();
    const ac = new AbortController();
    submitControllers.set(id, ac);

    const unique = Array.from(new Map(words.map((w) => [w.toLowerCase(), w])).values());

    set((s) => ({
      tasks: [
        {
          id,
          type: "cards" as const,
          label: `生成 ${unique.length} 张单词卡`,
          status: "running" as const,
          createdAt: Date.now(),
        },
        ...s.tasks,
      ],
    }));

    fetch("/api/cards/generate?async=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: unique }),
      credentials: "include",
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        const body = (await res.json()) as { jobId?: string; status?: string } | CardGenerateResult;
        if ("jobId" in body && body.jobId) {
          startPolling(id, body.jobId);
          return;
        }

        // fallback for unexpected sync response
        const doneLabel = cardsDoneLabel(body as CardGenerateResult);
        updateTask(id, { status: "done", result: body as CardGenerateResult, label: doneLabel });
        queryClient.invalidateQueries({ queryKey: ["cards"] });
        toast.success(doneLabel);
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          updateTask(id, { status: "cancelled" });
        } else {
          updateTask(id, { status: "failed", error: err.message });
          toast.error(`单词卡生成失败: ${err.message}`);
        }
      })
      .finally(() => submitControllers.delete(id));

    return id;
  },

  async cancelTask(id: string) {
    const task = useTaskStore.getState().tasks.find((t) => t.id === id);
    if (!task) return;

    clearPoll(id);

    const submitController = submitControllers.get(id);
    if (submitController) submitController.abort();

    if (task.jobId) {
      try {
        await fetch(`/api/jobs/${task.jobId}/cancel`, {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // ignore best-effort cancel
      }
    }

    updateTask(id, { status: "cancelled" });
  },

  removeTask(id: string) {
    clearPoll(id);
    const submitController = submitControllers.get(id);
    if (submitController) submitController.abort();
    submitControllers.delete(id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  clearDone() {
    set((s) => ({
      tasks: s.tasks.filter((t) => t.status === "running"),
    }));
  },
}));