// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type Params = { search?: string; cefr?: string; page?: number; limit?: number };
const useCardsMock = vi.fn((params: Params) => {
  void params;
  return { data: { cards: [], total: 100, page: 1, limit: 20 }, isLoading: false };
});

vi.mock("@/client/hooks/useCards", () => ({
  useCards: (params: Params) => useCardsMock(params),
  useDeleteCard: () => ({ mutate: vi.fn(), isPending: false }),
  useMissingDeep: () => ({ data: { cards: [] }, refetch: vi.fn() }),
}));
vi.mock("@/client/hooks/useAuth", () => ({ useIsAdmin: () => false }));
vi.mock("@/client/components/auth/AdminOnly", () => ({ AdminOnly: () => null }));
vi.mock("../PrototypeWordCard", () => ({ PrototypeWordCard: () => null }));

import { CardCollection } from "../CardCollection";

beforeEach(() => {
  useCardsMock.mockClear();
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

describe("CardCollection paging", () => {
  it("moves between pages", () => {
    render(<CardCollection searchInput="" />);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText(/第 2 \/ 5 页/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(screen.getByText(/第 1 \/ 5 页/)).toBeInTheDocument();
  });

  // Each distinct params object is one network request (it is the query key),
  // so asking for page 3 of a search the user just typed is a wasted fetch of
  // a page they will never see.
  it("never requests the old page number for a new search", () => {
    const { rerender } = render(<CardCollection searchInput="" />);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(useCardsMock.mock.lastCall?.[0].page).toBe(3);

    useCardsMock.mockClear();
    rerender(<CardCollection searchInput="ab" />);

    const requested = useCardsMock.mock.calls.map(([p]) => `${p.search}:${p.page}`);
    expect(requested).not.toContain("ab:3");
    expect(useCardsMock.mock.lastCall?.[0]).toMatchObject({ search: "ab", page: 1 });
    expect(screen.getByText(/第 1 \/ 5 页/)).toBeInTheDocument();
  });

  it("returns to page 1 when the CEFR filter changes", () => {
    render(<CardCollection searchInput="" />);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    useCardsMock.mockClear();

    fireEvent.click(screen.getByText("B2"));

    const requested = useCardsMock.mock.calls.map(([p]) => `${p.cefr}:${p.page}`);
    expect(requested).not.toContain("B2:2");
    expect(useCardsMock.mock.lastCall?.[0]).toMatchObject({ cefr: "B2", page: 1 });
  });
});
