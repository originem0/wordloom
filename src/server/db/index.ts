import { eq, isNull } from "drizzle-orm";
import { createClient, LibsqlError, type InArgs, type InStatement, type TransactionMode } from "@libsql/client";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema.js";

const dbUrl = process.env.DATABASE_URL || "file:data/app.db";
const client = createClient({ url: dbUrl });

// The local driver is synchronous. Waiting inside SQLite would also block the
// JavaScript continuation that releases the competing request's write lock.
async function whenUnlocked<T>(operation: () => Promise<T>): Promise<T> {
  const deadline = performance.now() + 2_000;
  let pause = 5;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof LibsqlError) || !["SQLITE_BUSY", "SQLITE_LOCKED"].includes(error.code) || performance.now() >= deadline) throw error;
      await delay(pause);
      pause = Math.min(pause * 2, 100);
    }
  }
}

if (client.protocol === "file") {
  // Retry a standalone statement or BEGIN only, never an application transaction callback.
  const execute = client.execute.bind(client);
  const begin = client.transaction.bind(client);
  client.execute = (stmt: InStatement, args?: InArgs) => whenUnlocked(() =>
    typeof stmt === "string" ? execute(stmt, args) : execute(stmt));
  client.transaction = (mode?: TransactionMode) => whenUnlocked(() => begin(mode));
}

// WAL mode for better concurrent read performance
await client.execute("PRAGMA journal_mode=WAL");

export const db = drizzle(client, { schema });

/** libSQL defaults to a write transaction. Expose only SELECT on this read snapshot. */
export async function readSnapshot<T>(read: (reader: Pick<typeof db, "select">) => Promise<T>): Promise<T> {
  const tx = await client.transaction("read");
  try {
    const connection: typeof client = Object.create(client);
    connection.execute = tx.execute.bind(tx);
    return await read(drizzle(connection, { schema }));
  } finally {
    tx.close();
  }
}

// Apply pending migrations at startup (production Docker image doesn't ship drizzle-kit).
// Safe to run repeatedly: Drizzle records applied migrations in __drizzle_migrations.
await migrate(db, { migrationsFolder: "drizzle" });

const missingKey = isNull(schema.cards.wordKey);
if (await db.select({ id: schema.cards.id }).from(schema.cards).where(missingKey).limit(1).get()) {
  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: schema.cards.id, word: schema.cards.word }).from(schema.cards).where(missingKey);
    for (const row of rows) await tx.update(schema.cards).set({ wordKey: row.word.toLowerCase() }).where(eq(schema.cards.id, row.id));
  });
}
