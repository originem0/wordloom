import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Loader2, PlayCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiPost } from "@/client/lib/api";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Badge } from "@/client/components/ui/badge";
import { useSettings, useUpdateSetting } from "@/client/hooks/useSettings";
import { RimeVoiceSettings } from "./RimeVoiceSettings";
import { settingTestError } from "./setting-test-error";
import {
  StatusDot,
  SectionHeader,
  SettingRow,
  PRIMARY_BUTTON,
  INPUT_CLASS,
  SELECT_CLASS,
  type SettingTestResponse,
} from "./SettingWidgets";

type Drafts = Record<string, string>;
type ProviderType = "gemini" | "openai";

const PROVIDERS: ProviderType[] = ["gemini", "openai"];

const ROUTES = [
  { key: "cards", label: ["词卡", "Cards"], subtitle: ["生成词义、音标和例句", "Generate meanings, pronunciation and examples"], testTarget: "cardsModel" },
  { key: "deep", label: ["深度分析", "Deep Analysis"], subtitle: ["补充意象图、近义词对比和边界测试", "Add core images, word comparisons and boundary tests"], testTarget: "deepModel" },
  { key: "utility", label: ["辅助任务", "Utility"], subtitle: ["从文本中挑词并做简短整理", "Extract words and organise short text"], testTarget: "utilityModel" },
  // No probe of its own: it is tested as a cards call on this row's provider and model.
  // `once` suppresses the fallback controls: expressions and conversation
  // stay on the selected model, even when a conversation call is retried.
  { key: "expressions", label: ["表达", "Expressions"], subtitle: ["表达库与对谈。留空的项沿用词卡路由", "Expressions and Conversation. Empty fields inherit the Cards route"], testTarget: "cardsModel", inherits: "cards", once: true },
] as const;

const GEMINI_DEFAULTS: Record<string, string> = {
  cards_model: "",
  cards_fallback_model: "",
  deep_model: "",
  deep_fallback_model: "",
  utility_model: "",
  utility_fallback_model: "",
  expressions_model: "",
};

const RIME_DEFAULTS: Record<string, string> = { rime_model: "coda", rime_speaker: "astra", rime_speed: "1" };

/**
 * What a route runs on, as the server resolves it: its own setting, then, for
 * a route that inherits, the same setting of the route it follows.
 */
function resolveRoute(route: (typeof ROUTES)[number], get: (key: string) => string, generalModel?: string) {
  const setting = (name: string) => get(`${route.key}_${name}`) || ("inherits" in route ? get(`${route.inherits}_${name}`) : "");
  const provider = (setting("provider") || "gemini") as ProviderType;
  const model = setting(provider === "openai" ? "openai_model" : "model") || (provider === "gemini" ? generalModel || "gemini-2.5-flash" : "");
  return { provider, model };
}

/** Model list detected earlier in this browser session ([] if none or unreadable). */
function readCachedModels(provider: ProviderType, baseUrl: string, revision: string): string[] {
  try {
    const cached = JSON.parse(sessionStorage.getItem(`wordloom:ai-${provider}-models`) ?? "null");
    return cached?.baseUrl === baseUrl && cached.revision === revision ? readModelList(cached).models : [];
  } catch {
    return [];
  }
}

type RouteHealth = Record<string, SettingTestResponse>;
const HEALTH_CACHE = "wordloom:ai-route-health";

function readCachedHealth(revision: string): RouteHealth {
  try {
    const saved = JSON.parse(sessionStorage.getItem(HEALTH_CACHE) ?? "null");
    if (!revision || saved?.revision !== revision) return {};
    const health: RouteHealth = {};
    for (const { key } of ROUTES) {
      const probe = saved.routes?.[key];
      if (typeof probe?.ok === "boolean") health[key] = { ok: probe.ok, latencyMs: typeof probe.latencyMs === "number" ? probe.latencyMs : undefined };
    }
    return health;
  } catch { return {}; }
}

/** Narrow the untyped `result` of a listModels / openaiListModels test. */
function readModelList(result: unknown): { models: string[]; totalListed: number } {
  const r = (result && typeof result === "object" ? result : {}) as { models?: unknown; totalListed?: unknown };
  const models = Array.isArray(r.models) ? r.models.filter((m): m is string => typeof m === "string") : [];
  return { models, totalListed: typeof r.totalListed === "number" ? r.totalListed : models.length };
}

function roleCandidates(models: string[], role: string) {
  const textModels = [...new Set(models)].filter((m) => !/tts|audio|speech/i.test(m));
  const score = (m: string) => {
    if (role === "deep") return (/pro|gpt-5/i.test(m) ? 20 : 0) + (/flash/i.test(m) ? -4 : 0);
    if (role === "cards") return (/flash|mini/i.test(m) ? 10 : 0) + (/pro/i.test(m) ? 2 : 0);
    if (role === "utility") return (/flash|mini/i.test(m) ? 12 : 0) + (/pro/i.test(m) ? -2 : 0);
    return 0;
  };
  return textModels.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

export function AIProvidersPage() {
  const { t } = useI18n();
  const settingsQuery = useSettings();
  const updateSetting = useUpdateSetting();
  const settings = settingsQuery.data;

  const [drafts, setDrafts] = useState<Drafts>({});
  const [baseDraft, setBaseDraft] = useState<Drafts>({});
  const [savedRevision, setSavedRevision] = useState("");
  const probeVersion = useRef(0);
  const [initialized, setInitialized] = useState(false);

  // Per-provider state
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [detectingGemini, setDetectingGemini] = useState(false);
  const [detectingOpenai, setDetectingOpenai] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [testingSingle, setTestingSingle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualInput, setManualInput] = useState<Record<string, boolean>>({});
  const [showAllCandidates, setShowAllCandidates] = useState<Record<string, boolean>>({});
  const [routeHealth, setRouteHealth] = useState<RouteHealth>({});

  // Seed the drafts from the saved settings once, the first render they are
  // available. Done during render (not in an effect) so the form never paints
  // empty first; `initialized` keeps later refetches from overwriting what the
  // user is typing.
  if (settings && !initialized) {
    const d: Drafts = {
      gemini_api_key: "",
      gemini_base_url: settings.gemini_base_url ?? "",
      openai_api_key: "",
      openai_base_url: settings.openai_base_url ?? "",
      rime_api_key: "",
      ...Object.fromEntries(Object.entries(RIME_DEFAULTS).map(([key, value]) => [key, settings[key] || value])),
    };
    // Route providers. One that inherits stays empty until chosen: seeding it
    // with "gemini" would pin it on the next save and stop it following.
    for (const r of ROUTES) {
      d[`${r.key}_provider`] = settings[`${r.key}_provider`] ?? ("inherits" in r ? "" : "gemini");
    }
    // Gemini model keys
    for (const [k, v] of Object.entries(GEMINI_DEFAULTS)) {
      d[k] = settings[k] ?? v;
    }
    // OpenAI model keys
    for (const r of ROUTES) {
      d[`${r.key}_openai_model`] = settings[`${r.key}_openai_model`] ?? "";
      if (!("once" in r)) d[`${r.key}_openai_fallback_model`] = settings[`${r.key}_openai_fallback_model`] ?? "";
    }
    setBaseDraft(d);
    setGeminiModels(readCachedModels("gemini", d.gemini_base_url, settings._revision ?? ""));
    setOpenaiModels(readCachedModels("openai", d.openai_base_url, settings._revision ?? ""));
    setRouteHealth(readCachedHealth(settings._revision ?? ""));
    setSavedRevision(settings._revision ?? "");
    setDrafts(d);
    setInitialized(true);
  }

  useEffect(() => {
    if (!savedRevision || settings?._revision !== savedRevision || !Object.keys(routeHealth).length) return;
    if (Object.entries(drafts).some(([key, value]) => value !== baseDraft[key])) return;
    // A probe may include an upstream diagnostic or response body. Only its
    // status and latency belong in browser storage for this settings revision.
    const routes = Object.fromEntries(Object.entries(routeHealth).map(([key, { ok, latencyMs }]) => [key, { ok, latencyMs }]));
    try { sessionStorage.setItem(HEALTH_CACHE, JSON.stringify({ revision: savedRevision, routes })); } catch { /* storage unavailable */ }
  }, [baseDraft, drafts, routeHealth, savedRevision, settings?._revision]);

  const draftValue = useCallback((key: string) => drafts[key] ?? "", [drafts]);
  const setDraft = useCallback((key: string, value: string) => {
    probeVersion.current++;
    setRouteHealth({});
    if (key === "gemini_base_url" || key === "gemini_api_key") setGeminiModels([]);
    if (key === "openai_base_url" || key === "openai_api_key") setOpenaiModels([]);
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const hasGeminiKey = settings?.gemini_api_key === "configured";
  const hasOpenaiKey = settings?.openai_api_key === "configured";
  const hasRimeKey = settings?.rime_api_key === "configured";

  // --- Detect models ---
  const detectGeminiModels = useCallback(async () => {
    const version = probeVersion.current;
    setDetectingGemini(true);
    try {
      const payload: Record<string, unknown> = { target: "listModels", baseUrl: draftValue("gemini_base_url"), verify: true };
      if (drafts.gemini_api_key?.trim()) payload.apiKey = drafts.gemini_api_key.trim();
      const res = await apiPost<SettingTestResponse>("/api/settings/test", payload);
      if (version !== probeVersion.current) return;
      if (!res.ok) { toast.error(t(`Gemini 模型识别失败：${settingTestError(res)}`, `Gemini model detection failed: ${settingTestError(res)}`)); return; }
      const { models, totalListed } = readModelList(res.result);
      setGeminiModels(models);
      if (!payload.apiKey && payload.baseUrl === baseDraft.gemini_base_url) {
        try { sessionStorage.setItem("wordloom:ai-gemini-models", JSON.stringify({ models, baseUrl: payload.baseUrl, revision: savedRevision })); } catch { /* storage unavailable */ }
      }
      if (models.length > 0) {
        const msg = totalListed > models.length
          ? t(`列出 ${totalListed} 个模型，已验证 ${models.length} 个可用`, `${models.length} of ${totalListed} listed models verified`)
          : t(`${models.length} 个模型已验证`, `${models.length} model${models.length === 1 ? "" : "s"} verified`);
        toast.success(msg);
      } else {
        toast.error(totalListed > 0 ? t(`列出 ${totalListed} 个模型，本次未验证到可用模型`, `Listed ${totalListed} models. None of the models tested responded.`) : t("已连接，但没有返回模型", "Connected, no models returned"));
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDetectingGemini(false);
    }
  }, [draftValue, drafts.gemini_api_key, baseDraft.gemini_base_url, savedRevision, t]);

  const detectOpenaiModels = useCallback(async () => {
    const version = probeVersion.current;
    setDetectingOpenai(true);
    try {
      const payload: Record<string, unknown> = { target: "openaiListModels", baseUrl: draftValue("openai_base_url"), verify: true };
      if (drafts.openai_api_key?.trim()) payload.apiKey = drafts.openai_api_key.trim();
      const res = await apiPost<SettingTestResponse>("/api/settings/test", payload);
      if (version !== probeVersion.current) return;
      if (!res.ok) { toast.error(t(`OpenAI 模型识别失败：${settingTestError(res)}`, `OpenAI model detection failed: ${settingTestError(res)}`)); return; }
      const { models, totalListed } = readModelList(res.result);
      setOpenaiModels(models);
      if (!payload.apiKey && payload.baseUrl === baseDraft.openai_base_url) {
        try { sessionStorage.setItem("wordloom:ai-openai-models", JSON.stringify({ models, baseUrl: payload.baseUrl, revision: savedRevision })); } catch { /* storage unavailable */ }
      }
      if (models.length > 0) {
        const msg = totalListed > models.length
          ? t(`列出 ${totalListed} 个模型，已验证 ${models.length} 个可用`, `${models.length} of ${totalListed} listed models verified`)
          : t(`${models.length} 个模型已验证`, `${models.length} model${models.length === 1 ? "" : "s"} verified`);
        toast.success(msg);
      } else {
        toast.error(totalListed > 0 ? t(`列出 ${totalListed} 个模型，本次未验证到可用模型`, `Listed ${totalListed} models. None of the models tested responded.`) : t("已连接，但没有返回模型", "Connected, no models returned"));
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDetectingOpenai(false);
    }
  }, [draftValue, drafts.openai_api_key, baseDraft.openai_base_url, savedRevision, t]);

  // --- Per-route test ---
  const testRoute = useCallback(async (routeKey: string, target: string, model: string, provider: ProviderType) => {
    const version = probeVersion.current;
    const healthKey = routeKey;
    setTestingSingle(healthKey);
    try {
      const payload: Record<string, unknown> = { target, model, provider };
      if (provider === "gemini") {
        payload.baseUrl = draftValue("gemini_base_url");
        if (drafts.gemini_api_key?.trim()) payload.apiKey = drafts.gemini_api_key.trim();
      } else {
        payload.baseUrl = draftValue("openai_base_url");
        if (drafts.openai_api_key?.trim()) payload.apiKey = drafts.openai_api_key.trim();
      }
      const res = await apiPost<SettingTestResponse>("/api/settings/test", payload);
      if (version !== probeVersion.current) return;
      setRouteHealth((prev) => ({ ...prev, [healthKey]: res }));
      const route = ROUTES.find((item) => item.key === routeKey);
      const label = route ? t(route.label[0], route.label[1]) : routeKey;
      toast[res.ok ? "success" : "error"](
        res.ok ? t(`${label}：${model} 已通过 ${res.latencyMs ?? ""}ms`, `${label}: ${model} OK ${res.latencyMs ?? ""}ms`)
          : t(`${label} 测试失败：${settingTestError(res)}`, `${label} test failed: ${settingTestError(res)}`),
      );
    } catch (e) {
      const fail: SettingTestResponse = { ok: false, error: {
        message: e instanceof Error ? e.message : "",
        ...(e instanceof ApiError ? { status: e.status, code: e.code } : {}),
      } };
      if (version !== probeVersion.current) return;
      setRouteHealth((prev) => ({ ...prev, [healthKey]: fail }));
      toast.error(errorMessage(e));
    } finally {
      setTestingSingle(null);
    }
  }, [draftValue, drafts.gemini_api_key, drafts.openai_api_key, t]);

  const testAllRoutes = useCallback(async () => {
    setTestingAll(true);
    try {
      await Promise.allSettled(ROUTES.map((route) => {
        const { provider, model } = resolveRoute(route, draftValue, settings?.general_model);
        if (!model) return Promise.resolve();
        return testRoute(route.key, route.testTarget, model, provider);
      }));
    } finally {
      setTestingAll(false);
    }
  }, [draftValue, settings, testRoute]);

  // --- Save all ---
  const saveAll = useCallback(async () => {
    setSaving(true);
    try {
      const changes = Object.entries(drafts).filter(([key, value]) => value !== baseDraft[key] && (!key.endsWith("_api_key") || value.trim())).map(([key, value]) => ({ key, value: value.trim() }));
      if (changes.length) {
        const result = await updateSetting.mutateAsync({ changes, expectedRevision: savedRevision });
        probeVersion.current++;
        setRouteHealth({});
        setSavedRevision(result.revision);
        const clean: Drafts = { ...drafts, gemini_api_key: "", openai_api_key: "", rime_api_key: "" };
        setBaseDraft(clean);
        setDrafts((current) => ({ ...current, ...Object.fromEntries(Object.keys(clean).filter((key) => current[key] === drafts[key]).map((key) => [key, clean[key]])) }));
      }
      toast.success(t("AI 配置已保存", "AI provider settings saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }, [drafts, baseDraft, savedRevision, updateSetting, t]);

  // --- Model picker ---
  const modelField = (
    key: string,
    label: string,
    placeholder: string,
    candidates: string[],
    helper?: string,
    allowEmpty = false,
  ) => {
    const current = draftValue(key);
    const isManual = manualInput[key] ?? false;
    const hasDetected = candidates.length > 0;

    const options = [...candidates];
    if (current && !options.includes(current)) options.push(current);

    const showAll = showAllCandidates[key] ?? false;
    const maxVisible = 6;
    let visibleOptions = options;
    if (!showAll && options.length > maxVisible) {
      visibleOptions = options.slice(0, maxVisible);
      if (current && !visibleOptions.includes(current)) visibleOptions.push(current);
    }
    const hiddenCount = Math.max(0, options.length - visibleOptions.length);

    if (!hasDetected || isManual) {
      return (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium text-foreground">{label}</div>
            {hasDetected && (
              <button type="button" onClick={() => setManualInput((p) => ({ ...p, [key]: false }))} className="min-h-11 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                {t("从列表选择", "Pick from list")}
              </button>
            )}
          </div>
          <Input
            aria-label={label}
            value={current}
            onChange={(e) => setDraft(key, e.target.value)}
            placeholder={placeholder}
            className={`${INPUT_CLASS} font-mono text-sm`}
          />
          {helper && <div className="text-[11px] text-muted-foreground/60">{helper}</div>}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-medium text-foreground">{label}</div>
          <div className="flex items-center gap-2">
            {hiddenCount > 0 && (
              <button type="button" onClick={() => setShowAllCandidates((p) => ({ ...p, [key]: !showAll }))} className="min-h-11 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                {showAll ? t("收起", "Show less") : t(`显示全部（另有 ${hiddenCount} 项）`, `Show all (+${hiddenCount})`)}
              </button>
            )}
            <button type="button" onClick={() => setManualInput((p) => ({ ...p, [key]: true }))} className="min-h-11 rounded-md px-2 text-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
              {t("手动输入", "Type manually")}
            </button>
          </div>
        </div>
        <select aria-label={label} className={`${SELECT_CLASS} font-mono`} value={current} onChange={(e) => setDraft(key, e.target.value)}>
          {allowEmpty && <option value="">{t("沿用默认设置", "Inherit default")}</option>}
          {visibleOptions.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
        {helper && <div className="text-[11px] text-muted-foreground/60">{helper}</div>}
      </div>
    );
  };

  // --- Computed ---
  // Dirty check
  const isDirty = useMemo(() => {
    if (!initialized || !settings) return false;
    return Object.entries(drafts).some(([key, value]) => value !== baseDraft[key]);
  }, [initialized, settings, drafts, baseDraft]);

  if (settingsQuery.isLoading && !initialized) {
    return (
      <div className="flex items-center justify-center p-12" role="status" aria-label={t("正在加载 AI 配置", "Loading AI settings")}>
        <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (settingsQuery.error) {
    return <div className="p-6 text-destructive" role="alert">{t("配置加载失败", "Failed to load settings")}: {errorMessage(settingsQuery.error)}</div>;
  }

  const getRouteModelKey = (routeKey: string, provider: ProviderType, suffix: string) =>
    provider === "openai" ? `${routeKey}_openai_${suffix}` : `${routeKey}_${suffix}`;

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 md:px-6">
      <h1 className="text-2xl font-semibold text-foreground">{t("AI 配置", "AI Providers")}</h1>

      {/* ══════════ GEMINI CONNECTION ══════════ */}
      <SectionHeader>{t("Gemini 连接", "Gemini Connection")}</SectionHeader>

      <SettingRow
        title={t("API 密钥", "API Key")}
        subtitle={t("留空保留已保存的密钥", "Leave empty to keep the saved key")}
        right={<Badge variant={hasGeminiKey ? "outline" : "destructive"} className="rounded-md text-[10px]">{hasGeminiKey ? t("已保存", "Saved") : t("未设置", "Missing")}</Badge>}
        defaultOpen={!hasGeminiKey}
      >
        <Input
          type="password"
          aria-label={t("Gemini API 密钥", "Gemini API Key")}
          placeholder={hasGeminiKey ? t("已保存，输入以替换", "Saved, type to replace") : t("输入 Gemini 或中转站 API 密钥", "Enter Gemini / relay API key")}
          value={drafts.gemini_api_key ?? ""}
          onChange={(e) => setDraft("gemini_api_key", e.target.value)}
          className={INPUT_CLASS}
        />
      </SettingRow>

      <SettingRow
        title={t("基础地址", "Base URL")}
        subtitle={t("官方 API 留空；中转站填根地址", "Leave empty for the official API; enter a relay's root URL")}
        value={draftValue("gemini_base_url") || t("官方 API", "official")}
      >
        <Input
          aria-label={t("Gemini 基础地址", "Gemini Base URL")}
          value={draftValue("gemini_base_url")}
          onChange={(e) => setDraft("gemini_base_url", e.target.value)}
          placeholder={t("留空使用 Google 官方 API", "Leave empty for Google official API")}
          className={`${INPUT_CLASS} font-mono text-sm`}
        />
      </SettingRow>

      <SettingRow title={t("模型", "Models")} value={t(`已识别 ${geminiModels.length} 个`, `${geminiModels.length} detected`)}>
        <div className="space-y-2">
          {geminiModels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {geminiModels.slice(0, 12).map((m) => (
                <span key={m} className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">{m}</span>
              ))}
              {geminiModels.length > 12 && <span className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">{t(`另有 ${geminiModels.length - 12} 个`, `+${geminiModels.length - 12} more`)}</span>}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/60">{t("点击下方按钮识别模型。", "Click Detect & Verify below.")}</div>
          )}
        </div>
      </SettingRow>

      <div className="flex flex-wrap gap-2 py-3">
        <Button size="sm" variant="outline" onClick={detectGeminiModels} disabled={detectingGemini}>
          {detectingGemini ? <Loader2 className="size-3.5 animate-spin" /> : <Cpu className="size-3.5" />}
          {detectingGemini ? t("正在识别…", "Detecting…") : t("识别并验证", "Detect & Verify")}
        </Button>
      </div>

      {/* ══════════ OPENAI CONNECTION ══════════ */}
      <SectionHeader>{t("OpenAI 兼容连接", "OpenAI-Compatible Connection")}</SectionHeader>

      <SettingRow
        title={t("API 密钥", "API Key")}
        subtitle={t("DeepSeek / GLM / Kimi / 中转站的密钥", "API key for DeepSeek / GLM / Kimi / a relay")}
        right={<Badge variant={hasOpenaiKey ? "outline" : "destructive"} className="rounded-md text-[10px]">{hasOpenaiKey ? t("已保存", "Saved") : t("未设置", "Missing")}</Badge>}
        defaultOpen={!hasOpenaiKey}
      >
        <Input
          type="password"
          aria-label={t("OpenAI API 密钥", "OpenAI API Key")}
          placeholder={hasOpenaiKey ? t("已保存，输入以替换", "Saved, type to replace") : t("输入 OpenAI 兼容 API 密钥", "Enter OpenAI-compatible API key")}
          value={drafts.openai_api_key ?? ""}
          onChange={(e) => setDraft("openai_api_key", e.target.value)}
          className={INPUT_CLASS}
        />
      </SettingRow>

      <SettingRow
        title={t("基础地址", "Base URL")}
        subtitle={t("例如 https://api.deepseek.com", "For example, https://api.deepseek.com")}
        value={draftValue("openai_base_url") || t("未设置", "(not set)")}
        defaultOpen={!draftValue("openai_base_url")}
      >
        <Input
          aria-label={t("OpenAI 基础地址", "OpenAI Base URL")}
          value={draftValue("openai_base_url")}
          onChange={(e) => setDraft("openai_base_url", e.target.value)}
          placeholder="https://api.deepseek.com"
          className={`${INPUT_CLASS} font-mono text-sm`}
        />
      </SettingRow>

      <SettingRow title={t("模型", "Models")} value={t(`已识别 ${openaiModels.length} 个`, `${openaiModels.length} detected`)}>
        <div className="space-y-2">
          {openaiModels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {openaiModels.slice(0, 12).map((m) => (
                <span key={m} className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">{m}</span>
              ))}
              {openaiModels.length > 12 && <span className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">{t(`另有 ${openaiModels.length - 12} 个`, `+${openaiModels.length - 12} more`)}</span>}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/60">{t("点击下方按钮识别模型。", "Click Detect & Verify below.")}</div>
          )}
        </div>
      </SettingRow>

      <div className="flex flex-wrap gap-2 py-3">
        <Button size="sm" variant="outline" onClick={detectOpenaiModels} disabled={detectingOpenai}>
          {detectingOpenai ? <Loader2 className="size-3.5 animate-spin" /> : <Cpu className="size-3.5" />}
          {detectingOpenai ? t("正在识别…", "Detecting…") : t("识别并验证", "Detect & Verify")}
        </Button>
      </div>

      {/* ══════════ MODEL ROUTING ══════════ */}
      <SectionHeader>{t("模型路由", "Model Routing")}</SectionHeader>

      <div className="flex flex-wrap gap-2 py-2 mb-1">
        <Button size="sm" variant="outline" onClick={testAllRoutes} disabled={testingAll}>
          {testingAll ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
          {testingAll ? t("正在测试…", "Testing…") : t("测试全部路由", "Test All Routes")}
        </Button>
      </div>

      {ROUTES.map((route) => {
        const follows = "inherits" in route;
        const { provider, model } = resolveRoute(route, draftValue, settings?.general_model);
        const models = provider === "openai" ? openaiModels : geminiModels;
        const candidates = roleCandidates(models, follows ? route.inherits : route.key);
        const primaryKey = getRouteModelKey(route.key, provider, "model");
        const fallbackKey = getRouteModelKey(route.key, provider, "fallback_model");
        const runtimeModel = model || t("未设置", "(not set)");
        const health = (settings?._revision ?? "") === savedRevision ? routeHealth[route.key] : undefined;
        const healthLabel = health
          ? health.ok
            ? `${health.latencyMs ?? ""}ms`
            : settingTestError(health).slice(0, 40)
          : null;

        return (
          <SettingRow
            key={route.key}
            stackOnMobile
            title={t(route.label[0], route.label[1])}
            subtitle={t(route.subtitle[0], route.subtitle[1])}
            right={
              <div className="flex min-w-0 max-w-full items-center gap-2">
                <button
                  type="button"
                  title={t(`测试${route.label[0]}`, `Test ${route.label[1]}`)}
                  disabled={!model || testingSingle === route.key || testingAll}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    testRoute(route.key, route.testTarget, model, provider);
                  }}
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {testingSingle === route.key ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
                </button>
                <StatusDot res={health} />
                {healthLabel && (
                  <span className={`text-[10px] max-w-[120px] truncate ${health?.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {healthLabel}
                  </span>
                )}
                <Badge variant="outline" className="rounded-md text-[10px]">{provider}</Badge>
                <span className="min-w-0 max-w-[220px] truncate text-[12px] text-muted-foreground" title={runtimeModel}>{runtimeModel}</span>
              </div>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-[13px] font-medium text-foreground">{t("提供方", "Provider")}</div>
                <select
                  className={SELECT_CLASS}
                  aria-label={t(`${route.label[0]}提供方`, `${route.label[1]} Provider`)}
                  value={follows ? draftValue(`${route.key}_provider`) : provider}
                  onChange={(e) => setDraft(`${route.key}_provider`, e.target.value)}
                >
                  {follows && <option value="">{t("沿用词卡", "Inherit Cards")}</option>}
                  {PROVIDERS.map((p) => (<option key={p} value={p}>{p === "gemini" ? "Gemini" : t("OpenAI 兼容", "OpenAI-compatible")}</option>))}
                </select>
              </div>
              {modelField(primaryKey, t("主模型", "Primary Model"), provider === "gemini" || follows ? t("留空沿用默认设置", "Leave empty to inherit") : t("例如 deepseek-chat", "e.g. deepseek-chat"), candidates, undefined, provider === "gemini" || follows)}
              {"once" in route ? (
                <div className="text-[11px] text-muted-foreground/60">{t("这条路由使用上面选定的模型，没有后备模型。", "This route uses the selected model without a fallback.")}</div>
              ) : (
                modelField(fallbackKey, t("后备模型", "Fallback Model"), t("可选", "Optional"), candidates, t("主模型失败后尝试。", "Used when the primary model fails."), true)
              )}
            </div>
          </SettingRow>
        );
      })}

      <SectionHeader>{t("Rime 朗读", "Rime Speech")}</SectionHeader>
      <SettingRow
        title={t("API 密钥", "API Key")} subtitle={t("用于音色试听和对谈朗读。留空可沿用已保存的密钥。", "Used for voice previews and conversation audio. Leave empty to use the saved key.")}
        right={<Badge variant={hasRimeKey ? "outline" : "destructive"} className="rounded-md text-[10px]">{hasRimeKey ? t("已保存", "Saved") : t("未设置", "Missing")}</Badge>}
        defaultOpen={!hasRimeKey}
      >
        <Input
          type="password" aria-label={t("Rime API 密钥", "Rime API Key")} autoComplete="new-password"
          placeholder={hasRimeKey ? t("已保存，输入以替换", "Saved, type to replace") : t("输入 Rime API 密钥", "Enter Rime API key")}
          value={drafts.rime_api_key ?? ""} onChange={(e) => setDraft("rime_api_key", e.target.value)} className={INPUT_CLASS}
        />
        <a href="https://app.rime.ai/tokens/" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-muted-foreground underline">{t("获取 Rime API 密钥", "Rime API Tokens")}</a>
      </SettingRow>
      <SettingRow title={t("音色与试听", "Voice & preview")} value={`${draftValue("rime_speaker")} · ${draftValue("rime_speed")}×`} lazy>
        <RimeVoiceSettings model={draftValue("rime_model")} speaker={draftValue("rime_speaker")} speed={draftValue("rime_speed")}
          apiKey={draftValue("rime_api_key")} hasSavedKey={hasRimeKey} setDraft={setDraft} />
      </SettingRow>

      {/* ── Sticky save bar ── */}
      {isDirty && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <span className="text-[12px] text-muted-foreground">{t("有未保存的修改", "Unsaved changes")}</span>
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
