import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { useSpeech } from "@/client/hooks/useSpeech";
import { apiFetch } from "@/client/lib/api";
import { useI18n } from "@/client/lib/i18n";
import type { RimePreview, RimeVoices } from "@/shared/rime";
import { SELECT_CLASS } from "./SettingWidgets";

type Props = {
  model: string; speaker: string; speed: string; apiKey: string; hasSavedKey: boolean;
  setDraft: (key: string, value: string) => void;
};

const voiceName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

export function RimeVoiceSettings({ model, speaker, speed, apiKey, hasSavedKey, setDraft }: Props) {
  const { t } = useI18n();
  const catalog = useQuery({
    queryKey: ["rime", "voices", "en"],
    queryFn: ({ signal }) => apiFetch<RimeVoices>("/api/settings/rime/voices", { signal }),
    staleTime: 60 * 60 * 1000,
  });
  const selectedModel = model === "mist" ? "mist" : "coda";
  const voices = catalog.data?.[selectedModel] ?? [];
  const preview = useMemo<RimePreview>(() => ({
    model: selectedModel, speaker, speed: Number(speed), ...(apiKey.trim() && { apiKey: apiKey.trim() }),
  }), [selectedModel, speaker, speed, apiKey]);
  const { state, error, toggle } = useSpeech(preview, () => {
    toast.success(t(`${voiceName(speaker)} 试听成功`, `${voiceName(speaker)} is ready to use`));
  });

  function changeModel(next: RimePreview["model"]) {
    const options = catalog.data?.[next];
    if (!options?.length) return;
    setDraft("rime_model", next);
    if (!options.includes(speaker)) setDraft("rime_speaker", options.includes("astra") ? "astra" : options[0]);
  }

  const canPreview = hasSavedKey || !!preview.apiKey;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5 text-[13px] font-medium text-foreground">
          <span>{t("模型", "Model")}</span>
          <select aria-label={t("Rime 模型", "Rime Model")} className={SELECT_CLASS} value={selectedModel}
            disabled={!catalog.data} onChange={(e) => changeModel(e.target.value === "mist" ? "mist" : "coda")}>
            <option value="coda">Coda</option><option value="mist">Mist v3</option>
          </select>
        </label>
        <label className="space-y-1.5 text-[13px] font-medium text-foreground">
          <span>{t("英语音色", "English voice")}</span>
          <select aria-label={t("Rime 声音", "Rime Voice")} className={SELECT_CLASS} value={speaker}
            disabled={!voices.length} onChange={(e) => setDraft("rime_speaker", e.target.value)}>
            {!voices.includes(speaker) && <option value={speaker}>{voiceName(speaker)}{catalog.data && t("（目录未列出）", " (unlisted)")}</option>}
            {voices.map((id) => <option key={id} value={id}>{voiceName(id)}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 text-[13px] font-medium text-foreground">
          <span>{t("语速", "Speed")}</span>
          <select aria-label={t("Rime 语速", "Rime Speed")} className={SELECT_CLASS} value={speed}
            onChange={(e) => setDraft("rime_speed", e.target.value)}>
            {[...new Set(["0.8", "1", "1.2", speed])].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
        </label>
      </div>
      {catalog.isPending && <p role="status" className="text-sm text-muted-foreground">{t("正在读取英语音色…", "Loading English voices…")}</p>}
      {catalog.isError && <div role="alert" className="flex items-center gap-2 text-sm">
        {t("未能读取 Rime 音色目录。", "Could not load the Rime voice catalog.")}
        <Button size="sm" variant="outline" onClick={() => void catalog.refetch()}>{t("重试", "Retry")}</Button>
      </div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={!canPreview}
          aria-pressed={state !== "idle"} onClick={toggle}>
          {state === "loading" ? <Loader2 className="size-4 animate-spin" /> : state === "playing" ? <Square className="size-4" /> : <Volume2 className="size-4" />}
          {state === "loading" ? t("准备中，点此停止", "Preparing audio · stop") : state === "playing" ? t("停止试听", "Stop preview") : t("测试并试听", "Test voice")}
        </Button>
        {!canPreview && <span className="text-sm text-muted-foreground">{t("输入 Rime API 密钥即可试听。", "Enter a Rime API key to test a voice.")}</span>}
        {error && <span role="alert" className="text-sm text-destructive">{error.setup ? t("请检查 Rime API 密钥后重试。", "Check your Rime API key and try again.") : error.message}</span>}
      </div>
    </div>
  );
}
