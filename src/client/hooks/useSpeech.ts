import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type State = "idle" | "loading" | "playing";
type Problem = { message: string; setup?: boolean };
type Playback = { controller: AbortController; context: AudioContext; source: AudioBufferSourceNode | null };

// One voice at a time, across every turn. Nothing is kept in browser storage.
let active: { playback: Playback; stop: () => void } | null = null;

const problems: Record<string, Problem> = {
  "not configured": { message: "朗读还没配好。", setup: true },
  timeout: { message: "语音等太久了，可以再点一次。" },
  busy: { message: "语音服务正忙，稍后再点。" },
  failed: { message: "没能生成语音，可以再点一次。" },
};

class PlaybackError extends Error {
  constructor(readonly problem: Problem) { super(problem.message); }
}

/** A click activates the audio context before the network wait, so mobile
 * browsers recognize the playback as user initiated. Decoding uses Web Audio
 * without a blob URL, matching the app's existing content security policy. */
export function useSpeech(turnId: number) {
  const qc = useQueryClient();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<Problem | null>(null);
  const playback = useRef<Playback | null>(null);
  const alive = useRef(true);

  const stop = useCallback(() => {
    const current = playback.current;
    if (!current) return;
    playback.current = null;
    const source = current.source;
    current.controller.abort();
    try { source?.stop(); } catch { /* It may already have ended. */ }
    void current.context.close().catch(() => {});
    if (active?.playback === current) active = null;
    if (alive.current) setState("idle");
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stop(); };
  }, [stop, turnId]);

  const toggle = async () => {
    if (playback.current) { stop(); return; }
    active?.stop();
    setError(null);
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) { setError({ message: "这个浏览器暂时不能播放语音。" }); return; }
    let current: Playback;
    try {
      current = { controller: new AbortController(), context: new Context(), source: null };
    } catch {
      setError({ message: "浏览器没能播放语音。" });
      return;
    }
    playback.current = current;
    active = { playback: current, stop };
    setState("loading");
    try {
      await current.context.resume();
      for (let part = 0, total = 1; part < total; part++) {
        const res = await fetch("/api/expressions/speech", {
          method: "POST", credentials: "include", signal: current.controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turn: turnId, part }),
        });
        if (res.status === 401) {
          qc.clear();
          throw new PlaybackError({ message: "登录已失效。" });
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { reason?: string; code?: string };
          throw new PlaybackError(body.code === "SPEECH_EMPTY" ? { message: "这条回复没有可以朗读的文字。" }
            : res.status === 404 ? { message: "这条回复已经删掉了。" } : problems[body.reason ?? "failed"] ?? problems.failed);
        }
        total = Number(res.headers.get("X-Speech-Parts"));
        if (!Number.isInteger(total) || total < 1 || total > 32) throw new PlaybackError(problems.failed);
        const audio = await current.context.decodeAudioData(await res.arrayBuffer());
        if (playback.current !== current) return;
        setState("playing");
        await new Promise<void>((resolve) => {
          const source = current.context.createBufferSource();
          current.source = source;
          source.buffer = audio;
          source.connect(current.context.destination);
          const finish = () => {
            current.controller.signal.removeEventListener("abort", finish);
            source.disconnect();
            if (current.source === source) current.source = null;
            resolve();
          };
          source.onended = finish;
          current.controller.signal.addEventListener("abort", finish, { once: true });
          source.start();
        });
        if (playback.current !== current) return;
        if (part + 1 < total) setState("loading");
      }
    } catch (e) {
      if (playback.current === current && !current.controller.signal.aborted) {
        setError(e instanceof PlaybackError ? e.problem : { message: "没能播放语音，可以再点一次。" });
      }
    } finally {
      if (playback.current === current) stop();
    }
  };

  return { state, error, toggle, stop };
}
