import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

const client = createClient({ url: "file:data/app.db" });

// WAL mode for better concurrent read performance
await client.execute("PRAGMA journal_mode=WAL");

export const db = drizzle(client, { schema });
