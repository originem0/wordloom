/**
 * Thin fetch wrapper that always sends credentials (httpOnly cookie).
 * Hono RPC client (hc<AppType>) would be ideal, but the client tsconfig
 * doesn't include src/server/*, so we'd need a tsconfig change to get
 * type inference. Plain fetch + manual types is the pragmatic choice.
 */

/** Error thrown by apiFetch for non-2xx responses. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  /** The parsed JSON body, for a refusal that carries more than a message. */
  readonly body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function apiResponse(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: { error?: unknown; code?: unknown } = {};
    try {
      const parsed: unknown = text ? JSON.parse(text) : {};
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      body = {};
    }
    const message = typeof body.error === "string" ? body.error : text || `Request failed: ${res.status}`;
    throw new ApiError(message, res.status, typeof body.code === "string" ? body.code : undefined, body);
  }

  return res;
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiResponse(path, init);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text);
  } catch {
    return {} as T;
  }
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
