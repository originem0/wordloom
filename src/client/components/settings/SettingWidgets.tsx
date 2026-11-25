import type React from "react";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/client/lib/i18n";
import { settingTestError, type SettingTestResponse } from "./setting-test-error";

// --- Style constants shared across Settings and AI Providers ---

export const PRIMARY_BUTTON = "min-h-11";
export const INPUT_CLASS = "h-11 rounded-lg border-border bg-background focus-visible:ring-ring/30";
export const SELECT_CLASS = "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50";

// --- Shared UI components ---

export type { SettingTestResponse };

export function StatusDot({ res }: { res?: SettingTestResponse }) {
  const { t } = useI18n();
  const label = !res ? t("未测试", "Untested") : res.ok ? t("可用", "Ready") : t("失败", "Failed");
  const title = !res ? label : res.ok ? t(`已通过${res.latencyMs ? ` · ${res.latencyMs}ms` : ""}`, `OK${res.latencyMs ? ` · ${res.latencyMs}ms` : ""}`) : t(`失败 · ${settingTestError(res)}`, `Failed · ${settingTestError(res)}`);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title={title}>
      <span aria-hidden="true" className={`inline-block size-2 rounded-full ${!res ? "bg-muted-foreground/50" : res.ok ? "bg-emerald-500" : "bg-red-500"}`} />
      {label}
    </span>
  );
}

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-border/50 pt-6 pb-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{children}</h2>
    </div>
  );
}

export function SettingRow({
  title,
  subtitle,
  value,
  right,
  defaultOpen = false,
  stackOnMobile = false,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  value?: React.ReactNode;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  stackOnMobile?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="min-h-11 list-none cursor-pointer rounded-md py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <div className={stackOnMobile ? "flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4" : "flex items-center justify-between gap-4"}>
          <div className="flex items-center gap-2 min-w-0">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40 transition-transform group-open:rotate-90" />
            <div className="min-w-0">
              <div className="text-[14px] font-medium leading-5 text-foreground">{title}</div>
              {subtitle && <div className="mt-1 text-[13px] leading-5 text-muted-foreground">{subtitle}</div>}
            </div>
          </div>
          <div className={stackOnMobile ? "ml-[22px] flex min-w-0 items-center gap-2 sm:ml-0 sm:max-w-[70%]" : "flex min-w-0 max-w-[60%] items-center gap-2"}>
            {right}
            {!right && value && <div className="max-w-[200px] truncate text-sm text-muted-foreground" title={typeof value === "string" ? value : undefined}>{value}</div>}
          </div>
        </div>
      </summary>
      <div className="pt-2 pb-4 ml-[22px]">{children}</div>
    </details>
  );
}
