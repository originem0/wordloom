// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { useAppStore } from "@/client/store";
import { useReadingStore } from "@/client/store/reading";
import { WordForgePage } from "../WordForgePage";
import type { Card } from "@/shared/types";

const card = { id: 42, word: "anchor", coreMeaning: "a firm hold", cefr: "B2" } as Card;
const asked = vi.fn();
vi.mock("@/client/hooks/useCards", () => ({
  useCards: (params: unknown) => {
    asked(params);
    return { data: { cards: [card], total: 100 }, isLoading: false, isPlaceholderData: false };
  },
  useCard: (id: number | null) => ({ data: id === 42 ? card : undefined, error: null }),
  useDeleteCard: () => ({ mutate: vi.fn(), isPending: false }),
  useMissingDeep: () => ({ data: { cards: [] } }),
}));
vi.mock("@/client/hooks/useAuth", () => ({ useIsAdmin: () => false }));
vi.mock("@/client/components/auth/AdminOnly", () => ({ AdminOnly: () => null }));
vi.mock("../WordInput", () => ({ WordInput: ({ input, setInput }: { input: string; setInput: (value: string) => void }) => (
  <input aria-label="搜索词卡" value={input} onChange={(e) => setInput(e.target.value)} />
) }));
vi.mock("../PrototypeWordCard", () => ({ PrototypeWordCard: ({ card: shown, onClose }: { card: Card; onClose: () => void }) => (
  <div><h1>{shown.word}</h1><button onClick={onClose}>关闭</button></div>
) }));

beforeEach(() => {
  useAppStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  useAppStore.getState().setUiLanguage("zh-CN");
  useReadingStore.getState().reset();
  asked.mockClear();
});

function open(path = "/cards", withPrevious = true) {
  const router = createMemoryRouter([
    { path: "/cards", element: <WordForgePage /> },
    { path: "/settings", element: <Link to="/cards">回到词卡</Link> },
  ], { initialEntries: withPrevious ? ["/settings", path] : [path], initialIndex: withPrevious ? 1 : 0 });
  render(<RouterProvider router={router} />);
  return router;
}

describe("reading a card across navigation", () => {
  it("uses Back to close the card and returns keyboard focus to its opener", async () => {
    const router = open();
    const button = screen.getByRole("button", { name: "打开词卡 anchor" });
    button.focus();
    fireEvent.keyDown(button, { key: "Enter" });
    fireEvent.click(button);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(router.state.location.search).toBe("?card=42");
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/cards");
    await waitFor(() => expect(document.activeElement).toBe(button));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe("/settings");
  });

  it("keeps the search, level and page after visiting Settings", async () => {
    const router = open();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索词卡" }), { target: { value: "anchor" } });
    await waitFor(() => expect(asked.mock.lastCall?.[0].search).toBe("anchor"));
    fireEvent.click(screen.getByRole("button", { name: "B2" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await act(() => router.navigate("/settings"));
    fireEvent.click(screen.getByRole("link", { name: "回到词卡" }));
    expect(await screen.findByRole("textbox", { name: "搜索词卡" })).toHaveValue("anchor");
    expect(asked.mock.lastCall?.[0]).toMatchObject({ search: "anchor", cefr: "B2", page: 2 });
    expect(screen.getByRole("button", { name: "B2" })).toHaveAttribute("aria-pressed", "true");
  });

  it("can close a directly opened card without leaving the library", async () => {
    const router = open("/cards?card=42", false);
    fireEvent.click(await screen.findByRole("button", { name: "关闭" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(router.state.location.pathname).toBe("/cards");
    expect(router.state.location.search).toBe("");
  });
});
