// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TalkThread, TalkTurn } from "@/shared/expressions";
import { TalkPage } from "../TalkPage";
import { useOpenThread } from "../shared";
import { useAppStore } from "@/client/store";

// Node 26 has no localStorage without --localstorage-file. Persistence is not
// under test here; keep only the language preference in this test process.
useAppStore.persist.setOptions({ storage: {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
} });

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const turnOf = (id: number, thread: number, said: string, createdAt = thread): TalkTurn => ({
  id, thread, createdAt, said, reply: `reply to ${said}`, fix: null, rewrites: [], fresh: [], mine: [], searched: 0, total: 0,
});

// Two conversations, each named by the time of its opening turn, as on the real server.
const D20 = new Date(2026, 10, 20, 9).getTime();
const D24 = new Date(2026, 10, 24, 9).getTime();
const OLD = [turnOf(1, D20, "old question"), turnOf(2, D20, "old follow-up", D20 + 60_000)];
const LATEST = [turnOf(3, D24, "latest question"), turnOf(4, D24, "latest follow-up", D24 + 60_000)];

/** What the next POST /talk does instead of answering: wait first, fail with a body, or never arrive. */
type Next = { hold?: Promise<void>; status?: number; body?: unknown; raw?: string; lost?: true; stream?: ReadableStream<Uint8Array> };

// A stand-in for the API, small enough to read: it keeps the turns a test gives
// it and answers the four routes of 对谈 the way the contract says.
let server: { authenticated: boolean; configured: boolean; turns: TalkTurn[]; next: Next[]; failReads: number };
let requests: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const gone = () => json({ error: "Conversation not found", code: "NOT_FOUND" }, 404);

function threads(): TalkThread[] {
  const ids = [...new Set(server.turns.map((t) => t.thread))];
  return ids
    .map((thread) => {
      const own = server.turns.filter((t) => t.thread === thread);
      return { thread, title: own[0].said, turns: own.length, updatedAt: own[own.length - 1].createdAt };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function answer(method: string, url: string, body: Record<string, unknown> | null): Promise<Response> {
  if (url === "/api/auth/me") return json({ authenticated: server.authenticated });
  if (!server.configured) return json({ error: "Set AUTH_TOKEN to use private routes", code: "AUTH_NOT_CONFIGURED" }, 503);
  const [whole, id] = /^\/api\/expressions\/talk(?:\/(\d+))?$/.exec(url) ?? [];
  if (!whole) return json({ error: "Not found" }, 404);
  const own = server.turns.filter((t) => t.thread === Number(id ?? body?.thread));
  if (method === "DELETE") {
    server.turns = server.turns.filter((t) => !own.includes(t));
    return new Response(null, { status: 204 });
  }
  if (method === "GET" && !id) return json({ threads: threads() });
  if (method === "GET") {
    if (server.failReads-- > 0) return json({ error: "boom" }, 500);
    return own.length ? json({ turns: own }) : gone();
  }
  const next = server.next.shift() ?? {};
  if (next.stream) return new Response(next.stream, { headers: { "Content-Type": "text/event-stream" } });
  await next.hold;
  if (next.lost) throw new TypeError("Failed to fetch");
  if (next.raw) return new Response(next.raw, { status: next.status });
  if (next.status) return json(next.body, next.status);
  if (body?.thread != null && !own.length) return gone();
  const n = server.turns.length + 1;
  const turn = turnOf(100 + n, (body?.thread as number) ?? D24 + n * 3_600_000, String(body?.said), D24 + n * 3_600_000);
  server.turns.push(turn);
  return json(turn, 201);
}

const asked = (method: string, url: string) => requests.filter((r) => r.method === method && r.url === url);
/** The body of every message sent. */
const posted = () => asked("POST", "/api/expressions/talk").map((r) => r.body);

beforeEach(() => {
  useAppStore.setState({ uiLanguage: "zh-CN" });
  server = { authenticated: true, configured: true, turns: [], next: [], failReads: 0 };
  requests = [];
  useOpenThread.setState({ thread: undefined, visit: 0 });
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const request = { method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null };
      requests.push(request);
      return answer(request.method, url, request.body);
    }),
  );
});

afterEach(() => { vi.unstubAllGlobals(); useAppStore.setState({ uiLanguage: "zh-CN" }); });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TalkPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const box = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "说点什么" });
const picker = () => screen.getByRole<HTMLSelectElement>("combobox", { name: "对话" });
const shown = () => document.body.textContent!;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const enter = (init: object = {}) => fireEvent.keyDown(box(), { key: "Enter", ...init });

it("changes labels and date formatting without reloading the conversation or clearing its draft", async () => {
  server.turns = [...OLD, ...LATEST];
  renderPage();
  await screen.findByText("latest question");
  const draft = box();
  fireEvent.change(draft, { target: { value: "我还没写完 this thought" } });
  const previousRequests = requests.length;
  act(() => useAppStore.getState().setUiLanguage("en"));
  expect(screen.getByRole("heading", { name: "Conversation" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Say something" })).toBe(draft);
  expect(draft).toHaveValue("我还没写完 this thought");
  expect(screen.getByText("latest question")).toBeInTheDocument();
  const selected = screen.getByRole<HTMLSelectElement>("combobox", { name: "Conversation" });
  expect(selected).toHaveValue(String(D24));
  expect(selected.selectedOptions[0].textContent).toContain(new Date(D24 + 60_000).toLocaleDateString("en-US"));
  expect(requests).toHaveLength(previousRequests);
  act(() => useAppStore.getState().setUiLanguage("zh-CN"));
  expect(box()).toBe(draft);
  expect(draft).toHaveValue("我还没写完 this thought");
});

describe("streamed replies", () => {
  const openedStream = () => {
    let writer: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller; } });
    const send = (event: string, data: unknown) => writer.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    return { stream, send, close: () => writer.close() };
  };

  it("shows a partial reply before its saved turn arrives and then replaces the draft", async () => {
    const incoming = openedStream();
    server.next.push({ stream: incoming.stream });
    renderPage();
    await screen.findByRole("textbox", { name: "说点什么" });
    say("A thought about reading.");
    await waitFor(() => expect(posted()).toHaveLength(1));
    incoming.send("delta", { text: "Reading gives us" });
    await screen.findByText("Reading gives us");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    incoming.send("delta", { text: " another point of view." });
    const turn = { ...turnOf(41, D24, "A thought about reading."), reply: "Reading gives us another point of view." };
    server.turns.push(turn);
    incoming.send("done", { turn });
    incoming.close();
    await waitFor(() => expect(screen.queryByText("正在回复并整理批注…")).not.toBeInTheDocument());
    expect(screen.getAllByText(turn.reply)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "听语音" })).toBeInTheDocument();
    expect(box()).toHaveValue("");
  });

  it("restores the message and removes the draft when the stream ends without a saved turn", async () => {
    const incoming = openedStream();
    server.next.push({ stream: incoming.stream });
    renderPage();
    await screen.findByRole("textbox", { name: "说点什么" });
    say("Keep this message.");
    await waitFor(() => expect(posted()).toHaveLength(1));
    incoming.send("delta", { text: "An interrupted answer" });
    await screen.findByText("An interrupted answer");
    incoming.close();
    await waitFor(() => expect(box()).toHaveValue("Keep this message."));
    expect(screen.queryByText("An interrupted answer")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("它也可能已经记下了");
  });
});

/** Types a message and sends it with Enter. */
function say(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  enter();
}

/** The page with nothing stored: a conversation not yet begun. */
async function openNew() {
  const view = renderPage();
  await screen.findByText(/想到什么说什么/);
  return view;
}

/** The page with both conversations stored: the latest one is open. */
async function openLatest() {
  server.turns = [...OLD, ...LATEST];
  const view = renderPage();
  await screen.findByText("reply to latest follow-up");
  return view;
}

// The prototype of the storage that is really there. Under Node 26 that is
// Node's own, not the `Storage` jsdom puts on the global: a spy on
// `Storage.prototype` would see no write at all.
const watchStorage = () => vi.spyOn(Object.getPrototypeOf(sessionStorage) as Storage, "setItem");

describe("opening the page", () => {
  it("starts a conversation when there is none, and reads nothing but the list", async () => {
    await openNew();
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual(["GET /api/auth/me", "GET /api/expressions/talk"]);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(box()).toHaveAttribute("maxlength", "4000");
  });

  it("opens the latest conversation, its oldest turn first", async () => {
    await openLatest();
    expect(asked("GET", `/api/expressions/talk/${D24}`)).toHaveLength(1);
    expect(asked("GET", `/api/expressions/talk/${D20}`)).toHaveLength(0);
    expect(shown().indexOf("reply to latest question")).toBeLessThan(shown().indexOf("reply to latest follow-up"));
    expect(shown()).not.toContain("reply to old");
    expect(picker()).toHaveValue(String(D24));
  });

  it("lists the conversations by day and opening words, the latest first", async () => {
    await openLatest();
    expect(within(picker()).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "新对话", "2026/11/24 · latest question（2）", "2026/11/20 · old question（2）",
    ]);
  });

  // The route only brings an admin here. The page keeps the rule itself.
  it("asks for nothing when there is no admin", async () => {
    server.authenticated = false;
    server.turns = [...LATEST];
    renderPage();
    await waitFor(() => expect(asked("GET", "/api/auth/me")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(requests).toHaveLength(1);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says why when the server has no AUTH_TOKEN, and offers no box", async () => {
    server.configured = false;
    renderPage();
    expect(await screen.findByText(/服务器没有设置 AUTH_TOKEN 时不提供/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(shown()).not.toContain("读取失败");
  });

  it("can still start a conversation when the list did not load", async () => {
    server.turns = [...LATEST];
    vi.mocked(fetch).mockImplementationOnce(async () => json({ authenticated: true })).mockImplementationOnce(async () => json({ error: "boom" }, 500));
    renderPage();
    expect(await screen.findByText("读取失败：服务暂时不可用（HTTP 500）。")).toBeInTheDocument();
    expect(box()).toBeInTheDocument();
  });
});

describe("a message", () => {
  it("is sent by Enter, trimmed, in the body, and never in a URL or in storage", async () => {
    const stored = watchStorage();
    await openNew();
    let release = () => {};
    server.next.push({ hold: new Promise<void>((r) => (release = r)) });
    say("  Hello there  ");

    // On its way: said already, the box empty and held still.
    expect(await screen.findByText("对方在写…")).toBeInTheDocument();
    expect(screen.getByText("Hello there")).toBeInTheDocument();
    expect(box()).toHaveValue("");
    expect(box()).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(shown()).not.toContain("想到什么说什么");

    release();
    expect(await screen.findByText("reply to Hello there")).toBeInTheDocument();
    expect(screen.queryByText("对方在写…")).toBeNull();
    expect(box()).not.toHaveAttribute("readonly");
    expect(posted()).toEqual([{ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "Hello there" }]);
    expect(requests.some((r) => /hello/i.test(r.url))).toBe(false);
    expect(stored).not.toHaveBeenCalled();
    stored.mockRestore();
  });

  it("is sent by the button too", async () => {
    await openNew();
    fireEvent.change(box(), { target: { value: "Hello" } });
    click("发送");
    expect(await screen.findByText("reply to Hello")).toBeInTheDocument();
  });

  it.each([
    ["Shift+Enter, which is a new line", { shiftKey: true }],
    ["the Enter that ends an IME composition", { isComposing: true }],
    ["the same Enter as Safari reports it", { keyCode: 229 }],
  ])("is not sent by %s", async (_, init) => {
    await openNew();
    fireEvent.change(box(), { target: { value: "我突然" } });
    enter(init);
    await new Promise((r) => setTimeout(r, 20));
    expect(posted()).toEqual([]);
    expect(box()).toHaveValue("我突然");
  });

  it("is not sent empty", async () => {
    await openNew();
    say("   ");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
    await new Promise((r) => setTimeout(r, 20));
    expect(posted()).toEqual([]);
  });

  // A phone has no Shift+Enter: there Enter is the only way to a second line.
  it("is sent by the button only where the pointer is a finger", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
    await openNew();
    say("Hello");
    await new Promise((r) => setTimeout(r, 20));
    expect(posted()).toEqual([]);
    click("发送");
    expect(await screen.findByText("reply to Hello")).toBeInTheDocument();
  });

  it("opens a conversation with the first one, and the next ones carry the id it was given", async () => {
    await openNew();
    say("first");
    await screen.findByText("reply to first");
    say("second");
    await screen.findByText("reply to second");

    const { thread } = server.turns[0];
    expect(posted()).toEqual([{ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "first" }, { messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "second", thread }]);
    // What is on screen is the answers themselves: the conversation is not read back.
    expect(asked("GET", `/api/expressions/talk/${thread}`)).toHaveLength(0);
    expect(shown().indexOf("reply to first")).toBeLessThan(shown().indexOf("reply to second"));
    // The list has it by now, and it is the one open.
    await waitFor(() => expect(picker()).toHaveValue(String(thread)));
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("goes into the conversation that is open", async () => {
    await openLatest();
    say("one more");
    await screen.findByText("reply to one more");
    expect(posted()).toEqual([{ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "one more", thread: D24 }]);
    expect(shown().indexOf("reply to latest follow-up")).toBeLessThan(shown().indexOf("reply to one more"));
    expect(asked("GET", `/api/expressions/talk/${D24}`)).toHaveLength(1);
  });
});

describe("a message that got no answer", () => {
  const refuse = (reason: string): Next => ({ status: 502, body: { error: "No answer", code: "TALK_FAILED", reason } });

  it.each([
    ["timeout", "对方 45 秒内没有答完。"],
    ["busy", "模型那边正忙，过一会儿再发。"],
    ["failed", "没有答成。"],
    ["something new", "没有答成。"],
  ])("goes back into the box with the reason (%s), and nothing is added", async (reason, text) => {
    await openNew();
    server.next.push(refuse(reason));
    say("Hello");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`${text} 这句话没有记下，还在下面的框里。`);
    expect(box()).toHaveValue("Hello");
    expect(box()).not.toHaveAttribute("readonly");
    expect(shown()).not.toContain("对方在写");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("points to where a model is set up when there is none", async () => {
    await openNew();
    server.next.push(refuse("not configured"));
    say("Hello");
    expect(await screen.findByRole("alert")).toHaveTextContent("还没有配模型。去配一个 这句话没有记下");
    expect(screen.getByRole("link", { name: "去配一个" })).toHaveAttribute("href", "/providers");
  });

  // Only the server's own refusal says that nothing was written.
  it.each<[string, Next]>([
    ["the request never came back", { lost: true }],
    ["something in between answered for the server", { status: 504, raw: "<html><h1>504 Gateway Time-out</h1></html>" }],
  ])("does not claim it was not recorded when %s", async (_, next) => {
    await openNew();
    server.next.push(next);
    say("Hello");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("没有收到回答：网络断了，或者服务器没应。 这句话还在下面的框里；它也可能已经记下了");
    expect(alert).not.toHaveTextContent("没有记下");
    expect(shown()).not.toContain("Gateway");
    expect(box()).toHaveValue("Hello");
  });

  it("says what the server said when it refused the request itself", async () => {
    await openNew();
    server.next.push({ status: 400, body: { error: "Invalid request", code: "VALIDATION_ERROR" } });
    say("Hello");
    expect(await screen.findByRole("alert")).toHaveTextContent("没有发出去：请检查填写的内容。 这句话没有记下");
  });

  it("can be sent again as it is, and the line about the failure goes", async () => {
    await openNew();
    server.next.push(refuse("busy"));
    say("Hello");
    await screen.findByRole("alert");
    enter();

    expect(await screen.findByText("reply to Hello")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box()).toHaveValue("");
    expect(posted()[1]?.messageId).toBe(posted()[0]?.messageId);
    expect(posted()).toEqual([{ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "Hello" }, { messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "Hello" }]);
  });

  it("into a conversation deleted elsewhere becomes the first of a new one", async () => {
    await openLatest();
    server.turns = [...OLD];
    say("still there?");

    expect(await screen.findByRole("alert")).toHaveTextContent("这场对话已经在别处删掉了，再发一次会开一场新的。 这句话没有记下");
    expect(box()).toHaveValue("still there?");
    expect(shown()).not.toContain("reply to latest");
    // The list is read again: it no longer offers what is gone.
    await waitFor(() => expect(within(picker()).getAllByRole("option")).toHaveLength(2));
    expect(picker()).toHaveValue("");

    enter();
    expect(await screen.findByText("reply to still there?")).toBeInTheDocument();
    expect(posted()).toEqual([{ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "still there?", thread: D24 }, { messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "still there?" }]);
  });
});

describe("the conversations", () => {
  it("are read from the server one at a time, when chosen", async () => {
    await openLatest();
    fireEvent.change(picker(), { target: { value: String(D20) } });

    expect(await screen.findByText("reply to old follow-up")).toBeInTheDocument();
    expect(shown()).not.toContain("reply to latest");
    expect(asked("GET", `/api/expressions/talk/${D20}`)).toHaveLength(1);
    say("back to this");
    await screen.findByText("reply to back to this");
    expect(posted()).toEqual([{ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "back to this", thread: D20 }]);
  });

  it("make room for a new one without a word to the server", async () => {
    await openLatest();
    const before = requests.length;
    click("新对话");

    expect(await screen.findByText(/想到什么说什么/)).toBeInTheDocument();
    expect(shown()).not.toContain("reply to latest");
    expect(picker()).toHaveValue("");
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(requests).toHaveLength(before);
    say("fresh start");
    await screen.findByText("reply to fresh start");
    expect(posted()).toEqual([{ messageId: expect.stringMatching(/^[0-9a-f-]{36}$/i), said: "fresh start" }]);
  });

  it("are forgotten in two clicks, and a new one is open after", async () => {
    await openLatest();
    click("删除");
    expect(screen.getByText(/删掉这场对话？收下的表达和练习记录都留着。/)).toBeInTheDocument();
    expect(asked("DELETE", `/api/expressions/talk/${D24}`)).toHaveLength(0);
    click("删掉");

    expect(await screen.findByText(/想到什么说什么/)).toBeInTheDocument();
    expect(asked("DELETE", `/api/expressions/talk/${D24}`)).toHaveLength(1);
    await waitFor(() => expect(within(picker()).getAllByRole("option").map((o) => o.textContent)).toEqual(["新对话", "2026/11/20 · old question（2）"]));
    expect(picker()).toHaveValue("");
  });

  it("stay when the second click is 取消", async () => {
    await openLatest();
    click("删除");
    click("取消");
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
    expect(shown()).toContain("reply to latest follow-up");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("say so when the one to open was deleted elsewhere, and open a new one", async () => {
    server.turns = [...OLD];
    useOpenThread.setState({ thread: D24, visit: 1 });
    renderPage();

    expect(await screen.findByText(/想到什么说什么/)).toBeInTheDocument();
    expect(toast.info).toHaveBeenCalledWith("这场对话已经删掉了");
    expect(picker()).toHaveValue("");
  });

  // The answer to a message shows more than a later read does, so nothing of a
  // conversation is kept between visits but which one it was.
  it("are found again after a look at another page, and read from the server anew", async () => {
    const first = await openLatest();
    fireEvent.change(picker(), { target: { value: String(D20) } });
    await screen.findByText("reply to old follow-up");
    first.unmount();

    renderPage();
    expect(await screen.findByText("reply to old follow-up")).toBeInTheDocument();
    expect(asked("GET", `/api/expressions/talk/${D20}`)).toHaveLength(2);
    expect(asked("GET", `/api/expressions/talk/${D24}`)).toHaveLength(1);
  });

  it("can be read again when reading one failed", async () => {
    server.turns = [...LATEST];
    server.failReads = 1;
    renderPage();
    expect(await screen.findByText(/读取失败：服务暂时不可用（HTTP 500）。/)).toBeInTheDocument();
    click("重试");
    expect(await screen.findByText("reply to latest follow-up")).toBeInTheDocument();
  });
});

// The plan's answer to "the index passes through the relay" is to say so where
// it is done, not to stop it.
describe("what goes to the model", () => {
  it("is said under the box, before anything is typed", async () => {
    await openNew();
    expect(screen.getByText(/发给你配置的模型/)).toHaveTextContent("每句话会连同表达库的索引（每条的英文和提示句；「想用」里的不带英文）发给你配置的模型。对话存在服务器上，可以整场删掉。");
  });
});
