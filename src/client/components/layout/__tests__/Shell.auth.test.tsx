// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryClient } from "@/client/lib/query-client";
import { useTaskStore } from "@/client/store/tasks";
import { ExpressionsPage } from "@/client/components/expressions/ExpressionsPage";
import { Shell } from "../Shell";

vi.mock("../TaskPanel", () => ({ TaskPanel: () => null }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function renderShell(authenticated: boolean, at = "/") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(url === "/api/auth/me" ? { authenticated } : {}), { status: 200 }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route element={<Shell />}>
            <Route path="*" element={<p>home</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Lets the auth check answer: until it has, everyone is shown the visitor's shell. */
async function authSettled() {
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 20));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.error).mockClear();
  queryClient.clear();
  useTaskStore.setState({ tasks: [] });
});

// Everything but reading cards requires the admin session, so a visitor must
// be offered a way in — not a "log out" button for a session they don't have.
describe("Shell account control", () => {
  it("offers login to an anonymous visitor", async () => {
    renderShell(false);
    const link = await screen.findByRole("link", { name: "管理员登录" });
    expect(link).toHaveAttribute("href", "/login");
    expect(screen.queryByText("退出登录")).toBeNull();
  });

  it("offers logout to the admin", async () => {
    renderShell(true);
    expect(await screen.findByRole("button", { name: "退出登录" })).toBeInTheDocument();
    expect(screen.queryByText("管理员登录")).toBeNull();
  });
});

// The page that configures the models is the admin's (its route sits behind
// AuthGuard), so it is not on a visitor's menu, and neither is 表达, the
// admin's own library. Each entry appears twice: once in the sidebar, once in
// the bottom bar a phone shows instead.
describe("Shell navigation", () => {
  it("shows a visitor the card library and the settings, not the AI page or 表达", async () => {
    renderShell(false);
    await authSettled();
    expect(screen.getAllByRole("link", { name: "Cards" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(2);
    expect(screen.queryAllByRole("link", { name: "AI" })).toHaveLength(0);
    expect(screen.queryAllByRole("link", { name: "表达" })).toHaveLength(0);
  });

  it("adds the AI page for the admin", async () => {
    renderShell(true);
    await screen.findByRole("button", { name: "退出登录" });
    expect(screen.getAllByRole("link", { name: "AI" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Cards" })).toHaveLength(2);
  });

  it("puts 表达 first on the admin's menu, leading home", async () => {
    renderShell(true);
    await screen.findByRole("button", { name: "退出登录" });
    const links = screen.getAllByRole("link", { name: "表达" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/");
      expect(link.parentElement!.firstElementChild).toBe(link);
      expect(link).toHaveAttribute("aria-current", "page");
    }
  });

  // Every path starts with "/": matched as a prefix, 表达 would be lit on every page.
  it("marks 表达 as the current page on the home page only", async () => {
    renderShell(true, "/cards");
    await screen.findByRole("button", { name: "退出登录" });
    for (const link of screen.getAllByRole("link", { name: "表达" })) expect(link).not.toHaveAttribute("aria-current");
    for (const link of screen.getAllByRole("link", { name: "Cards" })) expect(link).toHaveAttribute("aria-current", "page");
  });
});

// Signing out has to take with it what this browser read and followed as the
// admin, or the next person at the screen is shown it from memory.
describe("Shell sign-out", () => {
  const KEPT = {
    id: 5, status: "seen", masked: false, text: "It dawned on me.", focus: null, intent: null, intentBy: null,
    sourceType: null, sourceTitle: null, occurredAt: null, createdAt: 0, updatedAt: 0,
  };
  const NUMBERS = { produced: 1, testableDays: 2, attemptDays: 1, since: 0, judgeAt: 28 * 86_400_000 };

  function renderSignedIn(logoutStatus: number, home = <p>home</p>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/me") return new Response(JSON.stringify({ authenticated: true }), { status: 200 });
        if (url === "/api/auth/logout") return new Response(JSON.stringify({ ok: logoutStatus === 200 }), { status: logoutStatus });
        if (url === "/api/expressions") return new Response(JSON.stringify({ expressions: [KEPT] }), { status: 200 });
        // What the 表达 page reads beside its list, once that has answered.
        if (url === "/api/expressions/stats") return new Response(JSON.stringify(NUMBERS), { status: 200 });
        if (url === "/api/expressions/try") return new Response(JSON.stringify({ items: [] }), { status: 200 });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    queryClient.setQueryData(["settings"], { analysis_language: "en" });
    useTaskStore.setState({ tasks: [{ id: "t-1", label: "生成 1 张单词卡", status: "done", createdAt: 0 }] });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={home} />
            </Route>
            <Route path="/login" element={<p>login page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("forgets what was read and followed under the session", async () => {
    renderSignedIn(200);
    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));

    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(queryClient.getQueryData(["settings"])).toBeUndefined();
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  // The expression library is the most private thing here. Signed out from the
  // page itself, with the list on screen and an entry that had been opened.
  it("leaves no expression behind, and asks for none again", async () => {
    const kept = () => queryClient.getQueryCache().findAll({ queryKey: ["expressions"] });
    queryClient.setQueryData(["expressions", KEPT.id], { ...KEPT, note: "a private note" });
    renderSignedIn(200, <ExpressionsPage />);
    expect(await screen.findByText("It dawned on me.")).toBeInTheDocument();
    expect(queryClient.getQueryData(["expressions"])).toEqual({ expressions: [KEPT] });
    expect(queryClient.getQueryData(["expressions", KEPT.id])).toBeDefined();
    // The numbers follow the list, so they too are on screen and in the cache when the session ends.
    expect(await screen.findByText(/用出过 1 条/)).toBeInTheDocument();
    expect(queryClient.getQueryData(["expressions", "stats"])).toEqual(NUMBERS);

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(await screen.findByText("login page")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(kept()).toEqual([]);
    // Whatever the page read while signed in (试一条 had asked too), the sign-out is the last thing asked.
    const asked = vi.mocked(fetch).mock.calls.map(([url]) => url);
    expect(asked).toContain("/api/expressions/try");
    expect(asked.at(-1)).toBe("/api/auth/logout");
    expect(asked.filter((url) => url === "/api/auth/logout")).toHaveLength(1);
  });

  // The cookie is still valid on the server. Showing the login page would
  // tell the admin they are signed out when they are not.
  it("stays where it is, and says so, when the server could not be told", async () => {
    renderSignedIn(500);
    fireEvent.click(await screen.findByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.queryByText("login page")).toBeNull();
    expect(queryClient.getQueryData(["settings"])).toEqual({ analysis_language: "en" });
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });
});

// The shell is public, so nothing may gate its first paint on the API: a slow
// auth check must not blank the whole app.
describe("Shell first paint", () => {
  it("renders the page without waiting for any API response", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route element={<Shell />}>
              <Route path="/" element={<p>home</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("home")).toBeInTheDocument();
  });
});
