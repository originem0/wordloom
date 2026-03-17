import { useState } from "react";
import { Key, Volume2, Sun, Moon, Monitor, Info, Loader2, Globe, Cpu, PlayCircle } from "lucide-react";
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
  // passthrough fields for debugging
  [key: string]: unknown;
};

function TestResultView({ res }: { res: SettingTestResponse | null }) {
  if (!res) return null;

  const ok = Boolean(res.ok);
  const title = ok ? "OK" : "FAIL";
  const message = ok
    ? `OK${typeof res.latencyMs === "number" ? ` (${res.latencyMs}ms)` : ""}`
    : (res.error?.message as string | undefined) || "Test failed";

  const hint = !ok ? (res.error?.hint as string | undefined) : undefined;

  return (
    <div className="mt-2 space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className={ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
          {title}
        </span>
        {res.model && <span className="font-mono text-muted-foreground">{String(res.model)}</span>}
      </div>
      <div className="text-foreground/90">{message}</div>
      {hint && <div className="text-muted-foreground">Hint: {hint}</div>}
      {import.meta.env.MODE !== "production" && (
        <details className="pt-1">
          <summary className="cursor-pointer text-muted-foreground">details</summary>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2">
            {JSON.stringify(res, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── API Key Section ─────────────────────────────────────────────────
function ApiKeySection() {
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();
  const [apiKey, setApiKey] = useState("");
  const [testRes, setTestRes] = useState<SettingTestResponse | null>(null);
  const [testing, setTesting] = useState(false);

  const isConfigured = settings?.gemini_api_key === "configured";

  function handleSave() {
    if (!apiKey.trim()) return;
    updateSetting.mutate(
      { key: "gemini_api_key", value: apiKey.trim() },
      {
        onSuccess: () => {
          toast.success("API key saved");
          setApiKey("");
        },
        onError: (err: Error) => toast.error(err.message),
      },
    );
  }

  async function handleTest() {
    setTesting(true);
    try {
      const payload: Record<string, unknown> = { target: "apiKey" satisfies SettingTestTarget };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      const res = await apiPost<SettingTestResponse>("/api/settings/test", payload);
      setTestRes(res);

      if (res.ok) {
        const count = (res.result as any)?.modelCount;
        toast.success(typeof count === "number" ? `API key OK (${count} models)` : "API key OK");
      } else {
        toast.error((res.error?.message as string | undefined) || "API key test failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      setTestRes({ ok: false, error: { message: msg } });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="size-4" />
          Gemini API Key
        </CardTitle>
        <CardDescription>
          Required for AI story generation and Gemini TTS.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isConfigured && (
          <Badge
            variant="outline"
            className="border-green-500/40 text-green-600 dark:text-green-400"
          >
            ✓ Configured
          </Badge>
        )}

        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="Enter your Gemini API Key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button
            onClick={handleSave}
            disabled={!apiKey.trim() || updateSetting.isPending}
          >
            {updateSetting.isPending && (
              <Loader2 className="size-4 animate-spin" />
            )}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || (!apiKey.trim() && !isConfigured)}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlayCircle className="size-4" />
            )}
            Test
          </Button>
        </div>

        <TestResultView res={testRes} />
      </CardContent>
    </Card>
  );
}

// ── API Base URL Section ────────────────────────────────────────────
function BaseUrlSection() {
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();
  const [url, setUrl] = useState("");
  const [testRes, setTestRes] = useState<SettingTestResponse | null>(null);
  const [testing, setTesting] = useState(false);

  const current = settings?.gemini_base_url ?? "";

  function handleSave() {
    updateSetting.mutate(
      { key: "gemini_base_url", value: url.trim() },
      {
        onSuccess: () => {
          toast.success("Base URL saved");
          setUrl("");
        },
        onError: (err: Error) => toast.error(err.message),
      },
    );
  }

  function handleClear() {
    updateSetting.mutate(
      { key: "gemini_base_url", value: "" },
      {
        onSuccess: () => toast.success("Reset to default Google API"),
        onError: (err: Error) => toast.error(err.message),
      },
    );
  }

  async function handleTest() {
    setTesting(true);
    try {
      const baseUrl = url.trim() || current;
      const payload: Record<string, unknown> = { target: "baseUrl" satisfies SettingTestTarget };
      if (baseUrl) payload.baseUrl = baseUrl;
      const res = await apiPost<SettingTestResponse>("/api/settings/test", payload);
      setTestRes(res);
      if (res.ok) {
        toast.success("Base URL OK");
      } else {
        toast.error((res.error?.message as string | undefined) || "Base URL test failed");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      setTestRes({ ok: false, error: { message: msg } });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4" />
          API Base URL
        </CardTitle>
        <CardDescription>
          Leave empty for Google official API. Set a proxy URL if you use a relay service.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {current && (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {current}
            </Badge>
            <Button variant="ghost" size="sm" onClick={handleClear}>
              Reset
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="https://your-proxy.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button
            onClick={handleSave}
            disabled={!url.trim() || updateSetting.isPending}
          >
            Save
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlayCircle className="size-4" />
            )}
            Test
          </Button>
        </div>

        <TestResultView res={testRes} />
      </CardContent>
    </Card>
  );
}

// ── Model Configuration Section ─────────────────────────────────────
function ModelSection() {
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();

  const models = [
    { key: "story_model", label: "Story Model", fallback: "gemini-2.5-pro", desc: "Used for image → story generation" },
    { key: "general_model", label: "General Model", fallback: "gemini-2.5-flash", desc: "Used for cards, translation, extraction" },
    { key: "tts_model", label: "TTS Model", fallback: "gemini-2.5-flash-preview-tts", desc: "Used for AI voice narration" },
  ];

  function handleSave(key: string, value: string) {
    updateSetting.mutate(
      { key, value: value.trim() },
      {
        onSuccess: () => toast.success("Model saved"),
        onError: (err: Error) => toast.error(err.message),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="size-4" />
          Models
        </CardTitle>
        <CardDescription>
          Override model names. Leave empty for defaults.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {models.map(({ key, label, fallback, desc }) => {
          const current = settings?.[key] ?? "";
          return (
            <ModelInput
              key={key}
              settingKey={key}
              label={label}
              fallback={fallback}
              desc={desc}
              current={current}
              onSave={handleSave}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

function ModelInput({ settingKey, label, fallback, desc, current, onSave }: {
  settingKey: string; label: string; fallback: string; desc: string; current: string;
  onSave: (key: string, value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [testRes, setTestRes] = useState<SettingTestResponse | null>(null);
  const [testing, setTesting] = useState(false);

  const effectiveModel = (value.trim() || current || fallback).trim();

  const target: SettingTestTarget | null =
    settingKey === "story_model"
      ? "storyModel"
      : settingKey === "general_model"
        ? "generalModel"
        : settingKey === "tts_model"
          ? "ttsModel"
          : null;

  async function handleTest() {
    if (!target) return;
    setTesting(true);
    try {
      const res = await apiPost<SettingTestResponse>("/api/settings/test", {
        target,
        model: effectiveModel,
      });
      setTestRes(res);

      if (res.ok) {
        toast.success(`${label}: OK`);
      } else {
        toast.error((res.error?.message as string | undefined) || `${label}: test failed`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
      setTestRes({ ok: false, error: { message: msg } });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">
          {current || fallback}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
      <div className="flex gap-2">
        <Input
          placeholder={fallback}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() && onSave(settingKey, value)}
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          onClick={() => { onSave(settingKey, value); setValue(""); }}
          disabled={!value.trim()}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={testing || !target}
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlayCircle className="size-4" />
          )}
          Test
        </Button>
      </div>

      <TestResultView res={testRes} />
    </div>
  );
}

// ── TTS Preference ──────────────────────────────────────────────────
function TtsSection() {
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();

  const current = settings?.tts_preference ?? "browser";

  function handleChange(value: string) {
    updateSetting.mutate(
      { key: "tts_preference", value },
      { onError: (err) => toast.error(err.message) },
    );
  }

  const options = [
    {
      value: "browser",
      label: "Browser TTS (Offline)",
      desc: "Uses your browser's built-in speech synthesis",
    },
    {
      value: "edge",
      label: "Edge TTS (Free)",
      desc: "Server-side Microsoft Edge Read Aloud voices (English)",
    },
    {
      value: "gemini",
      label: "Gemini TTS (AI Voice)",
      desc: "Higher quality, requires API key and network",
    },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="size-4" />
          TTS Preference
        </CardTitle>
        <CardDescription>
          Choose how stories are read aloud.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              current === opt.value
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-accent/50"
            }`}
          >
            <input
              type="radio"
              name="tts"
              value={opt.value}
              checked={current === opt.value}
              onChange={() => handleChange(opt.value)}
              className="mt-0.5 accent-primary"
            />
            <div>
              <div className="text-sm font-medium">{opt.label}</div>
              <div className="text-xs text-muted-foreground">{opt.desc}</div>
            </div>
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

// ── Theme Section ───────────────────────────────────────────────────
function ThemeSection() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  function handleChange(next: Theme) {
    setTheme(next);
    applyTheme(next);
  }

  const options: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
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
          Stored locally in your browser.
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

// ── About Section ───────────────────────────────────────────────────
function AboutSection() {
  return (
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
          Upload an image, let AI craft a children's story, and hear it read
          aloud. Build vocabulary with Word Forge flash cards.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export function SettingsPage() {
  const { isLoading, error } = useSettings();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-destructive">
        Failed to load settings: {error.message}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h2 className="text-2xl font-semibold">Settings</h2>
      <ApiKeySection />
      <BaseUrlSection />
      <ModelSection />
      <TtsSection />
      <ThemeSection />
      <AboutSection />
    </div>
  );
}
