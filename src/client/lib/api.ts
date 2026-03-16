/**
 * Thin fetch wrapper that always sends credentials (httpOnly cookie).
 * Hono RPC client (hc<AppType>) would be ideal, but the client tsconfig
 * doesn't include src/server/*, so we'd need a tsconfig change to get
 * type inference. Plain fetch + manual types is the pragmatic choice.
 */

export async function apiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `Request failed: ${res.status}`);
    (err as any).status = res.status;
    (err as any).code = body.code;
    throw err;
  }

  return res.json();
}

/** POST JSON helper */
export function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** PUT JSON helper */
export function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
