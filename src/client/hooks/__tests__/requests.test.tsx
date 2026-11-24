// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCards, useGenerateDeep, useMissingDeep } from "../useCards";
import { EXPRESSIONS_KEY, useAnnotate, useExpression, useExpressions } from "../useExpressions";
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
    ["the expression library", () => useExpressions(false)],
    ["an expression that is not open", () => useExpression(null)],
  ];
  const switchedOn: Array<[what: string, hook: () => unknown, url: string]> = [
    ["the settings", () => useSettings(), "/api/settings"],
    ["which cards lack a deep layer", () => useMissingDeep(true), "/api/cards/missing-deep"],
    ["the exact-match lookup", () => useCards({ search: "anchor", limit: 1 }), "/api/cards?search=anchor&limit=1"],
    ["the expression library", () => useExpressions(true), "/api/expressions"],
    ["an expression that is open", () => useExpression(7), "/api/expressions/7"],
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

// Every write answers with the entry as it now is, and that answer is kept:
// it spares a request. Unless the session ended while it was on its way.
// Signing out drops the cache, and a late answer must not put an entry back.
describe("a write to the expression library", () => {
  const ENTRY = { id: 7, text: "It dawned on me.", gloss: "to become clear" };
  let answerWrite: (response: Response) => void;

  async function annotate() {
    vi.mocked(fetch).mockImplementation((url) =>
      url === "/api/expressions"
        ? Promise.resolve(new Response(JSON.stringify({ expressions: [] }), { status: 200 }))
        : new Promise<Response>((resolve) => (answerWrite = resolve)),
    );
    const page = renderHook(() => ({ list: useExpressions(true), write: useAnnotate() }), { wrapper });
    await waitFor(() => expect(page.result.current.list.isSuccess).toBe(true));
    const written = page.result.current.write.mutateAsync(7);
    await waitFor(() => expect(requested()).toContain("/api/expressions/7/annotate"));
    return { ...page, written };
  }

  it("keeps the entry it was answered with, and reloads only the list", async () => {
    const { written } = await annotate();
    answerWrite(new Response(JSON.stringify(ENTRY), { status: 200 }));
    await written;
    expect(client.getQueryData([...EXPRESSIONS_KEY, 7])).toEqual(ENTRY);
    expect(requested()).toEqual(["/api/expressions", "/api/expressions/7/annotate", "/api/expressions"]);
  });

  it("keeps nothing when the answer arrives after signing out", async () => {
    const { written, unmount } = await annotate();
    // What useLogout does, and the page is gone with it.
    client.clear();
    unmount();
    answerWrite(new Response(JSON.stringify(ENTRY), { status: 200 }));
    await written;
    expect(client.getQueryCache().findAll({ queryKey: EXPRESSIONS_KEY })).toEqual([]);
    expect(requested()).toEqual(["/api/expressions", "/api/expressions/7/annotate"]);
  });
});
