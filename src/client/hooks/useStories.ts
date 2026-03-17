import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/client/lib/api";
import type { Story } from "@/shared/types";

export function useStories() {
  const qc = useQueryClient();

  const storiesQuery = useQuery({
    queryKey: ["stories"],
    queryFn: () => apiFetch<Story[]>("/api/stories"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/stories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stories"] }),
  });

  return { storiesQuery, deleteMutation };
}

export function useTranslate() {
  return useMutation({
    mutationFn: (storyId: number) =>
      apiPost<{ translation: string }>(`/api/stories/${storyId}/translate`, {}),
  });
}
