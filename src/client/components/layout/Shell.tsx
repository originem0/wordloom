import { useEffect } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Layers, Settings, Sun, Moon } from "lucide-react";
import { apiFetch } from "@/client/lib/api";
import { useAppStore } from "@/client/store";
import { applyTheme } from "@/client/lib/theme";
import { TaskPanel } from "./TaskPanel";

const navItems = [
  { to: "/", icon: BookOpen, label: "Story" },
  { to: "/cards", icon: Layers, label: "Cards" },
  { to: "/settings", icon: Settings, label: "Settings" },
] as const;

function ThemeToggle() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  function cycle() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <button
      onClick={cycle}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title={`Theme: ${theme}`}
    >
      {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
      <span className="capitalize">{theme}</span>
    </button>
  );
}

export function Shell() {
  const navigate = useNavigate();

  // Auth guard: probe a protected endpoint
  const { error, isLoading } = useQuery({
    queryKey: ["auth-check"],
    queryFn: () => apiFetch("/api/settings"),
    retry: false,
  });

  useEffect(() => {
    if (error && (error as any).status === 401) {
      navigate("/login", { replace: true });
    }
  }, [error, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-56 md:border-r md:h-screen md:fixed">
        <div className="px-4 py-5 border-b">
          <h1 className="text-lg font-semibold">WordLoom</h1>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">
          <ThemeToggle />
        </div>
      </aside>

      {/* Main content */}
      <main className="md:ml-56 pb-16 md:pb-0 min-h-screen">
        <Outlet />
      </main>

      {/* Global task queue panel */}
      <TaskPanel />

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-background border-t flex items-center justify-around md:hidden">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 px-3 text-xs transition-colors ${
                isActive ? "text-foreground font-medium" : "text-muted-foreground"
              }`
            }
          >
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
