// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useAppStore } from "@/client/store";

type ProbeArgs = [params: { search?: string; limit?: number }, options?: { enabled?: boolean }];
let isAdmin: boolean;
let inLibrary: string[];
const useCardsMock = vi.fn((...args: ProbeArgs) => {
  void args;
  return { data: { cards: inLibrary.map((word) => ({ word })) }, isFetching: false };
});
const submitCards = vi.fn();
const extraction = { mutate: vi.fn(), isPending: false, isError: false, data: undefined as { words: string[] } | undefined };

vi.mock("@/client/hooks/useCards", () => ({
  useCards: (...args: ProbeArgs) => useCardsMock(...args),
  useExtractWords: () => extraction,
}));
vi.mock("@/client/hooks/useAuth", () => ({ useIsAdmin: () => isAdmin }));
vi.mock("@/client/store/tasks", () => ({
  useTaskStore: (select: (s: { submitCards: typeof submitCards }) => unknown) => select({ submitCards }),
}));

import { WordInput } from "../WordInput";

/** Renders the box as the page does once the debounce has caught up with typing. */
function renderInput(input: string) {
  render(<WordInput input={input} setInput={vi.fn()} debouncedInput={input} />);
  return screen.getByRole("textbox");
}

/** Every value the exact-match lookup was switched to; a missing one means "on". */
const lookupEnabled = () => new Set(useCardsMock.mock.calls.map(([, options]) => options?.enabled));

beforeEach(() => {
  useAppStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  useAppStore.getState().setUiLanguage("zh-CN");
  useCardsMock.mockClear();
  submitCards.mockClear();
  inLibrary = [];
  extraction.mutate.mockReset();
  extraction.data = undefined;
});

// Generating is the admin's, and the server answers anyone else with 401. For
// a visitor the box searches the library and does nothing else.
describe("WordInput for a visitor", () => {
  beforeEach(() => {
    isAdmin = false;
  });

  it("is a search box with no offer to generate or extract", () => {
    const box = renderInput("zyzzyva");
    expect(box).toHaveAttribute("placeholder", "搜索词卡");
    expect(screen.queryByRole("button", { name: "生成词卡" })).toBeNull();
    expect(screen.queryByRole("button", { name: /从文本抽取/ })).toBeNull();
  });

  it("does not look up whether the word could be generated", () => {
    renderInput("zyzzyva");
    expect(lookupEnabled()).toEqual(new Set([false]));
  });

  it("generates nothing on Enter", () => {
    fireEvent.keyDown(renderInput("zyzzyva"), { key: "Enter" });
    expect(submitCards).not.toHaveBeenCalled();
  });

  it("generates nothing for several words either", () => {
    const box = renderInput("anchor, harbor");
    expect(screen.queryByRole("button", { name: "生成" })).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(submitCards).not.toHaveBeenCalled();
  });
});

describe("WordInput for the admin", () => {
  beforeEach(() => {
    isAdmin = true;
  });

  it("offers to generate a word the library does not have", () => {
    const box = renderInput("zyzzyva");
    expect(box).toHaveAttribute("placeholder", expect.stringContaining("生成"));
    expect(useCardsMock).toHaveBeenLastCalledWith({ search: "zyzzyva", limit: 1 }, { enabled: true });

    fireEvent.click(screen.getByRole("button", { name: "生成词卡" }));
    expect(submitCards).toHaveBeenCalledWith(["zyzzyva"]);
  });

  it("generates that word on Enter", () => {
    fireEvent.keyDown(renderInput("zyzzyva"), { key: "Enter" });
    expect(submitCards).toHaveBeenCalledWith(["zyzzyva"]);
  });

  it("leaves a word that already has a card alone", () => {
    inLibrary = ["Anchor"];
    const box = renderInput("anchor");
    expect(screen.queryByRole("button", { name: "生成词卡" })).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(submitCards).not.toHaveBeenCalled();
  });

  it("generates several words at once", () => {
    renderInput("anchor, harbor");
    fireEvent.click(screen.getByRole("button", { name: "生成" }));
    expect(submitCards).toHaveBeenCalledWith(["anchor", "harbor"]);
  });

  it("offers extraction from a text", () => {
    renderInput("");
    expect(screen.getByRole("button", { name: /从文本抽取/ })).toBeInTheDocument();
  });

  it("looks nothing up while there is no single word to look up", () => {
    renderInput("");
    expect(lookupEnabled()).toEqual(new Set([false]));
  });

  it("switches labels in place without resetting the open extraction or the typed text", () => {
    extraction.data = { words: ["anchor", "harbor"] };
    renderInput("existing search");
    fireEvent.click(screen.getByRole("button", { name: /从文本抽取/ }));
    const text = screen.getByRole("textbox", { name: "用于抽取的英文文本" });
    fireEvent.change(text, { target: { value: "A draft passage." } });
    act(() => useAppStore.getState().setUiLanguage("en"));
    expect(screen.getByRole("textbox", { name: "Search or generate cards" })).toHaveValue("existing search");
    expect(screen.getByRole("button", { name: /Extract from text/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("textbox", { name: "English text to extract from" })).toBe(text);
    expect(text).toHaveValue("A draft passage.");
    fireEvent.click(screen.getByText("anchor", { selector: '[data-slot="badge"]' }));
    expect(screen.getByRole("button", { name: "Generate 1 card" })).toBeInTheDocument();
    act(() => useAppStore.getState().setUiLanguage("zh-CN"));
    expect(screen.getByRole("button", { name: "生成 1 张词卡" })).toBeInTheDocument();
    expect(text).toHaveValue("A draft passage.");
  });
});
