import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/client/lib/api";
import type { Story } from "@/shared/types";

export function useStories(params?: { page?: number; limit?: number }) {
  const qc = useQueryClient();

  const storiesQuery = useQuery({
    queryKey: ["stories", params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params?.page) sp.set("page", String(params.page));
      if (params?.limit) sp.set("limit", String(params.limit));
      return apiFetch<{ stories: Story[]; total: number; page: number; limit: number }>(`/api/stories?${sp}`);
    },
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
