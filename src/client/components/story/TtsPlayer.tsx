import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, Square, Volume2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/client/components/ui/tabs";
import { useSettings } from "@/client/hooks/useSettings";

interface TtsPlayerProps {
  storyId: number;
  storyText: string;
}

// ---- Browser TTS (Web Speech API) ----

function BrowserTtsPlayer({ storyText }: { storyText: string }) {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    window.speechSynthesis.getVoices();
    const onVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
  }, [supported]);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setPlaying(false);
    setPaused(false);
    utteranceRef.current = null;
  }, []);

  const play = useCallback(() => {
    if (!supported) return;

    if (paused) {
      window.speechSynthesis.resume();
      setPaused(false);
      return;
    }

    window.speechSynthesis.cancel();

    const utt = new SpeechSynthesisUtterance(storyText);
    utt.rate = 0.9;
    utt.lang = "en-US";

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        (v.name.includes("Google") ||
          v.name.includes("Microsoft") ||
          v.name.includes("Samantha") ||
          v.name.includes("Daniel") ||
          !v.localService),
    ) ?? voices.find((v) => v.lang.startsWith("en"));
    if (preferred) utt.voice = preferred;

    utt.onend = () => {
      setPlaying(false);
      setPaused(false);
      utteranceRef.current = null;
    };
    utt.onerror = (e) => {
      if (e.error !== "canceled") console.error("Speech error:", e.error);
      setPlaying(false);
      setPaused(false);
      utteranceRef.current = null;
    };

    utteranceRef.current = utt;
    window.speechSynthesis.speak(utt);
    setPlaying(true);
    setPaused(false);
  }, [storyText, paused, supported]);

  const pause = useCallback(() => {
    window.speechSynthesis.pause();
    setPaused(true);
  }, []);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

  if (!supported) {
    return <p className="text-sm text-muted-foreground">浏览器不支持语音合成</p>;
  }

  return (
    <div className="flex items-center gap-2">
      {!playing ? (
        <Button variant="outline" size="sm" onClick={play}>
          <Play className="size-3.5" />
          播放
        </Button>
      ) : (
        <>
          <Button variant="outline" size="sm" onClick={paused ? play : pause}>
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "继续" : "暂停"}
          </Button>
          <Button variant="outline" size="sm" onClick={stop}>
            <Square className="size-3.5" />
            停止
          </Button>
        </>
      )}
    </div>
  );
}

// ---- Server TTS (Edge / Gemini) with loading & error states ----

function ServerTtsPlayer({
  storyId,
  provider,
}: {
  storyId: number;
  provider: "edge" | "gemini";
}) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Clean up blob URL on unmount or re-generate
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const generate = useCallback(async () => {
    setState("loading");
    setErrorMsg("");
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    try {
      const res = await fetch(`/api/stories/${storyId}/tts?provider=${provider}`);
      if (!res.ok) {
        let msg = `Server error ${res.status}`;
        try {
          const json = await res.json();
          if (json.error) msg = json.error;
        } catch {
          /* not JSON */
        }
        throw new Error(msg);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("audio/")) {
        throw new Error("Server returned non-audio response");
      }

      const blob = await res.blob();
      if (blob.size === 0) throw new Error("Empty audio response");

      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setState("ready");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }, [storyId, provider, audioUrl]);

  if (state === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={generate}>
        <Play className="size-3.5" />
        生成语音
      </Button>
    );
  }

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在生成语音…
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" />
          {errorMsg}
        </div>
        <Button variant="outline" size="sm" onClick={generate}>
          重试
        </Button>
      </div>
    );
  }

  // state === "ready"
  return (
    <div className="flex items-center gap-2">
      <Volume2 className="size-4 text-muted-foreground" />
      <audio
        src={audioUrl!}
        controls
        autoPlay
        className="h-8 w-full max-w-xs"
      />
      <Button variant="ghost" size="sm" onClick={generate} title="重新生成">
        ↻
      </Button>
    </div>
  );
}

// ---- Combined player ----

export function TtsPlayer({ storyId, storyText }: TtsPlayerProps) {
  const { data: settings } = useSettings();
  const pref = settings?.tts_preference;
  const preferred =
    pref === "browser" || pref === "edge" || pref === "gemini" ? pref : "edge";

  return (
    <Tabs key={preferred} defaultValue={preferred} className="w-full">
      <TabsList>
        <TabsTrigger value="browser">浏览器朗读</TabsTrigger>
        <TabsTrigger value="edge">Edge TTS（免费）</TabsTrigger>
        <TabsTrigger value="gemini">Gemini TTS</TabsTrigger>
      </TabsList>
      <TabsContent value="browser" className="pt-2">
        <BrowserTtsPlayer storyText={storyText} />
      </TabsContent>
      <TabsContent value="edge" className="pt-2">
        <ServerTtsPlayer storyId={storyId} provider="edge" />
      </TabsContent>
      <TabsContent value="gemini" className="pt-2">
        <ServerTtsPlayer storyId={storyId} provider="gemini" />
      </TabsContent>
    </Tabs>
  );
}
