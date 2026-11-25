import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  LogIn,
  LogOut,
  Moon,
  Monitor,
  RefreshCcw,
  Sparkles,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useIsAdmin, useLogout } from "@/client/hooks/useAuth";
import { useSettings, useUpdateSetting } from "@/client/hooks/useSettings";
import { useAppStore } from "@/client/store";
import { applyTheme } from "@/client/lib/theme";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import {
  SectionHeader,
  SettingRow,
  PRIMARY_BUTTON,
  SELECT_CLASS,
  INPUT_CLASS,
} from "./SettingWidgets";
import { Input } from "@/client/components/ui/input";
import { DEFAULT_API_MAX_RETRIES, DEFAULT_API_TIMEOUT_MS } from "@/shared/defaults";
import { DRAFT_SETTING_KEY } from "@/shared/expressions";

type Theme = "light" | "dark" | "system";

const DEFAULTS: Record<string, string> = {
  analysis_language: "zh-CN",
  api_timeout_ms: String(DEFAULT_API_TIMEOUT_MS),
  api_max_retries: String(DEFAULT_API_MAX_RETRIES),
  [DRAFT_SETTING_KEY]: "",
};

export function SettingsPage() {
  const { language, t } = useI18n();
  // The page is public: the theme and the cache controls live in the browser.
  // What the server stores is the admin's to read as well as to change, so it
  // is only asked for, and only shown, to an admin.
  const isAdmin = useIsAdmin();
  const logout = useLogout();
  const settingsQuery = useSettings({ enabled: isAdmin });
  const updateSetting = useUpdateSetting();
  const settings = settingsQuery.data;

  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const setUiLanguage = useAppStore((s) => s.setUiLanguage);

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
      toast.success(t("设置已保存", "Settings saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [drafts, updateSetting, t]);

  const clearLocalCache = useCallback(async () => {
    setMaintenanceBusy(true);
    try {
      localStorage.removeItem("app-store");
      sessionStorage.clear();
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      toast.success(t("本地缓存已清理，正在刷新…", "Local cache cleared. Reloading…"));
      window.location.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setMaintenanceBusy(false);
    }
  }, [t]);

  const refreshPwa = useCallback(async () => {
    setMaintenanceBusy(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update()));
      }
      toast.success(t("正在检查应用更新…", "Checking for app update…"));
      window.location.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setMaintenanceBusy(false);
    }
  }, [t]);

  // Where the admin's part of the page stands. Loading and failing stay inside
  // that part: the rest of the page does not depend on the server.
  const serverSettings = !isAdmin
    ? "hidden"
    : settingsQuery.error
      ? "error"
      : initialized
        ? "ready"
        : "loading";

  const saveTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  const textField = (key: string, label: string, placeholder: string) => (
    <div className="space-y-1.5">
      <div className="text-[13px] font-medium text-foreground">{label}</div>
      <Input
        aria-label={label}
        value={draftValue(key)}
        onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        className={`${INPUT_CLASS} font-mono text-sm`}
      />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 md:px-6">
      <h1 className="text-2xl font-semibold text-foreground">{t("设置", "Settings")}</h1>

      {/* ══════════ LANGUAGE ══════════ */}
      <SectionHeader>{t("语言", "Language")}</SectionHeader>
      <SettingRow
        title={t("界面语言", "Interface Language")}
        subtitle={t("只改变本浏览器的界面文字，立即生效。", "Changes interface text in this browser immediately.")}
        value={language === "en" ? t("英语", "English") : t("简体中文", "Simplified Chinese")} defaultOpen
      >
        <select
          aria-label={t("界面语言", "Interface Language")} className={SELECT_CLASS} value={language}
          onChange={(e) => setUiLanguage(e.target.value === "en" ? "en" : "zh-CN")}
        >
          <option value="zh-CN">{t("简体中文", "Simplified Chinese")}</option><option value="en">{t("英语", "English")}</option>
        </select>
      </SettingRow>

      {serverSettings === "loading" && (
        <div className="py-3" role="status" aria-label={t("正在加载 AI 设置", "Loading AI settings")}>
          <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {serverSettings === "error" && (
        <div className="py-3 text-sm text-destructive" role="alert">
          {t("设置加载失败", "Failed to load settings")}: {errorMessage(settingsQuery.error)}
        </div>
      )}

      {serverSettings === "ready" && (
        <SettingRow
          title={t("AI 解释语言", "AI Explanation Language")}
          subtitle={t("控制新生成词卡的词义、词源和深度分析文字，不改变界面语言。", "Controls definitions, etymology and deep analysis in new cards. It does not change the interface language.")}
          value={draftValue("analysis_language") === "en" ? t("英语", "English") : draftValue("analysis_language") === "bilingual" ? t("中英双语", "Bilingual") : t("简体中文", "Simplified Chinese")}
          defaultOpen
        >
          <select
            aria-label={t("AI 解释语言", "AI Explanation Language")}
            className={SELECT_CLASS}
            value={draftValue("analysis_language")}
            onChange={(e) => setDrafts((prev) => ({ ...prev, analysis_language: e.target.value }))}
          >
            <option value="zh-CN">{t("简体中文", "Simplified Chinese")}</option>
            <option value="en">{t("英语", "English")}</option>
            <option value="bilingual">{t("中英双语", "Bilingual")}</option>
          </select>
        </SettingRow>
      )}

      {/* ══════════ APPEARANCE & APP ══════════ */}
      <SectionHeader>{t("外观与应用", "Appearance & App")}</SectionHeader>

      <SettingRow title={t("主题", "Theme")} value={theme === "light" ? t("浅色", "Light") : theme === "dark" ? t("Solarized 深色", "Solarized Dark") : t("跟随系统", "System")} defaultOpen>
        <div className="flex flex-wrap gap-2">
          {[
            { value: "light", label: t("浅色", "Light"), icon: Sun },
            { value: "dark", label: t("Solarized 深色", "Solarized Dark"), icon: Moon },
            { value: "system", label: t("跟随系统", "System"), icon: Monitor },
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

      <SettingRow title={t("应用刷新与缓存", "App Refresh & Cache")} value={t("维护", "maintenance")}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={refreshPwa} disabled={maintenanceBusy}>
            {maintenanceBusy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
            {t("强制刷新", "Force Refresh")}
          </Button>
          <Button size="sm" variant="outline" onClick={clearLocalCache} disabled={maintenanceBusy}>
            {maintenanceBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {t("清理缓存", "Clear Cache")}
          </Button>
        </div>
      </SettingRow>

      {serverSettings === "ready" && (
        <SettingRow
          title={t("网络容错", "Network Tolerance")}
          value={t(`${draftValue("api_timeout_ms")}ms · ${draftValue("api_max_retries")} 次重试`, `${draftValue("api_timeout_ms")}ms · ${draftValue("api_max_retries")} retries`)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {textField("api_timeout_ms", t("API 超时（毫秒）", "API timeout (ms)"), DEFAULTS.api_timeout_ms)}
            {textField("api_max_retries", t("最多重试次数", "Max retries"), DEFAULTS.api_max_retries)}
          </div>
        </SettingRow>
      )}

      {/* 帮我起草 on the 表达 page opens by itself under the rule below. Checked, it is on whatever the rule says; "" leaves it to the rule. */}
      {serverSettings === "ready" && (
        <SettingRow
          title={t("表达：帮我起草", "Expressions: Draft for me")}
          subtitle={t("在提示句旁放一个按钮，填进 AI 写的那句意思。库满两周、「见过」不少于 20 条而「想用」不到 5 条时会自己打开", "Adds a button to draft an intent with AI. It opens automatically after two weeks when the library has at least 20 Seen entries and fewer than 5 To use entries.")}
          value={draftValue(DRAFT_SETTING_KEY) === "1" ? t("开", "On") : t("按规则", "Automatic")}
        >
          <label className="flex items-center gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={draftValue(DRAFT_SETTING_KEY) === "1"}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [DRAFT_SETTING_KEY]: e.target.checked ? "1" : "" }))}
            />
            {t("现在就打开「帮我起草」", "Enable Draft for me now")}
          </label>
        </SettingRow>
      )}

      {/* ══════════ ACCOUNT ══════════ */}
      {/* On a phone this row is the only way in or out: the sidebar that
          carries the same two actions is not shown there. */}
      <SectionHeader>{t("账号", "Account")}</SectionHeader>
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium leading-5 text-foreground">{t("管理员", "Admin")}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-muted-foreground/60">
            {isAdmin ? t("已登录，可以生成词卡、调整 AI 配置", "Signed in. You can generate cards and configure AI.") : t("生成词卡、调整 AI 配置需要登录", "Sign in to generate cards and configure AI.")}
          </div>
        </div>
        {isAdmin ? (
          <Button size="sm" variant="outline" className="shrink-0" onClick={logout}>
            <LogOut className="size-3.5" />
            {t("退出登录", "Sign Out")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="shrink-0" asChild>
            <Link to="/login?redirect=/settings">
              <LogIn className="size-3.5" />
              {t("管理员登录", "Admin Login")}
            </Link>
          </Button>
        )}
      </div>

      {/* ══════════ ABOUT ══════════ */}
      <SectionHeader>{t("关于", "About")}</SectionHeader>
      <div className="space-y-2 py-3 text-[13px] leading-6 text-muted-foreground/80">
        <p>
          <span className="font-medium text-foreground">WordLoom</span>{" "}
          {t("是一座公开可读的英语词卡库。", "is a public library of English word cards.")}
        </p>
        <p>
          <span className="font-medium text-foreground">Word Forge</span>{" "}
          {t("查词与造卡合一，包含音标、词源、认知意象和边界测试。", "combines search and card creation, with pronunciation, etymology, mental imagery and boundary tests.")}
        </p>
        <p className="text-muted-foreground/60">
          {t("搜索和浏览对所有人开放；生成新卡、从文本抽词需要管理员登录。", "Search and browsing are open to everyone. Generating cards and extracting words require administrator access.")}
        </p>
      </div>

      {/* ── Sticky bottom save bar ── */}
      {serverSettings === "ready" && dirtyKeys.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <span className="text-[12px] text-muted-foreground">{t(`${dirtyKeys.length} 项未保存的修改`, `${dirtyKeys.length} unsaved change${dirtyKeys.length > 1 ? "s" : ""}`)}</span>
            <Button className={PRIMARY_BUTTON} onClick={saveAll} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t("保存修改", "Save Changes")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
