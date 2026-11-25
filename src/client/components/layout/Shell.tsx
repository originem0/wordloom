import { Link, Outlet, NavLink } from "react-router-dom";
import { Layers, Cpu, MessagesSquare, Quote, Settings, Sun, Moon, LogIn, LogOut, type LucideIcon } from "lucide-react";
import { useAppStore } from "@/client/store";
import { applyTheme } from "@/client/lib/theme";
import { useIsAdmin, useLogout } from "@/client/hooks/useAuth";
import { TaskPanel } from "./TaskPanel";
import { useI18n } from "@/client/lib/i18n";

// A visitor reads cards and nothing else, so the page that configures the
// models is not on their menu (the route itself sits behind AuthGuard), and
// neither are 表达, the admin's home (for a visitor `/` leads to the cards),
// and 对谈, which talks about what is in it.
const navItems: Array<{ to: string; icon: LucideIcon; label: readonly [string, string]; adminOnly?: boolean }> = [
  { to: "/", icon: Quote, label: ["表达", "Expressions"], adminOnly: true },
  { to: "/talk", icon: MessagesSquare, label: ["对谈", "Conversation"], adminOnly: true },
  { to: "/cards", icon: Layers, label: ["词卡", "Cards"] },
  { to: "/providers", icon: Cpu, label: ["AI 配置", "AI"], adminOnly: true },
  { to: "/settings", icon: Settings, label: ["设置", "Settings"] },
];

function ThemeToggle() {
  const { t } = useI18n();
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
      title={t("切换外观", "Change appearance")}
    >
      {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
      <span>{theme === "light" ? t("浅色", "Light") : theme === "dark" ? t("深色", "Dark") : t("跟随系统", "System")}</span>
    </button>
  );
}

export function Shell() {
  const { t } = useI18n();
  const isAdmin = useIsAdmin();
  const handleLogout = useLogout();
  const visibleNav = navItems.filter((item) => isAdmin || !item.adminOnly);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-56 md:border-r md:h-screen md:fixed">
        <div className="px-4 py-5 border-b">
          <h1 className="text-lg font-semibold">WordLoom</h1>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {visibleNav.map(({ to, icon: Icon, label }) => (
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
              {t(...label)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3 space-y-2">
          <ThemeToggle />
          {isAdmin ? (
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-4" />
              {t("退出登录", "Sign out")}
            </button>
          ) : (
            <Link
              to="/login"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <LogIn className="size-4" />
              {t("管理员登录", "Admin sign-in")}
            </Link>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="md:ml-56 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0 min-h-screen">
        <Outlet />
      </main>

      {/* Global task queue panel */}
      <TaskPanel />

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-background border-t flex items-center justify-around md:hidden">
        {visibleNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-1 min-h-11 min-w-11 px-2 text-[11px] transition-colors ${
                isActive ? "text-foreground font-medium" : "text-muted-foreground"
              }`
            }
          >
            <Icon className="size-5" />
            {t(...label)}
          </NavLink>
        ))}

      </nav>
    </div>
  );
}
