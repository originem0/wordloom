import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Cpu,
  Globe,
  Loader2,
  Moon,
  Monitor,
  PlayCircle,
  RefreshCcw,
  Sparkles,
  Sun,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/client/lib/api";
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
  | "cardsModel"
  | "deepModel"
  | "utilityModel"
  | "edgeTts"
  | "geminiTts"
  | "generalModel"
  | "ttsModel";

type SettingTestResponse = {
  ok: boolean;
  target?: SettingTestTarget;
  latencyMs?: number;
  warnings?: string[];
  requestUrl?: string;
  model?: string;
  result?: unknown;
  error?: {
    message?: string;
    hint?: string;
  };
  [key: string]: unknown;
};

type Drafts = Record<string, string>;
type HealthKey =
  | "apiKey"
  | "baseUrl"
  | "story"
  | "cards"
  | "deep"
  | "utility"
  | "edgeTts"
  | "geminiTts";
type HealthMap = Partial<Record<HealthKey, SettingTestResponse>>;

const DEFAULTS: Record<string, string> = {
  gemini_base_url: "",
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
  tts_preference: "browser",
  tts_provider_fallback: "",
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
const TTS_PROVIDERS = ["browser", "edge", "gemini"] as const;
const MODEL_RUNTIME_DEFAULTS = {
  story: "gemini-2.5-pro",
  shared: "gemini-2.5-flash",
  geminiTts: "gemini-2.5-flash-preview-tts",
} as const;

const PRIMARY_BUTTON = "bg-sky-600 text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400";
const INPUT_CLASS = "h-10 rounded-lg border-border/60 bg-background/80 focus-visible:ring-sky-500/20";
const SELECT_CLASS = "h-10 w-full rounded-lg border border-border/60 bg-background/80 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20";

/* ── Status dot ── */
function StatusDot({ res }: { res?: SettingTestResponse }) {
  if (!res) return <span className="inline-block size-2 rounded-full bg-muted-foreground/30" title="untested" />;
  return res.ok ? (
    <span className="inline-block size-2 rounded-full bg-emerald-500" title={`verified${res.latencyMs ? ` ${res.latencyMs}ms` : ""}`} />
  ) : (
    <span className="inline-block size-2 rounded-full bg-red-500" title="failed" />
  );
}

/* ── Section divider + label ── */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-border/50 pt-6 pb-2">
      <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground/60">{children}</div>
    </div>
  );
}

/* ── Flat expandable row ── */
function SettingRow({
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

function roleCandidates(models: string[], role: "story" | "cards" | "deep" | "utility" | "geminiTts") {
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

export function SettingsPage() {
  const settingsQuery = useSettings();
  const updateSetting = useUpdateSetting();
  const settings = settingsQuery.data;

  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [drafts, setDrafts] = useState<Drafts>({ gemini_api_key: "", ...DEFAULTS });
  const [initialized, setInitialized] = useState(false);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectingModels, setDetectingModels] = useState(false);
  const [health, setHealth] = useState<HealthMap>({});
  const [testingAll, setTestingAll] = useState(false);
  const [testingSingle, setTestingSingle] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  // Track which model fields are in manual-input mode
  const [manualInput, setManualInput] = useState<Record<string, boolean>>({});
  // Track whether each model field should show the full candidate list
  const [showAllCandidates, setShowAllCandidates] = useState<Record<string, boolean>>({});
  // Ensure auto-detect + auto-test only fires once per session
  const hasAutoTested = useRef(false);
  const AUTO_TEST_KEY = "wordloom:settings-auto-tested";
  const TEST_ALL_KEY = "wordloom:settings-test-all";
  const HEALTH_CACHE_KEY = "wordloom:settings-health";
  const MODELS_CACHE_KEY = "wordloom:settings-models";
  const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h safety window
  const TEST_TTL_MS = 5 * 60 * 1000; // resume test-all if navigated away recently
  const hasHydrated = useRef(false);


  useEffect(() => {
    if (!settings || initialized) return;
    setDrafts({
      gemini_api_key: "",
      gemini_base_url: settings.gemini_base_url ?? DEFAULTS.gemini_base_url,
      story_model: settings.story_model ?? DEFAULTS.story_model,
      story_fallback_model: settings.story_fallback_model ?? DEFAULTS.story_fallback_model,
      cards_model: settings.cards_model ?? settings.general_model ?? DEFAULTS.cards_model,
      cards_fallback_model:
        settings.cards_fallback_model ?? settings.general_fallback_model ?? DEFAULTS.cards_fallback_model,
      deep_model: settings.deep_model ?? settings.general_model ?? DEFAULTS.deep_model,
      deep_fallback_model:
        settings.deep_fallback_model ?? settings.general_fallback_model ?? DEFAULTS.deep_fallback_model,
      utility_model: settings.utility_model ?? settings.general_model ?? DEFAULTS.utility_model,
      utility_fallback_model:
        settings.utility_fallback_model ?? settings.general_fallback_model ?? DEFAULTS.utility_fallback_model,
      gemini_tts_model: settings.gemini_tts_model ?? settings.tts_model ?? DEFAULTS.gemini_tts_model,
      gemini_tts_fallback_model:
        settings.gemini_tts_fallback_model ?? settings.tts_fallback_model ?? DEFAULTS.gemini_tts_fallback_model,
      tts_preference: settings.tts_preference ?? DEFAULTS.tts_preference,
      tts_provider_fallback: settings.tts_provider_fallback ?? DEFAULTS.tts_provider_fallback,
      edge_tts_voice: settings.edge_tts_voice ?? DEFAULTS.edge_tts_voice,
      gemini_tts_voice: settings.gemini_tts_voice ?? DEFAULTS.gemini_tts_voice,
      analysis_language: settings.analysis_language ?? DEFAULTS.analysis_language,
      api_timeout_ms: settings.api_timeout_ms ?? DEFAULTS.api_timeout_ms,
      api_max_retries: settings.api_max_retries ?? DEFAULTS.api_max_retries,
    });
    setInitialized(true);
  }, [settings, initialized]);

  const hasSavedApiKey = settings?.gemini_api_key === "configured";

  const connectionSignature = useMemo(() => {
    const base = (drafts.gemini_base_url || settings?.gemini_base_url || "").trim().toLowerCase() || "official";
    const keyTag = drafts.gemini_api_key.trim()
      ? `draft:${drafts.gemini_api_key.trim().slice(0, 8)}`
      : hasSavedApiKey
        ? "saved"
        : "none";
    return `${base}|${keyTag}`;
  }, [drafts.gemini_api_key, drafts.gemini_base_url, hasSavedApiKey, settings?.gemini_base_url]);

  const scopedKey = useCallback((baseKey: string) => `${baseKey}:${connectionSignature}`, [connectionSignature]);

  const savedValue = useCallback(
    (key: string) => {
      if (key === "gemini_api_key") return "";
      return settings?.[key] ?? DEFAULTS[key] ?? "";
    },
    [settings],
  );

  const draftValue = useCallback((key: string) => drafts[key] ?? "", [drafts]);

  const resolveRuntimePrimary = useCallback(
    (route: "story" | "cards" | "deep" | "utility" | "geminiTts") => {
      if (route === "story") return draftValue("story_model") || MODEL_RUNTIME_DEFAULTS.story;
      if (route === "geminiTts") {
        return draftValue("gemini_tts_model") || settings?.tts_model || MODEL_RUNTIME_DEFAULTS.geminiTts;
      }
      const routeKey = `${route}_model`;
      return draftValue(routeKey) || settings?.general_model || MODEL_RUNTIME_DEFAULTS.shared;
    },
    [draftValue, settings],
  );

  const resolveRuntimeFallback = useCallback(
    (route: "story" | "cards" | "deep" | "utility" | "geminiTts") => {
      if (route === "story") return draftValue("story_fallback_model");
      if (route === "geminiTts") {
        return draftValue("gemini_tts_fallback_model") || settings?.tts_fallback_model || "";
      }
      const routeKey = `${route}_fallback_model`;
      return draftValue(routeKey) || settings?.general_fallback_model || "";
    },
    [draftValue, settings],
  );

  const dirtyKeys = useMemo(() => {
    if (!initialized) return [] as string[];
    return Object.keys(DEFAULTS)
      .filter((key) => draftValue(key) !== savedValue(key))
      .concat(drafts.gemini_api_key.trim() ? ["gemini_api_key"] : []);
  }, [draftValue, drafts.gemini_api_key, initialized, savedValue]);

  useEffect(() => {
    hasHydrated.current = false;
    hasAutoTested.current = false;
    setHealth({});
    setDetectedModels([]);
  }, [connectionSignature]);

  const buildTestPayload = useCallback(
    (target: SettingTestTarget, model?: string) => {
      const payload: Record<string, unknown> = {
        target,
        baseUrl: draftValue("gemini_base_url"),
      };
      if (drafts.gemini_api_key.trim()) payload.apiKey = drafts.gemini_api_key.trim();
      if (model) payload.model = model;
      return payload;
    },
    [drafts.gemini_api_key, draftValue],
  );

  const readCache = useCallback(<T,>(key: string, ttl = CACHE_TTL_MS): T | null => {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw) as { ts?: number } & T;
      if (!data.ts) return null;
      if (Date.now() - data.ts > ttl) return null;
      return data;
    } catch {
      return null;
    }
  }, []);

  const writeCache = useCallback((key: string, payload: Record<string, unknown>) => {
    try {
      sessionStorage.setItem(key, JSON.stringify({ ...payload, ts: Date.now() }));
    } catch {
      // ignore
    }
  }, []);


  const runProbe = useCallback(
    async (key: HealthKey, target: SettingTestTarget, model?: string) => {
      try {
        const res = await apiPost<SettingTestResponse>("/api/settings/test", buildTestPayload(target, model));
        const compact: SettingTestResponse = {
          ok: res.ok,
          target: res.target,
          latencyMs: res.latencyMs,
          error: res.error ? { message: res.error.message } : undefined,
        };
        setHealth((prev) => {
          const next = { ...prev, [key]: compact };
          writeCache(scopedKey(HEALTH_CACHE_KEY), { health: next });
          return next;
        });
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const fail: SettingTestResponse = { ok: false, target, error: { message: msg } };
        setHealth((prev) => {
          const next = { ...prev, [key]: fail };
          writeCache(scopedKey(HEALTH_CACHE_KEY), { health: next });
          return next;
        });
        throw e;
      }
    },
    [buildTestPayload, writeCache, scopedKey],
  );

  const detectModels = useCallback(async () => {
    setDetectingModels(true);
    try {
      const res = await apiPost<SettingTestResponse>("/api/settings/test", buildTestPayload("listModels"));
      if (!res.ok) {
        toast.error(res.error?.message || "Model detection failed");
        return;
      }
      const models = Array.isArray((res.result as { models?: unknown[] } | undefined)?.models)
        ? (((res.result as { models?: string[] }).models ?? []).map((m) => String(m)))
        : [];
      setDetectedModels(models);
      writeCache(scopedKey(MODELS_CACHE_KEY), { models });
      toast.success(models.length > 0 ? `Detected ${models.length} models` : "Connected, but no model list returned");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setDetectingModels(false);
    }
  }, [buildTestPayload, writeCache, scopedKey]);

  /* Per-route test */
  const testRoute = useCallback(
    async (key: HealthKey, target: SettingTestTarget, model: string) => {
      setTestingSingle(key);
      try {
        const res = await runProbe(key, target, model);
        toast[res.ok ? "success" : "error"](
          res.ok ? `${key}: ${model} ✓ ${res.latencyMs ?? ""}ms` : `${key}: ${res.error?.message ?? "failed"}`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setTestingSingle(null);
      }
    },
    [runProbe],
  );

  const testAll = useCallback(async () => {
    setTestingAll(true);
    writeCache(scopedKey(TEST_ALL_KEY), { inProgress: true });
    try {
      await Promise.allSettled([
        runProbe("apiKey", "apiKey"),
        runProbe("baseUrl", "baseUrl"),
        runProbe("story", "storyModel", resolveRuntimePrimary("story")),
        runProbe("cards", "cardsModel", resolveRuntimePrimary("cards")),
        runProbe("deep", "deepModel", resolveRuntimePrimary("deep")),
        runProbe("utility", "utilityModel", resolveRuntimePrimary("utility")),
        runProbe("edgeTts", "edgeTts"),
        runProbe("geminiTts", "geminiTts", resolveRuntimePrimary("geminiTts")),
      ]);
      toast.success("Capability matrix refreshed");
    } finally {
      setTestingAll(false);
      writeCache(scopedKey(TEST_ALL_KEY), { inProgress: false });
    }
  }, [resolveRuntimePrimary, runProbe, writeCache, scopedKey]);

  useEffect(() => {
    if (!initialized) return;
    if (hasAutoTested.current) return;
    if (!hasSavedApiKey && !drafts.gemini_api_key.trim()) return;

    let shouldRun = true;
    try {
      if (sessionStorage.getItem(scopedKey(AUTO_TEST_KEY)) === "1") shouldRun = false;
      else sessionStorage.setItem(scopedKey(AUTO_TEST_KEY), "1");
    } catch {
      try {
        const raw = localStorage.getItem(scopedKey(AUTO_TEST_KEY));
        const ts = raw ? Number(raw) : 0;
        if (ts && Date.now() - ts < CACHE_TTL_MS) shouldRun = false;
        else localStorage.setItem(scopedKey(AUTO_TEST_KEY), String(Date.now()));
      } catch {
        // ignore
      }
    }

    if (!shouldRun) return;

    hasAutoTested.current = true;
    detectModels().catch(() => undefined);
    testAll().catch(() => undefined);
  }, [initialized, connectionSignature]);

  // Hydrate cached models + health so results survive navigation
  useEffect(() => {
    if (!initialized || hasHydrated.current) return;
    hasHydrated.current = true;
    const cachedModels = readCache<{ models: string[] }>(scopedKey(MODELS_CACHE_KEY));
    if (cachedModels?.models?.length) setDetectedModels(cachedModels.models);
    const cachedHealth = readCache<{ health: HealthMap }>(scopedKey(HEALTH_CACHE_KEY));
    if (cachedHealth?.health) setHealth(cachedHealth.health);
  }, [initialized, connectionSignature]);

  // If Test All was running and user navigated away, resume when coming back
  useEffect(() => {
    if (!initialized || testingAll) return;
    const cached = readCache<{ inProgress?: boolean }>(scopedKey(TEST_ALL_KEY), TEST_TTL_MS);
    if (cached?.inProgress) testAll().catch(() => undefined);
  }, [initialized, testingAll, connectionSignature]);

  const savePairs = useCallback(
    async (label: string, pairs: Array<{ key: string; value: string; skipEmpty?: boolean }>) => {
      setSaving(label);
      try {
        for (const pair of pairs) {
          if (pair.skipEmpty && !pair.value.trim()) continue;
          await updateSetting.mutateAsync({ key: pair.key, value: pair.value.trim() });
        }
        toast.success(`${label} saved`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(null);
      }
    },
    [updateSetting],
  );

  const saveAll = useCallback(async () => {
    await savePairs("All settings", [
      { key: "gemini_api_key", value: drafts.gemini_api_key, skipEmpty: true },
      { key: "gemini_base_url", value: draftValue("gemini_base_url") },
      { key: "story_model", value: draftValue("story_model") },
      { key: "story_fallback_model", value: draftValue("story_fallback_model") },
      { key: "cards_model", value: draftValue("cards_model") },
      { key: "cards_fallback_model", value: draftValue("cards_fallback_model") },
      { key: "deep_model", value: draftValue("deep_model") },
      { key: "deep_fallback_model", value: draftValue("deep_fallback_model") },
      { key: "utility_model", value: draftValue("utility_model") },
      { key: "utility_fallback_model", value: draftValue("utility_fallback_model") },
      { key: "gemini_tts_model", value: draftValue("gemini_tts_model") },
      { key: "gemini_tts_fallback_model", value: draftValue("gemini_tts_fallback_model") },
      { key: "tts_preference", value: draftValue("tts_preference") },
      { key: "tts_provider_fallback", value: draftValue("tts_provider_fallback") },
      { key: "edge_tts_voice", value: draftValue("edge_tts_voice") },
      { key: "gemini_tts_voice", value: draftValue("gemini_tts_voice") },
      { key: "analysis_language", value: draftValue("analysis_language") },
      { key: "api_timeout_ms", value: draftValue("api_timeout_ms") },
      { key: "api_max_retries", value: draftValue("api_max_retries") },
    ]);
  }, [draftValue, drafts.gemini_api_key, savePairs]);

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

  const storyCandidates = useMemo(() => roleCandidates(detectedModels, "story"), [detectedModels]);
  const cardsCandidates = useMemo(() => roleCandidates(detectedModels, "cards"), [detectedModels]);
  const deepCandidates = useMemo(() => roleCandidates(detectedModels, "deep"), [detectedModels]);
  const utilityCandidates = useMemo(() => roleCandidates(detectedModels, "utility"), [detectedModels]);
  const geminiTtsCandidates = useMemo(() => roleCandidates(detectedModels, "geminiTts"), [detectedModels]);

  const legacySharedRoutingActive = Boolean(settings?.general_model || settings?.general_fallback_model);
  const legacyGeminiTtsActive = Boolean(settings?.tts_model || settings?.tts_fallback_model);

  /* Which TTS providers are active (primary or fallback) */
  const activeProviders = useMemo(() => {
    const set = new Set<string>();
    const prim = draftValue("tts_preference");
    const fb = draftValue("tts_provider_fallback");
    if (prim) set.add(prim);
    if (fb) set.add(fb);
    return set;
  }, [draftValue]);

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

  const modelPreview = detectedModels.slice(0, 12);

  /* ── Model picker: select from detected models, with manual fallback ── */
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

    // Build option list: candidates + current value if not in list
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
      // Fallback: plain text input
      return (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-medium text-foreground">{label}</div>
            {hasDetected && (
              <button
                type="button"
                onClick={() => setManualInput((p) => ({ ...p, [key]: false }))}
                className="text-[10px] text-sky-500 hover:underline"
              >
                ← pick from list
              </button>
            )}
          </div>
          <Input
            value={current}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
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
              <button
                type="button"
                onClick={() => setShowAllCandidates((p) => ({ ...p, [key]: !showAll }))}
                className="text-[10px] text-sky-500 hover:underline"
              >
                {showAll ? "show less" : `show all (+${hiddenCount})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setManualInput((p) => ({ ...p, [key]: true }))}
              className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground"
            >
              type manually
            </button>
          </div>
        </div>
        <select
          className={`${SELECT_CLASS} font-mono`}
          value={current}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
        >
          {allowEmpty && <option value="">— inherit default —</option>}
          {visibleOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        {helper && <div className="text-[11px] text-muted-foreground/60">{helper}</div>}
      </div>
    );
  };

  /* ── Plain text field (non-model) ── */
  const textField = (key: string, label: string, placeholder: string, helper?: string) => (
    <div className="space-y-1.5">
      <div className="text-[13px] font-medium text-foreground">{label}</div>
      <Input
        value={draftValue(key)}
        onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        className={`${INPUT_CLASS} font-mono text-sm`}
      />
      {helper && <div className="text-[11px] text-muted-foreground/60">{helper}</div>}
    </div>
  );

  const saveTheme = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };

  /* Per-route test button */
  const routeTestBtn = (healthKey: HealthKey, target: SettingTestTarget, model: string) => (
    <button
      type="button"
      title={`Test ${healthKey}`}
      disabled={testingSingle === healthKey || testingAll}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        testRoute(healthKey, target, model);
      }}
      className="rounded-md p-1 text-muted-foreground/40 hover:text-sky-500 hover:bg-sky-500/10 disabled:opacity-40 transition-colors"
    >
      {testingSingle === healthKey ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Zap className="size-3" />
      )}
    </button>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 md:px-6">
      <h1 className="text-xl font-semibold text-foreground">Settings</h1>

      {/* ══════════ CONNECTION ══════════ */}
      <SectionHeader>Connection</SectionHeader>

      <SettingRow
        title="API Key"
        subtitle="留空表示保留已保存的 key"
        right={
          <div className="flex items-center gap-2">
            <StatusDot res={health.apiKey} />
            <Badge variant={hasSavedApiKey ? "outline" : "destructive"} className="rounded-md text-[10px]">
              {hasSavedApiKey ? "saved" : "missing"}
            </Badge>
          </div>
        }
        defaultOpen={!hasSavedApiKey}
      >
        <Input
          type="password"
          placeholder={hasSavedApiKey ? "Saved — type a new key only to replace" : "Enter your Gemini / relay API key"}
          value={drafts.gemini_api_key}
          onChange={(e) => setDrafts((prev) => ({ ...prev, gemini_api_key: e.target.value }))}
          className={INPUT_CLASS}
        />
      </SettingRow>

      <SettingRow
        title="Base URL"
        subtitle="官方 API 留空；中转站填根地址，不带 /v1"
        right={
          <div className="flex items-center gap-2">
            <StatusDot res={health.baseUrl} />
            <span className="max-w-[160px] truncate text-[12px] text-muted-foreground">
              {draftValue("gemini_base_url") || "official"}
            </span>
          </div>
        }
      >
        <div className="space-y-3">
          {textField("gemini_base_url", "Base URL", "Leave empty for Google official API, or set https://x666.me")}
          {health.baseUrl?.warnings?.[0] && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              {health.baseUrl.warnings[0]}
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow
        title="Model Discovery"
        value={`${detectedModels.length} detected`}
        defaultOpen={detectedModels.length === 0}
      >
        <div className="space-y-3">
          {modelPreview.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {modelPreview.map((model) => (
                <span key={model} className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {model}
                </span>
              ))}
              {detectedModels.length > modelPreview.length && (
                <span className="rounded-md border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground">
                  +{detectedModels.length - modelPreview.length} more
                </span>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground/60">No models detected yet. Click Detect Models below.</div>
          )}
        </div>
      </SettingRow>

      <div className="flex flex-wrap gap-2 py-3">
        <Button size="sm" variant="outline" onClick={detectModels} disabled={detectingModels}>
          {detectingModels ? <Loader2 className="size-3.5 animate-spin" /> : <Cpu className="size-3.5" />}
          Detect Models
        </Button>
        <Button size="sm" variant="outline" onClick={testAll} disabled={testingAll}>
          {testingAll ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
          Test All
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runProbe("baseUrl", "baseUrl").catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}
        >
          <Globe className="size-3.5" />
          Test URL
        </Button>
      </div>

      {/* ══════════ MODELS & ROUTING ══════════ */}
      <SectionHeader>Models & Routing</SectionHeader>

      {(legacySharedRoutingActive || legacyGeminiTtsActive) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 mb-2 text-[11px] text-muted-foreground/80">
          Legacy fallback settings 还在库里。留空时会先继承旧的 general / tts 配置。
        </div>
      )}

      {detectedModels.length === 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 mb-2 text-[11px] text-muted-foreground/70">
          尚未检测到可用模型。请先在上方 Connection 区域点击 Detect Models，下面的选择器才能列出模型。
        </div>
      )}

      <SettingRow
        title="Story"
        subtitle="图片 → 故事生成"
        right={
          <div className="flex items-center gap-2">
            {routeTestBtn("story", "storyModel", resolveRuntimePrimary("story"))}
            <StatusDot res={health.story} />
            <span className="text-[12px] text-muted-foreground">{resolveRuntimePrimary("story")}</span>
          </div>
        }
      >
        <div className="space-y-3">
          {modelField("story_model", "Primary", DEFAULTS.story_model, storyCandidates)}
          {modelField("story_fallback_model", "Fallback", "Optional", storyCandidates, "Primary 挂了之后再试。", true)}
        </div>
      </SettingRow>

      <SettingRow
        title="Cards"
        subtitle="短 JSON、稳定结构"
        right={
          <div className="flex items-center gap-2">
            {routeTestBtn("cards", "cardsModel", resolveRuntimePrimary("cards"))}
            <StatusDot res={health.cards} />
            <span className="text-[12px] text-muted-foreground">{resolveRuntimePrimary("cards")}</span>
          </div>
        }
      >
        <div className="space-y-3">
          {modelField("cards_model", "Primary", "Leave empty to inherit", cardsCandidates, "卡片生成偏向稳定、快、规整。", true)}
          {modelField("cards_fallback_model", "Fallback", "Optional", cardsCandidates, undefined, true)}
        </div>
      </SettingRow>

      <SettingRow
        title="Deep Analysis"
        subtitle="长 JSON、schemaAnalysis、SVG"
        right={
          <div className="flex items-center gap-2">
            {routeTestBtn("deep", "deepModel", resolveRuntimePrimary("deep"))}
            <StatusDot res={health.deep} />
            <span className="text-[12px] text-muted-foreground">{resolveRuntimePrimary("deep")}</span>
          </div>
        }
      >
        <div className="space-y-3">
          {modelField("deep_model", "Primary", "Leave empty to inherit", deepCandidates, "深层分析容易把便宜模型打崩。", true)}
          {modelField("deep_fallback_model", "Fallback", "Optional", deepCandidates, undefined, true)}
        </div>
      </SettingRow>

      <SettingRow
        title="Utility"
        subtitle="抽词、翻译、轻量文本"
        right={
          <div className="flex items-center gap-2">
            {routeTestBtn("utility", "utilityModel", resolveRuntimePrimary("utility"))}
            <StatusDot res={health.utility} />
            <span className="text-[12px] text-muted-foreground">{resolveRuntimePrimary("utility")}</span>
          </div>
        }
      >
        <div className="space-y-3">
          {modelField("utility_model", "Primary", "Leave empty to inherit", utilityCandidates, "便宜快就行。", true)}
          {modelField("utility_fallback_model", "Fallback", "Optional", utilityCandidates, undefined, true)}
        </div>
      </SettingRow>

      {/* ══════════ TTS ══════════ */}
      <SectionHeader>TTS</SectionHeader>

      <SettingRow
        title="Provider"
        subtitle="选哪个 provider，就只看到它的配置"
        right={
          <div className="flex items-center gap-2">
            {activeProviders.has("edge") && <StatusDot res={health.edgeTts} />}
            {activeProviders.has("gemini") && <StatusDot res={health.geminiTts} />}
            <span className="text-[12px] text-muted-foreground">
              {draftValue("tts_preference")}{draftValue("tts_provider_fallback") ? ` → ${draftValue("tts_provider_fallback")}` : ""}
            </span>
          </div>
        }
        defaultOpen
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-[13px] font-medium">Primary</div>
              <select
                className={SELECT_CLASS}
                value={draftValue("tts_preference")}
                onChange={(e) => setDrafts((prev) => ({ ...prev, tts_preference: e.target.value }))}
              >
                {TTS_PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <div className="text-[13px] font-medium">Fallback</div>
              <select
                className={SELECT_CLASS}
                value={draftValue("tts_provider_fallback")}
                onChange={(e) => setDrafts((prev) => ({ ...prev, tts_provider_fallback: e.target.value }))}
              >
                <option value="">none</option>
                {TTS_PROVIDERS.filter((p) => p !== draftValue("tts_preference")).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Conditional: Edge config */}
          {activeProviders.has("edge") && (
            <div className="space-y-1.5">
              <div className="text-[13px] font-medium">Edge TTS voice</div>
              <select
                className={SELECT_CLASS}
                value={draftValue("edge_tts_voice")}
                onChange={(e) => setDrafts((prev) => ({ ...prev, edge_tts_voice: e.target.value }))}
              >
                {EDGE_VOICES.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          )}

          {/* Conditional: Gemini config */}
          {activeProviders.has("gemini") && (
            <div className="space-y-3">
              {modelField("gemini_tts_model", "Gemini TTS model", DEFAULTS.gemini_tts_model, geminiTtsCandidates)}
              {modelField("gemini_tts_fallback_model", "Gemini TTS fallback", "Optional", geminiTtsCandidates, undefined, true)}
              <div className="space-y-1.5">
                <div className="text-[13px] font-medium">Gemini TTS voice</div>
                <select
                  className={SELECT_CLASS}
                  value={draftValue("gemini_tts_voice")}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, gemini_tts_voice: e.target.value }))}
                >
                  {GEMINI_VOICES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Browser needs no config */}
          {draftValue("tts_preference") === "browser" && !draftValue("tts_provider_fallback") && (
            <div className="text-[11px] text-muted-foreground/60">
              Browser TTS uses your device's built-in speech synthesis. No additional configuration needed.
            </div>
          )}
        </div>
      </SettingRow>

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
      <div className="py-3 text-[13px] leading-6 text-muted-foreground/70">
        <span className="font-medium text-foreground">WordLoom</span> — AI-powered English learning workspace: generate compact image-based stories, listen with TTS, double-click words into cards, and explore deep vocabulary analysis in one loop.
      </div>

      {/* ── Sticky bottom save bar ── */}
      {dirtyKeys.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur px-4 py-3">
          <div className="mx-auto flex max-w-2xl items-center justify-between">
            <span className="text-[12px] text-muted-foreground">{dirtyKeys.length} unsaved change{dirtyKeys.length > 1 ? "s" : ""}</span>
            <Button
              className={PRIMARY_BUTTON}
              onClick={saveAll}
              disabled={saving === "All settings"}
            >
              {saving === "All settings" && <Loader2 className="size-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
