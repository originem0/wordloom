// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "../Shell";

vi.mock("../TaskPanel", () => ({ TaskPanel: () => null }));

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

afterEach(() => vi.unstubAllGlobals());

// Deleting and editing now require the admin session, so a visitor must be
// offered a way in — not a "log out" button for a session they don't have.
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

// GET /api/settings is public and can never answer 401, so nothing may gate
// the first paint on it: a slow settings read must not blank the whole app.
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
