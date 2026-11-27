// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { CaptureBox } from "../CaptureBox";
import { useLastSource } from "../shared";
import { useAppStore } from "@/client/store";

// Node 26 has no localStorage without --localstorage-file. Persistence is not
// under test here; keep only the language preference in this test process.
useAppStore.persist.setOptions({ storage: {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
} });

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

/** Every write the box sent, and what the server is to answer to the next ones (201 by default), after `hold` if there is one. */
let writes: Array<{ method: string; url: string; body: unknown }>;
let answers: Array<{ status: number; body: unknown; hold?: Promise<void> }>;

beforeEach(() => {
  useAppStore.setState({ uiLanguage: "zh-CN" });
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
  useAppStore.setState({ uiLanguage: "zh-CN" });
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

// The prototype of the storage that is really there. Under Node 26 that is
// Node's own, not the `Storage` jsdom puts on the global: a spy on
// `Storage.prototype` would see no write at all.
const watchStorage = () => vi.spyOn(Object.getPrototypeOf(sessionStorage) as Storage, "setItem");

/** React builds onSelect from focus plus mouse and key events, not from the native "select" event. */
function select(box: HTMLTextAreaElement, part: string) {
  const start = box.value.indexOf(part);
  box.focus();
  box.setSelectionRange(start, start + part.length);
  fireEvent.mouseUp(box);
}

const keep = () => fireEvent.click(screen.getByRole("button", { name: "收下" }));

const CHAT = "Me: how do I say 我突然意识到?\n\nAI: You could say it dawned on me.\nOr simply: it hit me.";

it("switches interface language while preserving the selected source, focus, and original draft", async () => {
  const { box } = renderBox();
  type(box, "It dawned on me that I was wrong.");
  select(box, "dawned on me");
  fireEvent.click(screen.getByRole("button", { name: "书" }));
  fireEvent.change(screen.getByRole("textbox", { name: "出处" }), { target: { value: "私人书名" } });
  act(() => useAppStore.getState().setUiLanguage("en"));
  expect(screen.getByRole("textbox", { name: "Original text" })).toBe(box);
  expect(box).toHaveValue("It dawned on me that I was wrong.");
  expect(screen.getByRole("textbox", { name: "Source" })).toHaveValue("私人书名");
  expect(screen.getByRole("button", { name: "Book" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Focus: dawned on me" })).toBeInTheDocument();
  expect(writes).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].body).toEqual({ text: "It dawned on me that I was wrong.", focus: "dawned on me", focusRange: { start: 3, end: 15 }, sourceType: "book", sourceTitle: "私人书名" });
});

describe("what 收下 makes of the box", () => {
  it("keeps a second sentence typed before the first response arrives", async () => {
    let release!: () => void;
    answers.push({ status: 201, body: { id: 2 }, hold: new Promise<void>((resolve) => { release = resolve; }) });
    const { box, onSaved } = renderBox();
    type(box, "first sentence");
    keep();
    await waitFor(() => expect(writes).toHaveLength(1));
    type(box, "second sentence");
    release();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
    expect(box).toHaveValue("second sentence");
  });

  it("saves the whole box as the text when nothing is selected", async () => {
    const { box, onSaved } = renderBox();
    type(box, "  It dawned on me that I was wrong.  ");
    keep();

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(writes).toEqual([{ method: "POST", url: "/api/expressions", body: { text: "  It dawned on me that I was wrong.  " } }]);
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
    expect(writes[0].body).toEqual({ text: "It dawned on me that I was wrong.", focus: "dawned on me", focusRange: { start: 3, end: 15 } });
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

  // The paragraph above is whatever was pasted, not something the user typed:
  // its length must not be what refuses the save.
  it("offers no more 上文 than the server takes, and keeps the end of it", async () => {
    const { box } = renderBox();
    type(box, `${"a".repeat(4000)} and then this.\nYou could say it dawned on me.`);
    select(box, "it dawned on me");
    const offered = screen.getByRole<HTMLTextAreaElement>("textbox", { name: /上文/ }).value;
    expect(offered).toHaveLength(4000);
    expect(offered.endsWith("a and then this.")).toBe(true);
    keep();

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({ text: "it dawned on me", textBefore: offered });
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
    const stored = watchStorage();
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

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有存上：服务暂时不可用（HTTP 500）。"));
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
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有挑成：服务暂时不可用（HTTP 502）。"));
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

// The plan's answer to "a pasted conversation passes through the relay" is to
// say so where it is done, not to stop it.
describe("what goes to the model", () => {
  it("is said beside the button, before anything is typed", () => {
    renderBox();
    expect(screen.getByText(/发给你配置的模型/)).toHaveTextContent("「帮我挑」会把框里的整段对话发给你配置的模型");
  });

  // Asking is what 对谈 is for: the box has no way left to ask, only a word on where to.
  it("is nothing else: the box no longer asks", () => {
    const { box } = renderBox();
    type(box, "怎么说我突然意识到");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["AI 对话", "书", "影视", "其他", "收下"]);
    expect(screen.getAllByRole("textbox")).toEqual([box]);
    expect(screen.getByText(/去「对谈」里说/)).toBeInTheDocument();
  });
});
