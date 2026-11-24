// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AttemptResponse } from "@/shared/expressions";
import { AttemptResult } from "../AttemptResult";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const ANSWER = { text: "It dawned on me that I was wrong.", focus: "dawned on", gloss: "to become clear to someone" };

const judged = (over: Partial<AttemptResponse> = {}): AttemptResponse => ({
  encounterId: 31, status: "done", verdict: "used", outcome: "pass", overturned: false, rewrites: [], answer: ANSWER, intent: null, ...over,
});

/** What the server is to answer to the next request, and every request that was sent. */
let next: { status: number; body: unknown };
let sent: Array<{ method: string; url: string; body: unknown }>;

beforeEach(() => {
  sent = [];
  next = { status: 200, body: judged() };
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ method: init?.method ?? "GET", url, body: JSON.parse(String(init?.body ?? "null")) });
      return new Response(JSON.stringify(next.body), { status: next.status });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function show(result: AttemptResponse) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AttemptResult result={result} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("a judgement", () => {
  it.each([
    ["used", "用上了"],
    ["conveyed", "绕开但说通了"],
    ["missed", "没说通"],
  ] as const)("reads %s as %s", (verdict, wording) => {
    show(judged({ verdict, outcome: verdict === "used" ? "pass" : "fail" }));
    expect(screen.getByText(wording)).toBeInTheDocument();
  });

  it("shows the rewrites, then the original with its focus marked and the gloss signed as the AI's", () => {
    show(judged({ rewrites: [{ from: "I suddenly knew", to: "it dawned on me", why: "the idea arrives by itself" }] }));
    const shown = document.body.textContent!;
    expect(shown).toContain("I suddenly knew → it dawned on me");
    expect(shown).toContain("the idea arrives by itself");
    expect(shown.indexOf("it dawned on me")).toBeLessThan(shown.indexOf("It dawned on me that I was wrong."));
    expect(document.querySelector("mark")).toHaveTextContent("dawned on");
    expect(screen.getByText(/补注 · AI 写的/)).toHaveTextContent("to become clear to someone");
  });

  // After a miss that had only the fresh scene the server holds the English
  // back and sends the intent: the next try is made with that hint.
  it("gives the hint instead of the answer when the answer was withheld", () => {
    show(judged({ verdict: "conveyed", outcome: "fail", answer: null, intent: "想说：我突然明白了" }));
    expect(screen.getByText(/想说：我突然明白了/)).toBeInTheDocument();
    expect(document.querySelector("mark")).toBeNull();
    expect(document.body.textContent).not.toContain("dawned");
  });

  it("treats what the model and the user wrote as text, never as markup", () => {
    const HOSTILE = '<img src=x onerror="alert(1)">';
    show(judged({
      rewrites: [{ from: `a ${HOSTILE}`, to: `b ${HOSTILE}`, why: `**c** ${HOSTILE}` }],
      answer: { text: `text ${HOSTILE}`, focus: HOSTILE, gloss: `gloss ${HOSTILE}` },
    }));
    expect(document.querySelector("img, strong")).toBeNull();
    expect(document.querySelector("mark")).toHaveTextContent(HOSTILE);
    expect(document.body.textContent).toContain(`**c** ${HOSTILE}`);
  });
});

describe("overturning a judgement", () => {
  it("turns a miss into a pass with one click, and hands the new state up", async () => {
    const onChange = show(judged({ verdict: "conveyed", outcome: "fail" }));
    next.body = judged({ verdict: "conveyed", outcome: "pass", overturned: true });
    fireEvent.click(screen.getByRole("button", { name: "判错了，我用上了" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next.body));
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions/attempts/31/overturn", body: { outcome: "pass" } }]);
  });

  it("takes a pass back the same way", async () => {
    const onChange = show(judged());
    fireEvent.click(screen.getByRole("button", { name: "其实没用上" }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(sent[0].body).toEqual({ outcome: "fail" });
  });

  // The model's reading stays on screen: what the user changed is what counts, not what was said.
  it("says so when the outcome that stands is the user's", () => {
    show(judged({ verdict: "missed", outcome: "pass", overturned: true }));
    expect(screen.getByText("没说通")).toBeInTheDocument();
    expect(screen.getByText(/你改成了：算用上/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "其实没用上" })).toBeInTheDocument();
  });

  it("says what went wrong and changes nothing when the server refuses", async () => {
    const onChange = show(judged());
    next = { status: 409, body: { error: "Not judged yet", code: "NOT_JUDGED" } };
    fireEvent.click(screen.getByRole("button", { name: "其实没用上" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有改成：Not judged yet"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// The sentence was saved before the model was asked. When no judgement came
// back nothing is counted, and the same row is judged again on request.
describe("a judgement that did not come back", () => {
  const PENDING = judged({ status: "failed", verdict: null, outcome: null, answer: null });

  it("says the sentence is kept and not counted, and offers nothing to overturn", () => {
    show(PENDING);
    expect(screen.getByText(/已经存下/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /用上/ })).toBeNull();
  });

  it("asks again on the same row", async () => {
    const onChange = show(PENDING);
    fireEvent.click(screen.getByRole("button", { name: "再判一次" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(judged()));
    expect(sent).toEqual([{ method: "POST", url: "/api/expressions/attempts/31/judge", body: {} }]);
  });

  it("says so when it fails again", async () => {
    const onChange = show(PENDING);
    next.body = PENDING;
    fireEvent.click(screen.getByRole("button", { name: "再判一次" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("判定还是没有回来，过一会儿再试"));
    expect(onChange).toHaveBeenCalledWith(PENDING);
  });
});
