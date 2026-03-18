import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Key,
  Volume2,
  Sun,
  Moon,
  Monitor,
  Info,
  Loader2,
  Globe,
  Cpu,
  PlayCircle,
  ShieldCheck,
  RefreshCcw,
  Wrench,
  Database,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/client/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Badge } from "@/client/components/ui/badge";
import { useSettings, useUpdateSetting } from "@/client/hooks/useSettings";
import { useAppStore } from "@/client/store";
import { applyTheme } from "@/client/lib/theme";

type Theme = "light" | "dark" | "system";

type SettingTestTarget =
  | "apiKey"
  | "baseUrl"
  | "listModels"
  | "storyModel"
  | "generalModel"
  | "ttsModel";

type SettingTestResponse = {
  ok: boolean;
  target?: SettingTestTarget;
  latencyMs?: number;
  warnings?: string[];
  request?: {
    baseUrl?: string;
    apiVersion?: string;
    requestRoot?: string | null;
  };
  requestUrl?: string;
  model?: string;
  result?: unknown;
  error?: {
    message?: string;
    hint?: string;
    upstream?: unknown;
  };
  [key: string]: unknown;
};

type Drafts = Record<string, string>;
type HealthKey = "apiKey" | "baseUrl" | "storyModel" | "generalModel" | "ttsModel";
type HealthMap = Partial<Record<HealthKey, SettingTestResponse>>;

const DEFAULTS: Record<string, string> = {
  gemini_base_url: "",
  story_model: "gemini-2.5-pro",
  story_fallback_model: "",
  general_model: "gemini-2.5-flash",
  general_fallback_model: "",
  tts_model: "gemini-2.5-flash-preview-tts",
  tts_fallback_model: "",
  tts_preference: "browser",
  edge_tts_voice: "en-US-EmmaMultilingualNeural",
  gemini_tts_voice: "Zephyr",
  analysis_language: "zh-CN",
  api_timeout_ms: "45000",
  api_max_retries: "3",
};

const EDGE_VOICES = [
  "en-US-EmmaMultilingualNeural",
  "en-US-JennyNeural",
  "en-US-GuyNeural",
  "en-GB-SoniaNeural",
  "en-GB-RyanNeural",
  "en-AU-NatashaNeural",
  "en-AU-WilliamNeural",
] as const;

const GEMINI_VOICES = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Aoede"] as const;

function statusTone(res?: SettingTestResponse) {
  if (!res) return "secondary" as const;
  return res.ok ? "default" : "destructive" as const;
}

function modelCandidatesForRole(models: string[], role: "story" | "general" | "tts") {
  const unique = [...new Set(models)];
  if (role === "tts") {
    return unique.filter((m) => /tts|audio|speech/i.test(m));
  }
  if (role === "story") {
    return unique.filter((m) => !/tts|audio|speech/i.test(m)).sort((a, b) => {
      const pa = /pro|vision/i.test(a) ? -1 : 0;
      const pb = /pro|vision/i.test(b) ? -1 : 0;
      return pa - pb || a.localeCompare(b);
    });
  }
  return unique.filter((m) => !/tts|audio|speech/i.test(m));
}

function HealthBadge({ label, res }: { label: string; res?: SettingTestResponse }) {
  const ok = res?.ok;
  const latency = typeof res?.latencyMs === "number" ? `${res.latencyMs}ms` : null;
  const text = res ? (ok ? "OK" : "FAIL") : "N/A";
  return (
    <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-sm">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        {latency && <span className="text-xs text-muted-foreground">{latency}</span>}
        <Badge variant={statusTone(res)}>{text}</Badge>
      </div>
    </div>
  );
}

function ThemeSection() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  function handleChange(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark (Solarized)", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sun className="size-4" />
          Theme
        </CardTitle>
        <CardDescription>
          Dark mode uses Solarized Dark. Stored locally in your browser.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          {options.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? "default" : "outline"}
              size="sm"
              onClick={() => handleChange(value)}
              className="flex-1"
            >
              <Icon className="size-4" />
              {label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const settingsQuery = useSettings();
  const updateSetting = useUpdateSetting();
  const settings = settingsQuery.data;

  const [drafts, setDrafts] = useState<Drafts>({
    gemini_api_key: "",
    ...DEFAULTS,
  });
  const [initialized, setInitialized] = useState(false);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectingModels, setDetectingModels] = useState(false);
  const [health, setHealth] = useState<HealthMap>({});
  const [testingAll, setTestingAll] = useState(false);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);

  useEffect(() => {
    if (!settings || initialized) return;
    setDrafts({
      gemini_api_key: "",
      gemini_base_url: settings.gemini_base_url ?? DEFAULTS.gemini_base_url,
      story_model: settings.story_model ?? DEFAULTS.story_model,
      story_fallback_model: settings.story_fallback_model ?? DEFAULTS.story_fallback_model,
      general_model: settings.general_model ?? DEFAULTS.general_model,
      general_fallback_model: settings.general_fallback_model ?? DEFAULTS.general_fallback_model,
      tts_model: settings.tts_model ?? DEFAULTS.tts_model,
      tts_fallback_model: settings.tts_fallback_model ?? DEFAULTS.tts_fallback_model,
      tts_preference: settings.tts_preference ?? DEFAULTS.tts_preference,
      edge_tts_voice: settings.edge_tts_voice ?? DEFAULTS.edge_tts_voice,
      gemini_tts_voice: settings.gemini_tts_voice ?? DEFAULTS.gemini_tts_voice,
      analysis_language: settings.analysis_language ?? DEFAULTS.analysis_language,
      api_timeout_ms: settings.api_timeout_ms ?? DEFAULTS.api_timeout_ms,
      api_max_retries: settings.api_max_retries ?? DEFAULTS.api_max_retries,
    });
    setInitialized(true);
  }, [settings, initialized]);

  const hasSavedApiKey = settings?.gemini_api_key === "configured";

  const buildTestPayload = useCallback(
    (target: SettingTestTarget, model?: string) => {
      const payload: Record<string, unknown> = {
        target,
        baseUrl: drafts.gemini_base_url,
      };
      if (drafts.gemini_api_key.trim()) payload.apiKey = drafts.gemini_api_key.trim();
      if (model) payload.model = model;
      return payload;
    },
    [drafts.gemini_api_key, drafts.gemini_base_url],
  );

  const runSingleTest = useCallback(
    async (key: HealthKey, target: SettingTestTarget, model?: string) => {
      try {
        const res = await apiPost<SettingTestResponse>("/api/settings/test", buildTestPayload(target, model));
        setHealth((prev) => ({ ...prev, [key]: res }));
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const fail: SettingTestResponse = { ok: false, target, error: { message: msg } };
        setHealth((prev) => ({ ...prev, [key]: fail }));
        throw e;
      }
    },
    [buildTestPayload],
  );

  const handleDetectModels = useCallback(async () => {
    setDetectingModels(true);
    try {
      const res = await apiPost<SettingTestResponse>("/api/settings/test", buildTestPayload("listModels"));
      if (!res.ok) {
        toast.error(res.error?.message || "Model detection failed");
        return;
      }
      const models = Array.isArray((res.result as { models?: unknown[] } | undefined)?.models)
        ? ((res.result as { models?: string[] }).models ?? [])
        : [];
      setDetectedModels(models);
      toast.success(models.length > 0 ? `Detected ${models.length} models` : "Connected, but no model list returned");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDetectingModels(false);
    }
  }, [buildTestPayload]);

  const handleTestAll = useCallback(async () => {
    setTestingAll(true);
    try {
      await Promise.allSettled([
        runSingleTest("apiKey", "apiKey"),
        runSingleTest("baseUrl", "baseUrl"),
        runSingleTest("storyModel", "storyModel", drafts.story_model || DEFAULTS.story_model),
        runSingleTest("generalModel", "generalModel", drafts.general_model || DEFAULTS.general_model),
        runSingleTest("ttsModel", "ttsModel", drafts.tts_model || DEFAULTS.tts_model),
      ]);
      toast.success("Health check finished");
    } finally {
      setTestingAll(false);
    }
  }, [drafts.general_model, drafts.story_model, drafts.tts_model, runSingleTest]);

  useEffect(() => {
    if (!initialized) return;
    if (!hasSavedApiKey && !drafts.gemini_api_key.trim()) return;
    handleDetectModels().catch(() => undefined);
    handleTestAll().catch(() => undefined);
  }, [initialized]);

  const savePairs = useCallback(
    async (section: string, pairs: Array<{ key: string; value: string; skipEmpty?: boolean }>) => {
      setSavingSection(section);
      try {
        for (const pair of pairs) {
          if (pair.skipEmpty && !pair.value.trim()) continue;
          await updateSetting.mutateAsync({ key: pair.key, value: pair.value.trim() });
        }
        toast.success(`${section} saved`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingSection(null);
      }
    },
    [updateSetting],
  );

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

  const storyModels = useMemo(() => modelCandidatesForRole(detectedModels, "story"), [detectedModels]);
  const generalModels = useMemo(() => modelCandidatesForRole(detectedModels, "general"), [detectedModels]);
  const ttsModels = useMemo(() => modelCandidatesForRole(detectedModels, "tts"), [detectedModels]);

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

  const modelPicker = (
    key: keyof Drafts,
    label: string,
    desc: string,
    fallbackLabel: string,
    suggestions: string[],
  ) => (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Input
        value={drafts[key] ?? ""}
        onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
        placeholder={fallbackLabel}
        className="font-mono text-sm"
        list={`${String(key)}-models`}
      />
      <datalist id={`${String(key)}-models`}>
        {suggestions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.slice(0, 12).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDrafts((prev) => ({ ...prev, [key]: m }))}
              className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${drafts[key] === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent/50"}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          草稿会直接显示在输入框里。点击 Test All 时，未保存的草稿也会参与测试。
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            Health Overview
          </CardTitle>
          <CardDescription>
            一眼看清连接、模型和 TTS 是否可用。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <HealthBadge label="API Key" res={health.apiKey} />
            <HealthBadge label="Base URL" res={health.baseUrl} />
            <HealthBadge label="Story Model" res={health.storyModel} />
            <HealthBadge label="General Model" res={health.generalModel} />
            <HealthBadge label="TTS Model" res={health.ttsModel} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleDetectModels} disabled={detectingModels}>
              {detectingModels ? <Loader2 className="size-4 animate-spin" /> : <Cpu className="size-4" />}
              Detect / Refresh Models
            </Button>
            <Button onClick={handleTestAll} disabled={testingAll}>
              {testingAll ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
              Test All
            </Button>
            {detectedModels.length > 0 && (
              <Badge variant="outline">{detectedModels.length} detected models</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="size-4" />
            Connection
          </CardTitle>
          <CardDescription>
            API key 不回显；留空表示保留已保存的 key。Base URL 可直接测试未保存草稿。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium">Gemini API Key</div>
              {hasSavedApiKey && <Badge variant="outline">saved</Badge>}
            </div>
            <Input
              type="password"
              placeholder={hasSavedApiKey ? "Saved. Type a new key only if you want to replace it" : "Enter your Gemini / relay API key"}
              value={drafts.gemini_api_key ?? ""}
              onChange={(e) => setDrafts((prev) => ({ ...prev, gemini_api_key: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">API Base URL</div>
            <Input
              placeholder="Leave empty for Google official API, or set https://x666.me"
              value={drafts.gemini_base_url ?? ""}
              onChange={(e) => setDrafts((prev) => ({ ...prev, gemini_base_url: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                savePairs("Connection", [
                  { key: "gemini_api_key", value: drafts.gemini_api_key, skipEmpty: true },
                  { key: "gemini_base_url", value: drafts.gemini_base_url },
                ])
              }
              disabled={savingSection === "Connection"}
            >
              {savingSection === "Connection" && <Loader2 className="size-4 animate-spin" />}
              Save Connection
            </Button>
            <Button variant="outline" onClick={() => runSingleTest("baseUrl", "baseUrl").catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}>
              <Globe className="size-4" />
              Test Base URL
            </Button>
          </div>
          {health.baseUrl?.warnings?.[0] && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{health.baseUrl.warnings[0]}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-4" />
            Models & Fallbacks
          </CardTitle>
          <CardDescription>
            检测到模型后可直接点选；也保留手动输入。主模型失败后会尝试 fallback。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {modelPicker("story_model", "Story Model", "Image → story generation", DEFAULTS.story_model, storyModels)}
          {modelPicker("story_fallback_model", "Story Fallback", "Fallback when story model fails after retries", "Optional", storyModels)}
          {modelPicker("general_model", "General Model", "Cards, extraction, translation, deep analysis", DEFAULTS.general_model, generalModels)}
          {modelPicker("general_fallback_model", "General Fallback", "Fallback for card/extract/translate/deep failures", "Optional", generalModels)}
          {modelPicker("tts_model", "Gemini TTS Model", "AI voice narration", DEFAULTS.tts_model, ttsModels)}
          {modelPicker("tts_fallback_model", "TTS Fallback", "Fallback when Gemini TTS model fails", "Optional", ttsModels)}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                savePairs("Models", [
                  { key: "story_model", value: drafts.story_model },
                  { key: "story_fallback_model", value: drafts.story_fallback_model },
                  { key: "general_model", value: drafts.general_model },
                  { key: "general_fallback_model", value: drafts.general_fallback_model },
                  { key: "tts_model", value: drafts.tts_model },
                  { key: "tts_fallback_model", value: drafts.tts_fallback_model },
                ])
              }
              disabled={savingSection === "Models"}
            >
              {savingSection === "Models" && <Loader2 className="size-4 animate-spin" />}
              Save Models
            </Button>
            <Button variant="outline" onClick={handleDetectModels} disabled={detectingModels}>
              <RefreshCcw className="size-4" />
              Refresh Detected Models
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="size-4" />
            Voices & Language
          </CardTitle>
          <CardDescription>
            选择默认 TTS 方式、声音，以及解释文字的语言偏好。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="text-sm font-medium">TTS Preference</div>
            <div className="grid gap-2 md:grid-cols-3">
              {[
                { value: "browser", label: "Browser", desc: "offline, local" },
                { value: "edge", label: "Edge TTS", desc: "free, server-side" },
                { value: "gemini", label: "Gemini TTS", desc: "AI voice" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDrafts((prev) => ({ ...prev, tts_preference: opt.value }))}
                  className={`rounded-lg border p-3 text-left transition-colors ${drafts.tts_preference === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-accent/40"}`}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-sm font-medium">Edge TTS Voice</div>
              <select
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={drafts.edge_tts_voice}
                onChange={(e) => setDrafts((prev) => ({ ...prev, edge_tts_voice: e.target.value }))}
              >
                {EDGE_VOICES.map((voice) => (
                  <option key={voice} value={voice}>{voice}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Gemini TTS Voice</div>
              <select
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                value={drafts.gemini_tts_voice}
                onChange={(e) => setDrafts((prev) => ({ ...prev, gemini_tts_voice: e.target.value }))}
              >
                {GEMINI_VOICES.map((voice) => (
                  <option key={voice} value={voice}>{voice}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Analysis Language</div>
            <select
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              value={drafts.analysis_language}
              onChange={(e) => setDrafts((prev) => ({ ...prev, analysis_language: e.target.value }))}
            >
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
              <option value="bilingual">Bilingual</option>
            </select>
            <p className="text-xs text-muted-foreground">影响词义解释、词源、深度分析等说明性文本。</p>
          </div>

          <Button
            onClick={() =>
              savePairs("Voices & Language", [
                { key: "tts_preference", value: drafts.tts_preference },
                { key: "edge_tts_voice", value: drafts.edge_tts_voice },
                { key: "gemini_tts_voice", value: drafts.gemini_tts_voice },
                { key: "analysis_language", value: drafts.analysis_language },
              ])
            }
            disabled={savingSection === "Voices & Language"}
          >
            {savingSection === "Voices & Language" && <Loader2 className="size-4 animate-spin" />}
            Save Voices & Language
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-4" />
            Advanced
          </CardTitle>
          <CardDescription>
            控制超时和重试。并发仍固定在服务端 semaphore，不在这里暴露，免得把自己玩死。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-sm font-medium">API Timeout (ms)</div>
            <Input
              value={drafts.api_timeout_ms}
              onChange={(e) => setDrafts((prev) => ({ ...prev, api_timeout_ms: e.target.value }))}
              placeholder={DEFAULTS.api_timeout_ms}
            />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Max Retries</div>
            <Input
              value={drafts.api_max_retries}
              onChange={(e) => setDrafts((prev) => ({ ...prev, api_max_retries: e.target.value }))}
              placeholder={DEFAULTS.api_max_retries}
            />
          </div>
          <div className="md:col-span-2">
            <Button
              onClick={() =>
                savePairs("Advanced", [
                  { key: "api_timeout_ms", value: drafts.api_timeout_ms },
                  { key: "api_max_retries", value: drafts.api_max_retries },
                ])
              }
              disabled={savingSection === "Advanced"}
            >
              {savingSection === "Advanced" && <Loader2 className="size-4 animate-spin" />}
              Save Advanced Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <ThemeSection />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-4" />
            Local Data & Cache
          </CardTitle>
          <CardDescription>
            浏览器侧维护操作：PWA 更新、缓存清理、强制刷新。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refreshPwa} disabled={maintenanceBusy}>
            {maintenanceBusy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCcw className="size-4" />}
            Force Refresh / Update
          </Button>
          <Button variant="outline" onClick={clearLocalCache} disabled={maintenanceBusy}>
            {maintenanceBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Clear Local Cache
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="size-4" />
            About
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">WordLoom</p>
          <p>
            AI-powered English learning workspace: generate compact image-based stories, listen with TTS,
            double-click words into cards, and explore deep vocabulary analysis in one loop.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
