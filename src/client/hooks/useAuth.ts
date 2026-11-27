import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, apiPost } from "@/client/lib/api";
import { queryClient } from "@/client/lib/query-client";
import { useTaskStore } from "@/client/store/tasks";
import { translate } from "@/client/lib/i18n";
import { useReadingStore } from "@/client/store/reading";

import { useOpenThread, useLastSource } from "../components/expressions/shared";
import { broadcastLogout, expireSession, SESSION_ENDED } from "@/client/lib/session";

function clearPrivateData() {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith("wordloom:ai-")) sessionStorage.removeItem(key);
  } catch { /* Storage may be disabled. */ }
  useTaskStore.getState().reset();
  useReadingStore.getState().reset();
  useOpenThread.setState({ thread: undefined, visit: 0 });
  useLastSource.setState({ source: null });
  queryClient.clear();
  queryClient.setQueryData(AUTH_QUERY_KEY, { authenticated: false });
}

export function useSessionEvents() {
  const navigate = useNavigate();
  useEffect(() => {
    const leave = () => {
      clearPrivateData();
      void navigate("/login", { replace: true });
    };
    const storage = (event: StorageEvent) => { if (event.key === SESSION_ENDED) leave(); };
    window.addEventListener(SESSION_ENDED, leave);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(SESSION_ENDED, leave);
      window.removeEventListener("storage", storage);
    };
  }, [navigate]);
}

export const AUTH_QUERY_KEY = ["auth", "me"] as const;

const authQuery = {
  queryKey: AUTH_QUERY_KEY,
  refetchOnWindowFocus: "always" as const,
  queryFn: async () => {
    const me = await apiFetch<{ authenticated: boolean }>("/api/auth/me");
    if (!me.authenticated && queryClient.getQueryData<{ authenticated: boolean }>(AUTH_QUERY_KEY)?.authenticated) expireSession();
    return me;
  },
};

/**
 * Whether the current browser holds an admin session.
 * False while loading and on error: admin-only controls fail closed.
 */
export function useIsAdmin(): boolean {
  const { data } = useQuery(authQuery);
  return data?.authenticated === true;
}

/**
 * The same answer for a caller that must not act on a guess: undefined while
 * it is unknown. That is the first load, and also a cached "no" that is being
 * asked again: right after login the cache still holds the visitor's answer.
 */
export function useAdminOnceKnown(): boolean | undefined {
  const { data, isPending, isFetching } = useQuery(authQuery);
  const isAdmin = data?.authenticated === true;
  return isPending || (!isAdmin && isFetching) ? undefined : isAdmin;
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
      toast.error(translate("退出登录失败，请重试。", "Sign-out failed. Please try again."));
      return;
    }
    clearPrivateData();
    broadcastLogout();
    navigate("/login", { replace: true });
  }, [navigate]);
}
