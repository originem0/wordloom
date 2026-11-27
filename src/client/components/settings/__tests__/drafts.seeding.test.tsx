// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "@/client/store";

type Settings = Record<string, string>;
let current: { data?: Settings; isLoading: boolean; error: Error | null };
let isAdmin: boolean;
const useSettingsMock = vi.fn((options?: { enabled?: boolean }) => {
  void options;
  return current;
});
const logout = vi.fn();

vi.mock("@/client/hooks/useSettings", () => ({
  useSettings: (options?: { enabled?: boolean }) => useSettingsMock(options),
  useUpdateSetting: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/client/hooks/useAuth", () => ({
  useIsAdmin: () => isAdmin,
  useLogout: () => logout,
}));

import { SettingsPage } from "../SettingsPage";
import { AIProvidersPage } from "../AIProvidersPage";

const renderSettings = () => render(<SettingsPage />, { wrapper: MemoryRouter });

beforeEach(() => {
  useAppStore.setState({ uiLanguage: "en" });
  sessionStorage.clear();
  useSettingsMock.mockClear();
  logout.mockClear();
  isAdmin = true;
  current = { data: undefined, isLoading: true, error: null };
});

// Both pages edit a local draft of the saved settings. The draft is seeded
// from the server exactly once: a background refetch must never overwrite
// what the user is in the middle of typing.
describe("SettingsPage drafts", () => {
  it("shows the saved values once settings arrive", () => {
    const view = renderSettings();
    expect(screen.queryByRole("combobox", { name: "AI Explanation Language" })).toBeNull();

    current = { data: { analysis_language: "en" }, isLoading: false, error: null };
    view.rerender(<SettingsPage />);
    expect(screen.getByRole("combobox", { name: "AI Explanation Language" })).toHaveValue("en");
  });

  it("keeps unsaved edits when the settings query refetches", () => {
    current = { data: { analysis_language: "en" }, isLoading: false, error: null };
    const view = renderSettings();
    fireEvent.change(screen.getByRole("combobox", { name: "AI Explanation Language" }), { target: { value: "bilingual" } });

    current = { data: { analysis_language: "zh-CN" }, isLoading: false, error: null };
    view.rerender(<SettingsPage />);
    expect(screen.getByRole("combobox", { name: "AI Explanation Language" })).toHaveValue("bilingual");
  });
});

// The page is public; what the server stores is not, and GET /api/settings
// answers a visitor with 401. So the page neither asks for it nor leaves an
// error where it would have been.
describe("SettingsPage for a visitor", () => {
  beforeEach(() => {
    isAdmin = false;
    current = { data: undefined, isLoading: false, error: null };
  });

  it("shows what lives in the browser and asks the server for nothing", () => {
    renderSettings();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("App Refresh & Cache")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.queryByText("AI Explanation Language")).toBeNull();
    expect(screen.queryByText("Network Tolerance")).toBeNull();

    // Leaving the option out would mean "enabled", so every call must say no.
    const asked = new Set(useSettingsMock.mock.calls.map(([options]) => options?.enabled));
    expect(asked).toEqual(new Set([false]));
  });

  // Settings read under a session that has since expired are still in memory.
  it("keeps the server's settings off the page even when they are cached", () => {
    current = { data: { analysis_language: "en" }, isLoading: false, error: null };
    renderSettings();
    expect(screen.queryByRole("combobox", { name: "AI Explanation Language" })).toBeNull();
    expect(screen.queryByText("Network Tolerance")).toBeNull();
  });

  it("offers the way in, and the way back to this page", () => {
    renderSettings();
    expect(screen.getByRole("link", { name: "Admin Login" })).toHaveAttribute("href", "/login?redirect=/settings");
    expect(screen.queryByRole("button", { name: "Sign Out" })).toBeNull();
  });
});

describe("SettingsPage for the admin", () => {
  it("asks for the settings", () => {
    renderSettings();
    expect(useSettingsMock).toHaveBeenLastCalledWith({ enabled: true });
  });

  it("offers the way out", () => {
    renderSettings();
    expect(screen.queryByRole("link", { name: "Admin Login" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  // What the server applies while nothing is stored. A page showing other
  // numbers would be describing a server that does not exist.
  it("shows the server's defaults for what was never saved", () => {
    current = { data: {}, isLoading: false, error: null };
    renderSettings();
    expect(screen.getByText("60000ms · 3 retries")).toBeInTheDocument();
  });

  it("keeps the rest of the page when the settings cannot be read", () => {
    current = { data: undefined, isLoading: false, error: new Error("boom") };
    renderSettings();
    expect(screen.getByText("Failed to load settings: boom")).toBeInTheDocument();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
    expect(screen.queryByText("Network Tolerance")).toBeNull();
  });
});

describe("AIProvidersPage drafts", () => {
  const saved = { gemini_base_url: "https://relay.example.com", openai_base_url: "https://gw.example.com/v1" };

  it("shows the saved values once settings arrive", () => {
    const view = render(<AIProvidersPage />);
    expect(screen.queryByDisplayValue(saved.gemini_base_url)).toBeNull();

    current = { data: saved, isLoading: false, error: null };
    view.rerender(<AIProvidersPage />);
    expect(screen.getByDisplayValue(saved.gemini_base_url)).toBeInTheDocument();
    expect(screen.getByDisplayValue(saved.openai_base_url)).toBeInTheDocument();
  });

  it("keeps unsaved edits when the settings query refetches", () => {
    current = { data: saved, isLoading: false, error: null };
    const view = render(<AIProvidersPage />);
    fireEvent.change(screen.getByDisplayValue(saved.gemini_base_url), { target: { value: "https://typing.example" } });

    current = { data: { ...saved, gemini_base_url: "https://other.example" }, isLoading: false, error: null };
    view.rerender(<AIProvidersPage />);
    expect(screen.getByDisplayValue("https://typing.example")).toBeInTheDocument();
  });

  it("restores the detected model lists cached for this browser session", () => {
    sessionStorage.setItem("wordloom:ai-gemini-models", JSON.stringify({ models: ["gemini-x", "gemini-y"], baseUrl: saved.gemini_base_url, revision: "" }));
    sessionStorage.setItem("wordloom:ai-openai-models", JSON.stringify({ models: ["gpt-z"], baseUrl: saved.openai_base_url, revision: "" }));
    current = { data: saved, isLoading: false, error: null };
    render(<AIProvidersPage />);
    expect(screen.getByText("2 detected")).toBeInTheDocument();
    expect(screen.getByText("1 detected")).toBeInTheDocument();
  });

  it("ignores a corrupt model cache", () => {
    sessionStorage.setItem("wordloom:ai-gemini-models", "{not json");
    current = { data: saved, isLoading: false, error: null };
    render(<AIProvidersPage />);
    expect(screen.getAllByText("0 detected")).toHaveLength(2);
  });
});
