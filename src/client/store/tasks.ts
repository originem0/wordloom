import { create } from "zustand";
import { toast } from "sonner";
import { queryClient } from "../lib/query-client";
import type { CardGenerateResult } from "../../shared/types";
import { errorMessage, translate } from "../lib/i18n";
import { ApiError } from "../lib/api";

export type TaskStatus = "running" | "done" | "failed" | "cancelled";

type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

type JobResponse = {
  id: string;
  status: JobStatus;
  result?: unknown;
  error?: string | null;
};

export interface Task {
  id: string;
  label: string;
  status: TaskStatus;
  error?: string;
  errorText?: readonly [string, string];
  errorCause?: Error;
  result?: CardGenerateResult;
  createdAt: number;
  jobId?: string;
  wordCount?: number;
}

const submitControllers = new Map<string, AbortController>();
const pollTimers = new Map<string, number>();
// Consecutive failed polls per task. Transient errors (a 502 during a deploy,
// a dropped connection) are retried, but not forever: ~5 minutes of nothing
// but failures means the job's outcome is unknowable from here.
const pollFailures = new Map<string, number>();
const POLL_RETRY_MS = 2500;
const MAX_POLL_FAILURES = 120;

function failTask(taskId: string, error: string | Error | readonly [string, string]) {
  clearPoll(taskId);
  // A task dropped while its poll was in flight (removed, or everything reset
  // at sign-out) has nobody left to report to.
  if (!useTaskStore.getState().tasks.some((t) => t.id === taskId)) return;
  // Keep labels or the original cause so a visible failure can be translated
  // again after a language switch. The string stays for existing task readers.
  const errorText = typeof error === "string" || error instanceof Error ? undefined : error;
  const errorCause = error instanceof Error ? error : undefined;
  const message = errorText ? translate(...errorText) : errorMessage(errorCause ?? new Error(error as string));
  updateTask(taskId, { status: "failed", error: message, errorText, errorCause });
  toast.error(translate(`词卡生成失败：${message}`, `Card generation failed: ${message}`));
}
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
  pollFailures.delete(taskId);
}

function cardsDoneLabel(result: CardGenerateResult): string {
  const ok = result.success.length;
  const fail = result.failed.length;
  const existingCount = result.existing?.length ?? 0;
  const newCount = ok - existingCount;

  if (existingCount > 0 && newCount === 0) {
    return translate(`${existingCount} 个词已存在`, `${existingCount} words already exist`);
  }
  if (existingCount > 0) {
    return translate(`已创建 ${newCount} 张新卡，${existingCount} 个词已存在`, `${newCount} new cards created, ${existingCount} words already exist`);
  }
  if (fail > 0) {
    return translate(`已创建 ${ok} 张，${fail} 张失败`, `${ok} cards created, ${fail} failed`);
  }
  return translate(`已创建 ${ok} 张词卡`, `${ok} cards created`);
}

/** Stored task data stays language-neutral; labels are recomputed when the
 * panel rerenders so switching languages also updates work already in flight. */
export function taskLabel(task: Task): string {
  if (task.result) return cardsDoneLabel(task.result);
  if (task.wordCount != null) return translate(`生成 ${task.wordCount} 张词卡`, `Generate ${task.wordCount} cards`);
  return task.label;
}

export function taskError(task: Task): string {
  if (task.errorText) return translate(...task.errorText);
  return errorMessage(task.errorCause ?? new Error(task.error ?? ""));
}

async function pollJob(taskId: string) {
  const task = useTaskStore.getState().tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "running" || !task.jobId) {
    clearPoll(taskId);
    return;
  }

  try {
    const res = await fetch(`/api/jobs/${task.jobId}`, { credentials: "include" });
    // 404 is definitive — the server has no such job and never will.
    if (res.status === 404) {
      failTask(taskId, ["任务不存在或已过期", "The task does not exist or has expired"]);
      return;
    }
    // So is 401: jobs are the admin's, and asking again without a session
    // cannot start working. The job itself carries on regardless.
    if (res.status === 401) {
      failTask(taskId, ["登录已失效，重新登录后可在词库中查看结果", "Your session has expired. Sign in again to view the results"]);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const job = (await res.json()) as JobResponse;
    pollFailures.delete(taskId);

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
      failTask(taskId, job.error || ["未知错误", "Unknown error"]);
      return;
    }

    // done
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
    const failures = (pollFailures.get(taskId) ?? 0) + 1;
    if (failures >= MAX_POLL_FAILURES) {
      failTask(taskId, ["长时间无法连接服务器，请稍后在列表中查看结果", "The server has been unreachable. Check the card list later"]);
      return;
    }
    pollFailures.set(taskId, failures);
    const timer = window.setTimeout(() => pollJob(taskId), POLL_RETRY_MS);
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
  submitCards: (words: string[]) => string;
  cancelTask: (id: string) => Promise<void> | void;
  removeTask: (id: string) => void;
  clearDone: () => void;
  reset: () => void;
}>((set) => ({
  tasks: [],

  submitCards(words: string[]) {
    const id = genId();
    const ac = new AbortController();
    submitControllers.set(id, ac);

    const unique = Array.from(new Map(words.map((w) => [w.toLowerCase(), w])).values());

    set((s) => ({
      tasks: [
        {
          id,
          label: translate(`生成 ${unique.length} 张词卡`, `Generate ${unique.length} cards`),
          wordCount: unique.length,
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
          throw new ApiError(
            typeof body.error === "string" ? body.error : `HTTP ${res.status}`,
            res.status,
            typeof body.code === "string" ? body.code : undefined,
          );
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
          failTask(id, err instanceof Error ? err : new Error(errorMessage(err)));
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

  // Sign-out: the tasks were the admin's, and following them needs the session
  // that just ended. The jobs themselves are left to finish on the server.
  reset() {
    for (const id of [...pollTimers.keys()]) clearPoll(id);
    for (const controller of submitControllers.values()) controller.abort();
    submitControllers.clear();
    set({ tasks: [] });
  },
}));
