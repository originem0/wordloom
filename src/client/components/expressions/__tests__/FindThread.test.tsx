// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AttemptResponse, ExpressionSummary, FindResponse } from "@/shared/expressions";
import { FindThread, type Turn } from "../FindThread";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const ENGLISH = "It dawned on me that I was wrong.";
const NEED = "怎么说我突然意识到";

const entry = (over: Partial<ExpressionSummary> = {}): ExpressionSummary => ({
  id: 7, status: "seen", masked: false, text: ENGLISH, focus: "dawned on", intent: null, intentBy: null,
  sourceType: "book", sourceTitle: "The Remains of the Day", occurredAt: null,
  createdAt: new Date(2026, 9, 3).getTime(), updatedAt: new Date(2026, 9, 3).getTime(),
  produced: false, graduated: false, queued: false, ...over,
});

/** In 想用 and not graduated: the server sends neither the text nor the focus. */
const MASKED = entry({ id: 9, status: "active", masked: true, text: null, focus: null, intent: "想说：我突然明白了", intentBy: "self", sourceType: "chat", sourceTitle: null });
const FRESH = { text: "It suddenly struck me.", why: "more abrupt, like a blow" };

const answer = (over: Partial<FindResponse> = {}): FindResponse => ({ card: null, mine: [], fix: null, fresh: [], searched: 3, total: 3, ...over });
const turn = (over: Partial<FindResponse> = {}, attempt?: string): Turn => ({ need: NEED, attempt, answer: answer(over) });

const judged = (over: Partial<AttemptResponse> = {}): AttemptResponse => ({
  encounterId: 31, status: "done", verdict: "used", outcome: "pass", overturned: false, rewrites: [],
  answer: { text: ENGLISH, focus: "dawned on", gloss: "to become clear to someone" }, intent: null, ...over,
});

/** Every request the thread sent, and what the server is to answer to the next ones (201 by default). */
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

function show(turns: Turn[], busy = false) {
  const onSaved = vi.fn();
  const onReset = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FindThread turns={turns} busy={busy} onSaved={onSaved} onReset={onReset} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSaved, onReset };
}

const shown = () => document.body.textContent!;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("a turn", () => {
  it("shows what was asked, and the user's own English only when some was sent", () => {
    show([turn({}, "I suddenly knew")]);
    expect(screen.getByText(NEED)).toBeInTheDocument();
    expect(screen.getByText("我写的：I suddenly knew")).toBeInTheDocument();
  });

  it("puts the newest turn first", () => {
    show([{ need: "first question", answer: answer() }, { need: "second question", answer: answer() }]);
    expect(shown().indexOf("second question")).toBeLessThan(shown().indexOf("first question"));
    expect(shown()).not.toContain("我写的");
  });

  it("says that nothing was found in the library without making it the user's fault", () => {
    show([turn({ fresh: [FRESH] })]);
    expect(screen.getByText("这次没在你存过的里面找到。")).toBeInTheDocument();
    // What the model suggests is still offered.
    expect(screen.getByText(FRESH.text)).toBeInTheDocument();
  });

  it("links a single word that has a card to the cards page, and does not call that nothing", () => {
    show([{ need: "dawn & dusk", answer: answer({ card: { id: 3, word: "dawn & dusk" } }) }]);
    expect(screen.getByRole("link", { name: "词卡：dawn & dusk" })).toHaveAttribute("href", "/cards?prefill=dawn%20%26%20dusk");
    expect(shown()).not.toContain("没在你存过的里面找到");
  });

  it("says how much of the library was searched when not all of it fitted", () => {
    show([turn({ searched: 120, total: 300 })]);
    expect(screen.getByText("这次只搜了 120 / 300 条。")).toBeInTheDocument();
  });

  it("says nothing about the search when all of it was read, and nothing about suggestions when there are none", () => {
    show([turn()]);
    expect(shown()).not.toContain("只搜了");
    expect(shown()).not.toContain("新说法");
    expect(shown()).not.toContain("改成");
  });

  it("drops the thread when the user starts a new topic", () => {
    const { onReset } = show([turn()]);
    click("新话题");
    expect(onReset).toHaveBeenCalled();
  });

  // The answer on its way belongs to this thread: it must not bring a dropped one back.
  it("does not let go of the thread while a question is on its way", () => {
    show([turn()], true);
    expect(screen.getByRole("button", { name: "新话题" })).toBeDisabled();
  });
});

describe("hits that are not masked", () => {
  it("come in two groups, each with its text, the focus marked, the reason, the source and the date", () => {
    show([turn({
      mine: [
        { expression: entry(), why: "the same sudden realisation" },
        { expression: entry({ id: 8, text: "Break the ice.", focus: null, produced: true, sourceType: null, sourceTitle: null, occurredAt: new Date(2026, 8, 1).getTime() }), why: null },
      ],
    })]);
    const used = screen.getByRole("group", { name: "用出过的" });
    const stored = screen.getByRole("group", { name: "存过没用出的" });
    expect(within(used).getByText("Break the ice.")).toBeInTheDocument();
    // The day it was met when that is known, else the day it was saved.
    expect(within(used).getByText("未记录 · 2026/9/1")).toBeInTheDocument();
    expect(stored).toHaveTextContent(ENGLISH);
    expect(stored.querySelector("mark")).toHaveTextContent("dawned on");
    expect(within(stored).getByText("the same sudden realisation")).toBeInTheDocument();
    expect(within(stored).getByText("书 · The Remains of the Day · 2026/10/3")).toBeInTheDocument();
  });

  it("leaves out a group that has nothing in it", () => {
    show([turn({ mine: [{ expression: entry(), why: null }] })]);
    expect(screen.queryByRole("group", { name: "用出过的" })).toBeNull();
    expect(shown()).not.toContain("没在你存过的里面找到");
  });

  it("moves a seen entry into 想用 with the need as its intent when it has none", async () => {
    show([turn({ mine: [{ expression: entry(), why: null }] })]);
    answers.push({ status: 200, body: entry({ status: "active", intent: NEED }) });
    click("放进想用");

    expect(await screen.findByText("已放进想用")).toBeInTheDocument();
    expect(sent).toEqual([{ method: "PATCH", url: "/api/expressions/7", body: { status: "active", intent: NEED, intentBy: "find" } }]);
    // The hit is what this answer showed: it does not go blank because the entry is masked from now on.
    expect(shown()).toContain(ENGLISH);
    expect(screen.queryByRole("button", { name: "放进想用" })).toBeNull();
  });

  it("leaves an intent the entry already has alone", async () => {
    show([turn({ mine: [{ expression: entry({ intent: "我自己写的", intentBy: "self" }), why: null }] })]);
    click("放进想用");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body).toEqual({ status: "active" });
  });

  it("says so and offers the move again when it did not go through", async () => {
    show([turn({ mine: [{ expression: entry(), why: null }] })]);
    answers.push({ status: 500, body: { error: "boom" } });
    click("放进想用");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有放进去：boom"));
    expect(screen.getByRole("button", { name: "放进想用" })).toBeEnabled();
    expect(shown()).not.toContain("已放进想用");
  });

  it("labels a retired entry and offers no move for it, nor for one already in 想用", () => {
    show([turn({
      mine: [
        { expression: entry({ status: "retired" }), why: null },
        { expression: entry({ id: 8, status: "active", graduated: true, produced: true, intent: "x" }), why: null },
      ],
    })]);
    expect(screen.getByText("已收起")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "放进想用" })).toBeNull();
  });
});

describe("a masked hit", () => {
  const withMasked = () => show([turn({ mine: [{ expression: MASKED, why: null }], fresh: [FRESH] })]);

  it("shows its intent, source and date, and holds the new suggestions back", () => {
    withMasked();
    expect(screen.getByText("想说：我突然明白了")).toBeInTheDocument();
    expect(screen.getByText("AI 对话 · 2026/10/3")).toBeInTheDocument();
    expect(shown()).not.toContain("dawned");
    expect(shown()).not.toContain(FRESH.text);
    expect(screen.getByText(/新说法.*之后/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is looked at with cue masked, and only then shows its English, the gloss signed, and the new suggestions", async () => {
    withMasked();
    answers.push({ status: 200, body: { ...MASKED, masked: false, text: ENGLISH, focus: "dawned on", gloss: "to become clear to someone" } });
    click("看答案");

    await waitFor(() => expect(shown()).toContain(ENGLISH));
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions/9/reveal", body: { cue: "masked" } }]);
    expect(document.querySelector("mark")).toHaveTextContent("dawned on");
    expect(screen.getByText(/补注 · AI 写的/)).toHaveTextContent("to become clear to someone");
    expect(screen.getByText(FRESH.text)).toBeInTheDocument();
    expect(screen.getByText("新说法 · AI 建议")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "看答案" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "先试着写一句" })).toBeNull();
  });

  it("stays masked when the reveal fails", async () => {
    withMasked();
    answers.push({ status: 500, body: { error: "boom" } });
    click("看答案");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有看成：boom"));
    expect(shown()).not.toContain(FRESH.text);
    expect(screen.getByRole("button", { name: "看答案" })).toBeEnabled();
  });

  it("takes a sentence with cue need and the need as the question, and shows the judgement", async () => {
    withMasked();
    expect(screen.getByRole("button", { name: "提交" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "先试着写一句" })).toHaveAttribute("maxlength", "2000");
    fireEvent.change(screen.getByRole("textbox", { name: "先试着写一句" }), { target: { value: "  It dawned on me.  " } });
    answers.push({ status: 201, body: judged() });
    click("提交");

    expect(await screen.findByText("用上了")).toBeInTheDocument();
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions/9/attempts", body: { text: "It dawned on me.", cue: "need", prompt: NEED } }]);
    expect(shown()).toContain(ENGLISH);
    expect(screen.getByText(FRESH.text)).toBeInTheDocument();
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

  // The sentence is saved and the user has tried: that is what the new
  // suggestions waited for. The English is still not on screen, so looking
  // at it stays possible.
  it("counts as tried when the judgement did not come back, and can still be looked at", async () => {
    withMasked();
    fireEvent.change(screen.getByRole("textbox", { name: "先试着写一句" }), { target: { value: "I suddenly knew." } });
    answers.push({ status: 201, body: judged({ status: "failed", verdict: null, outcome: null, answer: null }) });
    click("提交");

    expect(await screen.findByText(/判定没有回来/)).toBeInTheDocument();
    expect(screen.getByText(FRESH.text)).toBeInTheDocument();
    expect(shown()).not.toContain("dawned");
    expect(screen.queryByRole("textbox", { name: "先试着写一句" })).toBeNull();
    expect(screen.getByRole("button", { name: "看答案" })).toBeEnabled();
  });

  it("stays unresolved when the sentence was refused", async () => {
    withMasked();
    fireEvent.change(screen.getByRole("textbox", { name: "先试着写一句" }), { target: { value: "I suddenly knew." } });
    answers.push({ status: 409, body: { error: "Not in 想用", code: "NOT_ACTIVE" } });
    click("提交");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有交上：Not in 想用"));
    expect(shown()).not.toContain(FRESH.text);
    expect(shown()).not.toContain("dawned");
    expect(screen.getByRole("textbox", { name: "先试着写一句" })).toHaveValue("I suddenly knew.");
  });

  it("holds the suggestions back until every masked hit of the turn is resolved", async () => {
    show([turn({ mine: [{ expression: MASKED, why: null }, { expression: { ...MASKED, id: 10, intent: "想说：打破僵局" }, why: null }], fresh: [FRESH] })]);
    answers.push({ status: 200, body: { ...MASKED, masked: false, text: ENGLISH, focus: null, gloss: null } });
    fireEvent.click(screen.getAllByRole("button", { name: "看答案" })[0]);
    await waitFor(() => expect(shown()).toContain(ENGLISH));
    expect(shown()).not.toContain(FRESH.text);

    answers.push({ status: 200, body: { ...MASKED, id: 10, masked: false, text: "Break the ice.", focus: null, gloss: null } });
    click("看答案");
    expect(await screen.findByText(FRESH.text)).toBeInTheDocument();
    expect(sent.map((s) => s.url)).toEqual(["/api/expressions/9/reveal", "/api/expressions/10/reveal"]);
  });
});

describe("a suggestion", () => {
  it("is kept with the need and the attempt of its turn as the scene", async () => {
    const { onSaved } = show([turn({ fix: { text: "It suddenly dawned on me.", why: "knew is too flat" }, fresh: [FRESH] }, "I suddenly knew")]);
    expect(screen.getByText("把你那句改成")).toBeInTheDocument();
    expect(screen.getByText("knew is too flat")).toBeInTheDocument();
    expect(screen.getByText(FRESH.why)).toBeInTheDocument();
    answers.push({ status: 201, body: { id: 12 } });
    fireEvent.click(screen.getAllByRole("button", { name: "收" })[0]);

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(12));
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions", body: { text: "It suddenly dawned on me.", found: { need: NEED, attempt: "I suddenly knew" } } }]);
    expect(screen.getByText("已收下")).toBeInTheDocument();
    // The other one is still to be decided.
    expect(screen.getAllByRole("button", { name: "收" })).toHaveLength(1);
  });

  it("sends no attempt when the turn had none", async () => {
    const { onSaved } = show([turn({ fresh: [FRESH] })]);
    click("收");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(sent[0].body).toEqual({ text: FRESH.text, found: { need: NEED } });
  });

  it("is not a failure when the library already has the same words", async () => {
    const { onSaved } = show([turn({ fresh: [FRESH] })]);
    answers.push({ status: 409, body: { error: "An entry with the same norm exists", code: "DUPLICATE", existing: [] } });
    click("收");

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("已经收过同样的"));
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("已收过")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收" })).toBeNull();
    // Nothing new was saved, so there is no gloss to wait for.
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("can be tried again when the save failed", async () => {
    const { onSaved } = show([turn({ fresh: [FRESH] })]);
    answers.push({ status: 500, body: { error: "boom" } });
    click("收");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有存上：boom"));
    expect(screen.getByRole("button", { name: "收" })).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("what the user, the library and the model wrote", () => {
  const HOSTILE = '<img src=x onerror="alert(1)">';

  it("is only ever text", async () => {
    show([{
      need: `need ${HOSTILE}`,
      attempt: `mine ${HOSTILE}`,
      answer: answer({
        card: { id: 1, word: `word ${HOSTILE}` },
        mine: [
          { expression: entry({ text: `text ${HOSTILE}`, focus: HOSTILE, sourceTitle: `title ${HOSTILE}` }), why: `**why** ${HOSTILE}` },
          { expression: { ...MASKED, intent: `intent ${HOSTILE}` }, why: null },
        ],
        fix: { text: `fix ${HOSTILE}`, why: `fixwhy ${HOSTILE}` },
        fresh: [{ text: `fresh ${HOSTILE}`, why: `freshwhy ${HOSTILE}` }],
      }),
    }]);
    answers.push({ status: 200, body: { ...MASKED, masked: false, text: `revealed ${HOSTILE}`, focus: null, gloss: `gloss ${HOSTILE}` } });
    click("看答案");
    await waitFor(() => expect(shown()).toContain(`revealed ${HOSTILE}`));

    expect(document.querySelector("img, strong")).toBeNull();
    for (const field of ["need", "mine", "word", "text", "title", "**why**", "intent", "fix", "fixwhy", "fresh", "freshwhy", "gloss"]) {
      expect(shown()).toContain(`${field} ${HOSTILE}`);
    }
    expect(document.querySelector("mark")).toHaveTextContent(HOSTILE);
  });
});
