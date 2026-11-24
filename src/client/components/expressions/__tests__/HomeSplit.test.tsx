// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AUTH_QUERY_KEY } from "@/client/hooks/useAuth";
import { HomeSplit } from "../HomeSplit";
import { ExpressionsPage } from "../ExpressionsPage";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/** Every page that was on screen at some point, in order: a bounce through the wrong one must show. */
let visited: string[];
/** Lets a test decide when, and what, the auth check answers. */
let answerAuth: (response: Response) => void;

function Visit({ page }: { page: string }) {
  useEffect(() => {
    visited.push(page);
  }, [page]);
  return <p>{page}</p>;
}

const requested = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));
const me = (authenticated: boolean) => new Response(JSON.stringify({ authenticated }), { status: 200 });

beforeEach(() => {
  visited = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url === "/api/auth/me"
        ? new Promise<Response>((resolve) => (answerAuth = resolve))
        : Promise.resolve(new Response(JSON.stringify({ expressions: [] }), { status: 200 })),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

/** The app's own freshness window: a second reader of an answer just given does not ask again. */
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });

function renderHome(client = newClient(), home = <Visit page="the admin's home" />) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomeSplit>{home}</HomeSplit>} />
          <Route path="/cards" element={<Visit page="the cards" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const authAsked = () => waitFor(() => expect(requested()).toContain("/api/auth/me"));

// useIsAdmin() is false while the check is in flight. Splitting on it would
// send the admin to the cards on every hard refresh.
describe("the home split", () => {
  it("shows neither page until the auth check has answered, then keeps the admin on /", async () => {
    renderHome();
    await authAsked();
    await new Promise((r) => setTimeout(r, 20));
    expect(visited).toEqual([]);

    answerAuth(me(true));
    expect(await screen.findByText("the admin's home")).toBeInTheDocument();
    expect(visited).toEqual(["the admin's home"]);
  });

  it("sends a visitor to the cards", async () => {
    renderHome();
    await authAsked();
    answerAuth(me(false));
    expect(await screen.findByText("the cards")).toBeInTheDocument();
    expect(visited).toEqual(["the cards"]);
  });

  it("counts a check that failed as a visitor", async () => {
    renderHome();
    await authAsked();
    answerAuth(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    expect(await screen.findByText("the cards")).toBeInTheDocument();
  });

  // LoginPage invalidates the auth query and goes to `/`. Nothing was watching
  // the query on the login page, so the cache still says "visitor" on arrival.
  it("does not act on the visitor's answer that is still cached right after login", async () => {
    const client = newClient();
    client.setQueryData(AUTH_QUERY_KEY, { authenticated: false });
    await client.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    renderHome(client);
    await authAsked();
    await new Promise((r) => setTimeout(r, 20));
    expect(visited).toEqual([]);

    answerAuth(me(true));
    expect(await screen.findByText("the admin's home")).toBeInTheDocument();
    expect(visited).toEqual(["the admin's home"]);
  });

  it("goes by a fresh cached answer without asking again", async () => {
    const client = newClient();
    client.setQueryData(AUTH_QUERY_KEY, { authenticated: false });
    renderHome(client);
    expect(await screen.findByText("the cards")).toBeInTheDocument();
    expect(requested()).toEqual([]);
  });
});

// Acceptance: a visitor's network panel shows no expression data. The page is
// the real one here, so anything it would ask for on mounting would show.
describe("a visitor at /", () => {
  it("lands on the cards without one request to the expressions API", async () => {
    renderHome(undefined, <ExpressionsPage />);
    await authAsked();
    answerAuth(me(false));
    expect(await screen.findByText("the cards")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(requested()).toEqual(["/api/auth/me"]);
  });

  it("is where the admin gets the page and its list", async () => {
    renderHome(undefined, <ExpressionsPage />);
    await authAsked();
    answerAuth(me(true));
    expect(await screen.findByText("还没有收下任何表达。")).toBeInTheDocument();
    expect(requested()).toEqual(["/api/auth/me", "/api/expressions"]);
  });
});
