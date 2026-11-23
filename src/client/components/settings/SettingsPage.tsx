import { useCallback, useMemo, useState } from "react";
import {
  Loader2,
  Moon,
  Monitor,
  RefreshCcw,
  Sparkles,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useSettings, useUpdateSetting } from "@/client/hooks/useSettings";
import { useAppStore } from "@/client/store";
import { applyTheme } from "@/client/lib/theme";
import {
  SectionHeader,
  SettingRow,
  PRIMARY_BUTTON,
  SELECT_CLASS,
  INPUT_CLASS,
} from "./SettingWidgets";
import { Input } from "@/client/components/ui/input";

type Theme = "light" | "dark" | "system";

const DEFAULTS: Record<string, string> = {
  analysis_language: "zh-CN",
  api_timeout_ms: "45000",
  api_max_retries: "3",
};

export function SettingsPage() {
  const settingsQuery = useSettings();
  const updateSetting = useUpdateSetting();
  const settings = settingsQuery.data;

  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [drafts, setDrafts] = useState<Record<string, string>>({ ...DEFAULTS });
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);

  // Seed the drafts from the saved settings once, the first render they are
  // available. Done during render (not in an effect) so the form never paints
  // with defaults first; `initialized` keeps later refetches from overwriting
  // what the user is typing.
  if (settings && !initialized) {
    const d: Record<string, string> = {};
    for (const [k, v] of Object.entries(DEFAULTS)) {
      d[k] = settings[k] ?? v;
    }
    setDrafts(d);
    setInitialized(true);
  }

  const draftValue = useCallback((key: string) => drafts[key] ?? "", [drafts]);

  const savedValue = useCallback(
    (key: string) => settings?.[key] ?? DEFAULTS[key] ?? "",
    [settings],
  );

  const dirtyKeys = useMemo(() => {
    if (!initialized) return [] as string[];
    return Object.keys(DEFAULTS).filter((key) => draftValue(key) !== savedValue(key));
  }, [draftValue, initialized, savedValue]);

  const saveAll = useCallback(async () => {
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(drafts)) {
        await updateSetting.mutateAsync({ key, value: value.trim() });
      }
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [drafts, updateSetting]);

  const clearLocalCache = useCallback(async () => {
    setMaintenanceBusy(true);
    try {
      localStorage.removeItem("app-store");
      sessionStorage.clear();
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      toast.success("Local cache cleared. Reloading…");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMaintenanceBusy(false);
    }
  }, []);

  const refreshPwa = useCallback(async () => {
    setMaintenanceBusy(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update()));
      }
      toast.success("Checking for app update…");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMaintenanceBusy(false);
    }
  }, []);

  if (settingsQuery.isLoading && !initialized) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (settingsQuery.error) {
    return <div className="p-6 text-destructive">Failed to load settings: {settingsQuery.error.message}</div>;
  }

  const saveTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  const textField = (key: string, label: string, placeholder: string) => (
    <div className="space-y-1.5">
      <div className="text-[13px] font-medium text-foreground">{label}</div>
      <Input
        value={draftValue(key)}
        onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        className={`${INPUT_CLASS} font-mono text-sm`}
      />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 md:px-6">
      <h1 className="text-xl font-semibold text-foreground">Settings</h1>

      {/* ══════════ LANGUAGE ══════════ */}
      <SectionHeader>Language</SectionHeader>

      <SettingRow
        title="Explanation Language"
        subtitle="词义解释、词源、深度分析等说明性文本"
        value={draftValue("analysis_language")}
        defaultOpen
      >
        <select
          className={SELECT_CLASS}
          value={draftValue("analysis_language")}
          onChange={(e) => setDrafts((prev) => ({ ...prev, analysis_language: e.target.value }))}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
          <option value="bilingual">Bilingual</option>
        </select>
      </SettingRow>

      {/* ══════════ APPEARANCE & APP ══════════ */}
      <SectionHeader>Appearance & App</SectionHeader>

      <SettingRow title="Theme" value={theme} defaultOpen>
        <div className="flex flex-wrap gap-2">
          {[
            { value: "light", label: "Light", icon: Sun },
            { value: "dark", label: "Solarized Dark", icon: Moon },
            { value: "system", label: "System", icon: Monitor },
          ].map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              size="sm"
              onClick={() => saveTheme(value as Theme)}
              className={theme === value ? PRIMARY_BUTTON : ""}
            >
              <Icon className="size-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </SettingRow>

      <SettingRow title="App Refresh & Cache" value="maintenance">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={refreshPwa} disabled={maintenanceBusy}>
            {maintenanceBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            Force Refresh
          </Button>
          <Button size="sm" variant="outline" onClick={clearLocalCache} disabled={maintenanceBusy}>
            {maintenanceBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Clear Cache
          </Button>
        </div>
      </SettingRow>

      <SettingRow
        title="Network Tolerance"
        value={`${draftValue("api_timeout_ms")}ms · ${draftValue("api_max_retries")} retries`}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {textField("api_timeout_ms", "API timeout (ms)", DEFAULTS.api_timeout_ms)}
          {textField("api_max_retries", "Max retries", DEFAULTS.api_max_retries)}
        </div>
      </SettingRow>

      {/* ══════════ ABOUT ══════════ */}
      <SectionHeader>About</SectionHeader>
      <div className="space-y-2 py-3 text-[13px] leading-6 text-muted-foreground/80">
        <p>
          <span className="font-medium text-foreground">WordLoom</span> ——
          一座公开可读的英语词卡库。
        </p>
        <p>
          <span className="font-medium text-foreground">Word Forge</span>：
          查/造合一的词卡工坊。分层卡片含音标、词源、认知意象与边界测试。
        </p>
        <p className="text-muted-foreground/60">
          搜索和浏览对所有人开放；生成新卡、从文本抽词需要管理员登录。
        </p>
      </div>

      {/* ── Sticky bottom save bar ── */}
      {dirtyKeys.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <span className="text-[12px] text-muted-foreground">{dirtyKeys.length} unsaved change{dirtyKeys.length > 1 ? "s" : ""}</span>
            <Button className={PRIMARY_BUTTON} onClick={saveAll} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
