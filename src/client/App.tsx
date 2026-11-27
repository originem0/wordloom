import { useEffect, lazy, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider, Routes, Route, Navigate, useRouteError } from "react-router-dom";
import { queryClient } from "./lib/query-client";
import { ErrorBoundary, FailureView } from "./components/layout/ErrorBoundary";
import { Shell } from "./components/layout/Shell";
import { LoginPage } from "./components/auth/LoginPage";
import { AuthGuard } from "./components/auth/AuthGuard";
import { SettingsPage } from "./components/settings/SettingsPage";
import { AIProvidersPage } from "./components/settings/AIProvidersPage";
import { Toaster } from "./components/ui/sonner";
import { HomeSplit } from "./components/expressions/HomeSplit";
import { useAppStore } from "./store";
import { useSessionEvents } from "./hooks/useAuth";
import { applyTheme } from "./lib/theme";

// A failed import is handled by the recoverable error boundary.
const WordForgePage = lazy(() =>
  import("./components/cards/WordForgePage").then((m) => ({ default: m.WordForgePage })),
);
const ExpressionsPage = lazy(() =>
  import("./components/expressions/ExpressionsPage").then((m) => ({ default: m.ExpressionsPage })),
);
const TalkPage = lazy(() =>
  import("./components/expressions/TalkPage").then((m) => ({ default: m.TalkPage })),
);

const pageFallback = (
  <div className="flex items-center justify-center p-12">
    <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

function AppContent() {
  useSessionEvents();
  const theme = useAppStore((s) => s.theme);
  const uiLanguage = useAppStore((s) => s.uiLanguage);

  useEffect(() => {
    document.documentElement.lang = uiLanguage;
  }, [uiLanguage]);

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
  );
}

function RouteFailure() {
  const error = useRouteError();
  // React.lazy caches a rejected import. An explicit retry must load a fresh document.
  return <FailureView error={error instanceof Error ? error : null} retry={() => window.location.reload()} />;
}

const router = createBrowserRouter([{ path: "*", element: <AppContent />, errorElement: <RouteFailure /> }]);

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
