// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { CaptureBox } from "../CaptureBox";
import { useLastSource } from "../shared";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** Every write the box sent, and what the server is to answer to the next ones (201 by default). */
let writes: Array<{ method: string; url: string; body: unknown }>;
let answers: Array<{ status: number; body: unknown }>;

beforeEach(() => {
  writes = [];
  answers = [];
  useLastSource.setState({ source: null });
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      writes.push({ method: init?.method ?? "GET", url, body: JSON.parse(String(init?.body ?? "null")) });
      const { status, body } = answers.shift() ?? { status: 201, body: { id: 1 } };
      return new Response(JSON.stringify(body), { status });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

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
