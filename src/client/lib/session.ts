// Only a session event crosses tabs. Private data stays in memory.
export const SESSION_ENDED = "wordloom:session-ended";

export function broadcastLogout() {
  try { localStorage.setItem(SESSION_ENDED, crypto.randomUUID()); } catch { /* storage may be disabled */ }
}

export function expireSession() {
  window.dispatchEvent(new Event(SESSION_ENDED));
  broadcastLogout();
}

export async function sessionFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, { ...init, credentials: "include" });
  if (res.status === 401 && !path.startsWith("/api/auth/")) expireSession();
  return res;
}
