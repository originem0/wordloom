import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Globe, Loader2, PlayCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/client/lib/api";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Badge } from "@/client/components/ui/badge";
import { useSettings, useUpdateSetting } from "@/client/hooks/useSettings";
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
type HealthKey = string;
type HealthMap = Partial<Record<HealthKey, SettingTestResponse>>;
type ProviderType = "gemini" | "openai";

const PROVIDERS: ProviderType[] = ["gemini", "openai"];

const GEMINI_VOICES = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Aoede"] as const;

const ROUTES = [
  { key: "story", label: "Story", subtitle: "图片 → 故事生成", testTarget: "storyModel" },
  { key: "cards", label: "Cards", subtitle: "短 JSON、稳定结构", testTarget: "cardsModel" },
  { key: "deep", label: "Deep Analysis", subtitle: "长 JSON、schemaAnalysis、SVG", testTarget: "deepModel" },
  { key: "utility", label: "Utility", subtitle: "抽词、翻译、轻量文本", testTarget: "utilityModel" },
] as const;

const GEMINI_DEFAULTS: Record<string, string> = {
  story_model: "gemini-2.5-pro",
  story_fallback_model: "",
  cards_model: "",
  cards_fallback_model: "",
  deep_model: "",
  deep_fallback_model: "",
  utility_model: "",
  utility_fallback_model: "",
  gemini_tts_model: "gemini-2.5-flash-preview-tts",
  gemini_tts_fallback_model: "",
  gemini_tts_voice: "Zephyr",
};

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

function roleCandidates(models: string[], role: string) {
  const unique = [...new Set(models)];
  const textModels = unique.filter((m) => !/tts|audio|speech/i.test(m));
  const ttsModels = unique.filter((m) => /tts|audio|speech/i.test(m));
  const score = (m: string) => {
    if (role === "story") return (/pro|vision/i.test(m) ? 20 : 0) + (/flash/i.test(m) ? -2 : 0);
    if (role === "deep") return (/pro|gpt-5/i.test(m) ? 20 : 0) + (/flash/i.test(m) ? -4 : 0);
    if (role === "cards") return (/flash|mini/i.test(m) ? 10 : 0) + (/pro/i.test(m) ? 2 : 0);
    if (role === "utility") return (/flash|mini/i.test(m) ? 12 : 0) + (/pro/i.test(m) ? -2 : 0);
    return (/tts|audio/i.test(m) ? 10 : 0);
  };
  const list = role === "geminiTts" ? ttsModels : textModels;
  return list.sort((a, b) => score(b) - score(a) || a.localeCompare(b));
}

export function AIProvidersPage() {
  const settingsQuery = useSettings();
  const updateSetting = useUpdateSetting();
  const settings = settingsQuery.data;

  const [drafts, setDrafts] = useState<Drafts>({});
  const [initialized, setInitialized] = useState(false);

  // Per-provider state
  const [geminiModels, setGeminiModels] = useState<string[]>([]);
  const [openaiModels, setOpenaiModels] = useState<string[]>([]);
  const [geminiHealth, setGeminiHealth] = useState<HealthMap>({});
  const [openaiHealth, setOpenaiHealth] = useState<HealthMap>({});
  const [detectingGemini, setDetectingGemini] = useState(false);
  const [detectingOpenai, setDetectingOpenai] = useState(false);
  const [testingAll, setTestingAll] = useState(false);
  const [testingSingle, setTestingSingle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [manualInput, setManualInput] = useState<Record<string, boolean>>({});
  const [showAllCandidates, setShowAllCandidates] = useState<Record<string, boolean>>({});
  const [routeHealth, setRouteHealth] = useState<Record<string, SettingTestResponse>>(() => {
    try {
      const cached = sessionStorage.getItem("wordloom:ai-route-health");
      if (cached) return JSON.parse(cached);
    } catch { /* ignore */ }
    return {};
  });
  const hasAutoDetected = useRef(false);

  // Persist routeHealth to sessionStorage on change
  useEffect(() => {
    if (Object.keys(routeHealth).length > 0) {
      try { sessionStorage.setItem("wordloom:ai-route-health", JSON.stringify(routeHealth)); } catch { /* ignore */ }
    }
  }, [routeHealth]);

  // Initialize drafts from saved settings
  useEffect(() => {
    if (!settings || initialized) return;
    const d: Drafts = {
      gemini_api_key: "",
      gemini_base_url: settings.gemini_base_url ?? "",
      openai_api_key: "",
      openai_base_url: settings.openai_base_url ?? "",
      gemini_tts_voice: settings.gemini_tts_voice ?? GEMINI_DEFAULTS.gemini_tts_voice,
    };
    // Route providers
    for (const r of ROUTES) {
      d[`${r.key}_provider`] = settings[`${r.key}_provider`] ?? "gemini";
    }
    // Gemini model keys
    for (const [k, v] of Object.entries(GEMINI_DEFAULTS)) {
      d[k] = settings[k] ?? v;
    }
    // OpenAI model keys
    for (const r of ROUTES) {
      d[`${r.key}_openai_model`] = settings[`${r.key}_openai_model`] ?? "";
      d[`${r.key}_openai_fallback_model`] = settings[`${r.key}_openai_fallback_model`] ?? "";
    }
    setDrafts(d);
    setInitialized(true);
  }, [settings, initialized]);

  const draftValue = useCallback((key: string) => drafts[key] ?? "", [drafts]);
  const setDraft = useCallback((key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const hasGeminiKey = settings?.gemini_api_key === "configured";
  const hasOpenaiKey = settings?.openai_api_key === "configured";

  // Auto-detect models on first load
  useEffect(() => {
    if (!initialized || hasAutoDetected.current) return;
    hasAutoDetected.current = true;

    // Hydrate from cache
    try {
      const gCache = sessionStorage.getItem("wordloom:ai-gemini-models");
      if (gCache) { const d = JSON.parse(gCache); if (d.models?.length) setGeminiModels(d.models); }
      const oCache = sessionStorage.getItem("wordloom:ai-openai-models");
      if (oCache) { const d = JSON.parse(oCache); if (d.models?.length) setOpenaiModels(d.models); }
    } catch { /* ignore */ }
  }, [initialized]);

  // --- Detect models ---
  const detectGeminiModels = useCallback(async () => {
    setDetectingGemini(true);
    try {
      const payload: Record<string, unknown> = { target: "listModels", baseUrl: draftValue("gemini_base_url"), verify: true };
      if (drafts.gemini_api_key?.trim()) payload.apiKey = drafts.gemini_api_key.trim();
      const res = await apiPost<SettingTestResponse>("/api/settings/test", payload);
      if (!res.ok) { toast.error(res.error?.message || "Gemini model detection failed"); return; }
      const result = res.result as any;
      const models = result?.models ?? [];
      const totalListed = result?.totalListed ?? models.length;
      setGeminiModels(models);
      try { sessionStorage.setItem("wordloom:ai-gemini-models", JSON.stringify({ models, ts: Date.now() })); } catch {}
      if (models.length > 0) {
        const msg = totalListed > models.length
          ? `${models.length} usable models (${totalListed - models.length} filtered out)`
          : `${models.length} models verified`;
        toast.success(msg);
      } else {
        toast.error(totalListed > 0 ? `Listed ${totalListed} models but none responded` : "Connected, no models returned");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDetectingGemini(false);
    }
  }, [draftValue, drafts.gemini_api_key]);

  const detectOpenaiModels = useCallback(async () => {
    setDetectingOpenai(true);
    try {
      const payload: Record<string, unknown> = { target: "openaiListModels", baseUrl: draftValue("openai_base_url"), verify: true };
      if (drafts.openai_api_key?.trim()) payload.apiKey = drafts.openai_api_key.trim();
      const res = await apiPost<SettingTestResponse>("/api/settings/test", payload);
      if (!res.ok) { toast.error(res.error?.message || "OpenAI model detection failed"); return; }
      const result = res.result as any;
      const models = result?.models ?? [];
      const totalListed = result?.totalListed ?? models.length;
      setOpenaiModels(models);
      try { sessionStorage.setItem("wordloom:ai-openai-models", JSON.stringify({ models, ts: Date.now() })); } catch {}
      if (models.length > 0) {
        const msg = totalListed > models.length
          ? `${models.length} usable models (${totalListed - models.length} filtered out)`
          : `${models.length} models verified`;
        toast.success(msg);
      } else {
        toast.error(totalListed > 0 ? `Listed ${totalListed} models but none responded` : "Connected, no models returned");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDetectingOpenai(false);
    }
  }, [draftValue, drafts.openai_api_key]);

  // --- Per-route test ---
  const testRoute = useCallback(async (routeKey: string, target: string, model: string, provider: ProviderType) => {
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
      setRouteHealth((prev) => ({ ...prev, [healthKey]: res }));
      toast[res.ok ? "success" : "error"](
        res.ok ? `${routeKey}: ${model} OK ${res.latencyMs ?? ""}ms` : `${routeKey}: ${res.error?.message ?? "failed"}`,
      );
    } catch (e) {
      const fail: SettingTestResponse = { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
      setRouteHealth((prev) => ({ ...prev, [healthKey]: fail }));
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingSingle(null);
    }
  }, [draftValue, drafts.gemini_api_key, drafts.openai_api_key]);

  const testAllRoutes = useCallback(async () => {
    setTestingAll(true);
    try {
      await Promise.allSettled(ROUTES.map((route) => {
        const provider = (draftValue(`${route.key}_provider`) || "gemini") as ProviderType;
        const primaryKey = provider === "openai"
          ? `${route.key}_openai_model`
          : route.key === "story" ? "story_model" : `${route.key}_model`;
        const model = draftValue(primaryKey) || (provider === "gemini"
          ? (route.key === "story" ? "gemini-2.5-pro" : (settings?.general_model || "gemini-2.5-flash"))
          : "");
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
      const pairs: Array<{ key: string; value: string; skipEmpty?: boolean }> = [
        { key: "gemini_api_key", value: drafts.gemini_api_key ?? "", skipEmpty: true },
        { key: "gemini_base_url", value: draftValue("gemini_base_url") },
        { key: "openai_api_key", value: drafts.openai_api_key ?? "", skipEmpty: true },
        { key: "openai_base_url", value: draftValue("openai_base_url") },
        { key: "gemini_tts_voice", value: draftValue("gemini_tts_voice") },
      ];
      for (const r of ROUTES) {
        pairs.push({ key: `${r.key}_provider`, value: draftValue(`${r.key}_provider`) });
        // Gemini model keys
        const gKey = r.key === "story" ? "story_model" : `${r.key}_model`;
        const gFb = r.key === "story" ? "story_fallback_model" : `${r.key}_fallback_model`;
        pairs.push({ key: gKey, value: draftValue(gKey) });
        pairs.push({ key: gFb, value: draftValue(gFb) });
        // OpenAI model keys
        pairs.push({ key: `${r.key}_openai_model`, value: draftValue(`${r.key}_openai_model`) });
        pairs.push({ key: `${r.key}_openai_fallback_model`, value: draftValue(`${r.key}_openai_fallback_model`) });
      }
      // Gemini TTS models
      pairs.push({ key: "gemini_tts_model", value: draftValue("gemini_tts_model") });
      pairs.push({ key: "gemini_tts_fallback_model", value: draftValue("gemini_tts_fallback_model") });

      for (const pair of pairs) {
        if (pair.skipEmpty && !pair.value.trim()) continue;
        await updateSetting.mutateAsync({ key: pair.key, value: pair.value.trim() });
      }
      toast.success("AI provider settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [drafts, draftValue, updateSetting]);

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
              <button type="button" onClick={() => setManualInput((p) => ({ ...p, [key]: false }))} className="text-[10px] text-sky-500 hover:underline">
                ← pick from list
              </button>
            )}
          </div>
          <Input
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
              <button type="button" onClick={() => setShowAllCandidates((p) => ({ ...p, [key]: !showAll }))} className="text-[10px] text-sky-500 hover:underline">
                {showAll ? "show less" : `show all (+${hiddenCount})`}
              </button>
            )}
            <button type="button" onClick={() => setManualInput((p) => ({ ...p, [key]: true }))} className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground">
              type manually
            </button>
          </div>
        </div>
        <select className={`${SELECT_CLASS} font-mono`} value={current} onChange={(e) => setDraft(key, e.target.value)}>
          {allowEmpty && <option value="">— inherit default —</option>}
          {visibleOptions.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
        {helper && <div className="text-[11px] text-muted-foreground/60">{helper}</div>}
      </div>
    );
  };

  // --- Computed ---
  const geminiTtsCandidates = useMemo(() => roleCandidates(geminiModels, "geminiTts"), [geminiModels]);

  // Dirty check
  const isDirty = useMemo(() => {
    if (!initialized || !settings) return false;
    // Check API key drafts
    if (drafts.gemini_api_key?.trim()) return true;
    if (drafts.openai_api_key?.trim()) return true;
    // Check all other keys
    const keys = Object.keys(drafts).filter((k) => k !== "gemini_api_key" && k !== "openai_api_key");
    return keys.some((k) => (drafts[k] ?? "") !== (settings[k] ?? GEMINI_DEFAULTS[k] ?? ""));
  }, [initialized, settings, drafts]);

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

  const getRouteModelKey = (routeKey: string, provider: ProviderType, suffix: string) => {
    if (provider === "openai") return `${routeKey}_openai_${suffix}`;
    return routeKey === "story" ? `story_${suffix}` : `${routeKey}_${suffix}`;
  };

  const resolveRuntimeModel = (routeKey: string, provider: ProviderType) => {
    const key = getRouteModelKey(routeKey, provider, "model");
    const val = draftValue(key);
    if (val) return val;
    if (provider === "gemini") {
      return routeKey === "story" ? "gemini-2.5-pro" : (settings?.general_model || "gemini-2.5-flash");
    }
    return "(not set)";
  };

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 md:px-6">
      <h1 className="text-xl font-semibold text-foreground">AI Providers</h1>

      {/* ══════════ GEMINI CONNECTION ══════════ */}
      <SectionHeader>Gemini Connection</SectionHeader>

      <SettingRow
        title="API Key"
        subtitle="留空表示保留已保存的 key"
        right={<Badge variant={hasGeminiKey ? "outline" : "destructive"} className="rounded-md text-[10px]">{hasGeminiKey ? "saved" : "missing"}</Badge>}
        defaultOpen={!hasGeminiKey}
      >
        <Input
          type="password"
          placeholder={hasGeminiKey ? "Saved — type to replace" : "Enter Gemini / relay API key"}
          value={drafts.gemini_api_key ?? ""}
          onChange={(e) => setDraft("gemini_api_key", e.target.value)}
          className={INPUT_CLASS}
        />
      </SettingRow>

      <SettingRow
        title="Base URL"
        subtitle="官方 API 留空；中转站填根地址"
        value={draftValue("gemini_base_url") || "official"}
      >
        <Input
          value={draftValue("gemini_base_url")}
          onChange={(e) => setDraft("gemini_base_url", e.target.value)}
          placeholder="Leave empty for Google official API"
          className={`${INPUT_CLASS} font-mono text-sm`}
        />
      </SettingRow>

      <SettingRow title="Models" value={`${geminiModels.length} detected`}>
        <div className="space-y-2">
          {geminiModels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {geminiModels.slice(0, 12).map((m) => (
                <span key={m} className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">{m}</span>
              ))}
              {geminiModels.length > 12 && <span className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">+{geminiModels.length - 12} more</span>}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/60">Click Detect Models below.</div>
          )}
        </div>
      </SettingRow>

      <div className="flex flex-wrap gap-2 py-3">
        <Button size="sm" variant="outline" onClick={detectGeminiModels} disabled={detectingGemini}>
          {detectingGemini ? <Loader2 className="size-3.5 animate-spin" /> : <Cpu className="size-3.5" />}
          Detect & Verify
        </Button>
      </div>

      {/* ══════════ OPENAI CONNECTION ══════════ */}
      <SectionHeader>OpenAI-Compatible Connection</SectionHeader>

      <SettingRow
        title="API Key"
        subtitle="DeepSeek / GLM / Kimi / 中转站的 key"
        right={<Badge variant={hasOpenaiKey ? "outline" : "destructive"} className="rounded-md text-[10px]">{hasOpenaiKey ? "saved" : "missing"}</Badge>}
        defaultOpen={!hasOpenaiKey}
      >
        <Input
          type="password"
          placeholder={hasOpenaiKey ? "Saved — type to replace" : "Enter OpenAI-compatible API key"}
          value={drafts.openai_api_key ?? ""}
          onChange={(e) => setDraft("openai_api_key", e.target.value)}
          className={INPUT_CLASS}
        />
      </SettingRow>

      <SettingRow
        title="Base URL"
        subtitle="如 https://api.deepseek.com"
        value={draftValue("openai_base_url") || "(not set)"}
        defaultOpen={!draftValue("openai_base_url")}
      >
        <Input
          value={draftValue("openai_base_url")}
          onChange={(e) => setDraft("openai_base_url", e.target.value)}
          placeholder="https://api.deepseek.com"
          className={`${INPUT_CLASS} font-mono text-sm`}
        />
      </SettingRow>

      <SettingRow title="Models" value={`${openaiModels.length} detected`}>
        <div className="space-y-2">
          {openaiModels.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {openaiModels.slice(0, 12).map((m) => (
                <span key={m} className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">{m}</span>
              ))}
              {openaiModels.length > 12 && <span className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">+{openaiModels.length - 12} more</span>}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/60">Click Detect Models below.</div>
          )}
        </div>
      </SettingRow>

      <div className="flex flex-wrap gap-2 py-3">
        <Button size="sm" variant="outline" onClick={detectOpenaiModels} disabled={detectingOpenai}>
          {detectingOpenai ? <Loader2 className="size-3.5 animate-spin" /> : <Cpu className="size-3.5" />}
          Detect & Verify
        </Button>
      </div>

      {/* ══════════ MODEL ROUTING ══════════ */}
      <SectionHeader>Model Routing</SectionHeader>

      <div className="flex flex-wrap gap-2 py-2 mb-1">
        <Button size="sm" variant="outline" onClick={testAllRoutes} disabled={testingAll}>
          {testingAll ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
          Test All Routes
        </Button>
      </div>

      {ROUTES.map((route) => {
        const provider = (draftValue(`${route.key}_provider`) || "gemini") as ProviderType;
        const models = provider === "openai" ? openaiModels : geminiModels;
        const candidates = roleCandidates(models, route.key);
        const primaryKey = getRouteModelKey(route.key, provider, "model");
        const fallbackKey = getRouteModelKey(route.key, provider, "fallback_model");
        const runtimeModel = resolveRuntimeModel(route.key, provider);
        const health = routeHealth[route.key];
        const healthLabel = health
          ? health.ok
            ? `${health.latencyMs ?? ""}ms`
            : (health.error?.message ?? "failed").slice(0, 40)
          : null;

        return (
          <SettingRow
            key={route.key}
            title={route.label}
            subtitle={route.subtitle}
            right={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  title={`Test ${route.label}`}
                  disabled={testingSingle === route.key || testingAll}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    testRoute(route.key, route.testTarget, runtimeModel, provider);
                  }}
                  className="rounded-md p-1 text-muted-foreground/40 hover:text-sky-500 hover:bg-sky-500/10 disabled:opacity-40 transition-colors"
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
                <span className="text-[12px] text-muted-foreground">{runtimeModel}</span>
              </div>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-[13px] font-medium text-foreground">Provider</div>
                <select
                  className={SELECT_CLASS}
                  value={provider}
                  onChange={(e) => setDraft(`${route.key}_provider`, e.target.value)}
                >
                  {PROVIDERS.map((p) => (<option key={p} value={p}>{p === "gemini" ? "Gemini" : "OpenAI-compatible"}</option>))}
                </select>
              </div>
              {modelField(primaryKey, "Primary Model", provider === "gemini" ? (route.key === "story" ? "gemini-2.5-pro" : "Leave empty to inherit") : "e.g. deepseek-chat", candidates, undefined, provider === "gemini" && route.key !== "story")}
              {modelField(fallbackKey, "Fallback Model", "Optional", candidates, "Primary 失败后尝试。", true)}
            </div>
          </SettingRow>
        );
      })}

      {/* ══════════ GEMINI TTS MODELS ══════════ */}
      <SectionHeader>Gemini TTS Models</SectionHeader>

      <SettingRow
        title="TTS Model"
        subtitle="Gemini 原生语音合成模型"
        value={draftValue("gemini_tts_model") || "gemini-2.5-flash-preview-tts"}
      >
        <div className="space-y-3">
          {modelField("gemini_tts_model", "Primary", GEMINI_DEFAULTS.gemini_tts_model, geminiTtsCandidates)}
          {modelField("gemini_tts_fallback_model", "Fallback", "Optional", geminiTtsCandidates, undefined, true)}
          <div className="space-y-1.5">
            <div className="text-[13px] font-medium">Gemini TTS Voice</div>
            <select
              className={SELECT_CLASS}
              value={draftValue("gemini_tts_voice")}
              onChange={(e) => setDraft("gemini_tts_voice", e.target.value)}
            >
              {GEMINI_VOICES.map((v) => (<option key={v} value={v}>{v}</option>))}
            </select>
          </div>
        </div>
      </SettingRow>

      {/* ── Sticky save bar ── */}
      {isDirty && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <span className="text-[12px] text-muted-foreground">Unsaved changes</span>
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
