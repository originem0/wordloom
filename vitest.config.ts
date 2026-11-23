import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    globals: true,
    // Tests must never touch data/app.db: db/index.ts falls back to the real
    // file when DATABASE_URL is unset, and auth.test.ts wipes the sessions
    // table in beforeEach — every `pnpm test` used to log the admin out of
    // production. Each worker gets its own throwaway in-memory database.
    env: {
      DATABASE_URL: ":memory:",
    },
  },
});
