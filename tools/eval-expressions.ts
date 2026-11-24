#!/usr/bin/env tsx
// The two evaluations of the expression library, run by hand before its
// numbers are trusted: whether 找 brings back what is in the library
// ("recall"), and whether the judgement of 试一条 agrees with a careful reader
// ("judge"). Both call the real model through the app's own code, so they
// measure what the page gets: the prompts, the provider and model of the
// Expressions route, the single attempt and its 45 seconds.
//
// Run from the repository root, on a COPY of the database: 找 writes a row for
// every question, and in the real library those rows would count as use. The
// copy holds your API keys and the cases are your own sentences, so keep both
// outside the repository.
//
//   DATABASE_URL=file:../eval/app.db npx tsx tools/eval-expressions.ts recall ../eval/recall.json
//   DATABASE_URL=file:../eval/app.db npx tsx tools/eval-expressions.ts judge ../eval/judge.json
//
// recall.json: [{ "need": "怎么说我突然意识到", "attempt": "I suddenly knew", "expect": ["dawned on", 31] }]
//   need     what you would type into the box
//   attempt  optional: your own English for it
//   expect   the entries that should come back, each by its words (its focus,
//            or part of its sentence) or by its id; [] when none should
// judge.json: [{ "text": "It dawned on me that I was wrong.", "focus": "dawned on",
//                "prompt": "...", "answer": "...", "used": true }]
//   text, focus  the saved entry; focus is optional
//   prompt       what the learner was shown
//   answer       what they wrote
//   used         whether a careful reader says the answer uses the target
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const [mode, file] = process.argv.slice(2);
if ((mode !== "recall" && mode !== "judge") || !file) {
  console.error("usage: DATABASE_URL=file:<copy of app.db> npx tsx tools/eval-expressions.ts recall|judge <cases.json>");
  process.exit(1);
}
// Checked before anything of the app is imported: importing it opens the
// database and migrates it, and libsql creates a file that is not there.
const copy = (process.env.DATABASE_URL ?? "").replace(/^file:/, "");
if (!copy || resolve(copy).toLowerCase() === resolve("data/app.db").toLowerCase()) {
  console.error("Set DATABASE_URL to a copy of the database (file:<path>), not data/app.db: an evaluation writes rows.");
  process.exit(1);
}
if (!existsSync(copy)) {
  console.error(`database not found: ${resolve(copy)}`);
  process.exit(1);
}

const recallCase = z.object({ need: z.string().trim().min(1), attempt: z.string().optional(), expect: z.array(z.union([z.number().int(), z.string().trim().min(1)])) });
const judgeCase = z.object({ text: z.string().min(1), focus: z.string().optional(), prompt: z.string().min(1), answer: z.string().min(1), used: z.boolean() });

function load<T>(shape: z.ZodType<T>): T[] {
  const parsed = z.array(shape).min(1).safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  console.error(`${file} is not a list of ${mode} cases: at ${issue.path.join(".") || "the top"}: ${issue.message}`);
  process.exit(1);
}

const took: number[] = [];
async function timed<T>(call: () => Promise<T>): Promise<T> {
  const from = performance.now();
  try {
    return await call();
  } finally {
    took.push(performance.now() - from);
  }
}
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const last = () => secs(took[took.length - 1]);
function latency() {
  const sorted = [...took].sort((a, b) => a - b);
  return `time per call: median ${secs(sorted[sorted.length >> 1])}, slowest ${secs(sorted[sorted.length - 1])} (the app gives up at 45 s)`;
}
const share = (part: number, whole: number) => (whole ? `${part} of ${whole} (${Math.round((100 * part) / whole)}%)` : "none");

async function recall(): Promise<number> {
  const cases = load(recallCase);
  const { find, normalize } = await import("../src/server/services/expressions-find.js");
  const { loadLibrary } = await import("../src/server/services/expressions-view.js");
  const library = await loadLibrary();
  const name = (id: number) => {
    const row = library.find((e) => e.row.id === id)?.row;
    return `#${id} ${row ? (row.focus ?? row.text).slice(0, 40) : "?"}`;
  };
  // An expectation is met by any entry it names: the same words can be saved more than once.
  const named = (want: number | string) =>
    library
      .filter(({ row }) => (typeof want === "number" ? row.id === want : [row.norm, normalize(row.text)].some((s) => s.includes(normalize(want)))))
      .map((e) => e.row.id);
  const wanted = cases.map((c) => c.expect.map((want) => ({ want, ids: named(want) })));
  // Before the first call: a typo in the cases would read as a miss of the model's.
  const unknown = wanted.flatMap((list, i) => list.filter((x) => x.ids.length === 0).map((x) => `case ${i + 1}: ${JSON.stringify(x.want)}`));
  if (unknown.length) {
    console.error(`Nothing in this library matches:\n  ${unknown.join("\n  ")}`);
    process.exit(1);
  }
  for (const [i, list] of wanted.entries())
    for (const x of list) if (x.ids.length > 1) console.log(`note: case ${i + 1}: ${JSON.stringify(x.want)} names ${x.ids.length} entries; any of them counts`);
  const n = { failed: 0, whole: 0, part: 0, missed: 0, quiet: 0, noisy: 0, wanted: 0, found: 0, extra: 0 };
  for (const [i, c] of cases.entries()) {
    const out = await timed(() => find({ need: c.need, attempt: c.attempt, history: [], turn: 1, thread: Date.now() }));
    if (!out) {
      n.failed++;
      console.log(`${i + 1}. FAILED  ${c.need}  (no answer, ${last()})`);
      continue;
    }
    const got = out.mine.map((h) => h.expression.id);
    const missing = wanted[i].filter((x) => !x.ids.some((id) => got.includes(id)));
    const extra = got.filter((id) => !wanted[i].some((x) => x.ids.includes(id)));
    const found = wanted[i].length - missing.length;
    const verdict = wanted[i].length === 0 ? (got.length ? "noisy" : "quiet") : missing.length === 0 ? "whole" : found ? "part" : "missed";
    n[verdict]++;
    n.wanted += wanted[i].length;
    n.found += found;
    n.extra += extra.length;
    console.log(
      [
        `${i + 1}. ${verdict.padEnd(6)}  ${c.need}  ->  [${got.map(name).join(", ")}]`,
        missing.length ? `missing [${missing.map((x) => JSON.stringify(x.want)).join(", ")}]` : "",
        extra.length ? `beyond what was expected [${extra.map(name).join(", ")}]` : "",
        out.searched < out.total ? `index held ${out.searched} of ${out.total} entries` : "",
        last(),
      ].filter(Boolean).join("  "),
    );
  }
  console.log(`\n${cases.length} cases, ${n.failed} without an answer`);
  console.log(`expecting entries: ${n.whole} whole, ${n.part} in part, ${n.missed} missed; expected entries that came back: ${share(n.found, n.wanted)}`);
  console.log(`expecting none: ${n.quiet} came back empty, ${n.noisy} did not`);
  console.log(`hits beyond what was expected: ${n.extra} (not wrong by themselves: read them)`);
  return n.failed;
}

async function judged(): Promise<number> {
  const cases = load(judgeCase);
  const { judge } = await import("../src/server/services/expressions-ai.js");
  const n = { failed: 0, agreed: 0, used: 0, usedCalledMissed: 0, unused: 0, unusedCalledUsed: 0 };
  for (const [i, c] of cases.entries()) {
    let out;
    try {
      out = await timed(() => judge({ text: c.text, focus: c.focus ?? null, prompt: c.prompt, answer: c.answer }));
    } catch (err) {
      n.failed++;
      console.log(`${i + 1}. FAILED  ${c.answer}  (${err instanceof Error ? err.message : String(err)}, ${last()})`);
      continue;
    }
    if (c.used) n.used++;
    else n.unused++;
    if (out.used === c.used) n.agreed++;
    else if (c.used) n.usedCalledMissed++;
    else n.unusedCalledUsed++;
    // The three things the page can say, as it derives them from the two booleans.
    const said = out.used ? "used" : out.conveyed ? "conveyed" : "missed";
    console.log(`${i + 1}. ${out.used === c.used ? "agrees" : "DIFFERS"}  you: ${c.used ? "used" : "not used"}, model: ${said}  ${c.answer}  ${last()}`);
    for (const r of out.rewrites) console.log(`     ${r.from}  ->  ${r.to}  (${r.why})`);
  }
  const answered = cases.length - n.failed;
  console.log(`\n${cases.length} cases, ${n.failed} without a judgement`);
  console.log(`agrees with you: ${share(n.agreed, answered)}`);
  console.log(`uses the target, judged as not: ${share(n.usedCalledMissed, n.used)}  <- what makes a user stop trusting the count`);
  console.log(`does not use it, judged as used: ${share(n.unusedCalledUsed, n.unused)}`);
  return n.failed;
}

const failed = await (mode === "recall" ? recall() : judged());
if (took.length) console.log(latency());
// The database client keeps the process alive.
process.exit(failed && failed === took.length ? 1 : 0);
