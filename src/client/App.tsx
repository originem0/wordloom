import { useEffect, lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { queryClient } from "./lib/query-client";
import { ErrorBoundary } from "./components/layout/ErrorBoundary";
import { Shell } from "./components/layout/Shell";
import { LoginPage } from "./components/auth/LoginPage";
import { AuthGuard } from "./components/auth/AuthGuard";
import { SettingsPage } from "./components/settings/SettingsPage";
import { AIProvidersPage } from "./components/settings/AIProvidersPage";
import { Toaster } from "./components/ui/sonner";
import { HomeSplit } from "./components/expressions/HomeSplit";
import { useAppStore } from "./store";
import { applyTheme } from "./lib/theme";

// After a deploy, old chunk filenames are gone. Reload to get fresh HTML.
const reloadOnMiss = () => {
  window.location.reload();
  return { default: () => <></> };
};

const WordForgePage = lazy(() =>
  import("./components/cards/WordForgePage").then((m) => ({ default: m.WordForgePage })).catch(reloadOnMiss),
);
const ExpressionsPage = lazy(() =>
  import("./components/expressions/ExpressionsPage").then((m) => ({ default: m.ExpressionsPage })).catch(reloadOnMiss),
);
const TalkPage = lazy(() =>
  import("./components/expressions/TalkPage").then((m) => ({ default: m.TalkPage })).catch(reloadOnMiss),
);

const pageFallback = (
  <div className="flex items-center justify-center p-12">
    <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
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
          <Route index element={<HomeSplit><Suspense fallback={pageFallback}><ExpressionsPage /></Suspense></HomeSplit>} />
          <Route path="talk" element={<AuthGuard><Suspense fallback={pageFallback}><TalkPage /></Suspense></AuthGuard>} />
          <Route path="cards" element={<Suspense fallback={pageFallback}><WordForgePage /></Suspense>} />
          <Route path="providers" element={<AuthGuard><AIProvidersPage /></AuthGuard>} />
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
