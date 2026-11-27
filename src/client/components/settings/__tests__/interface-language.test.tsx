// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { useAppStore } from "@/client/store";

let isAdmin: boolean;
let saved: Record<string, string>;
let queryError: Error | null;
const save = vi.fn(async (update: { key?: string; value?: string; changes?: { key: string; value: string }[] }) => ({ revision: update.changes ? "rev2" : "rev1" }));
const settingsRead = vi.fn((options?: { enabled?: boolean }) => {
  void options;
  return { data: queryError ? undefined : saved, isLoading: false, error: queryError };
});
vi.mock("@/client/hooks/useAuth", () => ({ useIsAdmin: () => isAdmin, useLogout: () => vi.fn() }));
vi.mock("@/client/hooks/useSettings", () => ({ useSettings: (options?: { enabled?: boolean }) => settingsRead(options), useUpdateSetting: () => ({ mutateAsync: save }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SettingsPage } from "../SettingsPage";
import { AIProvidersPage } from "../AIProvidersPage";
import { StatusDot } from "../SettingWidgets";

beforeEach(() => {
  isAdmin = true;
  saved = { analysis_language: "bilingual" };
  queryError = null;
  sessionStorage.clear();
  useAppStore.setState({ uiLanguage: "zh-CN", theme: "system" });
  save.mockClear();
  settingsRead.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, latencyMs: 12, result: { models: ["gemini-x"] } }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const showSettings = () => render(<SettingsPage />, { wrapper: MemoryRouter });
const switchToEnglish = () => fireEvent.change(screen.getByRole("combobox", { name: "界面语言" }), { target: { value: "en" } });
const setLanguage = (language: "zh-CN" | "en") => act(() => { useAppStore.getState().setUiLanguage(language); });

describe("interface language and AI explanation language", () => {
  it("lets visitors switch immediately without reading or writing private settings", async () => {
    isAdmin = false;
    showSettings();
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "AI 解释语言" })).not.toBeInTheDocument();
    switchToEnglish();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Interface Language" })).toHaveValue("en");
    expect(screen.getByRole("link", { name: "Admin Login" })).toBeInTheDocument();
    expect(settingsRead.mock.calls.every(([options]) => options?.enabled === false)).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const stored = await useAppStore.persist.getOptions().storage!.getItem("app-store");
    expect(stored?.state.uiLanguage).toBe("en");
    expect(JSON.stringify(stored)).not.toContain("analysis_language");
    fireEvent.change(screen.getByRole("combobox", { name: "Interface Language" }), { target: { value: "zh-CN" } });
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
  });

  it("does not change the saved AI preference or create an unsaved server setting", () => {
    showSettings();
    expect(screen.getByRole("combobox", { name: "AI 解释语言" })).toHaveValue("bilingual");
    switchToEnglish();
    expect(screen.getByRole("combobox", { name: "AI Explanation Language" })).toHaveValue("bilingual");
    expect(saved.analysis_language).toBe("bilingual");
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps an unsaved AI preference across a UI switch and saves only server keys", async () => {
    showSettings();
    fireEvent.change(screen.getByRole("combobox", { name: "AI 解释语言" }), { target: { value: "en" } });
    switchToEnglish();
    expect(screen.getByRole("combobox", { name: "AI Explanation Language" })).toHaveValue("en");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Settings saved"));
    expect(save.mock.calls).toEqual([[{ expectedRevision: "", changes: [{ key: "analysis_language", value: "en" }] }]]);
    expect(save.mock.calls.some(([pair]) => /ui.?language/i.test(pair.key ?? ""))).toBe(false);
    expect(useAppStore.getState().uiLanguage).toBe("en");
  });

  it("translates a cached network failure while keeping the public language control usable", () => {
    queryError = new Error("Failed to fetch");
    showSettings();
    expect(screen.getByRole("alert")).toHaveTextContent("网络连接失败，请重试");
    switchToEnglish();
    expect(screen.getByRole("alert")).toHaveTextContent("The network connection failed. Please try again.");
    expect(screen.getByRole("combobox", { name: "Interface Language" })).toBeEnabled();
  });
});

describe("AI provider labels and callbacks", () => {
  it("updates provider and Rime controls without replacing the unsaved draft", async () => {
    saved = { gemini_base_url: "https://old.example", rime_api_key: "configured" };
    render(<AIProvidersPage />);
    expect(screen.getByRole("heading", { name: "AI 配置" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Gemini 基础地址" }), { target: { value: "https://typing.example" } });
    setLanguage("en");
    expect(screen.getByRole("heading", { name: "AI Providers" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rime Voice" })).toHaveValue("astra");
    expect(screen.getByRole("textbox", { name: "Gemini Base URL" })).toHaveValue("https://typing.example");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("AI provider settings saved"));
    expect(save.mock.calls).toEqual([[{ expectedRevision: "", changes: [{ key: "gemini_base_url", value: "https://typing.example" }] }]]);
    expect(save.mock.calls.some(([pair]) => /ui.?language/i.test(pair.key ?? ""))).toBe(false);
    expect(save.mock.calls.some(([pair]) => pair.key === "rime_api_key")).toBe(false);
  });

  it("uses the current language when a model detection finishes after a switch", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<AIProvidersPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "识别并验证" })[0]);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "正在识别…" })).toBeDisabled();
    setLanguage("en");
    expect(screen.getByRole("button", { name: "Detecting…" })).toBeDisabled();
    await act(async () => { finish(new Response(JSON.stringify({ ok: true, result: { models: ["gemini-x"] } }))); });
    expect(toast.success).toHaveBeenCalledWith("1 model verified");
    expect(screen.getByText("1 detected")).toBeInTheDocument();
  });

  it("sends model identifiers and provider keys unchanged while the interface is Chinese", async () => {
    saved = { cards_provider: "openai", cards_openai_model: "deepseek-chat", openai_base_url: "https://gw.example/v1" };
    render(<AIProvidersPage />);
    fireEvent.click(screen.getByTitle("测试表达"));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/settings/test");
    expect(JSON.parse(String(init?.body))).toEqual({ target: "cardsModel", model: "deepseek-chat", provider: "openai", baseUrl: "https://gw.example/v1" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("表达：deepseek-chat 已通过 12ms"));
  });
});

it("refreshes cached test status and API failures when the language changes", () => {
  render(<><StatusDot /><StatusDot res={{ ok: true, latencyMs: 12 }} /><StatusDot res={{ ok: false, error: { message: "Invalid request", status: 400, code: "VALIDATION_ERROR" } }} /></>);
  expect(screen.getByTitle("未测试")).toBeInTheDocument();
  expect(screen.getByTitle("已通过 · 12ms")).toBeInTheDocument();
  expect(screen.getByTitle("失败 · 请检查填写的内容。")).toBeInTheDocument();
  setLanguage("en");
  expect(screen.getByTitle("Untested")).toBeInTheDocument();
  expect(screen.getByTitle("OK · 12ms")).toBeInTheDocument();
  expect(screen.getByTitle("Failed · Please check the entered values.")).toBeInTheDocument();
});
