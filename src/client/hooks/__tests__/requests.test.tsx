// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCards, useGenerateDeep, useMissingDeep } from "../useCards";
import { useSettings } from "../useSettings";

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const requested = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

afterEach(() => vi.unstubAllGlobals());

// The server refuses these reads to a visitor. The components switch them off
// for one; this is the other half of that: a query switched off sends nothing.
describe("reads that are the admin's", () => {
  const switchedOff: Array<[what: string, hook: () => unknown]> = [
    ["the settings", () => useSettings({ enabled: false })],
    ["which cards lack a deep layer", () => useMissingDeep(false)],
    ["the exact-match lookup", () => useCards({ search: "anchor", limit: 1 }, { enabled: false })],
  ];
  const switchedOn: Array<[what: string, hook: () => unknown, url: string]> = [
    ["the settings", () => useSettings(), "/api/settings"],
    ["which cards lack a deep layer", () => useMissingDeep(true), "/api/cards/missing-deep"],
    ["the exact-match lookup", () => useCards({ search: "anchor", limit: 1 }), "/api/cards?search=anchor&limit=1"],
  ];

  it.each(switchedOff)("do not request %s when switched off", async (_what, hook) => {
    renderHook(hook, { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(requested()).toEqual([]);
  });

  it.each(switchedOn)("request %s otherwise", async (_what, hook, url) => {
    renderHook(hook, { wrapper });
    await waitFor(() => expect(requested()).toEqual([url]));
  });
});

// The rows of a card list carry the deep layer. Nothing regenerates it when a
// card is opened, so a list left as it was would hand the card out without it.
describe("generating a deep layer", () => {
  it("reloads the card lists afterwards", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useGenerateDeep(), { wrapper });
    result.current.mutate(7);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requested()).toEqual(["/api/cards/7/deep"]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cards"] });
  });
});
