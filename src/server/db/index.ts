import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

const dbUrl = process.env.DATABASE_URL || "file:data/app.db";
const client = createClient({ url: dbUrl });

// WAL mode for better concurrent read performance
await client.execute("PRAGMA journal_mode=WAL");

export const db = drizzle(client, { schema });
