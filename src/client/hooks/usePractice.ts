import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/client/lib/api";
import type { Practice, PracticeFeedback } from "@/shared/types";

export function usePractices(params?: { page?: number; limit?: number }) {
  const qc = useQueryClient();

  const practicesQuery = useQuery({
    queryKey: ["practices", params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params?.page) sp.set("page", String(params.page));
      if (params?.limit) sp.set("limit", String(params.limit));
      return apiFetch<{ practices: Practice[]; total: number; page: number; limit: number }>(
        `/api/practice?${sp}`,
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/practice/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["practices"] }),
  });

  return { practicesQuery, deleteMutation };
}

/** Grade a description against a practice — synchronous, not persisted. */
export function useGradePractice() {
  return useMutation({
    mutationFn: (input: { id: number; description: string }) =>
      apiPost<PracticeFeedback>(`/api/practice/${input.id}/grade`, {
        description: input.description,
      }),
  });
}
