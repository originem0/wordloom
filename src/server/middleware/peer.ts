import type { Context } from "hono";
import type { HttpBindings } from "@hono/node-server";

export const peerAddress = (c: Context): string =>
  ((c.env as Partial<HttpBindings> | undefined)?.incoming?.socket?.remoteAddress ?? "").replace(/^::ffff:/i, "");

export function isTrustedProxy(c: Context): boolean {
  const peer = peerAddress(c);
  return !!peer && (process.env.TRUSTED_PROXY_IPS ?? "").split(",").some((ip) => ip.trim() === peer);
}

const localNames = new Set(["localhost", "127.0.0.1", "[::1]"]);
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Vite forwards LAN requests over a loopback socket too. Require both the
 * addressed host and every hop in its forwarding chain to be local. */
export function localCaller(c: Context): boolean {
  if (process.env.NODE_ENV === "production" || !loopback.has(peerAddress(c))) return false;
  try {
    const host = new URL(`http://${c.req.header("host")}`).hostname;
    const forwarded = c.req.header("x-forwarded-for") ?? "";
    return localNames.has(host) && forwarded.split(",").every((ip) => !ip.trim() || loopback.has(ip.trim()));
  } catch {
    return false;
  }
}
