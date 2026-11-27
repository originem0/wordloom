import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPut } from "@/client/lib/api";

export interface Settings {
  gemini_api_key: string; // "configured" or ""
  openai_api_key: string; // "configured" or ""
  [key: string]: string;
}

/** Admin-only on the server: a caller that may be a visitor passes `enabled`. */
export function useSettings({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Settings>("/api/settings"),
    enabled,
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (update: { key: string; value: string } | { changes: { key: string; value: string }[]; expectedRevision: string }) =>
      apiPut<{ ok: boolean; revision: string }>("/api/settings", update),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
