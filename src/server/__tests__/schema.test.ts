import { describe, it, expect } from "vitest";
import { getTableName, is, sql } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";

// Story Studio, Chunk Forge and Practice are gone; their rows are not. All that
// keeps the rows is three definitions in schema.ts that no code reads: take
// one out, and the next `drizzle-kit generate` writes its DROP TABLE into a
// migration that runs by itself at startup.
const KEPT = ["chunks", "practices", "stories"];

describe("the tables of the features that are gone", () => {
  it("are still defined", () => {
    const defined = Object.values(schema).filter((t) => is(t, SQLiteTable)).map((t) => getTableName(t));
    expect(defined).toEqual(expect.arrayContaining(KEPT));
  });

  it("are still there once every migration has run", async () => {
    const tables = await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`);
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(KEPT));
  });
});
