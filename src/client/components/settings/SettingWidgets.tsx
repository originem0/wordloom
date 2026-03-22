import type React from "react";
import { ChevronRight, Loader2, Zap } from "lucide-react";

// --- Style constants shared across Settings and AI Providers ---

export const PRIMARY_BUTTON = "bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400";
export const INPUT_CLASS = "h-10 rounded-lg border-border/60 bg-background/80 focus-visible:ring-sky-500/20";
export const SELECT_CLASS = "h-10 w-full rounded-lg border border-border/60 bg-background/80 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20";

// --- Shared UI components ---

type SettingTestResponse = {
  ok: boolean;
  target?: string;
  latencyMs?: number;
  warnings?: string[];
  requestUrl?: string;
  model?: string;
  result?: unknown;
  error?: { message?: string; hint?: string };
  [key: string]: unknown;
};

export type { SettingTestResponse };

export function StatusDot({ res }: { res?: SettingTestResponse }) {
  if (!res) return <span className="inline-block size-2 rounded-full bg-muted-foreground/30" title="untested" />;
  if (res.ok) {
    return (
      <span className="inline-block size-2 rounded-full bg-emerald-500" title={`OK${res.latencyMs ? ` · ${res.latencyMs}ms` : ""}`} />
    );
  }
  const reason = res.error?.message || "failed";
  return (
    <span
      className="inline-block size-2 rounded-full bg-red-500 cursor-help"
      title={reason}
    />
  );
}

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-border/50 pt-6 pb-2">
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">{children}</div>
    </div>
  );
}

export function SettingRow({
  title,
  subtitle,
  value,
  right,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="list-none cursor-pointer py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-open:rotate-90" />
            <div className="min-w-0">
              <div className="text-[14px] font-medium leading-5 text-foreground">{title}</div>
              {subtitle && <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground/60">{subtitle}</div>}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {right}
            {!right && value && <div className="max-w-[200px] truncate text-[12px] text-muted-foreground">{value}</div>}
          </div>
        </div>
      </summary>
      <div className="pt-2 pb-4 ml-[22px]">{children}</div>
    </details>
  );
}

export function RouteTestBtn({
  healthKey,
  testing,
  testingAll,
  onClick,
}: {
  healthKey: string;
  testing: string | null;
  testingAll: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`Test ${healthKey}`}
      disabled={testing === healthKey || testingAll}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="rounded-md p-1 text-muted-foreground/40 hover:text-sky-500 hover:bg-sky-500/10 disabled:opacity-40 transition-colors"
    >
      {testing === healthKey ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Zap className="size-3" />
      )}
    </button>
  );
}
