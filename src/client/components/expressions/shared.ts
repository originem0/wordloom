import { create } from "zustand";
import type { ExpressionSummary, SourceType, Verdict } from "@/shared/expressions";

export const SOURCE_LABELS: Record<SourceType | "find", string> = { chat: "AI 对话", book: "书", video: "影视", other: "其他", find: "找" };

// The three things a judgement can say. Getting the meaning across another
// way is not called wrong: only the target expression was not used.
export const VERDICT_LABELS: Record<Verdict, string> = { used: "用上了", conveyed: "绕开但说通了", missed: "没说通" };

export const AREA_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export const day = (ms: number) => new Date(ms).toLocaleDateString("zh-CN");

/** What stands for an entry in a list: `text` is null while the server withholds the English. */
export const titleOf = (e: Pick<ExpressionSummary, "text" | "intent">) => e.text ?? e.intent ?? "（未显示）";

// The source tag last chosen, for this visit only: it outlives the page (a look
// at Cards and back) and is gone with a refresh. Never written to storage, and
// only the tag: a title typed for it is private text and stays with the page.
export const useLastSource = create<{ source: SourceType | null }>(() => ({ source: null }));

/**
 * Selection is focus. One line with part of it selected: the selection is the
 * focus and the line is the text. Several lines (a pasted conversation) with a
 * selection: the selection is the text, and the nearest non-empty paragraph
 * above it is offered as 上文. Nothing selected: the whole box is the text.
 */
export function readBox(box: string, start: number, end: number): { text: string; focus?: string; before?: string } {
  const whole = box.trim();
  const picked = box.slice(start, end).trim();
  if (!picked || picked === whole) return { text: whole };
  if (!whole.includes("\n")) return { text: whole, focus: picked };
  const above = box.slice(0, start).split("\n").slice(0, -1);
  return { text: picked, before: above.reverse().find((line) => line.trim())?.trim() ?? "" };
}
