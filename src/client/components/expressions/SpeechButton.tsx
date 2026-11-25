import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Loader2, Square, Volume2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { useSpeech } from "@/client/hooks/useSpeech";
import { useI18n } from "@/client/lib/i18n";

/** A quiet action beside a reply: the text remains the focus of the turn. */
export function SpeechButton({ turnId, disabled = false }: { turnId: number; disabled?: boolean }) {
  const { t } = useI18n();
  const { state, error, toggle, stop } = useSpeech(turnId);
  useEffect(() => { if (disabled) stop(); }, [disabled, stop]);
  const active = state !== "idle";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button" variant="ghost" size="sm" className="min-h-10 text-muted-foreground"
        disabled={disabled} aria-pressed={active} aria-label={active ? t("停止朗读", "Stop reading") : t("听语音", "Listen")} onClick={toggle}
      >
        {state === "loading" ? <Loader2 aria-hidden className="size-4 animate-spin" />
          : active ? <Square aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />}
        {state === "loading" ? t("准备语音，点此停止", "Preparing audio; click to stop") : active ? t("停止朗读", "Stop reading") : t("听语音", "Listen")}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error.message}{error.setup && <Link to="/providers" className="ml-1 underline">{t("去设置", "Open settings")}</Link>}
        </span>
      )}
    </span>
  );
}
