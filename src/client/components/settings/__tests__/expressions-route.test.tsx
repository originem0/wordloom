// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { toast } from "sonner";
import { useAppStore } from "@/client/store";

let saved: Record<string, string>;
const save = vi.fn(async (batch: { changes: { key: string; value: string }[]; expectedRevision: string }) => ({ revision: batch.expectedRevision + "-next" }));

vi.mock("@/client/hooks/useSettings", () => ({
  useSettings: () => ({ data: saved, isLoading: false, error: null }),
  useUpdateSetting: () => ({ mutateAsync: save }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { AIProvidersPage } from "../AIProvidersPage";

beforeEach(() => {
  useAppStore.setState({ uiLanguage: "en" });
  sessionStorage.clear();
  save.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, latencyMs: 12 }), { status: 200 })));
});

afterEach(() => vi.unstubAllGlobals());

/** A route's row: what its summary line says it runs on, and the controls inside. */
function row(label: string) {
  const details = screen.getByText(label).closest("details")!;
  return {
    runsOn: within(details.querySelector("summary")!),
    provider: within(details).getByRole("combobox"),
    primaryModel: within(details).getAllByRole("textbox")[0],
    test: within(details).getByTitle(`Test ${label}`),
  };
}

function renderPage(settings: Record<string, string>) {
  saved = { ...settings, _revision: "saved-1" };
  return render(<AIProvidersPage />);
}

async function saveAll() {
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("AI provider settings saved"));
  expect(save).toHaveBeenCalledTimes(1);
  const [batch] = save.mock.calls[0];
  expect(batch.expectedRevision).toBe("saved-1");
  return Object.fromEntries(batch.changes.map((pair) => [pair.key, pair.value]));
}

const CARDS_ON_A_GATEWAY = { cards_provider: "openai", cards_openai_model: "deepseek-chat", openai_base_url: "https://gw.example.com/v1" };

// The gloss of an expression has a route of its own, so that it can be moved
// to another model without moving the cards. Until someone does, it must work
// on the day it ships: whatever it has not been given, it takes from Cards.
describe("the Expressions route", () => {
  it("runs on what the Cards route runs on while it has nothing of its own, and says so", () => {
    renderPage(CARDS_ON_A_GATEWAY);
    const expressions = row("Expressions");
    expect(expressions.runsOn.getByText(/Empty fields inherit the Cards route/)).toBeInTheDocument();
    expect(expressions.provider).toHaveValue("");
    expect(expressions.runsOn.getByText("openai")).toBeInTheDocument();
    expect(expressions.runsOn.getByText("deepseek-chat")).toBeInTheDocument();

    // It follows the Cards row as that is edited, before anything is saved.
    fireEvent.change(row("Cards").provider, { target: { value: "gemini" } });
    expect(row("Expressions").runsOn.getByText("gemini")).toBeInTheDocument();
    expect(row("Expressions").runsOn.getByText("gemini-2.5-flash")).toBeInTheDocument();
  });

  it("preserves inheritance by submitting only edited settings", async () => {
    renderPage(CARDS_ON_A_GATEWAY);
    fireEvent.change(row("Cards").primaryModel, { target: { value: "deepseek-reasoner" } });
    const written = await saveAll();
    expect(written).toEqual({ cards_openai_model: "deepseek-reasoner" });
  });

  // Its calls are made once, inside the request that waits for them: there is
  // no second model to fall back to, so the row must not offer to set one.
  it("has no fallback model to set, and saves none", async () => {
    renderPage(CARDS_ON_A_GATEWAY);
    const details = (label: string) => within(screen.getByText(label).closest("details")!);
    expect(details("Cards").getByText("Fallback Model")).toBeInTheDocument();
    expect(details("Expressions").queryByText("Fallback Model")).toBeNull();
    expect(details("Expressions").getByText(/without a fallback/)).toBeInTheDocument();

    fireEvent.change(row("Cards").primaryModel, { target: { value: "deepseek-reasoner" } });
    const written = await saveAll();
    expect(Object.keys(written).filter((key) => key.startsWith("expressions_")).sort()).toEqual([]);
  });

  it("keeps a provider and a model of its own once they are chosen", async () => {
    renderPage(CARDS_ON_A_GATEWAY);
    fireEvent.change(row("Expressions").provider, { target: { value: "gemini" } });
    fireEvent.change(row("Expressions").primaryModel, { target: { value: "gemini-2.5-pro" } });
    expect(row("Expressions").runsOn.getByText("gemini")).toBeInTheDocument();
    expect(row("Expressions").runsOn.getByText("gemini-2.5-pro")).toBeInTheDocument();
    // The Cards row is not touched by it.
    expect(row("Cards").runsOn.getByText("deepseek-chat")).toBeInTheDocument();

    const written = await saveAll();
    expect(written).toEqual({ expressions_provider: "gemini", expressions_model: "gemini-2.5-pro" });
  });

  // The server has no probe for this route. A cards probe sent with this row's
  // provider and model exercises the same connection and the same model.
  it("is tested as a cards call on the provider and model it resolves to", async () => {
    renderPage(CARDS_ON_A_GATEWAY);
    fireEvent.click(row("Expressions").test);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Expressions: deepseek-chat OK 12ms"));

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/settings/test");
    expect(JSON.parse(String(init?.body))).toEqual({
      target: "cardsModel",
      model: "deepseek-chat",
      provider: "openai",
      baseUrl: "https://gw.example.com/v1",
    });
  });

  it("restores probe status on refresh only for the settings revision that was tested", async () => {
    const first = renderPage(CARDS_ON_A_GATEWAY);
    fireEvent.click(row("Expressions").test);
    await waitFor(() => expect(row("Expressions").runsOn.getByText("Ready")).toBeInTheDocument());
    first.unmount();

    const next = render(<AIProvidersPage />);
    expect(row("Expressions").runsOn.getByText("Ready")).toBeInTheDocument();
    fireEvent.change(row("Cards").primaryModel, { target: { value: "draft-model" } });
    expect(row("Expressions").runsOn.getByText("Untested")).toBeInTheDocument();
    next.unmount();

    saved = { ...saved, _revision: "saved-2" };
    render(<AIProvidersPage />);
    expect(row("Expressions").runsOn.getByText("Untested")).toBeInTheDocument();
  });

  it("keeps a probe of an unsaved provider configuration out of the saved status", async () => {
    const first = renderPage(CARDS_ON_A_GATEWAY);
    fireEvent.change(row("Cards").primaryModel, { target: { value: "draft-model" } });
    fireEvent.click(row("Expressions").test);
    await waitFor(() => expect(row("Expressions").runsOn.getByText("Ready")).toBeInTheDocument());
    first.unmount();

    render(<AIProvidersPage />);
    expect(row("Expressions").runsOn.getByText("deepseek-chat")).toBeInTheDocument();
    expect(row("Expressions").runsOn.getByText("Untested")).toBeInTheDocument();
  });
});
