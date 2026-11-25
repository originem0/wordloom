import { create } from "zustand";
import { EXPRESSION_LIMITS, type ExpressionSummary, type SourceType, type Verdict } from "@/shared/expressions";

export const SOURCE_LABELS: Record<SourceType | "find", string> = { chat: "AI 对话", book: "书", video: "影视", other: "其他", find: "对谈" };

// The three things a judgement can say. Getting the meaning across another
// way is not called wrong: only the target expression was not used.
export const VERDICT_LABELS: Record<Verdict, string> = { used: "用上了", conveyed: "绕开但说通了", missed: "没说通" };

export const AREA_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export const day = (ms: number) => new Date(ms).toLocaleDateString("zh-CN");

// Without AUTH_TOKEN the app treats everyone as the admin, and the server
// refuses to serve private data. What 表达 and 对谈 say then.
export const NO_AUTH_NOTE =
  "表达库和对谈是私人数据，服务器没有设置 AUTH_TOKEN 时不提供：请设置 AUTH_TOKEN、重启服务，然后登录。只在这台机器上试用的话，也可以改设 EXPRESSIONS_OPEN_LOCALLY=1 再重启，不用登录。";

/** What stands for an entry in a list: `text` is null while the server withholds the English. */
export const titleOf = (e: Pick<ExpressionSummary, "text" | "intent">) => e.text ?? e.intent ?? "（未显示）";

// The source tag last chosen, for this visit only: it outlives the page (a look
// at Cards and back) and is gone with a refresh. Never written to storage, and
// only the tag: a title typed for it is private text and stays with the page.
export const useLastSource = create<{ source: SourceType | null }>(() => ({ source: null }));

// Which conversation 对谈 has open, for this visit only: a look at another page
// and back finds it again, a refresh starts from the latest one. Undefined
// until one is chosen, null for a conversation not yet begun. `visit` counts
// the times one was chosen: a conversation that gets its id by its first turn
// is still the same visit, and keeps what is on screen.
export const useOpenThread = create<{ thread: number | null | undefined; visit: number }>(() => ({ thread: undefined, visit: 0 }));
export const openThread = (thread: number | null) => useOpenThread.setState((s) => ({ thread, visit: s.visit + 1 }));

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
  // No longer than the server takes, or a long paragraph the user never typed
  // would refuse the save. The end is kept: it is what the selection follows.
  return { text: picked, before: (above.reverse().find((line) => line.trim())?.trim() ?? "").slice(-EXPRESSION_LIMITS.text) };
}
