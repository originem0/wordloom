import { useEffect, lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { queryClient } from "./lib/query-client";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { Shell } from "./components/layout/Shell";
import { LoginPage } from "./components/auth/LoginPage";
import { StoryStudioPage } from "./components/story/StoryStudioPage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { Toaster } from "./components/ui/sonner";
import { useAppStore } from "./store";
import { applyTheme } from "./lib/theme";

const WordForgePage = lazy(() =>
  import("./components/cards/WordForgePage").then((m) => ({
    default: m.WordForgePage,
  })).catch(() => {
    // After a deploy, old chunk filenames are gone. Reload to get fresh HTML.
    window.location.reload();
    return { default: () => null };
  }),
);

function AppContent() {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for OS-level preference changes when set to "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Shell />}>
          <Route index element={<StoryStudioPage />} />
          <Route
            path="cards"
            element={
              <Suspense
                fallback={
                  <div className="flex items-center justify-center p-12">
                    <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                }
              >
                <WordForgePage />
              </Suspense>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppContent />
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
