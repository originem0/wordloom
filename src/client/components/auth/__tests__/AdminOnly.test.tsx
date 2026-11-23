// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminOnly } from "../AdminOnly";

function renderWithMe(me: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(me), { status: ok ? 200 : 500 })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminOnly>
        <button>Delete</button>
      </AdminOnly>
      <span>always</span>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

// The server refuses destructive writes from visitors; a control that can only
// ever answer 401 should not be on their screen.
describe("AdminOnly", () => {
  it("shows its children to a logged-in admin", async () => {
    renderWithMe({ authenticated: true });
    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("hides its children from an anonymous visitor", async () => {
    renderWithMe({ authenticated: false });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("always")).toBeInTheDocument();
  });

  it("hides its children when the auth check itself fails", async () => {
    renderWithMe({ error: "boom" }, false);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
