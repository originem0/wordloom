// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryClient } from "@/client/lib/query-client";
import { useTaskStore } from "@/client/store/tasks";
import { Shell } from "../Shell";

vi.mock("../TaskPanel", () => ({ TaskPanel: () => null }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

function renderShell(authenticated: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      new Response(JSON.stringify(url === "/api/auth/me" ? { authenticated } : {}), { status: 200 }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
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
// AuthGuard), so it is not on a visitor's menu. Each entry appears twice: once
// in the sidebar, once in the bottom bar a phone shows instead.
describe("Shell navigation", () => {
  it("shows a visitor the card library and the settings, not the AI page", async () => {
    renderShell(false);
    await authSettled();
    expect(screen.getAllByRole("link", { name: "Cards" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Settings" })).toHaveLength(2);
    expect(screen.queryAllByRole("link", { name: "AI" })).toHaveLength(0);
  });

  it("adds the AI page for the admin", async () => {
    renderShell(true);
    await screen.findByRole("button", { name: "退出登录" });
    expect(screen.getAllByRole("link", { name: "AI" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Cards" })).toHaveLength(2);
  });
});

// Signing out has to take with it what this browser read and followed as the
// admin, or the next person at the screen is shown it from memory.
describe("Shell sign-out", () => {
  function renderSignedIn(logoutStatus: number) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/me") return new Response(JSON.stringify({ authenticated: true }), { status: 200 });
        if (url === "/api/auth/logout") return new Response(JSON.stringify({ ok: logoutStatus === 200 }), { status: logoutStatus });
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
              <Route path="/" element={<p>home</p>} />
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
