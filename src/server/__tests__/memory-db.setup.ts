import { createClient, type Client } from "@libsql/client";

// vitest.config.ts points DATABASE_URL at a shared-cache in-memory database.
// SQLite drops such a database when its last connection closes, and the libsql
// client gives its connection away on every db.transaction(), opening a fresh
// one for whatever comes next. On a plain ":memory:" URL that fresh connection
// is a new, empty database, and every later query fails with "no such table".
// The connection below is never used. It stays open so the schema and the rows
// outlive that swap. Component tests (jsdom) have no database to keep.
const url = process.env.DATABASE_URL ?? "";
const holder = globalThis as { __wordloomTestDb?: Client };
if (url.includes(":memory:") && !("window" in globalThis)) {
  holder.__wordloomTestDb ??= createClient({ url });
}
