import { useState } from "react";
import { Key, Volume2, Sun, Moon, Monitor, Info, Loader2, Globe, Cpu } from "lucide-react";
import { toast } from "sonner";
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

// ── API Key Section ─────────────────────────────────────────────────
function ApiKeySection() {
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();
  const [apiKey, setApiKey] = useState("");

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
        </div>
      </CardContent>
    </Card>
  );
}

// ── API Base URL Section ────────────────────────────────────────────
function BaseUrlSection() {
  const { data: settings } = useSettings();
  const updateSetting = useUpdateSetting();
  const [url, setUrl] = useState("");

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
        </div>
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
      </div>
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
