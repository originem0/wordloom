#!/usr/bin/env node
// Export the chunks table to one Markdown file, grouped by category.
//
// Chunk Forge (the page, the routes and the prompt) has been removed; the
// table and its rows stay in the database. This script is the one way left to
// read them. It only runs SELECTs.
//
//   node tools/export-chunks.mjs <path-to-app.db> <out.md>
//
// Write the output somewhere outside the repository.
import { createClient } from "@libsql/client";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { basename, resolve } from "node:path";

const [dbArg, outArg] = process.argv.slice(2);
if (!dbArg || !outArg) {
  console.error("usage: node tools/export-chunks.mjs <path-to-app.db> <out.md>");
  process.exit(1);
}

const dbPath = resolve(dbArg);
// libsql creates the file when it is missing; a typo must not leave an empty
// database behind.
if (!existsSync(dbPath)) {
  console.error(`database not found: ${dbPath}`);
  process.exit(1);
}

/** Parse a JSON column; a malformed value comes back as the raw text. */
function parse(raw) {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return String(raw);
  }
}

function list(value, render) {
  if (typeof value === "string") return [`  - ${value}`];
  if (!Array.isArray(value)) return [];
  return value.map((item) => `  - ${render(item)}`);
}

function renderChunk(row) {
  const out = [`### ${row.form}`, ""];
  const meaning = row.core_meaning_zh ? `${row.core_meaning}（${row.core_meaning_zh}）` : row.core_meaning;
  out.push(`- **Meaning:** ${meaning}`);
  if (row.core_mechanic) out.push(`- **Mechanic:** ${row.core_mechanic}`);
  out.push(`- **Register / frequency:** ${row.register} · ${row.frequency}`);

  const slots = list(parse(row.slots), (s) => {
    const fillers = Array.isArray(s.fillers) && s.fillers.length > 0 ? `: ${s.fillers.join(", ")}` : "";
    return `\`${s.placeholder}\` (${s.type})${fillers}`;
  });
  if (slots.length > 0) out.push("- **Slots:**", ...slots);

  const examples = list(parse(row.examples), (e) => `${e.sentence} *(${e.register})*`);
  if (examples.length > 0) out.push("- **Examples:**", ...examples);

  if (row.pitfall) out.push(`- **Pitfall:** ${row.pitfall}`);

  const contrast = list(parse(row.contrast), (c) => `\`${c.form}\` — ${c.diff}`);
  if (contrast.length > 0) out.push("- **Contrast:**", ...contrast);

  const anchors = parse(row.theoretical_anchors);
  if (Array.isArray(anchors) && anchors.length > 0) out.push(`- **Anchors:** ${anchors.join(", ")}`);
  if (Number(row.usage_count) > 0) out.push(`- **Used:** ${row.usage_count}×`);

  out.push("");
  return out;
}

const outPath = resolve(outArg);
if (existsSync(outPath)) {
  const source = statSync(dbPath, { bigint: true }), output = statSync(outPath, { bigint: true });
  console.error(source.dev === output.dev && source.ino === output.ino ? "Output refers to the source database" : "Output already exists");
  process.exit(1);
}
const client = createClient({ url: pathToFileURL(dbPath).href });
try {
  const { rows } = await client.execute(
    "SELECT * FROM chunks ORDER BY category, form COLLATE NOCASE",
  );

  const byCategory = new Map();
  for (const row of rows) {
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }

  // sv-SE formats a date as YYYY-MM-DD in local time (toISOString is UTC).
  const today = new Date().toLocaleDateString("sv-SE");
  const lines = [
    "# WordLoom chunks",
    "",
    `Exported ${today} from \`${basename(dbPath)}\` · ${rows.length} chunks in ${byCategory.size} categories.`,
    "",
  ];
  for (const [category, items] of byCategory) {
    lines.push(`## ${category} (${items.length})`, "");
    for (const row of items) lines.push(...renderChunk(row));
  }

  writeFileSync(outPath, lines.join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(`${rows.length} chunks → ${outPath}`);
} finally {
  client.close();
}
