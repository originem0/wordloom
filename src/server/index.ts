import { serve } from "@hono/node-server";

if (process.env.NODE_ENV === "production") {
  const placeholders = new Set(["your-secret-access-token", "your-hmac-signing-secret"]);
  if ([process.env.AUTH_SECRET, process.env.AUTH_TOKEN].some((v) => !v?.trim() || placeholders.has(v.trim()))) {
    console.error("Missing AUTH_SECRET or AUTH_TOKEN in production.");
    process.exit(1);
  }
}

// Dynamic import: the env check above must run before any module opens the DB.
const { app } = await import("./app.js");

export type { AppType } from "./app.js";

// Any job still marked queued/running was owned by the previous process.
const { failOrphanedJobs } = await import("./services/jobs.js");
const orphaned = await failOrphanedJobs();
if (orphaned > 0) console.warn(`[jobs] marked ${orphaned} interrupted job(s) as failed`);

// Last line of defence: log instead of letting Node's default behaviour
// (exit on unhandled rejection) turn one stray promise into an outage.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

// Unauthenticated development is local-only, even if HOST was set for a container.
const hostname = (process.env.AUTH_TOKEN && process.env.HOST) || "127.0.0.1";
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001), hostname });
console.log(`Server running on http://localhost:${process.env.PORT ?? 3001}`);
if (!process.env.AUTH_TOKEN && process.env.EXPRESSIONS_OPEN_LOCALLY === "1") {
  console.warn("EXPRESSIONS_OPEN_LOCALLY=1: the expression library answers this machine without a login. For trying it out only.");
}
