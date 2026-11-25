// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { act, cleanup, render, screen, fireEvent, waitFor, within, type BoundFunctions, type queries } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StrictMode, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { EXPRESSIONS_KEY, useExpressions } from "@/client/hooks/useExpressions";
import { EXPRESSION_LIMITS, type AttemptResponse, type ExpressionDetail, type SceneResponse, type TryItem } from "@/shared/expressions";
import { TryPanel } from "../TryPanel";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

const SCENE = "朋友问起那次争吵。你想说，是过了几天自己才想通的。";
const INTENT = "想说：我突然明白了";
const ORIGINAL: SceneResponse = { scene: "It ____ me that I was wrong.", before: "We had argued all night." };
const ANSWER = { text: "It dawned on me that I was wrong.", focus: "dawned on", gloss: "to become clear to someone" };

const item = (over: Partial<TryItem> = {}): TryItem => ({ id: 7, prompt: SCENE, cue: "none", intent: INTENT, hasScene: true, ...over });

const judged = (over: Partial<AttemptResponse> = {}): AttemptResponse => ({
  encounterId: 31, status: "done", verdict: "used", outcome: "pass", overturned: false, rewrites: [], answer: ANSWER, intent: null, ...over,
});
/** A miss that had only the fresh scene: the English is held back and the intent comes in its place. */
const WITHHELD = judged({ verdict: "conveyed", outcome: "fail", answer: null, intent: INTENT });
/** The sentence is saved, the model did not answer. */
const UNJUDGED = judged({ status: "failed", verdict: null, outcome: null, answer: null });

/** What a reveal answers: the entry with its English, this once. */
const REVEALED: ExpressionDetail = {
  id: 7, status: "active", masked: true, ...ANSWER, intent: INTENT, intentBy: "self", sourceType: null, sourceTitle: null,
  occurredAt: null, createdAt: 0, updatedAt: 0, produced: false, graduated: false, queued: false,
  note: null, aiIntent: null, annotated: true, activeSince: 0, timeline: [],
};

/** "never": the request is left hanging for as long as the test runs. */
type Answer = { status: number; body: unknown } | "never";
const says = (body: unknown, status = 200): Answer => ({ status, body });
const refuses = (status: number, error: string, code?: string) => says({ error, code }, status);

// A stand-in for the routes 试一条 talks to. `due` and `judgements` are queues:
// one answer per request, in the order the requests arrive.
let server: {
  due: Array<TryItem[] | "fails">;
  /** When set, what is due is not answered before this. */
  hold: Promise<void> | null;
  scene: Answer;
  reveal: Answer;
  /** An attempt, a second judgement and an overturn all take the next one; a pass with the answer when there is none. */
  judgements: Answer[];
};
let sent: Array<{ method: string; url: string; body: unknown }>;
let stored: MockInstance<Storage["setItem"]>;
/** Ends the requests left hanging. A mutation that never settles would keep a timer going after its test. */
let hanging: Array<() => void>;

// Of an entry, only its id may sit in a URL.
const URLS = /^\/api\/expressions(|\/try(\?exclude=\d+(,\d+)*)?|\/\d+\/(scene|attempts|reveal)|\/attempts\/\d+\/(judge|overturn))$/;

const reply = (answer: Answer) =>
  answer === "never"
    ? new Promise<Response>((resolve) => hanging.push(() => resolve(new Response("{}", { status: 500 }))))
    : Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));

function route(url: string): Promise<Response> {
  const last = url.split("?")[0].split("/").pop();
  if (last === "expressions") return reply(says({ expressions: [] }));
  if (last === "try") {
    const due = server.due.shift() ?? [];
    return Promise.resolve(server.hold).then(() => reply(due === "fails" ? refuses(500, "boom") : says({ items: due })));
  }
  if (last === "scene") return reply(server.scene);
  if (last === "reveal") return reply(server.reveal);
  return reply(server.judgements.shift() ?? says(judged()));
}

beforeEach(() => {
  sent = [];
  hanging = [];
  server = { due: [[item()]], hold: null, scene: says(ORIGINAL), reveal: says(REVEALED), judgements: [] };
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  // The prototype of the storage that is really there. Under Node 26 that is
  // Node's own, not the `Storage` jsdom puts on the global: a spy on
  // `Storage.prototype` would see no write at all.
  stored = vi.spyOn(Object.getPrototypeOf(sessionStorage) as Storage, "setItem");
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      sent.push({ method: init?.method ?? "GET", url, body: JSON.parse(String(init?.body ?? "null")) });
      return route(url);
    }),
  );
});

// Whatever a test did: nothing of an entry but its id went into a URL, and nothing at all into storage.
afterEach(() => {
  try {
    for (const { url } of sent) expect(url).toMatch(URLS);
    expect(stored).not.toHaveBeenCalled();
  } finally {
    // Unmounted here as well: a failure above would otherwise leave this test's page standing under the next one.
    cleanup();
    hanging.forEach((end) => end());
    // The storage spy, and a clock or a hidden page some test left behind.
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "visibilityState");
    vi.unstubAllGlobals();
  }
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });

function renderPanel(ui: ReactElement = <TryPanel />, client = newClient()) {
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

/** One card, or the whole screen: what `within` gives, with its queries typed. */
type Card = BoundFunctions<typeof queries>;
/** The card asking `prompt`, once it is on screen. */
const card = async (prompt = SCENE): Promise<Card> => within((await screen.findByText(prompt)).closest("li")!);
const box = (c: Card) => c.getByRole<HTMLTextAreaElement>("textbox", { name: "你的句子" });
const press = (c: Card, name: string) => fireEvent.click(c.getByRole("button", { name }));
function answerWith(c: Card, sentence: string) {
  fireEvent.change(box(c), { target: { value: sentence } });
  press(c, "提交");
}
/** Asks a fresh card for `hints` hints and waits for what the second one fetches. */
async function climb(c: Card, hints: number) {
  for (let i = 0; i < hints; i++) press(c, "给点提示");
  if (hints === 2) await c.findByText(ORIGINAL.scene);
}

/** The bodies sent to the routes ending in `/name`, in order. */
const posted = (name: string) => sent.filter((r) => r.method === "POST" && r.url.endsWith(`/${name}`)).map((r) => r.body);
const urls = (part: string) => sent.map((r) => r.url).filter((url) => url.includes(part));

// How far up the ladder a fresh card is after so many clicks on 给点提示.
const RUNGS = [
  [0, "none"],
  [1, "need"],
  [2, "scene"],
] as const;

describe("试一条: what it asks for", () => {
  /** The page mounts the panel once its list has answered, and reloads that list after every write. */
  function UnderTheList() {
    return useExpressions(true).data ? <TryPanel /> : null;
  }

  it("asks once on mount, and not again when the list reloads under a sentence being typed", async () => {
    const client = renderPanel(<UnderTheList />);
    const c = await card();
    fireEvent.change(box(c), { target: { value: "It dawned" } });
    await act(() => client.invalidateQueries({ queryKey: EXPRESSIONS_KEY }));

    expect(sent.map((r) => r.url)).toEqual(["/api/expressions", "/api/expressions/try", "/api/expressions"]);
    expect(box(c)).toHaveValue("It dawned");
  });

  // main.tsx wraps the app in StrictMode: in development the mount effect runs
  // twice, so two requests go out. The answer to the second is the one kept.
  // StrictMode is outermost here as it is there: nested under the provider it
  // would not repeat the effects of the first mount.
  it("comes up all the same when its mount effect runs twice", async () => {
    server.due = [[item()], [item()]];
    render(<StrictMode><QueryClientProvider client={newClient()}><TryPanel /></QueryClientProvider></StrictMode>);
    await card();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(urls("/try")).toEqual(["/api/expressions/try", "/api/expressions/try"]);
  });

  it("says so when nothing is due, and looks again when asked", async () => {
    server.due = [[], [item(), item({ id: 8, prompt: "另一个处境" })]];
    renderPanel();
    expect(screen.getByRole("heading", { name: "试一条" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();

    expect(await screen.findByText("现在没有到时间的。放进「想用」的条目，隔一天会出现在这里。")).toBeInTheDocument();
    // What is not due now will be later, with the page still open. All of it comes, as on opening the page.
    press(screen, "再看一次");
    await card("另一个处境");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/现在没有到时间的/)).toBeNull();
    expect(urls("/try")).toEqual(["/api/expressions/try", "/api/expressions/try"]);
  });

  it("offers to ask again when the request failed", async () => {
    server.due = ["fails", [item()]];
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "再试一次" }));
    await card();
    expect(screen.queryByRole("button", { name: "再试一次" })).toBeNull();
    expect(urls("/try")).toEqual(["/api/expressions/try", "/api/expressions/try"]);
  });
});

describe("the hint ladder", () => {
  it("keeps the intent out of the page until a hint is asked for", async () => {
    renderPanel();
    const c = await card();
    expect(document.body.innerHTML).not.toContain(INTENT);

    press(c, "给点提示");
    expect(c.getByText(`提示：${INTENT}`)).toBeInTheDocument();
    // The intent is in hand already; only the next hint has to be fetched.
    expect(urls("/scene")).toEqual([]);
  });

  it.each(RUNGS)("after %i hint(s) an attempt goes with cue %s and the question as it was shown", async (hints, cue) => {
    renderPanel();
    const c = await card();
    await climb(c, hints);
    answerWith(c, "  It dawned on me.  ");

    await waitFor(() => expect(posted("attempts")).toEqual([{ text: "It dawned on me.", cue, prompt: SCENE }]));
    expect(urls("/attempts")).toEqual(["/api/expressions/7/attempts"]);
  });

  it("shows the original scene with its blanks as the second hint, and has none after it", async () => {
    renderPanel();
    const c = await card();
    await climb(c, 2);
    expect(c.getByText(ORIGINAL.before!)).toBeInTheDocument();
    expect(c.queryByRole("button", { name: "给点提示" })).toBeNull();
    expect(urls("/scene")).toEqual(["/api/expressions/7/scene"]);
  });

  it("starts at the intent when the entry has no fresh scene", async () => {
    server.due = [[item({ prompt: INTENT, cue: "need" })]];
    renderPanel();
    const c = await card(INTENT);
    // The question is the intent: saying it twice would be noise.
    expect(c.queryByText(/提示：/)).toBeNull();

    press(c, "给点提示");
    await c.findByText(ORIGINAL.scene);
    answerWith(c, "It dawned on me.");
    await waitFor(() => expect(posted("attempts")).toEqual([{ text: "It dawned on me.", cue: "scene", prompt: INTENT }]));
  });

  it("has no hint beyond the intent for an entry without an original scene", async () => {
    server.due = [[item({ hasScene: false })]];
    renderPanel();
    const c = await card();
    press(c, "给点提示");
    expect(c.getByText(`提示：${INTENT}`)).toBeInTheDocument();
    expect(c.queryByRole("button", { name: "给点提示" })).toBeNull();
    // Nothing was refused, so there is nothing to say about it, and nothing to ask the server.
    expect(c.queryByText("这一条没有原场景")).toBeNull();
    expect(urls("/scene")).toEqual([]);
  });

  it("says so when the original scene cannot be read, and stays at the intent", async () => {
    server.scene = refuses(404, "No scene", "NO_SCENE");
    renderPanel();
    const c = await card();
    press(c, "给点提示");
    press(c, "给点提示");
    expect(await c.findByText("这一条没有原场景")).toBeInTheDocument();
    expect(c.queryByRole("button", { name: "给点提示" })).toBeNull();

    answerWith(c, "It dawned on me.");
    await waitFor(() => expect(posted("attempts")).toEqual([{ text: "It dawned on me.", cue: "need", prompt: SCENE }]));
  });

  // A scene on screen can be read again (the connection coming back does
  // it), a scene that was refused too. While that request is out the card says
  // what it said: it does not go back to waiting.
  it("goes on saying so while the scene is read again", async () => {
    server.scene = refuses(404, "No scene", "NO_SCENE");
    const client = renderPanel();
    const c = await card();
    press(c, "给点提示");
    press(c, "给点提示");
    await c.findByText("这一条没有原场景");

    server.scene = "never";
    await act(async () => {
      void client.invalidateQueries({ queryKey: EXPRESSIONS_KEY });
      // One turn of the timers: a query tells its readers in a timeout.
      await new Promise((resolve) => setTimeout(resolve));
    });
    expect(urls("/scene")).toHaveLength(2);
    expect(c.getByText("这一条没有原场景")).toBeInTheDocument();
  });

  // The level is what was on screen, not what was asked for.
  it("does not count a scene that has not arrived", async () => {
    server.scene = "never";
    renderPanel();
    const c = await card();
    press(c, "给点提示");
    press(c, "给点提示");
    answerWith(c, "It dawned on me.");
    await waitFor(() => expect(posted("attempts")).toEqual([{ text: "It dawned on me.", cue: "need", prompt: SCENE }]));
  });

  // The other writes have what is on screen of the library read again. Where
  // an entry was first met does not change with a sentence written about it.
  it("does not read the scene again after an attempt", async () => {
    renderPanel();
    const c = await card();
    await climb(c, 2);
    answerWith(c, "It dawned on me.");
    await c.findByText("用上了");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(urls("/scene")).toEqual(["/api/expressions/7/scene"]);
  });

  // The scene stays in the query cache for a while. A card for the same entry
  // on a later visit has not shown it until its own hint is asked for.
  it("does not take a scene left in the cache for a hint it gave", async () => {
    const client = newClient();
    client.setQueryData([...EXPRESSIONS_KEY, 7, "scene"], ORIGINAL);
    renderPanel(undefined, client);
    const c = await card();
    expect(c.queryByText(ORIGINAL.scene)).toBeNull();

    answerWith(c, "It dawned on me.");
    await waitFor(() => expect(posted("attempts")).toEqual([{ text: "It dawned on me.", cue: "none", prompt: SCENE }]));
  });
});

describe("giving up", () => {
  it.each(RUNGS)("after %i hint(s) is recorded at level %s", async (hints, cue) => {
    renderPanel();
    const c = await card();
    await climb(c, hints);
    press(c, "看答案");
    await waitFor(() => expect(posted("reveal")).toEqual([{ cue }]));
    expect(urls("/reveal")).toEqual(["/api/expressions/7/reveal"]);
  });

  it("shows what the reveal answered, and counts a sentence written after it as revealed", async () => {
    renderPanel();
    const c = await card();
    expect(document.body.innerHTML).not.toContain("dawned");

    press(c, "看答案");
    expect(await c.findByText(/补注 · AI 写的/)).toHaveTextContent(ANSWER.gloss);
    expect(document.querySelector("mark")).toHaveTextContent("dawned on");
    expect(c.getByText("看过答案再写一句，不计档位")).toBeInTheDocument();
    // Nothing is left to ask for.
    expect(c.queryByRole("button", { name: "给点提示" })).toBeNull();
    expect(c.queryByRole("button", { name: "看答案" })).toBeNull();

    answerWith(c, "It dawned on me too.");
    await waitFor(() => expect(posted("attempts")).toEqual([{ text: "It dawned on me too.", cue: "revealed", prompt: SCENE }]));
    // The judgement prints the answer as well: one copy stays, not two.
    await waitFor(() => expect(c.queryByRole("textbox")).toBeNull());
    expect(c.getAllByText(/补注 · AI 写的/)).toHaveLength(1);
  });

  it("leaves the card as it was when the reveal fails", async () => {
    server.reveal = refuses(500, "boom");
    renderPanel();
    const c = await card();
    press(c, "看答案");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有揭开：服务暂时不可用（HTTP 500）。"));
    expect(c.getByRole("button", { name: "看答案" })).toBeEnabled();
    expect(c.queryByText("看过答案再写一句，不计档位")).toBeNull();
  });

  // A sentence sent now would go with the level from before the answer, which is already on its way.
  it("takes no sentence while the answer is on its way", async () => {
    server.reveal = "never";
    renderPanel();
    const c = await card();
    fireEvent.change(box(c), { target: { value: "It dawned on me." } });
    press(c, "看答案");
    await waitFor(() => expect(c.getByRole("button", { name: "提交" })).toBeDisabled());
    expect(c.getByRole("button", { name: "看答案" })).toBeDisabled();
  });
});

describe("an attempt", () => {
  it("is not sent blank", async () => {
    renderPanel();
    const c = await card();
    expect(c.getByRole("button", { name: "提交" })).toBeDisabled();
    fireEvent.change(box(c), { target: { value: "   " } });
    expect(c.getByRole("button", { name: "提交" })).toBeDisabled();
    expect(box(c)).toHaveAttribute("maxlength", String(EXPRESSION_LIMITS.attempt));
  });

  // A model takes seconds. A second click would save the sentence twice, and
  // giving up now would be recorded beside the attempt it gave up on.
  it("takes nothing else while a sentence is being judged", async () => {
    server.judgements = ["never"];
    renderPanel();
    const c = await card();
    answerWith(c, "It dawned on me.");
    await waitFor(() => expect(c.getByRole("button", { name: "提交" })).toBeDisabled());
    expect(c.getByRole("button", { name: "给点提示" })).toBeDisabled();
    expect(c.getByRole("button", { name: "看答案" })).toBeDisabled();
  });

  it("closes the card when the judgement brings the answer", async () => {
    renderPanel();
    const c = await card();
    answerWith(c, "  It dawned on me.  ");
    expect(await c.findByText("用上了")).toBeInTheDocument();
    expect(document.querySelector("mark")).toHaveTextContent("dawned on");
    expect(c.queryByRole("textbox")).toBeNull();
    expect(c.queryByRole("button", { name: /提交|给点提示|看答案/ })).toBeNull();
    // The box is gone; the sentence the judgement is about stays readable, as it was sent.
    expect(c.getByText("你写的：It dawned on me.")).toBeInTheDocument();
  });

  it("stays open after a miss that had only the fresh scene, and the next try goes with the intent", async () => {
    server.judgements = [says(WITHHELD), says(judged({ verdict: "conveyed", outcome: "fail" }))];
    renderPanel();
    const c = await card();
    answerWith(c, "I suddenly knew.");
    expect(await c.findByText(`没用上要练的那个说法。给你一句提示再试：${INTENT}`)).toBeInTheDocument();
    // Still in its box, to be changed: not printed a second time.
    expect(box(c)).toHaveValue("I suddenly knew.");
    expect(c.queryByText(/你写的/)).toBeNull();
    expect(document.body.innerHTML).not.toContain("dawned");

    answerWith(c, "It came to me.");
    await waitFor(() =>
      expect(posted("attempts")).toEqual([
        { text: "I suddenly knew.", cue: "none", prompt: SCENE },
        { text: "It came to me.", cue: "need", prompt: SCENE },
      ]),
    );
    // This time the answer came, pass or not: the card is done.
    await waitFor(() => expect(c.queryByRole("textbox")).toBeNull());
    expect(document.querySelector("mark")).toHaveTextContent("dawned on");
  });

  it("counts giving up after such a miss at the intent's level", async () => {
    server.judgements = [says(WITHHELD)];
    renderPanel();
    const c = await card();
    answerWith(c, "I suddenly knew.");
    await c.findByText(/给你一句提示再试/);
    press(c, "看答案");
    await waitFor(() => expect(posted("reveal")).toEqual([{ cue: "need" }]));
  });

  it("closes when the user overturns such a miss: the answer comes with it", async () => {
    server.judgements = [says(WITHHELD), says(judged({ verdict: "conveyed", outcome: "pass", overturned: true }))];
    renderPanel();
    const c = await card();
    answerWith(c, "It dawned on me.");
    const overturn = await c.findByRole("button", { name: "判错了，我用上了" });
    // A draft of the next try, never sent: the sentence that was judged is the first one.
    fireEvent.change(box(c), { target: { value: "It came to me." } });
    fireEvent.click(overturn);
    await waitFor(() => expect(document.querySelector("mark")).toHaveTextContent("dawned on"));
    expect(c.queryByRole("textbox")).toBeNull();
    expect(c.getByText("你写的：It dawned on me.")).toBeInTheDocument();
    expect(urls("/overturn")).toEqual(["/api/expressions/attempts/31/overturn"]);
  });

  it("puts the sentence out of reach while its judgement is missing, and takes the judgement when it comes", async () => {
    server.judgements = [says(UNJUDGED), says(judged())];
    renderPanel();
    const c = await card();
    answerWith(c, "It dawned on me.");
    fireEvent.click(await c.findByRole("button", { name: "再判一次" }));
    expect(c.queryByRole("textbox")).toBeNull();
    expect(c.getByText("你写的：It dawned on me.")).toBeInTheDocument();

    expect(await c.findByText("用上了")).toBeInTheDocument();
    expect(urls("/judge")).toEqual(["/api/expressions/attempts/31/judge"]);
    // One sentence, judged twice: not two attempts.
    expect(posted("attempts")).toHaveLength(1);
  });

  // The fresh scene was used up by the attempt whatever became of its
  // judgement: sending it again with `none` would be refused.
  it("opens again at the intent when a late judgement is such a miss", async () => {
    server.judgements = [says(UNJUDGED), says(WITHHELD)];
    renderPanel();
    const c = await card();
    answerWith(c, "I suddenly knew.");
    fireEvent.click(await c.findByRole("button", { name: "再判一次" }));
    await c.findByText(/给你一句提示再试/);
    expect(box(c)).toHaveValue("I suddenly knew.");

    press(c, "提交");
    await waitFor(() => expect(posted("attempts")).toHaveLength(2));
    expect(posted("attempts")[1]).toEqual({ text: "I suddenly knew.", cue: "need", prompt: SCENE });
  });

  it("drops the card when the entry has left 想用, and only that card", async () => {
    server.due = [[item(), item({ id: 8, prompt: "另一个处境" })]];
    server.judgements = [refuses(409, "Not in the active layer", "NOT_ACTIVE")];
    renderPanel();
    const other = await card("另一个处境");
    fireEvent.change(box(other), { target: { value: "half a sentence" } });
    answerWith(await card(), "It dawned on me.");

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("这一条已经不在想用里了"));
    expect(screen.queryByText(SCENE)).toBeNull();
    // The one below it moved up, with what was being typed in it.
    expect(box(other)).toHaveValue("half a sentence");
    expect(box(other)).toBeInTheDocument();
  });

  it("drops a card whose question the server no longer takes", async () => {
    server.judgements = [refuses(400, "The question is not the stored scene", "VALIDATION_ERROR")];
    renderPanel();
    answerWith(await card(), "It dawned on me.");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有交上：请检查填写的内容。"));
    expect(screen.queryByText(SCENE)).toBeNull();
  });

  it("keeps the card and the sentence when the request fails for another reason", async () => {
    server.judgements = [refuses(500, "boom")];
    renderPanel();
    const c = await card();
    answerWith(c, "It dawned on me.");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有交上：服务暂时不可用（HTTP 500）。"));
    expect(box(c)).toHaveValue("It dawned on me.");

    // Nothing was seen in between, so the level has not moved.
    press(c, "提交");
    await waitFor(() => expect(posted("attempts")).toHaveLength(2));
    expect(posted("attempts")[1]).toEqual({ text: "It dawned on me.", cue: "none", prompt: SCENE });
  });
});

describe("再来一条", () => {
  it("names every id that has been on screen, takes one entry, and says so when none is left", async () => {
    server.due = [
      ["甲", "乙", "丙"].map((prompt, i) => item({ id: i + 1, prompt })),
      [item({ id: 4, prompt: "丁" }), item({ id: 5, prompt: "戊" })],
      [],
    ];
    server.judgements = [says(judged()), refuses(409, "Not in the active layer", "NOT_ACTIVE")];
    renderPanel();
    // One card finished, one dropped: neither is to come back.
    answerWith(await card("甲"), "It dawned on me.");
    await screen.findByText("用上了");
    answerWith(await card("乙"), "It dawned on me.");
    await waitFor(() => expect(screen.queryByText("乙")).toBeNull());

    press(screen, "再来一条");
    await card("丁");
    expect(screen.getAllByRole("listitem").map((li) => li.firstChild?.textContent)).toEqual(["甲", "丙", "丁"]);

    press(screen, "再来一条");
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("没有到时间的了"));
    // Still offered: what is not due now will be later, with the page still open.
    expect(screen.getByRole("button", { name: "再来一条" })).toBeEnabled();
    expect(urls("/try")).toEqual(["/api/expressions/try", "/api/expressions/try?exclude=1,2,3", "/api/expressions/try?exclude=1,2,3,4"]);
    // Never a count of what is due or done.
    expect(screen.getByRole("heading", { name: "试一条" }).closest("section")).not.toHaveTextContent(/\d/);
  });

  it("says so and stays when the request fails", async () => {
    server.due = [[item()], "fails", [item({ id: 8, prompt: "另一个处境" })]];
    renderPanel();
    await card();
    press(screen, "再来一条");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("没有取到：服务暂时不可用（HTTP 500）。"));
    expect(screen.getByText(SCENE)).toBeInTheDocument();

    press(screen, "再来一条");
    await card("另一个处境");
  });
});

// The page is not always opened anew: a pinned tab stays for days. Coming back
// to it is what opening it was, once enough time has gone by.
describe("a page left open", () => {
  /** The page comes into view again, so many hours after this is called. */
  function comeBack(hours: number) {
    const then = Date.now() + hours * 3_600_000;
    vi.spyOn(Date, "now").mockReturnValue(then);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
  }

  it("starts over when it is looked at again hours later", async () => {
    // By then the entry answered yesterday is due again, asked for by its intent.
    server.due = [[item()], [item({ id: 8, prompt: "另一个处境" }), item({ prompt: INTENT, cue: "need" })]];
    renderPanel();
    answerWith(await card(), "It dawned on me.");
    await screen.findByText("用上了");

    comeBack(20);
    await card("另一个处境");
    // Asked as on opening the page: nothing is held back for having been on screen.
    expect(urls("/try")).toEqual(["/api/expressions/try", "/api/expressions/try"]);
    // Yesterday's judgement is gone, and its entry has a card of its own again, to be answered.
    expect(screen.queryByText("用上了")).toBeNull();
    expect(document.body.innerHTML).not.toContain("dawned");
    expect(box(await card(INTENT))).toHaveValue("");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  // A card dropped for a question gone stale was dropped for that question, not for good.
  it("asks again for an entry whose card had been dropped", async () => {
    server.due = [[item()], [item({ prompt: INTENT, cue: "need" })]];
    server.judgements = [refuses(400, "The question is not the stored scene", "VALIDATION_ERROR")];
    renderPanel();
    answerWith(await card(), "It dawned on me.");
    await waitFor(() => expect(screen.queryByText(SCENE)).toBeNull());

    comeBack(20);
    expect(box(await card(INTENT))).toHaveValue("");
  });

  it("looks again by itself where it had nothing to show", async () => {
    server.due = [[], [item()]];
    renderPanel();
    await screen.findByText(/现在没有到时间的/);
    comeBack(20);
    await card();
  });

  it("leaves everything as it is while a sentence is half written", async () => {
    server.due = [[item()], [item({ id: 8, prompt: "另一个处境" })]];
    renderPanel();
    const c = await card();
    fireEvent.change(box(c), { target: { value: "It dawned" } });
    comeBack(20);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(urls("/try")).toEqual(["/api/expressions/try"]);
    expect(box(c)).toHaveValue("It dawned");
  });

  it("keeps a sentence begun while the new round was on its way", async () => {
    server.due = [[item()], [item({ id: 8, prompt: "另一个处境" })]];
    renderPanel();
    const c = await card();
    let arrive!: () => void;
    server.hold = new Promise((resolve) => (arrive = resolve));
    comeBack(20);
    await waitFor(() => expect(urls("/try")).toHaveLength(2));
    fireEvent.change(box(c), { target: { value: "It dawned" } });
    await act(async () => {
      arrive();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(box(c)).toHaveValue("It dawned");
    expect(screen.queryByText("另一个处境")).toBeNull();
  });

  it("does not ask again within the hour, or while it is out of view", async () => {
    server.due = [[item()], [item({ id: 8, prompt: "另一个处境" })]];
    renderPanel();
    await card();
    comeBack(0.9);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    comeBack(20);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(urls("/try")).toEqual(["/api/expressions/try"]);
    expect(screen.getByText(SCENE)).toBeInTheDocument();
  });
});

describe("what the library and the models wrote", () => {
  it("is text, never markup", async () => {
    const HOSTILE = '<img src=x onerror="alert(1)">';
    server.due = [[item({ prompt: `处境 ${HOSTILE}`, intent: `**提示** ${HOSTILE}` })]];
    server.scene = says({ scene: `scene ${HOSTILE}`, before: `before ${HOSTILE}` });
    server.reveal = says({ ...REVEALED, text: `text ${HOSTILE}`, focus: HOSTILE, gloss: `gloss ${HOSTILE}` });
    renderPanel();
    const c = await card(`处境 ${HOSTILE}`);
    press(c, "给点提示");
    press(c, "给点提示");
    await c.findByText(`scene ${HOSTILE}`);
    press(c, "看答案");
    await c.findByText(/补注 · AI 写的/);

    expect(document.querySelector("img, script, strong")).toBeNull();
    expect(document.querySelector("mark")).toHaveTextContent(HOSTILE);
    const shown = document.body.textContent;
    for (const part of ["处境", "**提示**", "scene", "before", "text", "gloss"]) expect(shown).toContain(`${part} ${HOSTILE}`);

    // And so is what the user wrote, once it is printed back.
    answerWith(c, HOSTILE);
    expect(await c.findByText(`你写的：${HOSTILE}`)).toBeInTheDocument();
    expect(document.querySelector("img, script, strong")).toBeNull();
  });
});
