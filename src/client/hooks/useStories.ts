import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/client/lib/api";
import type { Story } from "@/shared/types";

export function useStories() {
  const qc = useQueryClient();

  const storiesQuery = useQuery({
    queryKey: ["stories"],
    queryFn: () => apiFetch<Story[]>("/api/stories"),
  });

  const generateMutation = useMutation({
    mutationFn: async ({ image, prompt }: { image: File; prompt: string }) => {
      const form = new FormData();
      form.append("image", image);
      form.append("prompt", prompt);
      const res = await fetch("/api/stories/generate", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Generate failed: ${res.status}`);
      }
      return res.json() as Promise<Story>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stories"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/stories/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stories"] }),
  });

  return { storiesQuery, generateMutation, deleteMutation };
}

export function useTranslate() {
  return useMutation({
    mutationFn: (storyId: number) =>
      apiPost<{ translation: string }>(`/api/stories/${storyId}/translate`, {}),
  });
}
