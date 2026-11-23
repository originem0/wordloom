// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type ProbeArgs = [params: { search?: string; limit?: number }, options?: { enabled?: boolean }];
let isAdmin: boolean;
let inLibrary: string[];
const useCardsMock = vi.fn((...args: ProbeArgs) => {
  void args;
  return { data: { cards: inLibrary.map((word) => ({ word })) }, isFetching: false };
});
const submitCards = vi.fn();

vi.mock("@/client/hooks/useCards", () => ({
  useCards: (...args: ProbeArgs) => useCardsMock(...args),
  useExtractWords: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: undefined }),
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
  useCardsMock.mockClear();
  submitCards.mockClear();
  inLibrary = [];
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
});
