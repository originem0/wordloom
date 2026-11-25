// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "..";

beforeEach(() => {
  useAppStore.setState({ theme: "system", uiLanguage: "zh-CN" });
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  useAppStore.setState({ theme: "system", uiLanguage: "zh-CN" });
  window.localStorage.clear();
});

it("restores the chosen language and theme after reloading preferences", async () => {
  useAppStore.getState().setTheme("dark");
  useAppStore.getState().setUiLanguage("en");
  const saved = window.localStorage.getItem("app-store")!;

  useAppStore.setState({ theme: "system", uiLanguage: "zh-CN" });
  window.localStorage.setItem("app-store", saved);
  await useAppStore.persist.rehydrate();

  expect(useAppStore.getState()).toMatchObject({ theme: "dark", uiLanguage: "en" });
  expect(useAppStore.getState().setUiLanguage).toBeTypeOf("function");
});

it("keeps the existing theme when older preferences have no interface language", async () => {
  window.localStorage.setItem("app-store", JSON.stringify({ state: { theme: "dark" }, version: 0 }));
  await useAppStore.persist.rehydrate();
  expect(useAppStore.getState()).toMatchObject({ theme: "dark", uiLanguage: "zh-CN" });
});

it("still changes preferences when browser storage is unavailable", async () => {
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
  expect(() => useAppStore.getState().setUiLanguage("en")).not.toThrow();
  expect(() => useAppStore.getState().setTheme("dark")).not.toThrow();
  await useAppStore.persist.rehydrate();
  expect(useAppStore.getState()).toMatchObject({ theme: "dark", uiLanguage: "en" });
});
