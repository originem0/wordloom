// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ExpressionSummary, FindRequest, FindResponse } from "@/shared/expressions";
import { CaptureBox } from "../CaptureBox";
import { useLastSource } from "../shared";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** Every write the box sent, and what the server is to answer to the next ones (201 by default), after `hold` if there is one. */
let writes: Array<{ method: string; url: string; body: unknown }>;
let answers: Array<{ status: number; body: unknown; hold?: Promise<void> }>;

beforeEach(() => {
  writes = [];
  answers = [];
  useLastSource.setState({ source: null });
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      writes.push({ method: init?.method ?? "GET", url, body: JSON.parse(String(init?.body ?? "null")) });
      const { status, body, hold } = answers.shift() ?? { status: 201, body: { id: 1 } };
      await hold;
      return new Response(JSON.stringify(body), { status });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Fragment() {
  return <output>{useLocation().hash || "no fragment"}</output>;
}

function renderBox(entry = "/") {
  const onSaved = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <CaptureBox onSaved={onSaved} />
        <Fragment />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, onSaved, box: screen.getByRole<HTMLTextAreaElement>("textbox", { name: "原文" }) };
}

const type = (box: HTMLTextAreaElement, value: string) => fireEvent.change(box, { target: { value } });

/** React builds onSelect from focus plus mouse and key events, not from the native "select" event. */
function select(box: HTMLTextAreaElement, part: string) {
  const start = box.value.indexOf(part);
  box.focus();
  box.setSelectionRange(start, start + part.length);
  fireEvent.mouseUp(box);
}

const keep = () => fireEvent.click(screen.getByRole("button", { name: "收下" }));

const CHAT = "Me: how do I say 我突然意识到?\n\nAI: You could say it dawned on me.\nOr simply: it hit me.";

describe("what 收下 makes of the box", () => {
  it("saves the whole box as the text when nothing is selected", async () => {
    const { box, onSaved } = renderBox();
    type(box, "  It dawned on me that I was wrong.  ");
    keep();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(writes).toEqual([{ method: "POST", url: "/api/expressions", body: { text: "It dawned on me that I was wrong." } }]);
    expect(box).toHaveValue("");
  });

  it("takes a selection inside one sentence as the focus, and the sentence as the text", async () => {
    const { box } = renderBox();
    type(box, "It dawned on me that I was wrong.");
    select(box, "dawned on me");
    // On screen before the click, not a surprise after it.
    expect(screen.getByRole("button", { name: "焦点：dawned on me" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /上文/ })).toBeNull();
    keep();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ text: "It dawned on me that I was wrong.", focus: "dawned on me" });
  });

  it("takes a selection inside a pasted conversation as the text, and offers the paragraph above as 上文", async () => {
    const { box } = renderBox();
    type(box, CHAT);
    select(box, "it dawned on me");
    expect(screen.getByRole("textbox", { name: /上文/ })).toHaveValue("Me: how do I say 我突然意识到?");
    expect(screen.queryByRole("button", { name: /焦点/ })).toBeNull();
    keep();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ text: "it dawned on me", textBefore: "Me: how do I say 我突然意识到?" });
  });

  it("sends 上文 as the user left it", async () => {
    const { box } = renderBox();
    type(box, CHAT);
    select(box, "it hit me");
    const before = screen.getByRole("textbox", { name: /上文/ });
    expect(before).toHaveValue("AI: You could say it dawned on me.");
    fireEvent.change(before, { target: { value: "how do I say 我突然意识到?" } });
    keep();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ text: "it hit me", textBefore: "how do I say 我突然意识到?" });
  });

  it("has nothing to save while the box is empty", () => {
    const { box } = renderBox();
    type(box, "   ");
    expect(screen.getByRole("button", { name: "收下" })).toBeDisabled();
  });
});

describe("the source tag", () => {
  it("is 未记录 until one is chosen, and then stays for the next save and the next visit to the page", async () => {
    const first = renderBox();
    expect(screen.getByText("未记录")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "书" }));
    fireEvent.change(screen.getByRole("textbox", { name: "出处" }), { target: { value: "The Remains of the Day" } });
    for (const text of ["one", "two"]) {
      type(first.box, text);
      keep();
      await waitFor(() => expect(first.box).toHaveValue(""));
    }
    expect(writes.map((w) => w.body)).toEqual([
      { text: "one", sourceType: "book", sourceTitle: "The Remains of the Day" },
      { text: "two", sourceType: "book", sourceTitle: "The Remains of the Day" },
    ]);

    // Back from another page: the tag is still chosen. The title is not kept
    // beyond the page, it is private text.
    first.unmount();
    const second = renderBox();
    expect(screen.getByRole("button", { name: "书" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("未记录")).toBeNull();
    expect(screen.getByRole("textbox", { name: "出处" })).toHaveValue("");
    type(second.box, "three");
    keep();
    await waitFor(() => expect(second.onSaved).toHaveBeenCalled());
    expect(writes[2].body).toEqual({ text: "three", sourceType: "book" });
  });

  it("drops the title when another tag is chosen", () => {
    renderBox();
    fireEvent.click(screen.getByRole("button", { name: "书" }));
    fireEvent.change(screen.getByRole("textbox", { name: "出处" }), { target: { value: "The Remains of the Day" } });
    fireEvent.click(screen.getByRole("button", { name: "影视" }));
    expect(screen.getByRole("button", { name: "书" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("textbox", { name: "出处" })).toHaveValue("");
  });

  it("is cleared with one click, and lives in memory only", async () => {
    const stored = vi.spyOn(Storage.prototype, "setItem");
    const { box, onSaved } = renderBox();
    fireEvent.click(screen.getByRole("button", { name: "影视" }));
    expect(stored).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "影视" }));
    expect(screen.getByText("未记录")).toBeInTheDocument();
    type(box, "three");
    keep();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(writes[0].body).toEqual({ text: "three" });
    stored.mockRestore();
  });
});

describe("a prefilled link", () => {
  it("fills the box from the fragment, clears the fragment, and submits nothing", async () => {
    const { box } = renderBox("/#text=break%20the%20ice%20%26%20more&focus=ice");
    expect(box).toHaveValue("break the ice & more");
    expect(screen.getByRole("button", { name: "焦点：ice" })).toBeInTheDocument();
    expect(await screen.findByText("no fragment")).toBeInTheDocument();

    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("takes a lone focus as the text to start from, and keeps it as the focus once a sentence is around it", async () => {
    const { box } = renderBox("/#focus=block");
    expect(box).toHaveValue("block");
    expect(screen.queryByRole("button", { name: /焦点/ })).toBeNull();

    type(box, "The road was blocked by snow.");
    keep();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ text: "The road was blocked by snow.", focus: "block" });
  });

  it("lets the focus that came with the link be dropped", async () => {
    const { box } = renderBox("/#text=break%20the%20ice&focus=ice");
    fireEvent.click(screen.getByRole("button", { name: "焦点：ice" }));
    keep();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ text: "break the ice" });
    expect(box).toHaveValue("");
  });
});

describe("a save that does not go through", () => {
  const DUPLICATE = {
    status: 409,
    body: {
      error: "An entry with the same norm exists",
      code: "DUPLICATE",
      existing: [{ id: 7, masked: false, text: "Break the ice.", intent: null, createdAt: new Date(2026, 9, 3).getTime() }],
    },
  };

  async function meetDuplicate() {
    answers.push(DUPLICATE);
    const view = renderBox();
    fireEvent.click(screen.getByRole("button", { name: "书" }));
    type(view.box, "break the ice");
    keep();
    expect(await screen.findByText("Break the ice.")).toBeInTheDocument();
    expect(screen.getByText("2026/10/3")).toBeInTheDocument();
    // Nothing was saved and nothing was lost.
    expect(view.box).toHaveValue("break the ice");
    expect(view.onSaved).not.toHaveBeenCalled();
    return view;
  }

  it("records one more encounter on the entry that exists when the user says 又一次遇到", async () => {
    const { box, onSaved } = await meetDuplicate();
    answers.push({ status: 201, body: { id: 7 } });
    fireEvent.click(screen.getByRole("button", { name: "又一次遇到" }));

    await waitFor(() => expect(box).toHaveValue(""));
    expect(writes[1]).toEqual({
      method: "POST",
      url: "/api/expressions/7/encounters",
      body: { text: "break the ice", sourceType: "book" },
    });
    expect(screen.queryByText("Break the ice.")).toBeNull();
    // Not a fresh entry: there is no gloss to wait for.
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("saves a separate entry when the user says 另存", async () => {
    const { box, onSaved } = await meetDuplicate();
    answers.push({ status: 201, body: { id: 8 } });
    fireEvent.click(screen.getByRole("button", { name: "另存" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(8));
    expect(writes[1]).toEqual({
      method: "POST",
      url: "/api/expressions",
      body: { text: "break the ice", sourceType: "book", force: true },
    });
    expect(box).toHaveValue("");
  });

  it("withdraws the question once the text is changed", async () => {
    const { box } = await meetDuplicate();
    type(box, "break the ice, slowly");
    expect(screen.queryByRole("button", { name: "又一次遇到" })).toBeNull();
  });

  it("keeps the text in the box when the server fails", async () => {
    answers.push({ status: 500, body: { error: "boom" } });
    const { box, onSaved } = renderBox();
    type(box, "It dawned on me.");
    keep();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有存上：boom"));
    expect(box).toHaveValue("It dawned on me.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "收下" })).toBeEnabled();
  });

  it("refuses a text over the limit before sending it", () => {
    const { box } = renderBox();
    type(box, "x".repeat(4001));
    expect(screen.getByText(/原文超过 4000 字/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收下" })).toBeDisabled();
  });
});

const NEED = "怎么说我突然意识到";

const hit = (id: number): ExpressionSummary => ({
  id, status: "seen", masked: false, text: `entry ${id}`, focus: null, intent: null, intentBy: null,
  sourceType: null, sourceTitle: null, occurredAt: null, createdAt: 1, updatedAt: 1, produced: false, graduated: false, queued: false,
});

/** What POST /find answers. */
const found = (over: Partial<FindResponse> = {}) => ({ status: 200, body: { card: null, mine: [], fix: null, fresh: [], searched: 3, total: 3, ...over } });
const own = () => screen.getByRole<HTMLInputElement>("textbox", { name: /我自己的英文/ });
const ask = (name = "问") => fireEvent.click(screen.getByRole("button", { name }));

/**
 * Asks one question and waits for its answer. The box is emptied only once the
 * answer is in. (Looking for the need on the page any sooner would find it in
 * the box: React keeps a textarea's value as its text content too.)
 */
async function askAndWait(box: HTMLTextAreaElement, need: string, answer = found(), name = "追问") {
  answers.push(answer);
  type(box, need);
  ask(name);
  await waitFor(() => expect(box).toHaveValue(""));
  expect(screen.getByText(need)).toBeInTheDocument();
}

describe("问", () => {
  it("sends the whole box, trimmed, in the body, and never in a URL or in storage", async () => {
    const stored = vi.spyOn(Storage.prototype, "setItem");
    const { box, onSaved } = renderBox();
    answers.push(found());
    type(box, `  ${NEED}  `);
    // A selection is for 收下: it plays no part in a question.
    select(box, "突然");
    ask();

    await waitFor(() => expect(box).toHaveValue(""));
    expect(screen.getByText(NEED)).toBeInTheDocument();
    expect(writes).toEqual([{ method: "POST", url: "/api/expressions/find", body: { need: NEED, history: [], turn: 1, thread: expect.any(Number) } }]);
    for (const { url } of writes) expect(decodeURIComponent(url)).not.toContain("突然");
    expect(stored).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("sends the user's own English when there is some, and empties both once the answer is in", async () => {
    const { box } = renderBox();
    answers.push(found({ fix: { text: "It suddenly dawned on me.", why: "knew is too flat" } }));
    type(box, NEED);
    fireEvent.change(own(), { target: { value: "  I suddenly knew  " } });
    ask();

    expect(await screen.findByText("我写的：I suddenly knew")).toBeInTheDocument();
    expect(writes[0].body).toMatchObject({ need: NEED, attempt: "I suddenly knew" });
    expect(box).toHaveValue("");
    type(box, "next");
    expect(own()).toHaveValue("");
  });

  it("leaves a blank attempt out", async () => {
    const { box } = renderBox();
    answers.push(found());
    type(box, NEED);
    fireEvent.change(own(), { target: { value: "   " } });
    ask();
    await waitFor(() => expect(box).toHaveValue(""));
    expect(writes[0].body).not.toHaveProperty("attempt");
    expect(document.body.textContent).not.toContain("我写的");
  });

  it("offers the field for the user's own English only while the box can be asked", () => {
    const { box } = renderBox();
    expect(screen.queryByRole("textbox", { name: /我自己的英文/ })).toBeNull();
    expect(screen.getByRole("button", { name: "问" })).toBeDisabled();

    type(box, ` ${"x".repeat(1000)} `);
    expect(own()).toHaveAttribute("maxlength", "2000");
    expect(screen.getByRole("button", { name: "问" })).toBeEnabled();

    type(box, "x".repeat(1001));
    expect(screen.queryByRole("textbox", { name: /我自己的英文/ })).toBeNull();
    expect(screen.getByRole("button", { name: "问" })).toBeDisabled();
    expect(screen.getByText(/超过 1000 字/)).toBeInTheDocument();
    // Too long to ask is not too long to keep.
    expect(screen.getByRole("button", { name: "收下" })).toBeEnabled();
  });

  it("holds the box still while the question is on its way", async () => {
    let release = () => {};
    const { box } = renderBox();
    answers.push({ ...found(), hold: new Promise<void>((r) => (release = r)) });
    type(box, NEED);
    ask();

    await waitFor(() => expect(screen.getByRole("button", { name: "问" })).toBeDisabled());
    expect(box).toHaveAttribute("readonly");
    expect(own()).toHaveAttribute("readonly");
    expect(box).toHaveValue(NEED);
    expect(screen.getByRole("button", { name: "收下" })).toBeDisabled();
    release();
    await waitFor(() => expect(box).toHaveValue(""));
    expect(box).not.toHaveAttribute("readonly");
  });

  // Either answer to a held save empties the box, which the question on its way still needs.
  it("holds a save that is waiting for an answer still as well", async () => {
    let release = () => {};
    answers.push({ status: 409, body: { error: "An entry with the same norm exists", code: "DUPLICATE", existing: [{ id: 7, masked: false, text: "Break the ice.", intent: null, createdAt: 1 }] } });
    const { box } = renderBox();
    type(box, "break the ice");
    keep();
    await screen.findByRole("button", { name: "另存" });
    answers.push({ ...found(), hold: new Promise<void>((r) => (release = r)) });
    ask();

    await waitFor(() => expect(screen.getByRole("button", { name: "另存" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "又一次遇到" })).toBeDisabled();
    release();
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("keeps the box and shows nothing when the question fails", async () => {
    const { box } = renderBox();
    answers.push({ status: 502, body: { error: "The model did not answer", code: "FIND_FAILED" } });
    type(box, NEED);
    fireEvent.change(own(), { target: { value: "I suddenly knew" } });
    ask();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有问成：The model did not answer"));
    expect(box).toHaveValue(NEED);
    expect(own()).toHaveValue("I suddenly knew");
    expect(screen.queryByRole("button", { name: "新话题" })).toBeNull();
    // Nothing was written, so the same question can be sent again as the opening turn.
    answers.push(found());
    ask();
    await waitFor(() => expect(box).toHaveValue(""));
    expect(writes[1].body).toMatchObject({ need: NEED, attempt: "I suddenly knew", history: [], turn: 1 });
  });

  it("says so when no answer came at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { box } = renderBox();
    type(box, NEED);
    ask();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有问成：Failed to fetch"));
    expect(box).toHaveValue(NEED);
  });
});

describe("a thread", () => {
  it("sends what the earlier turns were about, counts the turns, and keeps the time of the opening one", async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
    const { box } = renderBox();
    answers.push(found({ mine: [{ expression: hit(7), why: null }, { expression: hit(8), why: null }], fix: { text: "fix one", why: "" }, fresh: [{ text: "fresh one", why: "" }] }));
    type(box, "first");
    fireEvent.change(own(), { target: { value: "my try" } });
    ask();
    await waitFor(() => expect(box).toHaveValue(""));
    expect(screen.getByText("first")).toBeInTheDocument();
    // An open thread: the next question goes on with it.
    expect(screen.queryByRole("button", { name: "问" })).toBeNull();

    await askAndWait(box, "second");
    await askAndWait(box, "third");
    const [one, two, three] = writes.map((w) => w.body as FindRequest);
    expect(one).toEqual({ need: "first", attempt: "my try", history: [], turn: 1, thread: expect.any(Number) });
    expect(one.thread).toBeGreaterThan(1_800_000_000_000);
    expect(two).toEqual({
      need: "second",
      history: [{ need: "first", attempt: "my try", mine: [7, 8], fix: "fix one", fresh: ["fresh one"] }],
      turn: 2,
      thread: one.thread,
    });
    expect(three.history).toEqual([...two.history, { need: "second", mine: [], fix: null, fresh: [] }]);
    expect(three).toMatchObject({ turn: 3, thread: one.thread });
  });

  it("sends the opening turn and the latest five once there are more", async () => {
    const { box } = renderBox();
    await askAndWait(box, "q1", found(), "问");
    for (let n = 2; n <= 8; n++) await askAndWait(box, `q${n}`);

    const seventh = writes[6].body as FindRequest;
    expect(seventh.history.map((t) => t.need)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6"]);
    const eighth = writes[7].body as FindRequest;
    expect(eighth.history.map((t) => t.need)).toEqual(["q1", "q3", "q4", "q5", "q6", "q7"]);
    expect(eighth.turn).toBe(8);
    expect(eighth.thread).toBe((writes[0].body as FindRequest).thread);
  });

  // The server takes a suggestion back only up to the length of an attempt;
  // one longer than that would make every later question of the thread a 400.
  it("cuts an over-long suggestion down to what the server takes back", async () => {
    const { box } = renderBox();
    await askAndWait(box, "q1", found({ fix: { text: "f".repeat(2001), why: "" }, fresh: [{ text: "n".repeat(2500), why: "" }] }), "问");
    await askAndWait(box, "q2");
    const { history } = writes[1].body as FindRequest;
    expect(history[0].fix).toHaveLength(2000);
    expect(history[0].fresh[0]).toHaveLength(2000);
  });

  it("is dropped with 新话题: the next question opens a new one", async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1000));
    const { box } = renderBox();
    await askAndWait(box, "q1", found(), "问");
    fireEvent.click(screen.getByRole("button", { name: "新话题" }));
    expect(screen.queryByText("q1")).toBeNull();

    await askAndWait(box, "q2", found(), "问");
    const [first, second] = writes.map((w) => w.body as FindRequest);
    expect(second).toMatchObject({ need: "q2", history: [], turn: 1 });
    expect(second.thread).not.toBe(first.thread);
  });

  // The answer on its way would bring the dropped thread back.
  it("cannot be dropped while a question is on its way", async () => {
    let release = () => {};
    const { box } = renderBox();
    await askAndWait(box, "q1", found(), "问");
    answers.push({ ...found(), hold: new Promise<void>((r) => (release = r)) });
    type(box, "q2");
    ask("追问");
    await waitFor(() => expect(screen.getByRole("button", { name: "新话题" })).toBeDisabled());
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "新话题" })).toBeEnabled());
    expect(screen.getByText("q2")).toBeInTheDocument();
  });

  it("stays as it was when a later question fails", async () => {
    const { box } = renderBox();
    await askAndWait(box, "q1", found(), "问");
    answers.push({ status: 502, body: { error: "The model did not answer", code: "FIND_FAILED" } });
    type(box, "q2");
    ask("追问");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有问成：The model did not answer"));
    expect(box).toHaveValue("q2");
    expect(screen.getByText("q1")).toBeInTheDocument();
    answers.push(found());
    ask("追问");
    await waitFor(() => expect(box).toHaveValue(""));
    expect(writes[2].body).toMatchObject({ need: "q2", turn: 2, history: [{ need: "q1" }] });
  });

  it("tells the page about an entry kept from a suggestion, so that its gloss is watched for", async () => {
    const { box, onSaved } = renderBox();
    await askAndWait(box, NEED, found({ fresh: [{ text: "It suddenly struck me.", why: "more abrupt" }] }), "问");
    answers.push({ status: 201, body: { id: 12 } });
    fireEvent.click(screen.getByRole("button", { name: "收" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(12));
    expect(writes[1]).toEqual({ method: "POST", url: "/api/expressions", body: { text: "It suddenly struck me.", found: { need: NEED } } });
  });
});

describe("帮我挑", () => {
  const PICKED = { status: 200, body: { picks: [{ text: "it dawned on me", before: "Me: how do I say 我突然意识到?", why: "the idea arrives by itself" }, { text: "it hit me", before: null, why: "shorter" }] } };
  const choose = () => fireEvent.click(screen.getByRole("button", { name: "帮我挑" }));

  it("is offered only for a box that holds several lines", () => {
    const { box } = renderBox();
    type(box, "It dawned on me.\n");
    expect(screen.queryByRole("button", { name: "帮我挑" })).toBeNull();
    type(box, CHAT);
    expect(screen.getByRole("button", { name: "帮我挑" })).toBeEnabled();
  });

  it("sends the box as it is, shows what was picked, and leaves the box alone", async () => {
    const { box } = renderBox();
    answers.push(PICKED);
    type(box, `${CHAT}\n`);
    choose();

    expect(await screen.findByRole("checkbox", { name: /it hit me/ })).not.toBeChecked();
    expect(writes).toEqual([{ method: "POST", url: "/api/expressions/pick", body: { text: `${CHAT}\n` } }]);
    expect(box).toHaveValue(`${CHAT}\n`);
  });

  // Picks are found in the box word for word: they are of no use for a box that has moved on.
  it("holds the box still while the model reads it", async () => {
    let release = () => {};
    const { box } = renderBox();
    answers.push({ ...PICKED, hold: new Promise<void>((r) => (release = r)) });
    type(box, CHAT);
    choose();

    await waitFor(() => expect(screen.getByRole("button", { name: "帮我挑" })).toBeDisabled());
    expect(box).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "收下" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "问" })).toBeDisabled();
    release();
    await screen.findByRole("checkbox", { name: /it hit me/ });
    expect(box).not.toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "收下" })).toBeEnabled();
  });

  it("is not sent for a paste over the limit", () => {
    const { box } = renderBox();
    type(box, `${"x".repeat(5000)}\n${"y".repeat(5000)}`);
    expect(screen.getByRole("button", { name: "帮我挑" })).toBeDisabled();
    type(box, `${"x".repeat(5000)}\n${"y".repeat(4999)}`);
    expect(screen.getByRole("button", { name: "帮我挑" })).toBeEnabled();
  });

  it("says so when it fails, and shows no list", async () => {
    const { box } = renderBox();
    answers.push({ status: 502, body: { error: "The model did not answer", code: "PICK_FAILED" } });
    type(box, CHAT);
    choose();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有挑成：The model did not answer"));
    expect(screen.queryByRole("button", { name: "关掉" })).toBeNull();
    expect(box).toHaveValue(CHAT);
    expect(screen.getByRole("button", { name: "帮我挑" })).toBeEnabled();
  });

  it("saves the ticked picks with the tag chosen on the box, and still leaves the box alone", async () => {
    const { box, onSaved } = renderBox();
    fireEvent.click(screen.getByRole("button", { name: "AI 对话" }));
    fireEvent.change(screen.getByRole("textbox", { name: "出处" }), { target: { value: " ChatGPT " } });
    answers.push(PICKED, { status: 201, body: { id: 21 } });
    type(box, CHAT);
    choose();
    fireEvent.click(await screen.findByRole("checkbox", { name: /it dawned on me/ }));
    fireEvent.click(screen.getByRole("button", { name: "收下选中的" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(21));
    expect(writes[1]).toEqual({
      method: "POST",
      url: "/api/expressions",
      body: { text: "it dawned on me", textBefore: "Me: how do I say 我突然意识到?", sourceType: "chat", sourceTitle: "ChatGPT" },
    });
    expect(box).toHaveValue(CHAT);
    expect(await screen.findByText("已收下")).toBeInTheDocument();
  });

  // The ticks and the 已收下 marks belong to one answer: a second one starts clean.
  it("starts over when asked again", async () => {
    const { box } = renderBox();
    answers.push(PICKED, { status: 201, body: { id: 21 } }, { status: 200, body: { picks: [{ text: "it hit me", before: null, why: "shorter" }] } });
    type(box, CHAT);
    choose();
    fireEvent.click(await screen.findByRole("checkbox", { name: /it dawned on me/ }));
    fireEvent.click(screen.getByRole("button", { name: "收下选中的" }));
    expect(await screen.findByText("已收下")).toBeInTheDocument();

    choose();
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(await screen.findByRole("checkbox", { name: /it hit me/ })).not.toBeChecked();
    expect(screen.queryByText("已收下")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("goes away with the paste when the box is saved as a whole", async () => {
    const { box, onSaved } = renderBox();
    answers.push(PICKED);
    type(box, CHAT);
    choose();
    await screen.findByRole("checkbox", { name: /it hit me/ });
    keep();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(box).toHaveValue("");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("goes away when the box is edited, or with 关掉", async () => {
    const { box } = renderBox();
    answers.push(PICKED, PICKED);
    type(box, CHAT);
    choose();
    await screen.findByRole("checkbox", { name: /it hit me/ });
    type(box, `${CHAT} more`);
    expect(screen.queryByRole("checkbox")).toBeNull();

    choose();
    await screen.findByRole("checkbox", { name: /it hit me/ });
    fireEvent.click(screen.getByRole("button", { name: "关掉" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(box).toHaveValue(`${CHAT} more`);
  });
});
