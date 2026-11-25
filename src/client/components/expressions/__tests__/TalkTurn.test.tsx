// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AttemptResponse, ExpressionSummary, TalkTurn } from "@/shared/expressions";
import { TurnView } from "../TalkTurn";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ENGLISH = "It dawned on me that I was wrong.";
const SAID = "我突然意识到我错了";
const REPLY = "That moment of realising it is rarely comfortable. What gave it away?";

const entry = (over: Partial<ExpressionSummary> = {}): ExpressionSummary => ({
  id: 7, status: "seen", masked: false, text: ENGLISH, focus: "dawned on", intent: null, intentBy: null,
  sourceType: "book", sourceTitle: "The Remains of the Day", occurredAt: null,
  createdAt: new Date(2026, 9, 3).getTime(), updatedAt: new Date(2026, 9, 3).getTime(),
  produced: false, graduated: false, queued: false, ...over,
});

/** In 想用 and not graduated: the server sends neither the text nor the focus. */
const MASKED = entry({ id: 9, status: "active", masked: true, text: null, focus: null, intent: "想说：我突然明白了", intentBy: "self", sourceType: "chat", sourceTitle: null });
const FRESH = { text: "It struck me that something was off.", focus: "It struck me that", why: "more abrupt, like a blow" };

const turn = (over: Partial<TalkTurn> = {}): TalkTurn => ({
  id: 1, thread: 100, createdAt: 100, said: SAID, reply: REPLY, fix: null, rewrites: [], fresh: [], mine: [], searched: 3, total: 3, ...over,
});

const judged = (over: Partial<AttemptResponse> = {}): AttemptResponse => ({
  encounterId: 31, status: "done", verdict: "used", outcome: "pass", overturned: false, rewrites: [],
  answer: { text: ENGLISH, focus: "dawned on", gloss: "to become clear to someone" }, intent: null, ...over,
});

/** Every request the turn sent, and what the server is to answer to the next ones (201 by default). */
let sent: Array<{ method: string; url: string; body: unknown }>;
let answers: Array<{ status: number; body: unknown }>;

beforeEach(() => {
  sent = [];
  answers = [];
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ method: init?.method ?? "GET", url, body: JSON.parse(String(init?.body ?? "null")) });
      const { status, body } = answers.shift() ?? { status: 201, body: { id: 1 } };
      return new Response(JSON.stringify(body), { status });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function show(t: TalkTurn) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ol>
        <TurnView turn={t} />
      </ol>
    </QueryClientProvider>,
  );
}

const shown = () => document.body.textContent!;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
// The prototype of the storage that is really there. Under Node 26 that is
// Node's own, not the `Storage` jsdom puts on the global: a spy on
// `Storage.prototype` would see no write at all.
const watchStorage = () => vi.spyOn(Object.getPrototypeOf(sessionStorage) as Storage, "setItem");

describe("a turn", () => {
  it("keeps the reply while retrying failed coaching on the same turn", async () => {
    const original = turn({ coachingFailure: "failed" });
    answers.push({ status: 200, body: turn({ fresh: [FRESH] }) });
    show(original);
    expect(screen.getByText(REPLY)).toBeInTheDocument();
    click("重试批注");
    await screen.findByText("值得留下 · AI 建议");
    expect(screen.getByText(REPLY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试批注" })).not.toBeInTheDocument();
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions/talk/turn/1/coach", body: {} }]);
  });
  it("is the message and the reply, and nothing else when nothing came with them", () => {
    show(turn());
    expect(screen.getByText(SAID)).toBeInTheDocument();
    expect(screen.getByText(REPLY)).toBeInTheDocument();
    // It is a conversation: no word about a library that had nothing to say.
    expect(shown()).toBe(SAID + "听语音" + REPLY);
    expect(screen.getByRole("button", { name: "听语音" })).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says how much of the library was searched when not all of it fitted", () => {
    show(turn({ searched: 120, total: 300 }));
    expect(screen.getByText("这次只搜了 120 / 300 条。")).toBeInTheDocument();
  });

  it("says what a blank stands for, wherever the server put one", () => {
    show(turn({ reply: "That is when it ____ you, I suppose." }));
    expect(screen.getByText(/____ 是你「想用」里的一条/)).toBeInTheDocument();
  });

  it.each([
    ["the message", { said: "It ____ me." }],
    ["the whole sentence", { fix: { text: "It ____ me that I was wrong.", why: "" } }],
    ["a suggestion", { fresh: [{ text: "It ____ me.", why: "" }] }],
  ])("says so for a blank in %s too", (_, over) => {
    show(turn(over));
    expect(screen.getByText(/____ 是你「想用」里的一条/)).toBeInTheDocument();
  });
});

describe("a correction", () => {
  const REWRITE = { from: "I very like it", to: "I really like it", why: "very does not go with a verb" };

  it("quotes the user's own words, and is kept with them as what was tried", async () => {
    show(turn({ said: "I very like it, to be honest.", rewrites: [REWRITE] }));
    expect(screen.getByText("可以改的地方")).toBeInTheDocument();
    expect(screen.getByText(REWRITE.from)).toHaveClass("line-through");
    expect(screen.getByText(REWRITE.why)).toBeInTheDocument();
    answers.push({ status: 201, body: { id: 12 } });
    click("收");

    expect(await screen.findByText("已收下")).toBeInTheDocument();
    expect(sent).toEqual([{
      method: "POST", url: "/api/expressions", body: { text: REWRITE.to, found: { need: "I very like it, to be honest.", attempt: REWRITE.from } },
    }]);
    expect(screen.queryByRole("button", { name: "收" })).toBeNull();
  });

  it("of the whole message is kept with the message as its scene", async () => {
    show(turn({ fix: { text: "It dawned on me that I'd been wrong.", why: "the idea arrives by itself" }, fresh: [FRESH] }));
    expect(screen.getByText("整句更自然的说法")).toBeInTheDocument();
    expect(screen.getByText("the idea arrives by itself")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "收" })[0]);

    expect(await screen.findByText("已收下")).toBeInTheDocument();
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions", body: { text: "It dawned on me that I'd been wrong.", found: { need: SAID } } }]);
    // The other one is still to be decided.
    expect(screen.getAllByRole("button", { name: "收" })).toHaveLength(1);
  });
});

describe("hits that are not masked", () => {
  it("come in two groups, each with its text, the focus marked, the reason, the source and the date", () => {
    show(turn({
      mine: [
        { expression: entry(), why: "the same sudden realisation" },
        { expression: entry({ id: 8, text: "Break the ice.", focus: null, produced: true, sourceType: null, sourceTitle: null, occurredAt: new Date(2026, 8, 1).getTime() }), why: null },
      ],
    }));
    const used = screen.getByRole("group", { name: "你库里的 · 用出过的" });
    const stored = screen.getByRole("group", { name: "你库里的 · 存过没用出的" });
    expect(within(used).getByText("Break the ice.")).toBeInTheDocument();
    // The day it was met when that is known, else the day it was saved.
    expect(within(used).getByText("未记录 · 2026/9/1")).toBeInTheDocument();
    expect(stored).toHaveTextContent(ENGLISH);
    expect(stored.querySelector("mark")).toHaveTextContent("dawned on");
    expect(within(stored).getByText("the same sudden realisation")).toBeInTheDocument();
    expect(within(stored).getByText("书 · The Remains of the Day · 2026/10/3")).toBeInTheDocument();
  });

  it("leaves out a group that has nothing in it", () => {
    show(turn({ mine: [{ expression: entry(), why: null }] }));
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });

  it("names an entry kept from an earlier conversation by where it came from", () => {
    show(turn({ mine: [{ expression: entry({ sourceType: "find", sourceTitle: null }), why: null }] }));
    expect(screen.getByText("对谈 · 2026/10/3")).toBeInTheDocument();
  });

  it("moves a seen entry into 想用 with the message as its intent when it has none", async () => {
    show(turn({ mine: [{ expression: entry(), why: null }] }));
    answers.push({ status: 200, body: entry({ status: "active", intent: SAID }) });
    click("放进想用");

    expect(await screen.findByText("已放进想用")).toBeInTheDocument();
    expect(sent).toEqual([{ method: "PATCH", url: "/api/expressions/7", body: { status: "active", intent: SAID, intentBy: "find" } }]);
    // The hit is what this answer showed: it does not go blank because the entry is masked from now on.
    expect(shown()).toContain(ENGLISH);
    expect(screen.queryByRole("button", { name: "放进想用" })).toBeNull();
  });

  // A message can be four times as long as an intent: the server would refuse the move.
  it("cuts a long message to what an intent holds", async () => {
    show(turn({ said: "x".repeat(1500), mine: [{ expression: entry(), why: null }] }));
    click("放进想用");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect((sent[0].body as { intent: string }).intent).toBe("x".repeat(1000));
  });

  it("leaves an intent the entry already has alone", async () => {
    show(turn({ mine: [{ expression: entry({ intent: "我自己写的", intentBy: "self" }), why: null }] }));
    click("放进想用");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ status: "active" });
  });

  it("says so and offers the move again when it did not go through", async () => {
    show(turn({ mine: [{ expression: entry(), why: null }] }));
    answers.push({ status: 500, body: { error: "boom" } });
    click("放进想用");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有放进去：服务暂时不可用（HTTP 500）。"));
    expect(screen.getByRole("button", { name: "放进想用" })).toBeEnabled();
    expect(shown()).not.toContain("已放进想用");
  });

  it("labels a retired entry and offers no move for it, nor for one already in 想用", () => {
    show(turn({
      mine: [
        { expression: entry({ status: "retired" }), why: null },
        { expression: entry({ id: 8, status: "active", graduated: true, produced: true, intent: "x" }), why: null },
      ],
    }));
    expect(screen.getByText("已收起")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放进想用" })).toBeNull();
  });
});

describe("a masked hit", () => {
  const withMasked = () => show(turn({ mine: [{ expression: MASKED, why: null }], fresh: [FRESH] }));

  // The conversation does not wait for an exercise: what the server may show, it shows.
  it("shows its intent, source and date and not its English, and holds nothing else back", () => {
    withMasked();
    expect(screen.getByText("想说：我突然明白了")).toBeInTheDocument();
    expect(screen.getByText("AI 对话 · 2026/10/3")).toBeInTheDocument();
    expect(shown()).not.toContain("dawned");
    expect(screen.getByText(FRESH.why)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is looked at with cue masked, and only then shows its English and the gloss, signed", async () => {
    const stored = watchStorage();
    withMasked();
    answers.push({ status: 200, body: { ...MASKED, masked: false, text: ENGLISH, focus: "dawned on", gloss: "to become clear to someone" } });
    click("看答案");

    await waitFor(() => expect(shown()).toContain(ENGLISH));
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions/9/reveal", body: { cue: "masked" } }]);
    // Held by the hit and nowhere that outlives the page.
    expect(stored).not.toHaveBeenCalled();
    stored.mockRestore();
    expect(screen.getByText("dawned on", { selector: "mark" })).toBeInTheDocument();
    expect(screen.getByText(/补注 · AI 写的/)).toHaveTextContent("to become clear to someone");
    expect(screen.queryByRole("button", { name: "看答案" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "先试着写一句" })).toBeNull();
  });

  it("stays masked when the reveal fails", async () => {
    withMasked();
    answers.push({ status: 500, body: { error: "boom" } });
    click("看答案");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有看成：服务暂时不可用（HTTP 500）。"));
    expect(shown()).not.toContain("dawned");
    expect(screen.getByRole("button", { name: "看答案" })).toBeEnabled();
  });

  it("takes a sentence with cue need and the message as the question, and shows the judgement", async () => {
    withMasked();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "先试着写一句" })).toHaveAttribute("maxlength", "2000");
    fireEvent.change(screen.getByRole("textbox", { name: "先试着写一句" }), { target: { value: "  It dawned on me.  " } });
    answers.push({ status: 201, body: judged() });
    click("提交");

    expect(await screen.findByText("用上了")).toBeInTheDocument();
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions/9/attempts", body: { text: "It dawned on me.", cue: "need", prompt: SAID } }]);
    expect(shown()).toContain(ENGLISH);
    expect(screen.queryByRole("button", { name: "看答案" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "先试着写一句" })).toBeNull();
  });

  it("keeps a later state of the judgement, such as an overturn", async () => {
    withMasked();
    fireEvent.change(screen.getByRole("textbox", { name: "先试着写一句" }), { target: { value: "I suddenly knew." } });
    answers.push({ status: 201, body: judged({ verdict: "conveyed", outcome: "fail" }) });
    click("提交");
    expect(await screen.findByText("绕开但说通了")).toBeInTheDocument();

    answers.push({ status: 200, body: judged({ verdict: "conveyed", outcome: "pass", overturned: true }) });
    click("判错了，我用上了");
    expect(await screen.findByText(/你改成了：算用上/)).toBeInTheDocument();
  });

  // The sentence is saved. The English is still not on screen, so looking at it stays possible.
  it("can still be looked at when the judgement did not come back", async () => {
    withMasked();
    fireEvent.change(screen.getByRole("textbox", { name: "先试着写一句" }), { target: { value: "I suddenly knew." } });
    answers.push({ status: 201, body: judged({ status: "failed", verdict: null, outcome: null, answer: null }) });
    click("提交");

    expect(await screen.findByText(/判定没有回来/)).toBeInTheDocument();
    expect(shown()).not.toContain("dawned");
    expect(screen.queryByRole("textbox", { name: "先试着写一句" })).toBeNull();
    expect(screen.getByRole("button", { name: "看答案" })).toBeEnabled();
  });

  // Looked at after such a judgement, and judged after all: the look and the
  // judgement both brought the English, and it is on screen once.
  it("shows the English once when the judgement arrives after a look", async () => {
    withMasked();
    fireEvent.change(screen.getByRole("textbox", { name: "先试着写一句" }), { target: { value: "It dawned on me." } });
    answers.push({ status: 201, body: judged({ status: "failed", verdict: null, outcome: null, answer: null }) });
    click("提交");
    expect(await screen.findByText(/判定没有回来/)).toBeInTheDocument();

    answers.push({ status: 200, body: { ...MASKED, masked: false, text: ENGLISH, focus: "dawned on", gloss: "to become clear to someone" } });
    click("看答案");
    await waitFor(() => expect(shown()).toContain(ENGLISH));

    answers.push({ status: 200, body: judged() });
    click("再判一次");
    expect(await screen.findByText("用上了")).toBeInTheDocument();
    expect(sent.map((s) => s.url)).toEqual(["/api/expressions/9/attempts", "/api/expressions/9/reveal", "/api/expressions/attempts/31/judge"]);
    expect(screen.getAllByText("dawned on", { selector: "mark" })).toHaveLength(1);
    expect(screen.getAllByText(/补注 · AI 写的/)).toHaveLength(1);
  });

  it("keeps the sentence when it was refused", async () => {
    withMasked();
    fireEvent.change(screen.getByRole("textbox", { name: "先试着写一句" }), { target: { value: "I suddenly knew." } });
    answers.push({ status: 409, body: { error: "Not in 想用", code: "NOT_ACTIVE" } });
    click("提交");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有交上：Not in 想用"));
    expect(shown()).not.toContain("dawned");
    expect(screen.getByRole("textbox", { name: "先试着写一句" })).toHaveValue("I suddenly knew.");
  });

  it("is tried or looked at on its own: another one of the turn stays as it was", async () => {
    show(turn({ mine: [{ expression: MASKED, why: null }, { expression: { ...MASKED, id: 10, intent: "想说：打破僵局" }, why: null }] }));
    answers.push({ status: 200, body: { ...MASKED, masked: false, text: ENGLISH, focus: null, gloss: null } });
    fireEvent.click(screen.getAllByRole("button", { name: "看答案" })[0]);
    await waitFor(() => expect(shown()).toContain(ENGLISH));
    expect(sent.map((s) => s.url)).toEqual(["/api/expressions/9/reveal"]);
    expect(screen.getAllByRole("button", { name: "看答案" })).toHaveLength(1);
    expect(screen.getAllByRole("textbox", { name: "先试着写一句" })).toHaveLength(1);
  });
});

describe("a suggestion", () => {
  it("shows its sentence with the expression marked, and is kept as that sentence with that focus", async () => {
    show(turn({ fresh: [FRESH] }));
    expect(screen.getByText("值得留下 · AI 建议")).toBeInTheDocument();
    expect(screen.getByText(FRESH.focus, { selector: "mark" })).toBeInTheDocument();
    expect(screen.getByText(FRESH.why)).toBeInTheDocument();
    answers.push({ status: 201, body: { id: 12 } });
    click("收");

    expect(await screen.findByText("已收下")).toBeInTheDocument();
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions", body: { text: FRESH.text, focus: FRESH.focus, found: { need: SAID } } }]);
  });

  it("is not a failure when the library already has the same words", async () => {
    show(turn({ fresh: [FRESH] }));
    answers.push({ status: 409, body: { error: "An entry with the same norm exists", code: "DUPLICATE", existing: [] } });
    click("收");

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("已经收过同样的"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("已收过")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收" })).toBeNull();
  });

  it("can be tried again when the save failed", async () => {
    show(turn({ fresh: [FRESH] }));
    answers.push({ status: 500, body: { error: "boom" } });
    click("收");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有存上：服务暂时不可用（HTTP 500）。"));
    expect(screen.getByRole("button", { name: "收" })).toBeEnabled();
  });
});

describe("what the user, the library and the model wrote", () => {
  const HOSTILE = '<img src=x onerror="alert(1)">';

  it("is only ever text", async () => {
    show(turn({
      said: `said ${HOSTILE}`,
      reply: `reply **bold** ${HOSTILE}`,
      rewrites: [{ from: `from ${HOSTILE}`, to: `to ${HOSTILE}`, why: `rewritewhy ${HOSTILE}` }],
      mine: [
        { expression: entry({ text: `text ${HOSTILE}`, focus: HOSTILE, sourceTitle: `title ${HOSTILE}` }), why: `**why** ${HOSTILE}` },
        { expression: { ...MASKED, intent: `intent ${HOSTILE}` }, why: null },
      ],
      fix: { text: `fix ${HOSTILE}`, why: `fixwhy ${HOSTILE}` },
      fresh: [{ text: `fresh ${HOSTILE}`, focus: "fresh", why: `freshwhy ${HOSTILE}` }],
    }));
    answers.push({ status: 200, body: { ...MASKED, masked: false, text: `revealed ${HOSTILE}`, focus: null, gloss: `gloss ${HOSTILE}` } });
    click("看答案");
    await waitFor(() => expect(shown()).toContain(`revealed ${HOSTILE}`));

    expect(document.querySelector("img, strong")).toBeNull();
    for (const field of ["said", "reply **bold**", "from", "to", "rewritewhy", "text", "title", "**why**", "intent", "fix", "fixwhy", "fresh", "freshwhy", "gloss"]) {
      expect(shown()).toContain(`${field} ${HOSTILE}`);
    }
  });
});
