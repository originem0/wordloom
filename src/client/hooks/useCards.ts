import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/client/lib/api";
import type { Card, CardSummary } from "@/shared/types";

export function useCards(
  params: { search?: string; cefr?: string; page?: number; limit?: number },
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["cards", params],
    networkMode: "offlineFirst",
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.search) sp.set("search", params.search);
      if (params.cefr) sp.set("cefr", params.cefr);
      if (params.page) sp.set("page", String(params.page));
      if (params.limit) sp.set("limit", String(params.limit));
      return apiFetch<{ cards: CardSummary[]; total: number; page: number; limit: number }>(`/api/cards?${sp}`);
    },
    placeholderData: (prev) => prev,
    enabled,
  });
}

export function useExtractWords() {
  return useMutation({
    mutationFn: (text: string) =>
      apiPost<{ words: string[] }>("/api/cards/extract", { text }),
  });
}

/** Older cached lists can seed the full card. Current summaries need a detail request. */
export function useCard(id: number | null, initialData?: Card) {
  return useQuery({
    queryKey: ["cards", "detail", id],
    networkMode: "offlineFirst",
    queryFn: () => apiFetch<Card>(`/api/cards/${id}`),
    enabled: id !== null,
    initialData,
  });
}

export function useGenerateDeep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cardId: number) => {
      const result = await apiPost<Card | { jobId: string }>(`/api/cards/${cardId}/deep?async=1`, {});
      if (!("jobId" in result)) return result;
      for (;;) {
        const job = await apiFetch<{ status: string; error?: string }>(`/api/jobs/${result.jobId}`);
        if (job.status === "done") return apiFetch<Card>(`/api/cards/${cardId}`);
        if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error || "Generation stopped");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    },
    // Both the open detail and the count of cards awaiting analysis change.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

/** Admin-only on the server, so only ask when there is an admin to ask for. */
export function useMissingDeep(enabled: boolean) {
  return useQuery({
    queryKey: ["cards", "missing-deep"],
    queryFn: () => apiFetch<{ cards: Array<{ id: number; word: string }>; total: number; batch?: { id: string; status: string; progress: { done: number; total: number; fail: number } | null } }>("/api/cards/missing-deep"),
    refetchInterval: (query) => ["running","queued"].includes(query.state.data?.batch?.status ?? "") ? 1500 : false,
    enabled,
  });
}

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cardId: number) =>
      apiFetch(`/api/cards/${cardId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}
