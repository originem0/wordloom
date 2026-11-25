import { configDefaults, defineConfig } from "vitest/config";
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
    // .claude/worktrees holds whole checkouts of this repo (agent worktrees);
    // without this their test files run as part of ours.
    exclude: [...configDefaults.exclude, ".claude/**"],
    // Tests must never touch data/app.db: db/index.ts falls back to the real
    // file when DATABASE_URL is unset, and auth.test.ts wipes the sessions
    // table in beforeEach — every `pnpm test` used to log the admin out of
    // production. Each worker gets its own throwaway in-memory database.
    // Shared cache, so the connection the libsql client opens after a
    // db.transaction() still sees the same database (memory-db.setup.ts keeps
    // it alive in between).
    env: {
      DATABASE_URL: "file::memory:?cache=shared",
    },
    // A shared-cache memory database is process-wide: worker threads would all
    // write into the same one. Forks give every test file its own process.
    pool: "forks",
    setupFiles: ["src/server/__tests__/memory-db.setup.ts", "src/client/__tests__/storage.setup.ts"],
  },
});
