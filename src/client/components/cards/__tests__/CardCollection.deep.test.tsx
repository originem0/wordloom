// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { queryClient } from "@/client/lib/query-client";
import { useAppStore } from "@/client/store";
import { MemoryRouter } from "react-router-dom";
import { useReadingStore } from "@/client/store/reading";

let isAdmin: boolean;
const useMissingDeepMock = vi.fn((enabled: boolean) => {
  void enabled;
  // Answers whoever asks: a count read before sign-out stays in memory after it.
  return { data: { cards: [{ id: 7, word: "anchor" }, { id: 9, word: "harbor" }], total: 2 } };
});

vi.mock("@/client/hooks/useCards", () => ({
  useCards: () => ({ data: { cards: [], total: 0, page: 1, limit: 20 }, isLoading: false }),
  useCard: () => ({ data: undefined, error: null }),
  useDeleteCard: () => ({ mutate: vi.fn(), isPending: false }),
  useMissingDeep: (enabled: boolean) => useMissingDeepMock(enabled),
}));
vi.mock("@/client/hooks/useAuth", () => ({ useIsAdmin: () => isAdmin }));
vi.mock("@/client/components/auth/AdminOnly", () => ({ AdminOnly: () => null }));
vi.mock("../PrototypeWordCard", () => ({ PrototypeWordCard: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CardCollection } from "../CardCollection";

beforeEach(() => {
  useReadingStore.getState().reset();
  useAppStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  useAppStore.getState().setUiLanguage("en");
  useMissingDeepMock.mockClear();
  vi.stubGlobal("matchMedia", () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Which cards lack a deep layer is the admin's to know, and generating the
// layer is the admin's to do: both requests answer a visitor with 401.
describe("the batch deep retry", () => {
  it("is neither asked about nor offered to a visitor", () => {
    isAdmin = false;
    render(<CardCollection searchInput="" />, { wrapper: MemoryRouter });
    // Leaving the argument out would mean "enabled", so every call must say no.
    expect(new Set(useMissingDeepMock.mock.calls.map(([enabled]) => enabled))).toEqual(new Set([false]));
    expect(screen.queryByRole("button", { name: /Retry Deep/ })).toBeNull();
  });

  // Nothing generates the layer on opening a card any more, so a list that was
  // not reloaded would keep handing out the cards as they were before.
  it("works through the cards for the admin, then reloads the list", async () => {
    isAdmin = true;
    const posted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        posted.push(url);
        return new Response("{}", { status: 200 });
      }),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(<CardCollection searchInput="" />, { wrapper: MemoryRouter });
    expect(useMissingDeepMock).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry Deep (2)" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cards"] }));
    expect(posted).toEqual(["/api/cards/7/deep", "/api/cards/9/deep"]);
  });
});
