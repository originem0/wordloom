import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema.js";

const dbUrl = process.env.DATABASE_URL || "file:data/app.db";
const client = createClient({ url: dbUrl });

// WAL mode for better concurrent read performance
await client.execute("PRAGMA journal_mode=WAL");

export const db = drizzle(client, { schema });

// Apply pending migrations at startup (production Docker image doesn't ship drizzle-kit).
// Safe to run repeatedly: Drizzle records applied migrations in __drizzle_migrations.
await migrate(db, { migrationsFolder: "drizzle" });
