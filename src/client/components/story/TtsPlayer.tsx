import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, Square, Volume2 } from "lucide-react";
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

  // Load voices eagerly -- some browsers populate the list async
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

    // Fresh playback
    window.speechSynthesis.cancel();

    const utt = new SpeechSynthesisUtterance(storyText);
    utt.rate = 0.9;
    utt.lang = "en-US";

    // Pick best English voice
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

  // Cleanup on unmount
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

// ---- Edge TTS (server-side, free) ----

function EdgeTtsPlayer({ storyId }: { storyId: number }) {
  return (
    <div className="flex items-center gap-2">
      <Volume2 className="size-4 text-muted-foreground" />
      <audio
        src={`/api/stories/${storyId}/tts?provider=edge`}
        controls
        preload="none"
        className="h-8 w-full max-w-xs"
      />
    </div>
  );
}

// ---- Gemini TTS (server-side audio) ----

function GeminiTtsPlayer({ storyId }: { storyId: number }) {
  return (
    <div className="flex items-center gap-2">
      <Volume2 className="size-4 text-muted-foreground" />
      <audio
        src={`/api/stories/${storyId}/tts?provider=gemini`}
        controls
        preload="none"
        className="h-8 w-full max-w-xs"
      />
    </div>
  );
}

// ---- Combined player ----

export function TtsPlayer({ storyId, storyText }: TtsPlayerProps) {
  const { data: settings } = useSettings();
  const pref = settings?.tts_preference;
  const preferred =
    pref === "browser" || pref === "edge" || pref === "gemini" ? pref : "browser";

  // Radix Tabs only respects defaultValue on mount, so we key by preference.
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
        <EdgeTtsPlayer storyId={storyId} />
      </TabsContent>
      <TabsContent value="gemini" className="pt-2">
        <GeminiTtsPlayer storyId={storyId} />
      </TabsContent>
    </Tabs>
  );
}
