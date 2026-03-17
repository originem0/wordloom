import { create } from "zustand";
import { toast } from "sonner";
import { queryClient } from "../lib/query-client";
import type { Story, CardGenerateResult } from "../../shared/types";

export type TaskStatus = "running" | "done" | "failed" | "cancelled";
export type TaskType = "story" | "cards";

export interface Task {
  id: string;
  type: TaskType;
  label: string;
  status: TaskStatus;
  error?: string;
  result?: Story | CardGenerateResult;
  createdAt: number;
}

// AbortControllers stored outside Zustand (non-serializable)
const controllers = new Map<string, AbortController>();
let seq = 0;

function genId() {
  return `t-${Date.now()}-${++seq}`;
}

function updateTask(id: string, patch: Partial<Task>) {
  useTaskStore.setState((s) => ({
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

export const useTaskStore = create<{
  tasks: Task[];
  submitStory: (image: File, prompt: string) => string;
  submitCards: (words: string[]) => string;
  cancelTask: (id: string) => void;
  removeTask: (id: string) => void;
  clearDone: () => void;
}>((set) => ({
  tasks: [],

  submitStory(image: File, prompt: string) {
    const id = genId();
    const ac = new AbortController();
    controllers.set(id, ac);

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

    fetch("/api/stories/generate", {
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
        return res.json() as Promise<Story>;
      })
      .then((result) => {
        updateTask(id, { status: "done", result });
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
      .finally(() => controllers.delete(id));

    return id;
  },

  submitCards(words: string[]) {
    const id = genId();
    const ac = new AbortController();
    controllers.set(id, ac);

    const unique = Array.from(
      new Map(words.map((w) => [w.toLowerCase(), w])).values(),
    );
    const label = `生成 ${unique.length} 张单词卡`;

    set((s) => ({
      tasks: [
        {
          id,
          type: "cards" as const,
          label,
          status: "running" as const,
          createdAt: Date.now(),
        },
        ...s.tasks,
      ],
    }));

    fetch("/api/cards/generate", {
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
        return res.json() as Promise<CardGenerateResult>;
      })
      .then((result) => {
        const ok = result.success.length;
        const fail = result.failed.length;
        const doneLabel =
          fail > 0 ? `${ok} 张已创建, ${fail} 张失败` : `${ok} 张单词卡已创建`;
        updateTask(id, { status: "done", result, label: doneLabel });
        queryClient.invalidateQueries({ queryKey: ["cards"] });
        if (fail > 0) {
          toast.warning(doneLabel);
        } else {
          toast.success(doneLabel);
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          updateTask(id, { status: "cancelled" });
        } else {
          updateTask(id, { status: "failed", error: err.message });
          toast.error(`单词卡生成失败: ${err.message}`);
        }
      })
      .finally(() => controllers.delete(id));

    return id;
  },

  cancelTask(id: string) {
    const ac = controllers.get(id);
    if (ac) ac.abort();
  },

  removeTask(id: string) {
    const ac = controllers.get(id);
    if (ac) ac.abort();
    controllers.delete(id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  clearDone() {
    set((s) => ({
      tasks: s.tasks.filter((t) => t.status === "running"),
    }));
  },
}));
