import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/client/lib/api";
import type { Card } from "@/shared/types";

export function useCards(
  params: { search?: string; cefr?: string; page?: number; limit?: number },
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["cards", params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.search) sp.set("search", params.search);
      if (params.cefr) sp.set("cefr", params.cefr);
      if (params.page) sp.set("page", String(params.page));
      if (params.limit) sp.set("limit", String(params.limit));
      return apiFetch<{ cards: Card[]; total: number; page: number; limit: number }>(`/api/cards?${sp}`);
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

export function useGenerateDeep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cardId: number) =>
      apiPost<Card>(`/api/cards/${cardId}/deep`, {}),
    // The list rows carry the deep layer too. A card opened again from a stale
    // list would look as if it had never been analysed.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
  });
}

/** Admin-only on the server, so only ask when there is an admin to ask for. */
export function useMissingDeep(enabled: boolean) {
  return useQuery({
    queryKey: ["cards", "missing-deep"],
    queryFn: () => apiFetch<{ cards: Array<{ id: number; word: string }>; total: number }>("/api/cards/missing-deep"),
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
