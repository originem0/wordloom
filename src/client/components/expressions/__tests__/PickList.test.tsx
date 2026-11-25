// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PickResponse } from "@/shared/expressions";
import { PickList } from "../PickList";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const PICKS: PickResponse["picks"] = [
  { text: "it dawned on me", before: "Me: how do I say 我突然意识到?", why: "the idea arrives by itself" },
  { text: "it hit me", before: null, why: "shorter, more abrupt" },
  { text: "break the ice", before: "AI: one more for you", why: "a set phrase" },
];

const DUPLICATE = {
  status: 409,
  body: {
    error: "Already saved",
    code: "DUPLICATE",
    existing: [{ id: 7, masked: false, text: "It dawned on me that I was wrong.", intent: null, createdAt: new Date(2026, 9, 3).getTime() }],
  },
};

/** Every save the list sent, and what the server is to answer to the next ones (201 by default), after `hold` if there is one. */
let sent: Array<{ method: string; url: string; body: unknown }>;
let answers: Array<{ status: number; body: unknown; hold?: Promise<void> }>;

beforeEach(() => {
  sent = [];
  answers = [];
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ method: init?.method ?? "GET", url, body: JSON.parse(String(init?.body ?? "null")) });
      const { status, body, hold } = answers.shift() ?? { status: 201, body: { id: sent.length } };
      await hold;
      return new Response(JSON.stringify(body), { status });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function show(picks = PICKS, from: { sourceType?: "chat" | "book"; sourceTitle?: string } = {}) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PickList picks={picks} from={from} onSaved={onSaved} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onSaved, onClose };
}

const tick = (text: string) => fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(text) }));
const keep = () => fireEvent.click(screen.getByRole("button", { name: "收下选中的" }));

describe("what was picked", () => {
  it("is shown with what came before it and why, and nothing is ticked", () => {
    show();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    expect(screen.getByText("Me: how do I say 我突然意识到?")).toBeInTheDocument();
    expect(screen.getByText("shorter, more abrupt")).toBeInTheDocument();
    // Nothing is saved on the model's say-so.
    expect(screen.getByRole("button", { name: "收下选中的" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says so when nothing was picked", () => {
    show([]);
    expect(screen.getByText("没有挑出来。可以自己选中一段再收下。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "收下选中的" })).toBeNull();
  });

  it("is dismissed with 关掉", () => {
    const { onClose } = show();
    fireEvent.click(screen.getByRole("button", { name: "关掉" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("treats what the model returned as text, never as markup", () => {
    const HOSTILE = '<img src=x onerror="alert(1)">';
    show([{ text: `text ${HOSTILE}`, before: `before ${HOSTILE}`, why: `**why** ${HOSTILE}` }]);
    expect(document.querySelector("img, strong")).toBeNull();
    for (const field of ["text", "before", "**why**"]) expect(document.body.textContent).toContain(`${field} ${HOSTILE}`);
  });
});

describe("收下选中的", () => {
  it("saves only the ticked ones, in order, with what came before and the tag chosen on the box", async () => {
    const { onSaved } = show(PICKS, { sourceType: "chat", sourceTitle: "ChatGPT" });
    tick("break the ice");
    tick("it dawned on me");
    keep();

    await waitFor(() => expect(screen.getAllByText("已收下")).toHaveLength(2));
    expect(sent).toEqual([
      { method: "POST", url: "/api/expressions", body: { text: "it dawned on me", textBefore: "Me: how do I say 我突然意识到?", sourceType: "chat", sourceTitle: "ChatGPT" } },
      { method: "POST", url: "/api/expressions", body: { text: "break the ice", textBefore: "AI: one more for you", sourceType: "chat", sourceTitle: "ChatGPT" } },
    ]);
    expect(onSaved.mock.calls).toEqual([[1], [2]]);
    // What was saved cannot be saved twice; the one left can still be ticked.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: /it hit me/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "收下选中的" })).toBeDisabled();
  });

  it("leaves out a pick that was unticked again, and sends no 上文 and no source when there is none", async () => {
    show();
    tick("it dawned on me");
    tick("it hit me");
    tick("it dawned on me");
    keep();
    await waitFor(() => expect(screen.getByText("已收下")).toBeInTheDocument());
    expect(sent.map((s) => s.body)).toEqual([{ text: "it hit me" }]);
  });

  it("sends one at a time", async () => {
    let release = () => {};
    answers.push({ status: 201, body: { id: 5 }, hold: new Promise<void>((r) => (release = r)) });
    show();
    tick("it dawned on me");
    tick("it hit me");
    keep();

    await waitFor(() => expect(sent).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(1);
    expect(screen.getByRole("button", { name: "收下选中的" })).toBeDisabled();
    // What is being saved is what was ticked at the click: no tick changes under it, and the list stays.
    for (const box of screen.getAllByRole("checkbox")) expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "关掉" })).toBeDisabled();
    release();
    await waitFor(() => expect(sent).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByText("已收下")).toHaveLength(2));
  });

  // The rule of the box holds here as well: the library having the same words
  // already is a question for the user, not a refusal and not a thing to settle
  // for them.
  async function meetDuplicate(from: { sourceType?: "chat" } = {}) {
    const view = show(PICKS, from);
    answers.push(DUPLICATE, { status: 201, body: { id: 8 } });
    tick("it dawned on me");
    tick("it hit me");
    keep();
    expect(await screen.findByText("已收下")).toBeInTheDocument();
    return view;
  }

  it("asks about a pick the library already has, under that pick, and goes on with the rest", async () => {
    const { onSaved } = await meetDuplicate();
    expect(screen.getByText("已收过")).toBeInTheDocument();
    expect(screen.getByText("已经收过同样的。是又一次遇到，还是另一个意思？")).toBeInTheDocument();
    expect(screen.getByText("It dawned on me that I was wrong.")).toBeInTheDocument();
    expect(screen.getByText("2026/10/3")).toBeInTheDocument();
    expect(sent.map((s) => (s.body as { text: string }).text)).toEqual(["it dawned on me", "it hit me"]);
    expect(onSaved.mock.calls).toEqual([[8]]);
    expect(toast.error).not.toHaveBeenCalled();
    // While the question stands the pick cannot be ticked again: only the third still can.
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });

  it("records one more encounter when the user says 又一次遇到, with the 上文 and the tag of the pick", async () => {
    const { onSaved } = await meetDuplicate({ sourceType: "chat" });
    fireEvent.click(screen.getByRole("button", { name: "又一次遇到" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "另存" })).toBeNull());
    expect(sent[2]).toEqual({
      method: "POST",
      url: "/api/expressions/7/encounters",
      body: { text: "it dawned on me", textBefore: "Me: how do I say 我突然意识到?", sourceType: "chat" },
    });
    expect(screen.getByText("又一次遇到")).toBeInTheDocument();
    expect(screen.queryByText("已收过")).toBeNull();
    // Not a fresh entry: there is no gloss to wait for.
    expect(onSaved.mock.calls).toEqual([[8]]);
  });

  it("saves a separate entry when the user says 另存", async () => {
    const { onSaved } = await meetDuplicate();
    answers.push({ status: 201, body: { id: 9 } });
    fireEvent.click(screen.getByRole("button", { name: "另存" }));

    await waitFor(() => expect(screen.getAllByText("已收下")).toHaveLength(2));
    expect(sent[2]).toEqual({
      method: "POST",
      url: "/api/expressions",
      body: { text: "it dawned on me", textBefore: "Me: how do I say 我突然意识到?", force: true },
    });
    expect(onSaved.mock.calls).toEqual([[8], [9]]);
    expect(screen.queryByRole("button", { name: "又一次遇到" })).toBeNull();
  });

  it("keeps the question when its answer does not go through", async () => {
    await meetDuplicate();
    answers.push({ status: 500, body: { error: "boom" } });
    fireEvent.click(screen.getByRole("button", { name: "又一次遇到" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有存上：服务暂时不可用（HTTP 500）。"));
    await waitFor(() => expect(screen.getByRole("button", { name: "又一次遇到" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "另存" })).toBeEnabled();
    expect(screen.getByText("已收过")).toBeInTheDocument();
  });

  it("stops at any other error, says so, and leaves the rest ticked", async () => {
    const { onSaved } = show();
    answers.push({ status: 500, body: { error: "boom" } });
    tick("it dawned on me");
    tick("it hit me");
    keep();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有存上：服务暂时不可用（HTTP 500）。"));
    expect(sent).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /it dawned on me/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /it hit me/ })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "收下选中的" })).toBeEnabled());
  });
});
