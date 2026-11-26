import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, apiResponse } from "@/client/lib/api";
import { readSSE } from "@/shared/sse";
import type {
  AttemptRequest, AttemptResponse, CaptureRequest, EncounterRequest, ExpressionDetail, ExpressionListResponse, ExpressionPatch,
  OverturnRequest, PickResponse, RevealRequest, SceneResponse, StatsResponse, TalkListResponse, TalkRequest, TalkThreadResponse, TalkTurn,
  TryResponse,
} from "@/shared/expressions";

// Private data. Every key starts with this prefix, and signing out drops the
// whole cache (useLogout), so nothing under it outlives the session.
export const EXPRESSIONS_KEY = ["expressions"] as const;
const STATS_KEY = [...EXPRESSIONS_KEY, "stats"] as const;
const DELETED_KEY = [...EXPRESSIONS_KEY, "deleted"] as const;

// The open page holds the list in the cache, so a missing list means the cache
// was dropped. What is still on its way then must not put an entry back.
const signedOut = (qc: QueryClient) => !qc.getQueryState(EXPRESSIONS_KEY);

// An answer from the server is final (401, or 503 while AUTH_TOKEN is unset);
// only a request that got none is worth repeating.
const retry = (failures: number, error: Error) => failures < 1 && !(error instanceof ApiError);

const read = <T>(path: string) => apiFetch<T>(`/api/expressions${path}`);
const fetchDetail = (id: number) => read<ExpressionDetail>(`/${id}`);

const send = <T = ExpressionDetail>(method: string, path: string, body: unknown = {}) =>
  apiFetch<T>(`/api/expressions${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Admin-only on the server, so only ask when there is an admin to ask for. */
export function useExpressions(enabled: boolean) {
  return useQuery({ queryKey: EXPRESSIONS_KEY, queryFn: () => read<ExpressionListResponse>(""), enabled, retry });
}

export function useExpression(id: number | null) {
  return useQuery({ queryKey: [...EXPRESSIONS_KEY, id], queryFn: () => fetchDetail(id!), enabled: id !== null, retry });
}

/** The numbers on the page: how many entries were produced, and the two day counts. */
export function useStats(enabled: boolean) {
  return useQuery({ queryKey: STATS_KEY, queryFn: () => read<StatsResponse>("/stats"), enabled, retry });
}

/** The second hint in 试一条: where the entry was met, with its focus blanked out. Reading it writes nothing. */
export function useScene(id: number, enabled: boolean) {
  return useQuery({ queryKey: [...EXPRESSIONS_KEY, id, "scene"], queryFn: () => read<SceneResponse>(`/${id}/scene`), enabled, retry });
}

function useWrite<V>(request: (vars: V) => Promise<ExpressionDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    // Every write answers with the entry as it now is: keep that, and reload
    // only the list and the numbers.
    onSuccess: (detail) => {
      if (signedOut(qc) || qc.getQueryData<Set<number>>(DELETED_KEY)?.has(detail.id)) return;
      qc.setQueryData([...EXPRESSIONS_KEY, detail.id], detail);
      void qc.invalidateQueries({ queryKey: STATS_KEY });
      return qc.invalidateQueries({ queryKey: EXPRESSIONS_KEY, exact: true });
    },
  });
}

export const useCapture = () => useWrite((body: CaptureRequest) => send("POST", "", body));
export const useMetAgain = () =>
  useWrite(({ id, ...body }: EncounterRequest & { id: number }) => send("POST", `/${id}/encounters`, body));
export const usePatchExpression = () =>
  useWrite(({ id, ...patch }: ExpressionPatch & { id: number }) => send("PATCH", `/${id}`, patch));
export const useAnnotate = () => useWrite((id: number) => send("POST", `/${id}/annotate`));

export function useDeleteExpression() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => send<void>("DELETE", `/${id}`),
    gcTime: 0,
    onSuccess: async (_, id) => {
      if (signedOut(qc)) return;
      // A list read or annotation already in flight must not restore the entry
      // after deletion. The id-only markers are cleared with the private cache.
      qc.setQueryData<Set<number>>(DELETED_KEY, (ids) => new Set([...(ids ?? []), id]));
      await qc.cancelQueries({ queryKey: EXPRESSIONS_KEY });
      if (signedOut(qc)) return;
      qc.removeQueries({ queryKey: [...EXPRESSIONS_KEY, id] });
      qc.setQueryData<ExpressionListResponse>(EXPRESSIONS_KEY, (list) => list && ({ ...list, expressions: list.expressions.filter((entry) => entry.id !== id) }));
      void qc.invalidateQueries({ queryKey: EXPRESSIONS_KEY, predicate: (query) => query.queryKey[1] !== id && query.queryKey[2] !== "scene" });
    },
  });
}

/**
 * A reveal, an attempt, a turn of 对谈. What these answer with is not the
 * entry as the page may keep it: a judgement, the hits, or the English of a
 * masked entry this once. So the answer goes to the caller and nowhere else
 * (a reveal left in the cache would be shown again with no row saying so), and
 * since each of them wrote to a timeline, whatever is on screen of the library
 * is read again. Except the scenes in 试一条: none of these writes changes
 * where an entry was first met.
 */
function useAct<V, R>(request: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  // Not waited for: the caller gets its answer before the lists have reloaded.
  // After signing out there is nothing left to reload, so no guard is needed.
  const reload = () => void qc.invalidateQueries({ queryKey: EXPRESSIONS_KEY, predicate: (q) => q.queryKey[2] !== "scene" });
  return useMutation({ mutationFn: request, gcTime: 0, onSuccess: reload });
}

/** Answers with the entry unmasked, once. Hold it in the component that asked; the next read is masked again. */
export const useReveal = () => useAct(({ id, cue }: RevealRequest & { id: number }) => send("POST", `/${id}/reveal`, { cue }));
export const useAttempt = () =>
  useAct(({ id, ...body }: AttemptRequest & { id: number }) => send<AttemptResponse>("POST", `/${id}/attempts`, body));
/** Asks again for a judgement that did not come back; it lands on the same row. */
export const useJudge = () => useAct((encounterId: number) => send<AttemptResponse>("POST", `/attempts/${encounterId}/judge`));
export const useOverturn = () =>
  useAct(({ encounterId, outcome }: OverturnRequest & { encounterId: number }) =>
    send<AttemptResponse>("POST", `/attempts/${encounterId}/overturn`, { outcome }));
export function useTalk(onDelta?: (text: string) => void) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return useAct(async (body: TalkRequest) => {
    if (!onDelta) return send<TalkTurn>("POST", "/talk", body);
    const controller = new AbortController();
    active.current = controller;
    try {
      const res = await apiResponse("/api/expressions/talk", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body),
      });
      if (!res.headers.get("content-type")?.includes("text/event-stream")) return await res.json() as TalkTurn;
      if (!res.body) throw new ApiError("Reply stream missing", 0);
      for await (const event of readSSE(res.body)) {
        const data = JSON.parse(event.data) as { text?: string; turn?: TalkTurn; error?: string; code?: string };
        if (event.event === "delta" && typeof data.text === "string") onDelta(data.text);
        if (event.event === "done" && data.turn) return data.turn;
        if (event.event === "error") {
          const status = data.code === "NOT_FOUND" ? 404 : data.code === "STREAM_FAILED" ? 0 : 502;
          throw new ApiError(data.error ?? "Reply failed", status, data.code, data);
        }
      }
      throw new ApiError("Reply stream interrupted", 0);
    } finally {
      if (active.current === controller) active.current = null;
    }
  });
}

export const useRetryCoaching = () => useAct((id: number) => send<TalkTurn>("POST", `/talk/turn/${id}/coach`));
/** Forgets a conversation: its turns, not what they left on the timelines. */
export const useDropThread = () => useAct((thread: number) => send<unknown>("DELETE", `/talk/${thread}`));

/** The conversations of 对谈, latest first. Titles only, each as the library stands now. */
export function useTalkThreads(enabled: boolean) {
  return useQuery({ queryKey: [...EXPRESSIONS_KEY, "talk"], queryFn: () => read<TalkListResponse>("/talk"), enabled, retry });
}

// Asked for by hand, held by whoever asked, never in the query cache. 帮我挑
// writes nothing. 试一条 must not change under a sentence being typed, which a
// query reloading itself after every write would do; nor may the turns of a
// conversation, where the answer to a message shows more than a later read does.
export const usePick = () => useMutation({ mutationFn: (text: string) => send<PickResponse>("POST", "/pick", { text }), gcTime: 0 });
export const useTalkThread = () => useMutation({ mutationFn: (thread: number) => read<TalkThreadResponse>(`/talk/${thread}`), gcTime: 0 });
/** At most three entries that are due; `exclude` is the ids already on screen (ids are not private text). */
export const useTry = () =>
  useMutation({ mutationFn: (exclude: number[]) => read<TryResponse>(`/try${exclude.length ? `?exclude=${exclude.join(",")}` : ""}`), gcTime: 0 });

const GLOSS_TRIES = 3;
const GLOSS_WAIT_MS = 3000;

/**
 * A fresh entry gets its gloss after the response has gone out, and nothing
 * tells the page when. Look again a few times, a few seconds apart, then leave
 * it to the 补注 button. Returns the id being watched and how to start a watch.
 */
export function useGlossWatch() {
  const qc = useQueryClient();
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    if (id === null) return;
    let tries = 0;
    const timer = setInterval(async () => {
      if (signedOut(qc)) return clearInterval(timer);
      if (++tries >= GLOSS_TRIES) clearInterval(timer);
      const detail = await qc
        .fetchQuery({ queryKey: [...EXPRESSIONS_KEY, id], queryFn: () => fetchDetail(id), staleTime: 0 })
        .catch(() => null);
      // A newer entry may have taken this one's place: end only this watch.
      if (detail?.annotated || tries >= GLOSS_TRIES) setId((current) => (current === id ? null : current));
    }, GLOSS_WAIT_MS);
    return () => clearInterval(timer);
  }, [id, qc]);
  return [id, setId] as const;
}
