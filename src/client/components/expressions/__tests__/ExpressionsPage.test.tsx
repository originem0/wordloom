// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ExpressionDetail } from "@/shared/expressions";
import { ExpressionsPage } from "../ExpressionsPage";
import { useLastSource } from "../shared";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const MET_AT = new Date(2026, 10, 20, 9, 30).getTime();

function entry(over: Partial<ExpressionDetail> & { id: number; text: string | null }): ExpressionDetail {
  const row = {
    id: 100 + over.id, kind: "met" as const, createdAt: MET_AT, cue: null, outcome: null, text: over.text, textBefore: null,
    myAttempt: null, sourceType: over.sourceType ?? null, sourceTitle: over.sourceTitle ?? null, sourceLocator: null, occurredAt: MET_AT,
    feedback: null,
  };
  return {
    status: "seen", masked: false, focus: null, intent: null, intentBy: null, sourceType: null, sourceTitle: null,
    occurredAt: MET_AT, createdAt: MET_AT, updatedAt: MET_AT, produced: false, graduated: false, queued: false,
    note: null, gloss: null, aiIntent: null, annotated: false, activeSince: null, timeline: [row], ...over,
  };
}

// A stand-in for the API, small enough to read: it keeps the entries a test
// gives it (newest first) and answers the six routes of the contract.
let server: { authenticated: boolean; configured: boolean; entries: ExpressionDetail[]; glossOnAnnotate: string | null };
let requests: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function answer(method: string, url: string, body: Record<string, unknown> | null): Response {
  if (url === "/api/auth/me") return json({ authenticated: server.authenticated });
  if (!server.configured) return json({ error: "Set AUTH_TOKEN to use private routes", code: "AUTH_NOT_CONFIGURED" }, 503);
  const [, id, action] = /^\/api\/expressions(?:\/(\d+))?(?:\/(\w+))?$/.exec(url) ?? [];
  if (!id && method === "GET") return json({ expressions: server.entries });
  if (!id) {
    const created = entry({ id: 50 + server.entries.length, text: String(body?.text), focus: (body?.focus as string) ?? null });
    server.entries.unshift(created);
    return json(created, 201);
  }
  const found = server.entries.find((e) => e.id === Number(id));
  if (!found) return json({ error: "Not found" }, 404);
  if (method === "PATCH") Object.assign(found, body);
  if (action === "annotate") {
    if (!server.glossOnAnnotate) return json({ error: "The model did not answer", code: "ANNOTATE_FAILED" }, 502);
    Object.assign(found, { gloss: server.glossOnAnnotate, annotated: true });
  }
  return json(found);
}

const asked = (method: string, url: string) => requests.filter((r) => r.method === method && r.url === url);

beforeEach(() => {
  server = { authenticated: true, configured: true, entries: [], glossOnAnnotate: "to begin to be understood" };
  requests = [];
  useLastSource.setState({ source: null });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const request = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null };
      requests.push(request);
      return answer(request.method, url, request.body);
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let client: QueryClient;

function renderPage() {
  // The app's own freshness window: a detail just read or written is not asked for again on opening it.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ExpressionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const box = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "原文" });
/** The rows of the list, top to bottom. */
const rows = () => Array.from(document.querySelectorAll("ul > li > button")).map((b) => b.textContent);
/** Opens the row holding `part`. Not found by text: a marked focus splits the text over several nodes. */
async function openRow(part: string) {
  await waitFor(() => expect(rows().some((text) => text?.includes(part))).toBe(true));
  fireEvent.click(Array.from(document.querySelectorAll("ul > li > button")).find((b) => b.textContent?.includes(part))!);
}
const closeDetail = () => fireEvent.click(screen.getByRole("button", { name: "Close" }));

describe("the 表达 page without AUTH_TOKEN", () => {
  it("says what to do instead of showing a page that cannot work", async () => {
    server.configured = false;
    renderPage();
    expect(await screen.findByText(/请设置 AUTH_TOKEN、重启服务，然后登录/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "原文" })).toBeNull();
    expect(screen.queryByText(/读取失败/)).toBeNull();
    // The refusal is final: asking again would only repeat it.
    expect(asked("GET", "/api/expressions")).toHaveLength(1);
  });
});

describe("the 表达 page for someone who is not the admin", () => {
  it("asks the expressions API for nothing", async () => {
    server.authenticated = false;
    renderPage();
    await waitFor(() => expect(asked("GET", "/api/auth/me")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(requests.filter((r) => r.url.startsWith("/api/expressions"))).toEqual([]);
  });
});

describe("the list", () => {
  beforeEach(() => {
    server.entries = [
      entry({ id: 3, text: "Break the ice.", sourceType: "video", sourceTitle: "Friends" }),
      entry({ id: 2, text: "It dawned on me that I was wrong.", focus: "dawned on" }),
      entry({ id: 1, text: "An old one.", status: "retired" }),
    ];
  });

  it("shows what is kept, newest first, with where and when it was met", async () => {
    renderPage();
    await screen.findByText("Break the ice.");
    expect(rows()).toEqual(["Break the ice.影视 · Friends · 2026/11/20", "It dawned on me that I was wrong.未记录 · 2026/11/20"]);
    expect(document.querySelector("mark")).toHaveTextContent("dawned on");
  });

  it("filters in the browser, over the text, the focus and the source title", async () => {
    renderPage();
    await screen.findByText("Break the ice.");
    const filter = screen.getByRole("textbox", { name: "筛选" });

    fireEvent.change(filter, { target: { value: "friends" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("Break the ice.");

    fireEvent.change(filter, { target: { value: "DAWNED" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain("It dawned on me");

    fireEvent.change(filter, { target: { value: "nothing like this" } });
    expect(screen.getByText("没有匹配的条目。")).toBeInTheDocument();
    // The server was never told what was looked for.
    expect(requests.every((r) => !r.url.includes("?"))).toBe(true);
    expect(asked("GET", "/api/expressions")).toHaveLength(1);
  });

  it("keeps what was put away under 已收起", async () => {
    renderPage();
    await screen.findByText("Break the ice.");
    expect(screen.queryByText("An old one.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "已收起" }));
    expect(rows()).toEqual(["An old one.未记录 · 2026/11/20"]);
  });

  it("shows the intent of an entry whose English the server withholds", async () => {
    server.entries = [entry({ id: 4, text: null, focus: null, masked: true, intent: "想说：我突然明白了" })];
    renderPage();
    expect(await screen.findByText("想说：我突然明白了")).toBeInTheDocument();
  });
});

describe("收下 on the page", () => {
  it("puts the entry on top, marked 补注中, and empties the box", async () => {
    server.entries = [entry({ id: 2, text: "An earlier one." })];
    renderPage();
    await screen.findByText("An earlier one.");
    fireEvent.change(box(), { target: { value: "Break the ice." } });
    fireEvent.click(screen.getByRole("button", { name: "收下" }));

    await waitFor(() => expect(rows()[0]).toBe("Break the ice.未记录 · 2026/11/20 · 补注中"));
    expect(rows()).toHaveLength(2);
    expect(box()).toHaveValue("");
  });

  async function keepOne() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByText("还没有收下任何表达。");
    fireEvent.change(box(), { target: { value: "It dawned on me." } });
    fireEvent.click(screen.getByRole("button", { name: "收下" }));
    await screen.findByText(/补注中/);
    return `/api/expressions/${server.entries[0].id}`;
  }
  const later = () => act(() => vi.advanceTimersByTimeAsync(3000));

  it("looks again a few seconds later, and shows the gloss once it is there", async () => {
    const url = await keepOne();
    expect(asked("GET", url)).toHaveLength(0);

    Object.assign(server.entries[0], { gloss: "to begin to be understood", annotated: true });
    await later();
    await waitFor(() => expect(screen.queryByText(/补注中/)).toBeNull());
    expect(asked("GET", url)).toHaveLength(1);

    // And stops looking.
    await later();
    expect(asked("GET", url)).toHaveLength(1);

    await openRow("It dawned on me.");
    expect(await screen.findByText("to begin to be understood")).toBeInTheDocument();
    expect(screen.getByText("补注 · AI 写的")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补注" })).toBeNull();
  });

  it("gives up after three looks and leaves it to the 补注 button", async () => {
    const url = await keepOne();
    await openRow("It dawned on me.");
    // While it is still being looked for, the detail says so and offers no button.
    expect(await screen.findByText("补注中…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补注" })).toBeNull();

    await later();
    await later();
    expect(screen.getByText("补注中…")).toBeInTheDocument();
    await later();
    await waitFor(() => expect(screen.queryByText("补注中…")).toBeNull());
    await later();
    expect(asked("GET", url)).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "补注" }));
    expect(await screen.findByText("to begin to be understood")).toBeInTheDocument();
    expect(asked("POST", `${url}/annotate`)).toHaveLength(1);
  });

  // Signing out drops the cache (useLogout). A look that was still due must
  // not ask for a private entry after that.
  it("stops looking once the cache has been dropped", async () => {
    const url = await keepOne();
    client.clear();
    const sent = requests.length;
    await later();
    await later();
    expect(asked("GET", url)).toHaveLength(0);
    expect(requests).toHaveLength(sent);
  });
});

describe("the detail", () => {
  beforeEach(() => {
    server.entries = [
      entry({
        id: 2, text: "It dawned on me that I was wrong.", focus: "dawned on", note: "from a podcast", gloss: "to become clear",
        annotated: true, sourceType: "video", sourceTitle: "Friends",
      }),
    ];
  });

  async function open() {
    renderPage();
    await openRow("It dawned on me");
    return screen.findByRole("textbox", { name: "备注" });
  }

  it("shows the original with its focus marked, then the note, and the gloss below both, signed as the AI's", async () => {
    const note = await open();
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("mark")).toHaveTextContent("dawned on");
    expect(note).toHaveValue("from a podcast");

    const order = (text: string) => dialog.textContent!.indexOf(text);
    expect(order("It dawned on me")).toBeLessThan(order("备注"));
    expect(order("备注")).toBeLessThan(order("补注 · AI 写的"));
    expect(order("补注 · AI 写的")).toBeLessThan(order("to become clear"));
    expect(dialog).toHaveTextContent("出处：影视 · Friends");
    expect(dialog).toHaveTextContent("2026/11/20 · 遇到 · 影视 · Friends");
  });

  it("saves only what was changed", async () => {
    const note = await open();
    const save = screen.getByRole("button", { name: "保存" });
    expect(save).toBeDisabled();

    fireEvent.change(note, { target: { value: "  heard twice now  " } });
    fireEvent.click(save);
    await waitFor(() => expect(asked("PATCH", "/api/expressions/2")).toHaveLength(1));
    expect(asked("PATCH", "/api/expressions/2")[0].body).toEqual({ note: "heard twice now" });
    // The answer to the write is the entry: the list is read again, the entry is not.
    await waitFor(() => expect(asked("GET", "/api/expressions")).toHaveLength(2));
    expect(asked("GET", "/api/expressions/2")).toHaveLength(1);
    expect(note).toHaveValue("heard twice now");
  });

  it("changes the focus, and clears it with an empty field", async () => {
    await open();
    const focus = screen.getByRole("textbox", { name: "焦点" });
    expect(focus).toHaveValue("dawned on");

    fireEvent.change(focus, { target: { value: "dawned on me" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("dialog").querySelector("mark")).toHaveTextContent("dawned on me"));

    fireEvent.change(focus, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(asked("PATCH", "/api/expressions/2")).toHaveLength(2));
    expect(asked("PATCH", "/api/expressions/2").map((r) => r.body)).toEqual([{ focus: "dawned on me" }, { focus: null }]);
  });

  it("corrects when it was met", async () => {
    await open();
    const when = screen.getByLabelText("遇到的时间");
    expect(when).toHaveValue("2026-11-20T09:30");

    fireEvent.change(when, { target: { value: "2026-11-18T21:05" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(asked("PATCH", "/api/expressions/2")).toHaveLength(1));
    expect(asked("PATCH", "/api/expressions/2")[0].body).toEqual({ occurredAt: new Date(2026, 10, 18, 21, 5).getTime() });
  });

  // A tap beside the dialog is how a phone keyboard gets dismissed. It must
  // not take a half-written note with it.
  it("closes on a click beside it, but not while something typed is unsaved", async () => {
    const note = await open();
    // Radix starts listening a tick after the dialog opens, and acts on the click that follows the press.
    await new Promise((r) => setTimeout(r, 10));
    const clickBeside = () => {
      const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
      fireEvent.pointerDown(overlay);
      fireEvent.click(overlay);
    };

    fireEvent.change(note, { target: { value: "half a thought" } });
    clickBeside();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByRole("textbox", { name: "备注" })).toHaveValue("half a thought");

    fireEvent.change(note, { target: { value: "from a podcast" } });
    clickBeside();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("puts an entry away and brings it back", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    fireEvent.click(await screen.findByRole("button", { name: "恢复" }));
    await screen.findByRole("button", { name: "收起" });
    expect(asked("PATCH", "/api/expressions/2").map((r) => r.body)).toEqual([{ status: "retired" }, { status: "seen" }]);

    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    await screen.findByRole("button", { name: "恢复" });
    closeDetail();
    await screen.findByText("这一栏是空的。");
    fireEvent.click(screen.getByRole("button", { name: "已收起" }));
    expect(rows()).toHaveLength(1);
  });

  it("offers 补注 for an entry that has none, and says so when the model fails", async () => {
    Object.assign(server.entries[0], { gloss: null, annotated: false });
    server.glossOnAnnotate = null;
    await open();
    fireEvent.click(screen.getByRole("button", { name: "补注" }));
    await waitFor(() => expect(asked("POST", "/api/expressions/2/annotate")).toHaveLength(1));
    // Still offered: the entry itself was never at stake.
    expect(await screen.findByRole("button", { name: "补注" })).toBeEnabled();
  });
});

// Everything on this page was typed by the user, pasted from somewhere, or
// written by a model that read those: it is shown as text and never parsed.
describe("the 表达 page treats what it shows as text, never as markup", () => {
  const HOSTILE = '<img src=x onerror="alert(1)">';

  it("does not materialise HTML from an entry, in the list or in the detail", async () => {
    server.entries = [
      entry({
        id: 9, text: `It **dawned** on me ${HOSTILE}`, focus: `me ${HOSTILE}`, note: `<script>window.__pwned = 1</script>`,
        gloss: `gloss ${HOSTILE}`, aiIntent: `intent ${HOSTILE}`, intent: `<b>bold</b>`, sourceType: "book", sourceTitle: `title ${HOSTILE}`,
        annotated: true,
      }),
    ];
    Object.assign(server.entries[0].timeline[0], { textBefore: `before ${HOSTILE}`, sourceLocator: `p. 3 ${HOSTILE}` });
    renderPage();
    await openRow("It **dawned** on");
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(`gloss ${HOSTILE}`);

    expect(document.querySelector("img, script, b, strong")).toBeNull();
    expect(dialog.querySelector("mark")).toHaveTextContent(`me ${HOSTILE}`);
    for (const shown of [`before ${HOSTILE}`, `intent ${HOSTILE}`, `title ${HOSTILE}`, `p. 3 ${HOSTILE}`, "<b>bold</b>"]) {
      expect(dialog).toHaveTextContent(shown);
    }
    expect(screen.getByRole("textbox", { name: "备注" })).toHaveValue("<script>window.__pwned = 1</script>");
  });
});
