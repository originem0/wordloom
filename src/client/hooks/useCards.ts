import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/client/lib/api";
import type { Card, CardGenerateResult } from "@/shared/types";

export function useCards(params: { search?: string; cefr?: string }) {
  return useQuery({
    queryKey: ["cards", params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.search) sp.set("search", params.search);
      if (params.cefr) sp.set("cefr", params.cefr);
      return apiFetch<{ cards: Card[]; total: number }>(`/api/cards?${sp}`);
    },
  });
}

export function useCard(id: number) {
  return useQuery({
    queryKey: ["cards", id],
    queryFn: () => apiFetch<Card>(`/api/cards/${id}`),
    enabled: !!id,
  });
}

export function useGenerateCards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (words: string[]) =>
      apiPost<CardGenerateResult>("/api/cards/generate", { words }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
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
    onSuccess: (data: Card) => qc.setQueryData(["cards", data.id], data),
  });
}

export function useIncrementUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cardId: number) =>
      apiFetch<Card>(`/api/cards/${cardId}/usage`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cards"] }),
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
