import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Loader2, Square, Volume2 } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { useSpeech } from "@/client/hooks/useSpeech";

/** A quiet action beside a reply: the text remains the focus of the turn. */
export function SpeechButton({ turnId, disabled = false }: { turnId: number; disabled?: boolean }) {
  const { state, error, toggle, stop } = useSpeech(turnId);
  useEffect(() => { if (disabled) stop(); }, [disabled, stop]);
  const active = state !== "idle";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button" variant="ghost" size="sm" className="min-h-10 text-muted-foreground"
        disabled={disabled} aria-pressed={active} aria-label={active ? "停止朗读" : "听语音"} onClick={toggle}
      >
        {state === "loading" ? <Loader2 aria-hidden className="size-4 animate-spin" />
          : active ? <Square aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />}
        {state === "loading" ? "准备语音，点此停止" : active ? "停止朗读" : "听语音"}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error.message}{error.setup && <Link to="/providers" className="ml-1 underline">去设置</Link>}
        </span>
      )}
    </span>
  );
}
