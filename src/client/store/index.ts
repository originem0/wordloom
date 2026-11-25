import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type UiLanguage = "zh-CN" | "en";

interface AppStore {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  uiLanguage: UiLanguage;
  setUiLanguage: (language: UiLanguage) => void;
}

type AppPreferences = Pick<AppStore, "theme" | "uiLanguage">;

// Storage can be blocked or full; preferences must still work in memory.
// Read window explicitly because Node's localStorage can shadow jsdom's.
const preferenceStorage = {
  getItem(name: string) {
    try { return window.localStorage.getItem(name); } catch { return null; }
  },
  setItem(name: string, value: string) {
    try { window.localStorage.setItem(name, value); } catch { /* best effort */ }
  },
  removeItem(name: string) {
    try { window.localStorage.removeItem(name); } catch { /* best effort */ }
  },
};

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
      // Interface language is a public browser preference. The private
      // analysis_language setting still controls newly generated explanations.
      uiLanguage: "zh-CN",
      setUiLanguage: (uiLanguage) => set({ uiLanguage }),
    }),
    {
      name: "app-store",
      storage: createJSONStorage<AppPreferences>(() => preferenceStorage),
      partialize: ({ theme, uiLanguage }) => ({ theme, uiLanguage }),
    },
  ),
);
