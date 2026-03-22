import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPut } from "@/client/lib/api";

export interface Settings {
  gemini_api_key: string; // "configured" or ""
  openai_api_key: string; // "configured" or ""
  tts_preference: string; // "browser" | "edge" | "gemini"
  [key: string]: string;
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => apiFetch<Settings>("/api/settings"),
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiPut("/api/settings", { key, value }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}
