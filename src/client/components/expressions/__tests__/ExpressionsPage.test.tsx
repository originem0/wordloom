// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Cue, EncounterView, ExpressionDetail, StatsResponse } from "@/shared/expressions";
import { ExpressionsPage } from "../ExpressionsPage";
import { useLastSource } from "../shared";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

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

const NO_STATS: StatsResponse = { produced: 0, testableDays: 0, attemptDays: 0, since: null, judgeAt: null };
const DAY_MS = 86_400_000;
/** What a timeline row holds besides its kind, times, cue and outcome: all of it withheld while the entry is masked. */
const BARE = { text: null, textBefore: null, myAttempt: null, sourceType: null, sourceTitle: null, sourceLocator: null, feedback: null };

/** One more row at the end of an entry's timeline, a day after the last one. */
function addRow(e: ExpressionDetail, over: Partial<EncounterView> & Pick<EncounterView, "kind">) {
  const last = e.timeline[e.timeline.length - 1];
  e.timeline.push({ ...BARE, id: last.id + 1, createdAt: last.createdAt + DAY_MS, occurredAt: null, cue: null, outcome: null, ...over });
}

// A stand-in for the API, small enough to read: it keeps the entries a test
// gives it (newest first, each with its English) and answers the routes of the
// contract that this page uses.
let server: {
  authenticated: boolean; configured: boolean; entries: ExpressionDetail[]; glossOnAnnotate: string | null; draftOnAnnotate: string | null;
  settings: Record<string, string>; stats: StatsResponse | null;
};
let requests: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** What a read answers with. An entry in 想用 leaves without its English, as it does on the real server. */
function view(e: ExpressionDetail): ExpressionDetail {
  if (e.status !== "active" || e.graduated) return { ...e, masked: false };
  return { ...e, masked: true, text: null, focus: null, note: null, gloss: null, aiIntent: null, timeline: e.timeline.map((row) => ({ ...row, ...BARE })) };
}

function answer(method: string, url: string, body: Record<string, unknown> | null): Response {
  if (url === "/api/auth/me") return json({ authenticated: server.authenticated });
  if (!server.configured) return json({ error: "Set AUTH_TOKEN to use private routes", code: "AUTH_NOT_CONFIGURED" }, 503);
  if (url === "/api/settings") return json(server.settings);
  if (url === "/api/expressions/stats") return server.stats ? json(server.stats) : json({ error: "boom" }, 500);
  // 试一条 asks for this once it is on the page; ids in the query string are not private text.
  if (/^\/api\/expressions\/try(\?exclude=[\d,]+)?$/.test(url)) return json({ items: [] });
  const [, id, action] = /^\/api\/expressions(?:\/(\d+))?(?:\/(\w+))?$/.exec(url) ?? [];
  if (!id && method === "GET") return json({ expressions: server.entries.map(view) });
  if (!id) {
    const created = entry({ id: 50 + server.entries.length, text: String(body?.text), focus: (body?.focus as string) ?? null });
    server.entries.unshift(created);
    return json(created, 201);
  }
  const found = server.entries.find((e) => e.id === Number(id));
  if (!found) return json({ error: "Not found" }, 404);
  if (method === "PATCH") {
    const next = { ...found, ...body };
    if (next.status === "active" && !next.intent) return json({ error: "An entry in 想用 needs an intent", code: "INTENT_REQUIRED" }, 400);
    Object.assign(found, body);
  }
  if (action === "annotate") {
    if (!server.glossOnAnnotate) return json({ error: "The model did not answer", code: "ANNOTATE_FAILED" }, 502);
    // Only what is still empty is filled, as on the real server.
    Object.assign(found, { gloss: found.gloss ?? server.glossOnAnnotate, aiIntent: found.aiIntent ?? server.draftOnAnnotate, annotated: true });
  }
  if (action === "reveal") {
    // The row is written before the English leaves, and only for an entry that was masked.
    if (view(found).masked) addRow(found, { kind: "reveal", cue: body?.cue as Cue, text: "" });
    return json({ ...found, masked: false });
  }
  return json(view(found));
}

const asked = (method: string, url: string) => requests.filter((r) => r.method === method && r.url === url);

beforeEach(() => {
  server = {
    authenticated: true, configured: true, entries: [], glossOnAnnotate: "to begin to be understood", draftOnAnnotate: null, settings: {}, stats: NO_STATS,
  };
  requests = [];
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
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
/** A click on the page behind the dialog. Radix starts listening a tick after the dialog opens, and acts on the click that follows the press. */
async function clickBeside() {
  await new Promise((r) => setTimeout(r, 10));
  const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
  fireEvent.pointerDown(overlay);
  fireEvent.click(overlay);
}
const patches = (id: number) => asked("PATCH", `/api/expressions/${id}`).map((r) => r.body);

describe("the 表达 page without AUTH_TOKEN", () => {
  it("says what to do instead of showing a page that cannot work", async () => {
    server.configured = false;
    renderPage();
    expect(await screen.findByText(/请设置 AUTH_TOKEN、重启服务，然后登录/)).toBeInTheDocument();
    // And the way to try it out on one's own machine without one.
    expect(screen.getByText(/EXPRESSIONS_OPEN_LOCALLY=1/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "原文" })).toBeNull();
    expect(screen.queryByText(/读取失败/)).toBeNull();
    // The refusal is final: asking again would only repeat it.
    expect(asked("GET", "/api/expressions")).toHaveLength(1);
  });
});

describe("the 表达 page for someone who is not the admin", () => {
  // Not the list, not the numbers, not 试一条, and not the settings the page reads for 帮我起草.
  it("asks the expressions API for nothing", async () => {
    server.authenticated = false;
    renderPage();
    await waitFor(() => expect(asked("GET", "/api/auth/me")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(requests.map((r) => r.url)).toEqual(["/api/auth/me"]);
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
  const wanted = () => server.entries.unshift(entry({ id: 4, text: "Sleep on it.", focus: "sleep on", status: "active", intent: "想说：先放一放再决定" }));
  const layer = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

  it("shows what is kept, newest first, with where and when it was met", async () => {
    renderPage();
    await screen.findByText("Break the ice.");
    expect(rows()).toEqual(["Break the ice.影视 · Friends · 2026/11/20", "It dawned on me that I was wrong.未记录 · 2026/11/20"]);
    expect(document.querySelector("mark")).toHaveTextContent("dawned on");
  });

  // 全部 comes first so that what was just saved, or just moved, is on top wherever it went.
  it("opens on everything that was not put away, and narrows to one layer", async () => {
    wanted();
    renderPage();
    await screen.findByText("Break the ice.");
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(rows().map((row) => row!.slice(0, 5))).toEqual(["想说：先放", "Break", "It da"]);

    layer("想用");
    expect(rows()).toEqual(["想说：先放一放再决定想用 · 未记录 · 2026/11/20"]);
    layer("见过");
    expect(rows().map((row) => row!.slice(0, 5))).toEqual(["Break", "It da"]);
    layer("已收起");
    expect(rows()).toEqual(["An old one.未记录 · 2026/11/20"]);
    layer("全部");
    expect(rows()).toHaveLength(3);
    // Choosing a layer is not a question to the server.
    expect(asked("GET", "/api/expressions")).toHaveLength(1);
  });

  // An entry in 想用 is asked for by its intent. Its English must not be anywhere on the page.
  it("shows an entry of 想用 by its intent, without its English", async () => {
    wanted();
    renderPage();
    expect(await screen.findByText("想说：先放一放再决定")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sleep on/i);
    expect(document.querySelector("mark")).toHaveTextContent("dawned on");
  });

  it("marks a row with what the timeline says of it, and with nothing that counts or ranks", async () => {
    server.entries = [
      entry({ id: 8, text: "One.", status: "active", intent: "排着的", queued: true }),
      entry({ id: 7, text: "Two.", status: "active", intent: "用出过的", produced: true }),
      entry({ id: 6, text: "Three.", status: "active", intent: "毕业的", produced: true, graduated: true }),
      entry({ id: 5, text: "Four." }),
    ];
    renderPage();
    await screen.findByText("Four.");
    expect(rows()).toEqual([
      "排着的想用 · 排队中 · 未记录 · 2026/11/20",
      "用出过的想用 · 用出过 · 未记录 · 2026/11/20",
      // Graduated: no longer asked, so no longer masked.
      "Three.想用 · 已毕业 · 用出过 · 未记录 · 2026/11/20",
      "Four.未记录 · 2026/11/20",
    ]);
    expect(document.querySelector('[role="progressbar"], progress, meter')).toBeNull();
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
});

// The page shows one count and two day counts. Not how big the library is, no
// ratio, no bar, no streak: those would turn a record into a score.
describe("the numbers", () => {
  const statsAnswered = async () => {
    await waitFor(() => expect(asked("GET", "/api/expressions/stats")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
  };

  it("says how many were produced and what that means, the two day counts and the day of the verdict", async () => {
    server.entries = [entry({ id: 1, text: "One." }), entry({ id: 2, text: "Two." })];
    server.stats = { produced: 3, testableDays: 9, attemptDays: 4, since: MET_AT, judgeAt: MET_AT + 28 * DAY_MS };
    renderPage();
    const line = (await screen.findByText(/用出过 3 条/)).closest("p")!;
    expect(line.textContent).toBe("用出过 3 条（隔了一天以上、作答前没看答案、在新句子里打出来过） · 可测 9 天，其中作答 4 天 · 判定日 2026/12/18");
    expect(document.querySelector('[role="progressbar"], progress, meter')).toBeNull();
  });

  it("says nothing for an empty library", async () => {
    renderPage();
    await screen.findByText("还没有收下任何表达。");
    await statsAnswered();
    expect(document.body.textContent).not.toMatch(/用出过|可测|判定日/);
  });

  it("says nothing when the numbers cannot be read, and leaves the page alone", async () => {
    server.entries = [entry({ id: 1, text: "One." })];
    server.stats = null;
    renderPage();
    await screen.findByText("One.");
    await statsAnswered();
    expect(document.body.textContent).not.toMatch(/用出过|可测|判定日|读取失败/);
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

    fireEvent.change(note, { target: { value: "half a thought" } });
    await clickBeside();
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByRole("textbox", { name: "备注" })).toHaveValue("half a thought");

    fireEvent.change(note, { target: { value: "from a podcast" } });
    await clickBeside();
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
    // What was put away is in neither layer: it is brought back to 见过 first.
    for (const name of ["放进想用", "退回见过"]) expect(screen.queryByRole("button", { name })).toBeNull();
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

// An entry is asked for by its 提示句, so it has to be in the user's own words,
// and the library keeps who wrote it: the pass rates of the kinds get compared.
describe("the 提示句 and the two layers, in the detail", () => {
  beforeEach(() => {
    server.entries = [
      entry({ id: 6, text: "I'm swamped this week.", sourceType: "chat" }),
      entry({ id: 5, text: "Let's call it a day.", sourceType: "find" }),
      entry({ id: 2, text: "It dawned on me that I was wrong.", focus: "dawned on", note: "from a podcast" }),
    ];
    server.entries[0].timeline[0].textBefore = "I am very busy this week";
    Object.assign(server.entries[1].timeline[0], { textBefore: "今天就到这吧", myAttempt: "Let's stop today" });
  });

  async function open(part: string) {
    renderPage();
    await openRow(part);
    return screen.findByRole<HTMLInputElement>("textbox", { name: /提示句/ });
  }
  const button = (name: string) => screen.getByRole("button", { name });

  it("saves what was typed as the user's own", async () => {
    const intent = await open("It dawned on me");
    expect(intent).toHaveValue("");
    expect(intent).toHaveAttribute("maxlength", "1000");

    fireEvent.change(intent, { target: { value: "  想说：我突然明白了 " } });
    fireEvent.click(button("保存"));
    await waitFor(() => expect(patches(2)).toEqual([{ intent: "想说：我突然明白了", intentBy: "self" }]));
    await waitFor(() => expect(intent).toHaveValue("想说：我突然明白了"));
    expect(button("保存")).toBeDisabled();

    // In 见过 an entry may be without one again: blanks clear it.
    fireEvent.change(intent, { target: { value: "   " } });
    fireEvent.click(button("保存"));
    await waitFor(() => expect(patches(2)).toHaveLength(2));
    expect(patches(2)[1]).toMatchObject({ intent: null });
    await waitFor(() => expect(intent).toHaveValue(""));
    expect(button("保存")).toBeDisabled();
  });

  // What the user wanted to say when the entry was kept is the best prompt
  // there is. It is offered, not saved: the entry may never go to 想用.
  it("offers the need of an entry kept from 找, which is not an edit and holds nothing up", async () => {
    const intent = await open("call it a day");
    expect(intent).toHaveValue("今天就到这吧");
    expect(button("保存")).toBeDisabled();

    // Another field saved: the suggestion does not ride along.
    fireEvent.change(screen.getByRole("textbox", { name: "备注" }), { target: { value: "said at work" } });
    fireEvent.click(button("保存"));
    await waitFor(() => expect(patches(5)).toEqual([{ note: "said at work" }]));
    await waitFor(() => expect(button("保存")).toBeDisabled());
    expect(intent).toHaveValue("今天就到这吧");

    await clickBeside();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("放进想用 saves the untouched suggestion in the same request, as the need of 找", async () => {
    await open("call it a day");
    fireEvent.click(button("放进想用"));
    await waitFor(() => expect(patches(5)).toEqual([{ status: "active", intent: "今天就到这吧", intentBy: "find" }]));
    // The answer to that request is the entry as it now reads: asked for by its intent, the English withheld.
    await screen.findByRole("button", { name: "看答案" });
    expect(document.body.textContent).not.toMatch(/call it a day|stop today/i);
    expect(screen.getByRole("textbox", { name: /提示句/ })).toHaveValue("今天就到这吧");
    expect(asked("GET", "/api/expressions/5")).toHaveLength(1);
  });

  it("counts the line above a pasted passage as the user's own line", async () => {
    const intent = await open("swamped");
    expect(intent).toHaveValue("I am very busy this week");
    fireEvent.click(button("放进想用"));
    await waitFor(() => expect(patches(6)).toEqual([{ status: "active", intent: "I am very busy this week", intentBy: "paste" }]));
  });

  it("counts a suggestion that was changed as the user's own", async () => {
    const intent = await open("swamped");
    fireEvent.change(intent, { target: { value: "想说：这周忙不过来" } });
    expect(button("保存")).toBeEnabled();
    fireEvent.click(button("放进想用"));
    await waitFor(() => expect(patches(6)).toEqual([{ status: "active", intent: "想说：这周忙不过来", intentBy: "self" }]));
  });

  it("cuts a long passage above down to what an intent may hold", async () => {
    server.entries[0].timeline[0].textBefore = "x".repeat(1200);
    expect((await open("swamped")).value).toHaveLength(1000);
  });

  // The field holds one line, and a browser drops the line breaks from what it
  // is given: the words on either side would run together, and what is sent
  // would not be what was shown.
  it("offers what was written on several lines as one", async () => {
    server.entries[0].timeline[0].textBefore = "  I am very busy\nthis week,\r\n\r\n  really ";
    const intent = await open("swamped");
    expect(intent).toHaveValue("I am very busy this week, really");
    expect(button("保存")).toBeDisabled();
    fireEvent.click(button("放进想用"));
    await waitFor(() => expect(patches(6)).toEqual([{ status: "active", intent: "I am very busy this week, really", intentBy: "paste" }]));
  });

  it("refuses 放进想用 until there is an intent, and says why", async () => {
    const intent = await open("It dawned on me");
    expect(button("放进想用")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "退回见过" })).toBeNull();
    expect(screen.getByText("放进想用之前，先写一句提示句。")).toBeInTheDocument();

    fireEvent.change(intent, { target: { value: "   " } });
    expect(button("放进想用")).toBeDisabled();
    fireEvent.change(intent, { target: { value: "想说：我突然明白了" } });
    expect(screen.queryByText("放进想用之前，先写一句提示句。")).toBeNull();
    fireEvent.click(button("放进想用"));
    await waitFor(() => expect(patches(2)).toEqual([{ status: "active", intent: "想说：我突然明白了", intentBy: "self" }]));
  });

  // The fields of 见过 are gone once the entry is masked, so what was typed in them goes with the move.
  it("takes what else was typed along into 想用, and leaves a saved intent alone", async () => {
    Object.assign(server.entries[2], { intent: "想说：我突然明白了", intentBy: "self" });
    await open("It dawned on me");
    fireEvent.change(screen.getByRole("textbox", { name: "备注" }), { target: { value: "heard twice now" } });
    fireEvent.click(button("放进想用"));
    await waitFor(() => expect(patches(2)).toEqual([{ status: "active", note: "heard twice now" }]));
  });

  it("brings an entry back to 见过, where it reads in full and can be edited", async () => {
    Object.assign(server.entries[2], { status: "active", intent: "想说：我突然明白了", intentBy: "self" });
    await open("我突然明白了");
    expect(screen.queryByRole("button", { name: "放进想用" })).toBeNull();
    fireEvent.click(button("退回见过"));
    await waitFor(() => expect(patches(2)).toEqual([{ status: "seen" }]));
    expect(await screen.findByRole("textbox", { name: "备注" })).toHaveValue("from a podcast");
    expect(screen.getByRole("textbox", { name: "焦点" })).toHaveValue("dawned on");
    expect(screen.getByRole("dialog").querySelector("mark")).toHaveTextContent("dawned on");
    expect(button("保存")).toBeDisabled();
    expect(button("放进想用")).toBeEnabled();
  });

  it("says what is missing when the server refuses an entry of 想用 without an intent", async () => {
    Object.assign(server.entries[2], { status: "active", intent: "想说：我突然明白了", intentBy: "self" });
    const intent = await open("我突然明白了");
    fireEvent.change(intent, { target: { value: "" } });
    fireEvent.click(button("保存"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("先写一句提示句"));
    expect(server.entries[2].intent).toBe("想说：我突然明白了");
  });

  it("takes a 提示句 that was being rewritten along on the way back to 见过", async () => {
    Object.assign(server.entries[2], { status: "active", intent: "想说：我突然明白了", intentBy: "self" });
    const intent = await open("我突然明白了");
    fireEvent.change(intent, { target: { value: "想说：忽然想通了" } });
    fireEvent.click(button("退回见过"));
    await waitFor(() => expect(patches(2)).toEqual([{ intent: "想说：忽然想通了", intentBy: "self", status: "seen" }]));
    await screen.findByRole("textbox", { name: "备注" });
    expect(screen.getByRole("textbox", { name: /提示句/ })).toHaveValue("想说：忽然想通了");
  });

  it("takes it along when the entry is put away from 想用 as well", async () => {
    Object.assign(server.entries[2], { status: "active", intent: "想说：我突然明白了", intentBy: "self" });
    const intent = await open("我突然明白了");
    fireEvent.change(intent, { target: { value: "想说：忽然想通了" } });
    fireEvent.click(button("收起"));
    await waitFor(() => expect(patches(2)).toEqual([{ intent: "想说：忽然想通了", intentBy: "self", status: "retired" }]));
    expect(await screen.findByRole("button", { name: "恢复" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /提示句/ })).toHaveValue("想说：忽然想通了");
  });
});

// 帮我起草 is built and switched off. A prompt the model wrote is a different
// kind of prompt, and until the switch is on it must not be on screen at all:
// read once, it would be in every prompt the user then writes "themselves".
describe("帮我起草", () => {
  const DRAFT = "想说：事情到此为止";
  /** A library of `seen` entries in 见过 and `active` in 想用, whose first entry was saved `days` ago. */
  function library(seen: number, active: number, days: number) {
    const at = Date.now() - days * DAY_MS;
    server.entries = [
      entry({ id: 99, text: "Let's call it a day.", aiIntent: DRAFT, createdAt: at }),
      ...Array.from({ length: seen - 1 }, (_, i) => entry({ id: 100 + i, text: `Seen ${i}.` })),
      ...Array.from({ length: active }, (_, i) => entry({ id: 200 + i, text: `Wanted ${i}.`, status: "active", intent: `想用 ${i}` })),
    ];
  }
  async function open() {
    renderPage();
    await openRow("call it a day");
    return screen.findByRole("textbox", { name: /提示句/ });
  }
  const offered = () => screen.queryByRole("button", { name: "帮我起草" });

  it("is off to begin with, and then the AI's intent is nowhere on the page", async () => {
    library(1, 0, 30);
    await open();
    await waitFor(() => expect(asked("GET", "/api/settings")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(offered()).toBeNull();
    expect(document.body.textContent).not.toContain(DRAFT);
    expect(document.querySelector(`[value*="${DRAFT}"]`)).toBeNull();
  });

  it("is there once it was switched on in Settings, and what it wrote is kept as the AI's even after a change", async () => {
    library(1, 0, 0);
    server.settings = { expressions_draft: "1" };
    const intent = await open();
    fireEvent.click(await screen.findByRole("button", { name: "帮我起草" }));
    expect(intent).toHaveValue(DRAFT);

    fireEvent.change(intent, { target: { value: "想说：今天就到这" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(patches(99)).toEqual([{ intent: "想说：今天就到这", intentBy: "ai" }]));

    // The draft has been read: what is typed over it later is still not the user's own.
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeDisabled());
    fireEvent.change(intent, { target: { value: "想说：收工" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(patches(99)).toHaveLength(2));
    expect(patches(99)[1]).toEqual({ intent: "想说：收工", intentBy: "ai" });
  });

  // Whether a drafted prompt was changed is read off the two texts. Which kind it is must survive the change.
  it("keeps a prompt that was drafted earlier as the AI's when it is edited with the switch off", async () => {
    library(1, 0, 0);
    Object.assign(server.entries[0], { intent: DRAFT, intentBy: "ai" });
    const intent = await open();
    fireEvent.change(intent, { target: { value: "想说：到此为止吧" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(patches(99)).toEqual([{ intent: "想说：到此为止吧", intentBy: "ai" }]));
  });

  it("goes into 想用 as the AI's when the draft is taken as it is", async () => {
    library(1, 0, 0);
    server.settings = { expressions_draft: "1" };
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "帮我起草" }));
    fireEvent.click(screen.getByRole("button", { name: "放进想用" }));
    await waitFor(() => expect(patches(99)).toEqual([{ status: "active", intent: DRAFT, intentBy: "ai" }]));
  });

  // An entry can have a gloss and no intent of the AI's: the first one gave the
  // target away and was dropped. 帮我起草 is then the retry of 补注, and the
  // server fills only what is still empty.
  it("asks for the annotation again when the entry has no intent of the AI's, and takes what comes back", async () => {
    library(1, 0, 0);
    Object.assign(server.entries[0], { aiIntent: null, gloss: "to stop for today", annotated: true });
    server.settings = { expressions_draft: "1" };
    server.draftOnAnnotate = DRAFT;
    const intent = await open();
    fireEvent.click(await screen.findByRole("button", { name: "帮我起草" }));
    await waitFor(() => expect(intent).toHaveValue(DRAFT));
    expect(asked("POST", "/api/expressions/99/annotate")).toHaveLength(1);
    expect(screen.getByText("to stop for today")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(patches(99)).toEqual([{ intent: DRAFT, intentBy: "ai" }]));
  });

  it("says so when no draft comes back or the model fails, and leaves the field alone", async () => {
    library(1, 0, 0);
    server.entries[0].aiIntent = null;
    server.settings = { expressions_draft: "1" };
    const intent = await open();
    fireEvent.click(await screen.findByRole("button", { name: "帮我起草" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("这次没有起草出来：可以再点一次，或者自己写一句"));

    server.glossOnAnnotate = null;
    await waitFor(() => expect(screen.getByRole("button", { name: "帮我起草" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "帮我起草" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有起草成：The model did not answer"));
    expect(intent).toHaveValue("");
    expect(patches(99)).toEqual([]);
  });

  it("is not offered for an entry in 想用, whose intent of the AI's stays on the server", async () => {
    library(1, 0, 0);
    Object.assign(server.entries[0], { status: "active", intent: "想说：今天到此为止" });
    server.settings = { expressions_draft: "1" };
    renderPage();
    await openRow("今天到此为止");
    await screen.findByRole("button", { name: "看答案" });
    await waitFor(() => expect(asked("GET", "/api/settings")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(offered()).toBeNull();
  });

  // The rule written down before launch: two weeks in, plenty kept and almost
  // nothing moved to 想用 means that writing the prompt is what is in the way.
  it("opens by itself once the library is two weeks old with twenty in 见过 and fewer than five in 想用", async () => {
    library(20, 4, 14);
    await open();
    expect(await screen.findByRole("button", { name: "帮我起草" })).toBeInTheDocument();
  });

  it.each([
    ["the library is younger than two weeks", 20, 4, 13],
    ["fewer than twenty are in 见过", 19, 4, 14],
    ["five are in 想用 already", 20, 5, 14],
  ])("stays shut while %s", async (_why, seen, active, days) => {
    library(seen, active, days);
    await open();
    await waitFor(() => expect(asked("GET", "/api/settings")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(offered()).toBeNull();
  });
});

// The timeline is the record everything else is folded from: every row is
// listed, in the page's own words for what happened, and each conclusion on
// the page can be traced back to a row here.
describe("the timeline, in the detail", () => {
  /** Something of every text the rows hold, and of every wording that is derived from one. */
  const WITHHELD = /sleep on|A novel|Rachel|S2E7|answer tonight|p\. 41|想说先别急着定|think one night|还是那个意思|decide later|朋友催你|Sleep it|Hmm|redundant|用上了|说通|你改过/i;
  const timeline = () =>
    Array.from(screen.getByRole("dialog").querySelectorAll("ol > li")).map((li) => Array.from(li.childNodes).map((node) => node.textContent));

  beforeEach(() => {
    const e = entry({ id: 7, text: "Let me sleep on it.", focus: "sleep on", sourceType: "video", sourceTitle: "Friends", intent: "想说：先放一放再决定" });
    Object.assign(e.timeline[0], { textBefore: "Rachel: so, are you in?", sourceLocator: "S2E7" });
    addRow(e, { kind: "met", text: "I'll sleep on it and call you.", textBefore: "He wanted an answer tonight.", sourceType: "book", sourceTitle: "A novel", sourceLocator: "p. 41" });
    addRow(e, { kind: "looked_up", text: "想说先别急着定", myAttempt: "let me think one night", cue: "masked" });
    addRow(e, { kind: "looked_up", text: "还是那个意思" });
    addRow(e, {
      kind: "attempt", text: "Let me sleep on it first.", cue: "need", outcome: "pass",
      feedback: { prompt: "想说：先放一放再决定", status: "done", used: true, conveyed: true, rewrites: [{ from: "sleep on it first", to: "sleep on it", why: "first is redundant" }] },
    });
    addRow(e, {
      kind: "attempt", text: "I will decide later.", cue: "none", outcome: "pass",
      feedback: { prompt: "朋友催你今晚就答复", status: "done", used: false, conveyed: true, overturned: true, modelOutcome: "fail" },
    });
    addRow(e, { kind: "attempt", text: "Sleep it.", cue: "scene", outcome: "fail", feedback: { prompt: "朋友催你今晚就答复", status: "done", used: false, conveyed: false } });
    addRow(e, { kind: "attempt", text: "Hmm.", cue: "revealed", feedback: { prompt: "想说：先放一放再决定", status: "failed" } });
    addRow(e, { kind: "reveal", text: "", cue: "masked" });
    addRow(e, { kind: "reveal", text: "", cue: "need" });
    addRow(e, { kind: "used", text: "Let me sleep on it." });
    server.entries = [e];
  });

  const FULL = [
    // Its 上文 is the scene the entry came from, and stands above the sentence instead.
    ["2026/11/20 · 遇到 · 影视 · Friends · S2E7"],
    ["2026/11/21 · 遇到 · 书 · A novel · p. 41", "上文：He wanted an answer tonight.", "I'll sleep on it and call you."],
    ["2026/11/22 · 找 · 遮着给的", "想说先别急着定", "试写：let me think one night"],
    ["2026/11/23 · 找", "还是那个意思"],
    ["2026/11/24 · 作答 · 有提示句 · 算用上", "Let me sleep on it first.", "题面：想说：先放一放再决定", "用上了", "sleep on it first → sleep on it（first is redundant）"],
    ["2026/11/25 · 作答 · 只有新情境 · 算用上 · 你改过", "I will decide later.", "题面：朋友催你今晚就答复", "绕开但说通了"],
    ["2026/11/26 · 作答 · 看了原场景 · 不算", "Sleep it.", "题面：朋友催你今晚就答复", "没说通"],
    ["2026/11/27 · 作答 · 看过答案 · 没判", "Hmm.", "题面：想说：先放一放再决定"],
    ["2026/11/28 · 看答案"],
    ["2026/11/29 · 看答案 · 放弃"],
    // Only a `met` row leaves out a sentence that is the entry's own.
    ["2026/11/30 · 用出", "Let me sleep on it."],
  ];

  it("lists every row, oldest first, with what it holds", async () => {
    renderPage();
    await openRow("Let me sleep on it.");
    await screen.findByRole("textbox", { name: "备注" });
    expect(timeline()).toEqual(FULL);
    // Each 上文 once: the first above the sentence, a later one on its own row.
    expect(screen.getByRole("dialog").textContent?.split("Rachel: so, are you in?")).toHaveLength(2);
    expect(screen.getByRole("dialog").textContent?.split("He wanted an answer tonight.")).toHaveLength(2);
  });

  // The server sends a masked entry's rows without their text. What is left
  // says that something happened, when, at which hint level and how it counted.
  it("shows only kind, time, hint and outcome while the entry is masked, and the rest after 看答案", async () => {
    server.entries[0].status = "active";
    renderPage();
    await openRow("先放一放");
    await screen.findByRole("button", { name: "看答案" });
    expect(timeline()).toEqual([
      ["2026/11/20 · 遇到"], ["2026/11/21 · 遇到"], ["2026/11/22 · 找 · 遮着给的"], ["2026/11/23 · 找"], ["2026/11/24 · 作答 · 有提示句 · 算用上"],
      ["2026/11/25 · 作答 · 只有新情境 · 算用上"], ["2026/11/26 · 作答 · 看了原场景 · 不算"], ["2026/11/27 · 作答 · 看过答案 · 没判"],
      ["2026/11/28 · 看答案"], ["2026/11/29 · 看答案 · 放弃"], ["2026/11/30 · 用出"],
    ]);
    expect(document.body.textContent).not.toMatch(WITHHELD);

    fireEvent.click(screen.getByRole("button", { name: "看答案" }));
    await waitFor(() => expect(timeline()).toHaveLength(12));
    expect(timeline()).toEqual([...FULL, ["2026/12/1 · 看答案"]]);
  });
});

// "Had not seen the answer" rests on this: the English of an entry in 想用
// reaches the page only as the answer to a request that wrote a row.
describe("the detail of an entry in 想用", () => {
  const ENGLISH = /sleep on|decide tomorrow|a note of mine|to postpone/i;
  const everythingCached = () =>
    JSON.stringify([client.getQueryCache().getAll().map((q) => q.state.data), client.getMutationCache().getAll().map((m) => m.state.data)]);

  beforeEach(() => {
    server.entries = [
      entry({
        id: 4, text: "Let me sleep on it.", focus: "sleep on", status: "active", intent: "想说：先放一放再决定", intentBy: "self",
        note: "a note of mine", gloss: "to postpone a decision", annotated: true, sourceType: "video", sourceTitle: "Friends",
      }),
    ];
    server.entries[0].timeline[0].textBefore = "Can you decide tomorrow?";
  });

  async function open() {
    renderPage();
    await openRow("先放一放");
    return screen.findByRole("textbox", { name: /提示句/ });
  }

  it("shows the intent, the source and the date, and no field that would be empty", async () => {
    const intent = await open();
    const dialog = screen.getByRole("dialog");
    expect(intent).toHaveValue("想说：先放一放再决定");
    expect(dialog).toHaveTextContent("出处：影视 · Friends");
    expect(screen.getByLabelText("遇到的时间")).toHaveValue("2026-11-20T09:30");
    for (const name of ["焦点", "备注"]) expect(screen.queryByRole("textbox", { name })).toBeNull();
    expect(dialog).not.toHaveTextContent("补注");
    expect(document.body.textContent).not.toMatch(ENGLISH);
    expect(document.querySelector("mark")).toBeNull();
  });

  it("shows the English after 看答案, which is a request that says where it was asked", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "看答案" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toHaveTextContent("Let me sleep on it."));
    expect(asked("POST", "/api/expressions/4/reveal").map((r) => r.body)).toEqual([{ cue: "masked" }]);
    expect(dialog.querySelector("mark")).toHaveTextContent("sleep on");
    for (const shown of ["Can you decide tomorrow?", "备注：a note of mine", "补注 · AI 写的", "to postpone a decision"]) expect(dialog).toHaveTextContent(shown);
    // Read-only: an entry is edited in 见过, where nothing about it is withheld.
    for (const name of ["焦点", "备注"]) expect(screen.queryByRole("textbox", { name })).toBeNull();
    expect(screen.queryByRole("button", { name: "看答案" })).toBeNull();
  });

  // Kept anywhere but in the open dialog, the answer would come back on the
  // next look with no row saying that it was seen.
  it("is masked again once the dialog was closed, and a second look is a second request", async () => {
    // The prototype of the storage that is really there (Node's own under Node 26): a spy on `Storage.prototype` would see no write.
    const stored = vi.spyOn(Object.getPrototypeOf(sessionStorage) as Storage, "setItem");
    await open();
    fireEvent.click(screen.getByRole("button", { name: "看答案" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Let me sleep on it."));
    // The entry is read again after the reveal: that read is masked, and must not take the answer off the screen.
    await waitFor(() => expect(asked("GET", "/api/expressions/4")).toHaveLength(2));
    expect(screen.getByRole("dialog")).toHaveTextContent("Let me sleep on it.");
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.state.data))).not.toMatch(ENGLISH);
    expect(stored).not.toHaveBeenCalled();
    stored.mockRestore();

    closeDetail();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(everythingCached()).not.toMatch(ENGLISH));
    expect(document.body.textContent).not.toMatch(ENGLISH);

    await openRow("先放一放");
    fireEvent.click(await screen.findByRole("button", { name: "看答案" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Let me sleep on it."));
    expect(asked("POST", "/api/expressions/4/reveal")).toHaveLength(2);
    expect(server.entries[0].timeline.filter((row) => row.kind === "reveal")).toHaveLength(2);
  });

  it("says so when the answer could not be fetched, and shows nothing of it", async () => {
    await open();
    server.entries = [];
    fireEvent.click(screen.getByRole("button", { name: "看答案" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有看成：Not found"));
    expect(document.body.textContent).not.toMatch(ENGLISH);
  });

  // The fields of the masked view are empty because nothing was sent for them.
  // Carried over to the entry in full, they would read as an edit that wipes its note.
  it("starts over when the entry comes back unmasked while it is open", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "看答案" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("备注：a note of mine"));

    server.entries[0].status = "seen";
    await act(() => client.invalidateQueries());
    expect(await screen.findByRole("textbox", { name: "备注" })).toHaveValue("a note of mine");
    expect(screen.getByRole("textbox", { name: "焦点" })).toHaveValue("sleep on");
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    // And what 看答案 had answered is not kept beside the entry itself.
    expect(screen.getByRole("dialog")).not.toHaveTextContent("备注：");
  });
});

// Everything on this page was typed by the user, pasted from somewhere, or
// written by a model that read those: it is shown as text and never parsed.
describe("the 表达 page treats what it shows as text, never as markup", () => {
  const HOSTILE = '<img src=x onerror="alert(1)">';
  const hostileEntry = () => {
    const e = entry({
      id: 9, text: `It **dawned** on me ${HOSTILE}`, focus: `me ${HOSTILE}`, note: `<script>window.__pwned = 1</script>`,
      gloss: `gloss ${HOSTILE}`, aiIntent: `drafted ${HOSTILE}`, intent: `<b>bold</b>`, sourceType: "book", sourceTitle: `title ${HOSTILE}`,
      annotated: true,
    });
    Object.assign(e.timeline[0], { textBefore: `before ${HOSTILE}`, sourceLocator: `p. 3 ${HOSTILE}` });
    addRow(e, { kind: "looked_up", text: `need ${HOSTILE}`, myAttempt: `tried ${HOSTILE}` });
    addRow(e, {
      kind: "attempt", text: `sentence ${HOSTILE}`, cue: "need", outcome: "fail",
      feedback: { prompt: `asked ${HOSTILE}`, status: "done", used: false, conveyed: false, rewrites: [{ from: "<i>from</i>", to: `to ${HOSTILE}`, why: `why ${HOSTILE}` }] },
    });
    return e;
  };
  const IN_THE_ROWS = [`need ${HOSTILE}`, `试写：tried ${HOSTILE}`, `sentence ${HOSTILE}`, `题面：asked ${HOSTILE}`, `<i>from</i> → to ${HOSTILE}（why ${HOSTILE}）`];

  it("does not materialise HTML from an entry, in the list or in the detail", async () => {
    server.settings = { expressions_draft: "1" };
    server.entries = [hostileEntry()];
    renderPage();
    await openRow("It **dawned** on");
    const dialog = await screen.findByRole("dialog");
    await screen.findByText(`gloss ${HOSTILE}`);

    expect(document.querySelector("img, script, b, strong, i")).toBeNull();
    expect(dialog.querySelector("mark")).toHaveTextContent(`me ${HOSTILE}`);
    for (const shown of [`before ${HOSTILE}`, `title ${HOSTILE}`, `p. 3 ${HOSTILE}`, ...IN_THE_ROWS]) expect(dialog).toHaveTextContent(shown);
    expect(screen.getByRole("textbox", { name: "备注" })).toHaveValue("<script>window.__pwned = 1</script>");
    const intent = screen.getByRole("textbox", { name: /提示句/ });
    expect(intent).toHaveValue("<b>bold</b>");
    fireEvent.click(await screen.findByRole("button", { name: "帮我起草" }));
    expect(intent).toHaveValue(`drafted ${HOSTILE}`);
    expect(document.querySelector("img, script, b, strong, i")).toBeNull();
  });

  // After 看答案 the note is a paragraph, not the value of a field.
  it("does not materialise HTML from what 看答案 answers with", async () => {
    server.entries = [{ ...hostileEntry(), status: "active" }];
    renderPage();
    await openRow("<b>bold</b>");
    fireEvent.click(await screen.findByRole("button", { name: "看答案" }));
    const dialog = screen.getByRole("dialog");
    await screen.findByText(`gloss ${HOSTILE}`);

    expect(document.querySelector("img, script, b, strong, i")).toBeNull();
    expect(dialog.querySelector("mark")).toHaveTextContent(`me ${HOSTILE}`);
    for (const shown of [`before ${HOSTILE}`, "<script>window.__pwned = 1</script>", ...IN_THE_ROWS]) expect(dialog).toHaveTextContent(shown);
  });
});
