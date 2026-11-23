// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

type Settings = Record<string, string>;
let current: { data?: Settings; isLoading: boolean; error: null };

vi.mock("@/client/hooks/useSettings", () => ({
  useSettings: () => current,
  useUpdateSetting: () => ({ mutateAsync: vi.fn() }),
}));

import { SettingsPage } from "../SettingsPage";
import { AIProvidersPage } from "../AIProvidersPage";

beforeEach(() => {
  sessionStorage.clear();
  current = { data: undefined, isLoading: true, error: null };
});

// Both pages edit a local draft of the saved settings. The draft is seeded
// from the server exactly once: a background refetch must never overwrite
// what the user is in the middle of typing.
describe("SettingsPage drafts", () => {
  it("shows the saved values once settings arrive", () => {
    const view = render(<SettingsPage />);
    expect(screen.queryByText("Settings")).toBeNull();

    current = { data: { analysis_language: "en" }, isLoading: false, error: null };
    view.rerender(<SettingsPage />);
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("en");
  });

  it("keeps unsaved edits when the settings query refetches", () => {
    current = { data: { analysis_language: "en" }, isLoading: false, error: null };
    const view = render(<SettingsPage />);
    const language = screen.getAllByRole("combobox")[0];
    fireEvent.change(language, { target: { value: "bilingual" } });

    current = { data: { analysis_language: "zh-CN" }, isLoading: false, error: null };
    view.rerender(<SettingsPage />);
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("bilingual");
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
    sessionStorage.setItem("wordloom:ai-gemini-models", JSON.stringify({ models: ["gemini-x", "gemini-y"], ts: 1 }));
    sessionStorage.setItem("wordloom:ai-openai-models", JSON.stringify({ models: ["gpt-z"], ts: 1 }));
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
