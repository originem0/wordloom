import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/client/lib/api";

export const AUTH_QUERY_KEY = ["auth", "me"] as const;

/**
 * Whether the current browser holds an admin session.
 * False while loading and on error: admin-only controls fail closed.
 */
export function useIsAdmin(): boolean {
  const { data } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: () => apiFetch<{ authenticated: boolean }>("/api/auth/me"),
  });
  return data?.authenticated === true;
}
