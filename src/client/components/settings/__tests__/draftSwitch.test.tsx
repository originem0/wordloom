// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { DRAFT_SETTING_KEY } from "@/shared/expressions";
import { useAppStore } from "@/client/store";

let saved: Record<string, string>;
let isAdmin: boolean;
const mutateAsync = vi.fn(async (change: { key: string; value: string }) => {
  void change;
  return { ok: true };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/client/hooks/useSettings", () => ({
  useSettings: () => ({ data: saved, isLoading: false, error: null }),
  useUpdateSetting: () => ({ mutateAsync }),
}));
vi.mock("@/client/hooks/useAuth", () => ({ useIsAdmin: () => isAdmin, useLogout: () => vi.fn() }));

import { SettingsPage } from "../SettingsPage";

const renderSettings = () => render(<SettingsPage />, { wrapper: MemoryRouter });
const draftSwitch = () => screen.getByRole("checkbox", { name: /帮我起草/ });
const written = () => mutateAsync.mock.calls.map(([change]) => change).filter((change) => change.key === DRAFT_SETTING_KEY);

beforeEach(() => {
  useAppStore.setState({ uiLanguage: "zh-CN" });
  mutateAsync.mockClear();
  isAdmin = true;
  saved = {};
});

// 帮我起草 on the 表达 page is built and switched off. It opens by itself
// under a rule written down before launch; this row is the user's own way to
// open it sooner, and it says what the rule is.
describe("the switch for 帮我起草", () => {
  it("is off until it is switched on, and says when it opens by itself", () => {
    renderSettings();
    expect(screen.getByText("表达：帮我起草")).toBeInTheDocument();
    expect(screen.getByText(/满两周.*见过.*20.*想用.*5.*自己打开/)).toBeInTheDocument();
    expect(draftSwitch()).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "保存修改" })).toBeNull();
  });

  it('writes "1" through the page\'s own save', async () => {
    renderSettings();
    fireEvent.click(draftSwitch());
    expect(screen.getByText("1 项未保存的修改")).toBeInTheDocument();
    expect(written()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(written()).toEqual([{ key: DRAFT_SETTING_KEY, value: "1" }]));
  });

  it("shows what was saved, and writes an empty value to hand it back to the rule", async () => {
    saved = { [DRAFT_SETTING_KEY]: "1" };
    renderSettings();
    expect(draftSwitch()).toBeChecked();

    fireEvent.click(draftSwitch());
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(written()).toEqual([{ key: DRAFT_SETTING_KEY, value: "" }]));
  });

  // The 表达 page takes "1" and nothing else for on. A box ticked for any other value would show a switch that is not on.
  it("is off for a stored value that is not the one the page reads as on", () => {
    saved = { [DRAFT_SETTING_KEY]: "true" };
    renderSettings();
    expect(draftSwitch()).not.toBeChecked();
  });

  it("is not there for a visitor", () => {
    isAdmin = false;
    renderSettings();
    expect(screen.queryByText("表达：帮我起草")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
