import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/client/lib/api";
import type { Chunk, ChunkGenerateResult, ChunkPayload } from "@/shared/types";

export interface ChunkListParams {
  search?: string;
  category?: string;
  frequency?: string;
  page?: number;
  limit?: number;
}

export function useChunks(params: ChunkListParams) {
  return useQuery({
    queryKey: ["chunks", params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.search) sp.set("search", params.search);
      if (params.category) sp.set("category", params.category);
      if (params.frequency) sp.set("frequency", params.frequency);
      if (params.page) sp.set("page", String(params.page));
      if (params.limit) sp.set("limit", String(params.limit));
      return apiFetch<{
        chunks: Chunk[];
        total: number;
        page: number;
        limit: number;
      }>(`/api/chunks?${sp}`);
    },
    placeholderData: (prev) => prev,
  });
}

export function useChunk(id: number) {
  return useQuery({
    queryKey: ["chunks", id],
    queryFn: () => apiFetch<Chunk>(`/api/chunks/${id}`),
    enabled: !!id,
  });
}

export function useGenerateChunk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string) =>
      apiPost<ChunkGenerateResult>("/api/chunks/generate", { input }),
    onSuccess: (data) => {
      if (data.chunk) {
        qc.invalidateQueries({ queryKey: ["chunks"] });
      }
    },
  });
}

export function useUpdateChunk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<ChunkPayload> }) =>
      apiFetch<Chunk>(`/api/chunks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["chunks", data.id], data);
      qc.invalidateQueries({ queryKey: ["chunks"] });
    },
  });
}

export function useIncrementChunkUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<Chunk>(`/api/chunks/${id}/usage`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chunks"] }),
  });
}

export function useDeleteChunk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/chunks/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chunks"] }),
  });
}
