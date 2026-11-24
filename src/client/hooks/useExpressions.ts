import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/client/lib/api";
import type { CaptureRequest, EncounterRequest, ExpressionDetail, ExpressionListResponse, ExpressionPatch } from "@/shared/expressions";

// Private data. Every key starts with this prefix, and signing out drops the
// whole cache (useLogout), so nothing under it outlives the session.
export const EXPRESSIONS_KEY = ["expressions"] as const;

// The open page holds the list in the cache, so a missing list means the cache
// was dropped. What is still on its way then must not put an entry back.
const signedOut = (qc: QueryClient) => !qc.getQueryState(EXPRESSIONS_KEY);

// An answer from the server is final (401, or 503 while AUTH_TOKEN is unset);
// only a request that got none is worth repeating.
const retry = (failures: number, error: Error) => failures < 1 && !(error instanceof ApiError);

const fetchDetail = (id: number) => apiFetch<ExpressionDetail>(`/api/expressions/${id}`);

const send = (method: string, path: string, body: unknown = {}) =>
  apiFetch<ExpressionDetail>(`/api/expressions${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Admin-only on the server, so only ask when there is an admin to ask for. */
export function useExpressions(enabled: boolean) {
  return useQuery({ queryKey: EXPRESSIONS_KEY, queryFn: () => apiFetch<ExpressionListResponse>("/api/expressions"), enabled, retry });
}

export function useExpression(id: number | null) {
  return useQuery({ queryKey: [...EXPRESSIONS_KEY, id], queryFn: () => fetchDetail(id!), enabled: id !== null, retry });
}

function useWrite<V>(request: (vars: V) => Promise<ExpressionDetail>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    // Every write answers with the entry as it now is: keep that, and reload
    // only the list.
    onSuccess: (detail) => {
      if (signedOut(qc)) return;
      qc.setQueryData([...EXPRESSIONS_KEY, detail.id], detail);
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
