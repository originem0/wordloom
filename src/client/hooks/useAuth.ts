import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, apiPost } from "@/client/lib/api";
import { queryClient } from "@/client/lib/query-client";
import { useTaskStore } from "@/client/store/tasks";

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

/**
 * Ends the admin session and forgets what this browser read under it: the
 * settings, the admin's lists and the tasks being followed. Dropping the whole
 * query cache rather than naming keys means a private query added later cannot
 * be left out; the public card list simply loads again.
 */
export function useLogout() {
  const navigate = useNavigate();
  return useCallback(async () => {
    try {
      await apiPost("/api/auth/logout", {});
    } catch {
      // The session is still live on the server; leaving for the login page
      // would claim otherwise.
      toast.error("退出登录失败，请重试");
      return;
    }
    useTaskStore.getState().reset();
    queryClient.clear();
    navigate("/login", { replace: true });
  }, [navigate]);
}
