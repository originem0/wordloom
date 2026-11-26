// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { PrototypeWordCard } from "../PrototypeWordCard";
import { AUTH_QUERY_KEY } from "@/client/hooks/useAuth";
import { EXPRESSIONS_KEY } from "@/client/hooks/useExpressions";
import { useAppStore } from "@/client/store";
import type { Card } from "@/shared/types";
import type { ExpressionSummary } from "@/shared/expressions";

const AT = new Date(2026, 10, 20).getTime();
function entry(id: number, text: string, overrides: Partial<ExpressionSummary> = {}): ExpressionSummary {
  return {
    id, text, masked: false, focus: null, status: "seen", intent: null, intentBy: null,
    sourceType: "book", sourceTitle: "My reading", occurredAt: AT, createdAt: AT, updatedAt: AT,
    produced: false, graduated: false, queued: false, ...overrides,
  };
}

let client: QueryClient;
let authenticated: boolean;
let entries: ExpressionSummary[];
let status: number;
let pending: Promise<Response> | null;
let requests: { url: string; method: string }[];
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code });

beforeEach(() => {
  useAppStore.setState({ uiLanguage: "zh-CN" });
  authenticated = true;
  entries = [entry(1, "A tree blocked the road.")];
  status = 200;
  pending = null;
  requests = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? "GET" });
    if (url === "/api/auth/me") return json({ authenticated });
    if (url === "/api/expressions") return pending ?? (status === 200 ? json({ expressions: entries }) : json({ error: "Unavailable" }, status));
    throw new Error(`Unexpected request: ${url}`);
  }));
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  useAppStore.setState({ uiLanguage: "zh-CN" });
});

function renderCard(word = "block", pos = "verb") {
  const card: Card = {
    id: 7, word, pos, ipa: null, cefr: null, cefrConfidence: null, coreMeaning: null, wad: null, wap: null,
    etymology: null, collocations: [], examples: [], contextLadder: [], phrases: [], synonyms: [], antonyms: [], minPair: null,
    familyComparison: [], schemaAnalysis: null, boundaryTests: [], usageCount: 0, storyId: null, createdAt: 0, updatedAt: 0,
  };
  return render(<QueryClientProvider client={client}><MemoryRouter><PrototypeWordCard card={card} /></MemoryRouter></QueryClientProvider>);
}
async function open() {
  const summary = await screen.findByText("我收过的原句");
  fireEvent.click(summary);
  return summary;
}
const links = () => Array.from(document.querySelectorAll<HTMLAnchorElement>(".own-sentence-link"));
const reads = () => requests.filter((r) => r.url === "/api/expressions");

describe("a word card's own saved sentences", () => {
  it("reads only on expansion, shares the private cache, and drops excerpts when collapsed", async () => {
    renderCard();
    const summary = await screen.findByText("我收过的原句");
    expect(reads()).toHaveLength(0);
    expect(links()).toHaveLength(0);
    fireEvent.click(summary);
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(links()[0]).toHaveTextContent("A tree blocked the road.");
    expect(reads()).toHaveLength(1);

    fireEvent.click(summary);
    await waitFor(() => expect(links()).toHaveLength(0));
    fireEvent.click(summary);
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(reads()).toHaveLength(1);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
    expect(client.getQueryData(EXPRESSIONS_KEY)).toEqual({ expressions: entries });
  });

  it("offers visitors no private section even when the cache contains sentences", async () => {
    authenticated = false;
    client.setQueryData(EXPRESSIONS_KEY, { expressions: entries });
    renderCard();
    await waitFor(() => expect(client.getQueryData(AUTH_QUERY_KEY)).toEqual({ authenticated: false }));
    expect(screen.queryByText("我收过的原句")).toBeNull();
    expect(document.body).not.toHaveTextContent("A tree blocked the road.");
    expect(reads()).toHaveLength(0);
  });

  it("shows matching words, sources and dates, with id-only links, leaving masked and archived entries out", async () => {
    entries = [
      entry(5, "A tree blocked the road."),
      entry(4, "An old block remains.", { focus: "block" }),
      entry(3, "A masked block.", { status: "active", masked: true }),
      entry(2, "A retired block.", { status: "retired" }),
      entry(1, "We block it.", { status: "active", graduated: true }),
    ];
    renderCard();
    await open();
    await waitFor(() => expect(links()).toHaveLength(3));
    expect(links().map((a) => a.getAttribute("href"))).toEqual(["/?expression=4", "/?expression=5", "/?expression=1"]);
    expect(links()[0]).toHaveTextContent("书 · My reading · 2026/11/20");
    expect(links()[1].querySelector("mark")).toHaveTextContent("blocked");
    expect(document.body).not.toHaveTextContent("A masked block.");
    expect(document.body).not.toHaveTextContent("A retired block.");
    expect(screen.getByText("练习中隐藏的原文不在这里显示。")).toBeInTheDocument();
    expect(requests.map((r) => r.url)).toEqual(["/api/auth/me", "/api/expressions"]);
  });

  it("offers an empty library a capture link with the word in the fragment", async () => {
    entries = [];
    renderCard("rock & roll", "noun");
    await open();
    expect(await screen.findByText("还没有收下任何表达。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "收一条原句" })).toHaveAttribute("href", "/#focus=rock%20%26%20roll");
  });

  it("shows a repeated original once and links to the entry focused on the card word", async () => {
    entries = [
      entry(3, "A tree blocked the road.", { focus: "tree" }),
      entry(2, "A tree blocked the road.", { focus: "blocked" }),
      entry(1, "A tree blocked\n the road."),
    ];
    renderCard();
    await open();
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(links()[0]).toHaveAttribute("href", "/?expression=2");
    expect(links()[0]).toHaveTextContent("A tree blocked the road.");
  });

  it("distinguishes no matches from an empty library", async () => {
    entries = [entry(1, "Care is needed.")];
    renderCard("car", "noun");
    await open();
    expect(await screen.findByText("还没有可显示的相关原句。")).toBeInTheDocument();
    expect(links()).toHaveLength(0);
  });

  it("shows loading rather than an empty state while the read is pending", async () => {
    let answer!: (response: Response) => void;
    pending = new Promise<Response>((resolve) => { answer = resolve; });
    renderCard();
    await open();
    expect(await screen.findByRole("status")).toHaveTextContent("正在读取表达库…");
    expect(screen.queryByText("还没有收下任何表达。")).toBeNull();
    await act(async () => answer(json({ expressions: entries })));
    await waitFor(() => expect(links()).toHaveLength(1));
  });

  it("hides stale excerpts on a failed refresh and reads again only when retry is pressed", async () => {
    renderCard();
    await open();
    await waitFor(() => expect(links()).toHaveLength(1));
    status = 503;
    await act(async () => { await client.invalidateQueries({ queryKey: EXPRESSIONS_KEY }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("原句读取失败。");
    expect(links()).toHaveLength(0);
    expect(reads()).toHaveLength(2);
    status = 200;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(reads()).toHaveLength(3);
  });

  it("shows three at a time and keeps a completion label when all are shown", async () => {
    entries = Array.from({ length: 7 }, (_, i) => entry(i + 1, `We blocked road ${i + 1}.`));
    renderCard();
    await open();
    await waitFor(() => expect(links()).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "再看 3 条" }));
    expect(links()).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "再看 1 条" }));
    expect(links()).toHaveLength(7);
    expect(screen.getByRole("button", { name: "已显示全部" })).toBeDisabled();
    expect(reads()).toHaveLength(1);
  });

  it("updates labels without closing the disclosure, rewriting text, or reading again", async () => {
    renderCard();
    const summary = await open();
    await waitFor(() => expect(links()).toHaveLength(1));
    const details = summary.closest("details");
    const sent = requests.length;
    act(() => useAppStore.setState({ uiLanguage: "en" }));
    expect(screen.getByText("My saved sentences").closest("details")).toBe(details);
    expect(details).toHaveAttribute("open");
    expect(links()[0]).toHaveTextContent("A tree blocked the road.");
    expect(links()[0]).toHaveTextContent("Book · My reading");
    expect(requests).toHaveLength(sent);
  });

  it("renders text and source titles literally, and removes the whole section when admin access ends", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    entries = [entry(1, `A block ${hostile}`, { sourceTitle: hostile })];
    renderCard();
    await open();
    await waitFor(() => expect(links()).toHaveLength(1));
    expect(links()[0]).toHaveTextContent(hostile);
    expect(document.querySelector("img, script")).toBeNull();
    expect(links()[0]).toHaveAttribute("href", "/?expression=1");
    act(() => client.setQueryData(AUTH_QUERY_KEY, { authenticated: false }));
    await waitFor(() => expect(screen.queryByText("我收过的原句")).toBeNull());
    expect(document.body).not.toHaveTextContent(hostile);
  });
});
