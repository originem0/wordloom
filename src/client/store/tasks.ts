import { create } from "zustand";
import { toast } from "sonner";
import { queryClient } from "../lib/query-client";
import type { Story, Card, CardGenerateResult } from "../../shared/types";

export type TaskStatus = "running" | "verifying" | "done" | "failed" | "cancelled";
export type TaskType = "story" | "cards";

export interface TaskMeta {
  prompt?: string;
  words?: string[];
}

export interface Task {
  id: string;
  type: TaskType;
  label: string;
  status: TaskStatus;
  error?: string;
  result?: Story | CardGenerateResult;
  createdAt: number;
  meta?: TaskMeta;
}

// AbortControllers stored outside Zustand (non-serializable)
const controllers = new Map<string, AbortController>();
const verifyTimers = new Map<string, number>();
let seq = 0;

function genId() {
  return `t-${Date.now()}-${++seq}`;
}

function updateTask(id: string, patch: Partial<Task>) {
  useTaskStore.setState((s) => ({
    tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

function clearVerify(id: string) {
  const t = verifyTimers.get(id);
  if (t) clearTimeout(t);
  verifyTimers.delete(id);
}

function scheduleVerify(id: string, fn: () => void, delay: number) {
  clearVerify(id);
  const t = window.setTimeout(() => {
    verifyTimers.delete(id);
    fn();
  }, delay);
  verifyTimers.set(id, t);
}

const STORY_VERIFY_DELAYS = [6000, 15000];
const CARDS_VERIFY_DELAYS = [6000, 15000];

async function recoverStory(id: string, prompt: string, createdAt: number, attempt = 0) {
  const task = useTaskStore.getState().tasks.find((t) => t.id === id);
  if (!task || task.status === "cancelled") return;
  try {
    const res = await fetch(`/api/stories?page=1&limit=6`, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { stories: Story[] };
    const match = body.stories.find(
      (s) => s.prompt === prompt && s.createdAt >= createdAt - 60_000,
    );
    if (match) {
      clearVerify(id);
      updateTask(id, { status: "done", result: match, error: undefined, label: "故事生成完成" });
      queryClient.invalidateQueries({ queryKey: ["stories"] });
      toast.success("故事生成完成（后台确认）");
      return;
    }
  } catch {
    // ignore, we'll retry below
  }

  if (attempt < STORY_VERIFY_DELAYS.length) {
    scheduleVerify(id, () => recoverStory(id, prompt, createdAt, attempt + 1), STORY_VERIFY_DELAYS[attempt]);
  } else {
    clearVerify(id);
    updateTask(id, { status: "failed", error: "未确认生成结果" });
  }
}

async function recoverCards(id: string, words: string[], createdAt: number, attempt = 0) {
  const task = useTaskStore.getState().tasks.find((t) => t.id === id);
  if (!task || task.status === "cancelled") return;
  try {
    const checks = await Promise.all(
      words.map(async (word) => {
        const res = await fetch(`/api/cards?search=${encodeURIComponent(word)}&limit=5`, {
          credentials: "include",
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { cards: { word: string; createdAt: number }[] };
        const found = body.cards.find((c) => c.word.toLowerCase() === word.toLowerCase());
        return Boolean(found && found.createdAt >= createdAt - 60_000);
      }),
    );

    if (checks.every(Boolean)) {
      clearVerify(id);
      updateTask(id, { status: "done", error: undefined, label: "单词卡生成完成" });
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      toast.success("单词卡生成完成（后台确认）");
      return;
    }
  } catch {
    // ignore
  }

  if (attempt < CARDS_VERIFY_DELAYS.length) {
    scheduleVerify(id, () => recoverCards(id, words, createdAt, attempt + 1), CARDS_VERIFY_DELAYS[attempt]);
  } else {
    clearVerify(id);
    updateTask(id, { status: "failed", error: "未确认生成结果" });
  }
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
    const createdAt = Date.now();

    set((s) => ({
      tasks: [
        {
          id,
          type: "story" as const,
          label: "生成故事",
          status: "running" as const,
          createdAt,
          meta: { prompt },
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
          updateTask(id, { status: "verifying", error: undefined, label: "生成失败，确认中" });
          toast.warning("故事生成失败，正在确认后台结果…");
          recoverStory(id, prompt, createdAt, 0);
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

    const createdAt = Date.now();

    set((s) => ({
      tasks: [
        {
          id,
          type: "cards" as const,
          label,
          status: "running" as const,
          createdAt,
          meta: { words: unique },
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
        const existingCount = result.existing?.length ?? 0;
        const newCount = ok - existingCount;
        let doneLabel: string;
        if (existingCount > 0 && newCount === 0) {
          doneLabel = `${existingCount} 个词已存在`;
        } else if (existingCount > 0) {
          doneLabel = `${newCount} 张新卡已创建, ${existingCount} 个词已存在`;
        } else if (fail > 0) {
          doneLabel = `${ok} 张已创建, ${fail} 张失败`;
        } else {
          doneLabel = `${ok} 张单词卡已创建`;
        }
        updateTask(id, { status: "done", result, label: doneLabel });
        queryClient.invalidateQueries({ queryKey: ["cards"] });
        if (existingCount > 0 && newCount === 0) {
          toast.info(doneLabel);
        } else if (fail > 0) {
          toast.warning(doneLabel);
        } else {
          toast.success(doneLabel);
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          updateTask(id, { status: "cancelled" });
        } else {
          updateTask(id, { status: "verifying", error: undefined, label: "生成失败，确认中" });
          toast.warning("单词卡生成失败，正在确认后台结果…");
          recoverCards(id, unique, createdAt, 0);
        }
      })
      .finally(() => controllers.delete(id));

    return id;
  },

  cancelTask(id: string) {
    const task = useTaskStore.getState().tasks.find((t) => t.id === id);
    if (task?.status === "verifying") {
      clearVerify(id);
      updateTask(id, { status: "cancelled" });
      return;
    }
    const ac = controllers.get(id);
    if (ac) ac.abort();
  },

  removeTask(id: string) {
    clearVerify(id);
    const ac = controllers.get(id);
    if (ac) ac.abort();
    controllers.delete(id);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  clearDone() {
    set((s) => ({
      tasks: s.tasks.filter((t) => t.status === "running" || t.status === "verifying"),
    }));
  },
}));
