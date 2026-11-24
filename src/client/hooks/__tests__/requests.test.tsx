// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCards, useGenerateDeep, useMissingDeep } from "../useCards";
import { EXPRESSIONS_KEY, useAnnotate, useAttempt, useExpression, useExpressions, useReveal, useScene, useStats, useTry } from "../useExpressions";
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
    ["the numbers of the 表达 page", () => useStats(false)],
    ["a scene nobody asked to see", () => useScene(7, false)],
  ];
  const switchedOn: Array<[what: string, hook: () => unknown, url: string]> = [
    ["the settings", () => useSettings(), "/api/settings"],
    ["which cards lack a deep layer", () => useMissingDeep(true), "/api/cards/missing-deep"],
    ["the exact-match lookup", () => useCards({ search: "anchor", limit: 1 }), "/api/cards?search=anchor&limit=1"],
    ["the expression library", () => useExpressions(true), "/api/expressions"],
    ["an expression that is open", () => useExpression(7), "/api/expressions/7"],
    ["the numbers of the 表达 page", () => useStats(true), "/api/expressions/stats"],
    ["the scene asked for as a hint", () => useScene(7, true), "/api/expressions/7/scene"],
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

  // A capture can be the first entry, a change of layer moves what was due:
  // the numbers on the page depend on both.
  it("reloads the numbers of the page as well when they are on it", async () => {
    vi.mocked(fetch).mockImplementation(
      async (url) => new Response(JSON.stringify(url === "/api/expressions" ? { expressions: [] } : ENTRY), { status: 200 }),
    );
    const page = renderHook(() => ({ list: useExpressions(true), stats: useStats(true), write: useAnnotate() }), { wrapper });
    await waitFor(() => expect(page.result.current.list.isSuccess && page.result.current.stats.isSuccess).toBe(true));
    await page.result.current.write.mutateAsync(7);
    await waitFor(() => expect(requested().filter((url) => url === "/api/expressions/stats")).toHaveLength(2));
  });
});

// A reveal, an attempt, a question in 找: none of these answers with the entry
// as the page may keep it. Each wrote to a timeline, so what is on screen of
// the library is read again; what came back goes to whoever asked and nowhere
// else. A revealed entry left in the cache would be shown a second time with
// no row on its timeline to say so.
describe("an act on the expression library", () => {
  const MASKED = { id: 7, masked: true, text: null, intent: "想说：我突然明白了" };
  const REVEALED = { id: 7, masked: false, text: "It dawned on me.", intent: "想说：我突然明白了" };
  const cached = () => JSON.stringify(client.getQueryCache().findAll().map((query) => query.state.data));

  it("hands a revealed entry to the caller, keeps it out of the cache, and reads again what is on screen", async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      const body = url === "/api/expressions" ? { expressions: [MASKED] } : url === "/api/expressions/7/reveal" ? REVEALED : MASKED;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const page = renderHook(() => ({ list: useExpressions(true), open: useExpression(7), reveal: useReveal() }), { wrapper });
    await waitFor(() => expect(page.result.current.open.isSuccess && page.result.current.list.isSuccess).toBe(true));

    expect(await page.result.current.reveal.mutateAsync({ id: 7, cue: "masked" })).toEqual(REVEALED);
    const [, init] = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/expressions/7/reveal")!;
    expect(JSON.parse(String(init?.body))).toEqual({ cue: "masked" });

    await waitFor(() => expect(requested()).toHaveLength(5));
    expect(requested().slice(3).sort()).toEqual(["/api/expressions", "/api/expressions/7"]);
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(client.getQueryData([...EXPRESSIONS_KEY, 7])).toEqual(MASKED);
    expect(cached()).not.toContain("dawned");
    // Nor does it wait in the mutation cache once whoever asked is gone.
    page.unmount();
    await waitFor(() => expect(client.getMutationCache().getAll()).toEqual([]));
  });

  it("reads nothing again when its answer arrives after signing out", async () => {
    let answerAttempt!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation((url) =>
      url === "/api/expressions"
        ? Promise.resolve(new Response(JSON.stringify({ expressions: [MASKED] }), { status: 200 }))
        : new Promise<Response>((resolve) => (answerAttempt = resolve)),
    );
    const page = renderHook(() => ({ list: useExpressions(true), attempt: useAttempt() }), { wrapper });
    await waitFor(() => expect(page.result.current.list.isSuccess).toBe(true));
    const judged = page.result.current.attempt.mutateAsync({ id: 7, text: "It dawned on me then.", cue: "need", prompt: "想说：我突然明白了" });
    await waitFor(() => expect(requested()).toContain("/api/expressions/7/attempts"));
    client.clear();
    page.unmount();
    answerAttempt(new Response(JSON.stringify({ encounterId: 31, status: "done" }), { status: 201 }));
    await judged;
    expect(requested()).toEqual(["/api/expressions", "/api/expressions/7/attempts"]);
    expect(client.getQueryCache().findAll()).toEqual([]);
  });

  // 试一条 is asked for by hand and held by the panel: a list that reloaded
  // itself would change the question under a sentence being typed.
  it("asks 试一条 for more by the ids already on screen, and keeps the answer out of the cache", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const { result } = renderHook(() => useTry(), { wrapper });
    expect(await result.current.mutateAsync([])).toEqual({ items: [] });
    await result.current.mutateAsync([3, 9]);
    expect(requested()).toEqual(["/api/expressions/try", "/api/expressions/try?exclude=3,9"]);
    expect(client.getQueryCache().findAll()).toEqual([]);
  });
});
