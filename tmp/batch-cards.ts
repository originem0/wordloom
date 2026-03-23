#!/usr/bin/env tsx
/**
 * Batch word card generator for WordLoom.
 *
 * Reads words from tmp/words_by_cefr.md, filters inflected forms,
 * and generates cards one at a time via the local API with a 2-minute
 * pause between requests.
 *
 * Usage:  npx tsx tmp/batch-cards.ts
 * Resume: just re-run — progress is saved to tmp/batch-progress.json
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = "http://localhost:3001";
const WORDS_FILE = resolve(__dirname, "words_by_cefr.md");
const PROGRESS_FILE = resolve(__dirname, "batch-progress.json");
const FAILED_FILE = resolve(__dirname, "batch-failed.json");
const INTERVAL_MS = 2 * 60 * 1000; // 2 minutes between words

// Read AUTH_TOKEN from .env
function getAuthToken(): string {
  try {
    const env = readFileSync(resolve(ROOT, ".env"), "utf-8");
    const match = env.match(/^AUTH_TOKEN=(.+)$/m);
    return match?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Word parsing + filtering
// ---------------------------------------------------------------------------

interface WordEntry {
  word: string;
  cefr: string;
}

function parseWordsFile(path: string): WordEntry[] {
  const text = readFileSync(path, "utf-8");
  const entries: WordEntry[] = [];
  let currentCefr = "";

  for (const line of text.split("\n")) {
    const cefrMatch = line.match(/^## (A1|A2|B1|B2|C1|C2)/);
    if (cefrMatch) {
      currentCefr = cefrMatch[1];
      continue;
    }
    if (!currentCefr || line.startsWith("#") || line.startsWith("-") || line.startsWith("*") || !line.trim()) continue;

    for (const w of line.trim().split(/\s+/)) {
      const clean = w.trim();
      if (clean) entries.push({ word: clean, cefr: currentCefr });
    }
  }
  return entries;
}

// Whitelist: words ending in -ing/-ed/-s that are NOT inflections
const ING_WHITELIST = new Set([
  "building", "morning", "evening", "feeling", "meaning", "nothing", "something",
  "everything", "wedding", "setting", "clothing", "being", "beginning", "string",
  "spring", "ring", "king", "thing", "sing", "bring", "swing", "wing", "during",
  "ceiling", "lightning", "sterling", "pudding", "heading", "landing", "funding",
  "finding", "painting", "reading", "writing", "listening", "cooking", "blessing",
  "recording", "offering", "missing", "hearing", "bearing", "telling", "engineering",
  "nursing", "banking", "ranking", "booking", "parking", "shipping", "shopping",
  "stunning", "cunning", "offspring", "underlying", "darling", "sterling", "fling",
  "cling", "sting", "sling", "wring",
]);

const ED_WHITELIST = new Set([
  "bed", "red", "fed", "led", "shed", "hundred", "sacred", "wicked", "naked",
  "beloved", "rugged", "crooked", "ragged", "dogged", "learned", "sophisticated",
  "advanced", "concerned", "sealed", "alleged", "marked", "pronounced", "aged",
  "blessed", "cursed", "jagged", "wretched", "fixed", "mixed",
]);

const S_WHITELIST = new Set([
  "series", "species", "news", "lens", "axis", "basis", "crisis", "analysis",
  "thesis", "oasis", "synopsis", "diagnosis", "emphasis", "parenthesis",
  "hypothesis", "genesis", "nemesis", "means", "headquarters", "economics",
  "mathematics", "politics", "physics", "ethics", "linguistics", "gymnastics",
  "electronics", "dynamics", "statistics", "lyrics", "kudos", "chaos", "bus",
  "plus", "us", "thus", "gas", "yes", "this", "campus", "bonus", "status",
  "focus", "virus", "versus", "census", "corpus", "consensus", "stimulus",
  "apparatus", "radius", "genius", "fungus", "terminus", "syllabus", "cactus",
  "octopus", "platypus", "walrus", "canvas", "atlas", "boss", "cross", "dress",
  "express", "guess", "lass", "loss", "mass", "mess", "miss", "moss", "pass",
  "press", "stress", "class", "glass", "grass", "process", "access", "success",
  "address", "excess", "princess", "progress", "congress", "witness", "fitness",
  "illness", "darkness", "weakness", "awareness", "business", "happiness",
  "madness", "sadness", "kindness", "goodness", "consciousness", "nevertheless",
  "regardless",
]);

function isInflected(word: string): boolean {
  const w = word.toLowerCase();

  // -ing forms (not in whitelist)
  if (w.endsWith("ing") && w.length > 4 && !ING_WHITELIST.has(w)) return true;

  // -ed forms (not in whitelist)
  if (w.endsWith("ed") && w.length > 3 && !ED_WHITELIST.has(w)) return true;

  // -s/-es plurals (not in whitelist) — only filter obvious plurals
  if (w.length > 3 && !S_WHITELIST.has(w)) {
    // words ending in -ies (like "stories" from "story")
    if (w.endsWith("ies") && w.length > 4) return true;
    // words ending in -ses, -zes, -xes, -ches, -shes (like "boxes", "catches")
    if (/(?:ses|zes|xes|ches|shes)$/.test(w) && w.length > 5) return true;
  }

  return false;
}

function shouldExclude(word: string): boolean {
  // Multi-word phrases
  if (/\s/.test(word)) return true;
  // Contractions
  if (word.includes("'") || word.includes("'")) return true;
  // Hyphenated compounds (keep simple words)
  if (word.includes("-") && word.length > 3) return true;
  // Proper nouns (starts with uppercase)
  if (/^[A-Z]/.test(word)) return true;
  // Too short
  if (word.length < 2) return true;

  return isInflected(word);
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

function loadProgress(): Set<string> {
  try {
    if (existsSync(PROGRESS_FILE)) {
      const data = JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch { /* ignore */ }
  return new Set();
}

function saveProgress(done: Set<string>) {
  writeFileSync(PROGRESS_FILE, JSON.stringify([...done], null, 2));
}

interface FailedEntry {
  word: string;
  cefr: string;
  error: string;
  timestamp: string;
}

function loadFailed(): FailedEntry[] {
  try {
    if (existsSync(FAILED_FILE)) {
      return JSON.parse(readFileSync(FAILED_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return [];
}

function saveFailed(entries: FailedEntry[]) {
  writeFileSync(FAILED_FILE, JSON.stringify(entries, null, 2));
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function login(token: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    throw new Error(`Login failed: HTTP ${res.status}`);
  }
  // Extract session cookie from set-cookie header (ignore Secure flag for localhost)
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/session=([^;]+)/);
  return match?.[1] ?? "";
}

async function getExistingWords(session: string): Promise<Set<string>> {
  const existing = new Set<string>();
  let page = 1;
  while (true) {
    const res = await fetch(`${API_BASE}/api/cards?page=${page}&limit=100`, {
      headers: session ? { Cookie: `session=${session}` } : {},
    });
    const data = await res.json() as { cards: Array<{ word: string }>; total: number };
    for (const card of data.cards) {
      existing.add(card.word.toLowerCase());
    }
    if (data.cards.length < 100) break;
    page++;
  }
  return existing;
}

async function generateCard(
  word: string,
  session: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/api/cards/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Cookie: `session=${session}` } : {}),
    },
    body: JSON.stringify({ words: [word] }),
  });

  const body = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    return { ok: false, error: (body.error as string) ?? `HTTP ${res.status}` };
  }

  const success = body.success as unknown[];
  const failed = body.failed as Array<{ word: string; error: string }>;

  if (failed?.length > 0) {
    return { ok: false, error: failed[0].error };
  }
  if (body.message === "All words already exist") {
    return { ok: true }; // Already exists, treat as success
  }
  if (success?.length > 0) {
    return { ok: true };
  }

  return { ok: false, error: "Unknown response" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n[WordLoom Batch Card Generator]\n");

  // Parse words
  const allWords = parseWordsFile(WORDS_FILE);
  console.log(`  Raw words from file: ${allWords.length}`);

  // Filter
  const filtered = allWords.filter((e) => !shouldExclude(e.word));
  const excluded = allWords.length - filtered.length;
  console.log(`  After morphology filter: ${filtered.length} (${excluded} excluded)`);

  // Deduplicate within list (case-insensitive, keep first occurrence)
  const seen = new Set<string>();
  const unique: WordEntry[] = [];
  for (const entry of filtered) {
    const key = entry.word.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(entry);
    }
  }
  console.log(`  After dedup: ${unique.length}`);

  // Login
  const authToken = getAuthToken();
  let session = "";
  if (authToken) {
    session = await login(authToken);
    console.log(`  Auth: ${session ? "logged in" : "dev mode"}`);
  } else {
    console.log("  Auth: dev mode (no AUTH_TOKEN)");
  }

  // Check existing cards in DB
  const existing = await getExistingWords(session);
  console.log(`  Existing cards in DB: ${existing.size}`);

  // Load progress
  const done = loadProgress();
  const failedEntries = loadFailed();

  // Build work queue
  const queue = unique.filter(
    (e) => !existing.has(e.word.toLowerCase()) && !done.has(e.word.toLowerCase()),
  );
  console.log(`  To generate: ${queue.length}`);
  console.log(`  Already done (progress file): ${done.size}`);
  console.log(`  Interval: ${INTERVAL_MS / 1000}s between words`);
  console.log("");

  if (queue.length === 0) {
    console.log("Nothing to generate. All done!");
    return;
  }

  // Process
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const { word, cefr } = queue[i];
    const num = i + 1;
    const total = queue.length;
    const start = Date.now();

    try {
      const result = await generateCard(word, session);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (result.ok) {
        successCount++;
        console.log(`[${num}/${total}] ✓ ${word} (${cefr}) — ${elapsed}s`);
        done.add(word.toLowerCase());
        saveProgress(done);
      } else {
        failCount++;
        console.log(`[${num}/${total}] ✗ ${word} (${cefr}) — ${result.error}`);
        failedEntries.push({
          word,
          cefr,
          error: result.error ?? "unknown",
          timestamp: new Date().toISOString(),
        });
        saveFailed(failedEntries);
        // Still add to done so we don't retry automatically
        done.add(word.toLowerCase());
        saveProgress(done);
      }
    } catch (e) {
      failCount++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[${num}/${total}] ✗ ${word} (${cefr}) — ${msg}`);
      failedEntries.push({
        word,
        cefr,
        error: msg,
        timestamp: new Date().toISOString(),
      });
      saveFailed(failedEntries);
      done.add(word.toLowerCase());
      saveProgress(done);
    }

    // Wait between words (skip after last one)
    if (i < queue.length - 1) {
      process.stdout.write(`  ↳ Waiting ${INTERVAL_MS / 1000}s...`);
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
      process.stdout.write("\r" + " ".repeat(40) + "\r");
    }
  }

  console.log(`\n[Done] Success: ${successCount} | Failed: ${failCount} | Total: ${queue.length}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
