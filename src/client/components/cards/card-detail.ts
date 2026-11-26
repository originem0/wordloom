import type { ExpressionSummary } from "@/shared/expressions";

/** Pure helpers for the word card detail: nothing here touches React or the DOM. */

/** FNV-1a over the parts, so a card, a question and a retry each get their own order. */
export function seedOf(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const char of parts.join("\u0000")) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Models write the fitting option first, so stored order gives the answer
 * away. The order is derived from a seed rather than Math.random: it must not
 * change between two renders of the same question.
 */
export function shuffleOptions<T>(options: readonly T[], seed: number): T[] {
  const out = [...options];
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const PAIR = /[A-Za-z][A-Za-z'’-]*(?: [A-Za-z'’-]+){0,2}\s+vs\.?\s+[A-Za-z]/g;
const SENTENCE_END = "。．.!?！？；;";

/**
 * One line per compared pair. Newer cards store the note that way; older ones
 * hold a single paragraph in which each pair opens with "X vs Y" after a full
 * stop, and are cut there.
 */
export function splitBoundaryNote(note: string): string[] {
  return note
    .split(/\n+/)
    .flatMap((line) => {
      const cuts = [...line.matchAll(PAIR)]
        .map((match) => match.index)
        .filter((index) => index > 0 && SENTENCE_END.includes(line.slice(0, index).trimEnd().slice(-1)));
      return [0, ...cuts].map((start, i, all) => line.slice(start, all[i + 1]));
    })
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Collocations and set phrases overlap in stored cards; each is listed once. */
export function mergePhrases(...lists: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of lists.flatMap((list) => (Array.isArray(list) ? list : []))) {
    if (typeof item !== "string") continue;
    const phrase = item.trim();
    const key = phrase.toLowerCase();
    if (!phrase || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
  }
  return out;
}

/**
 * The word as a sentence may spell it: itself and its regular inflections.
 * Which endings apply follows a known part of speech, so a preposition
 * takes none and a noun no verb endings ("past" does not find "pasted"). A
 * short word with one vowel doubles its last letter and takes no plain ending,
 * or "hop" would find "hoped". An irregular form (sought) is not found: a
 * miss, where a looser rule would show the wrong sentence.
 */
export function wordForms(word: string, pos?: string | null): Set<string> {
  const w = spellingOf(word.trim());
  const forms = new Set([w]);
  // Two letters inflect into other words: be → bed, to → toes.
  if (!/^[a-z]{3,}$/.test(w)) return forms;
  const verb = /\b(verb|v)\b/i.test(pos ?? "");
  const noun = /\b(noun|n)\b/i.test(pos ?? "");
  if (!verb && !noun) return forms;

  const stem = w.slice(0, -1);
  const softY = /[^aeiou]y$/.test(w);
  if (softY) forms.add(`${stem}ies`);
  else if (/(s|x|z|ch|sh)$/.test(w)) forms.add(`${w}es`);
  else {
    forms.add(`${w}s`);
    if (w.endsWith("o")) forms.add(`${w}es`);
  }
  if (!verb) return forms;

  if (softY) {
    forms.add(`${stem}ied`).add(`${w}ing`);
  } else if (w.endsWith("ie")) {
    forms.add(`${w}d`).add(`${w.slice(0, -2)}ying`);
  } else if (/[eoy]e$/.test(w)) {
    // agreed, seeing; three letters would give seed, feed, need
    if (w.length > 3) forms.add(`${w}d`);
    forms.add(`${w}ing`);
  } else if (w.endsWith("e")) {
    forms.add(`${w}d`).add(`${stem}ing`);
  } else {
    const doubles = /[^aeiou][aeiou][bdgklmnprt]$/.test(w);
    const oneVowel = /^[^aeiou]*[aeiou][^aeiou]$/.test(w);
    if (doubles) forms.add(`${w}${w.slice(-1)}ed`).add(`${w}${w.slice(-1)}ing`);
    if (!(doubles && oneVowel)) forms.add(`${w}ed`).add(`${w}ing`);
  }
  return forms;
}

/** A sentence from the reader's own library, cut into the part that is the card's word and what stands around it. */
export interface OwnSentence {
  id: number;
  before: string;
  hit: string;
  after: string;
  sourceType: ExpressionSummary["sourceType"];
  sourceTitle: string | null;
  /** When it was met. */
  at: number;
}

type Saved = Pick<ExpressionSummary, "id" | "status" | "masked" | "text" | "focus" | "sourceType" | "sourceTitle" | "occurredAt" | "createdAt">;

const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const spellingOf = (text: string) => text.toLowerCase().replaceAll("’", "'");
// An entry can be a pasted passage of thousands of characters.
const AROUND = 120;

/**
 * The entries whose text has the card's word, whole and in any regular form.
 * Left out: what was put away, and what the server withholds (an entry being
 * practised arrives with no text, so the card cannot give its answer away).
 * Entries whose marked focus holds the word come first, then newest first as
 * the library lists them. The same original can be saved with different
 * focuses; show it once, linking to the entry focused on this word first.
 */
export function ownSentences(saved: readonly Saved[], word: string, pos?: string | null): OwnSentence[] {
  const written = word.trim();
  const wanted = [...written.matchAll(TOKEN)];
  const want = wanted.map((token) => spellingOf(token[0]));
  if (!want.length) return [];
  // A phrase is matched as written; only a single word is inflected.
  const forms = want.length === 1 ? wordForms(want[0], pos) : null;
  const noun = /\b(noun|n)\b/i.test(pos ?? "");
  const separators = wanted.slice(1).map((token, i) => written.slice(wanted[i].index + wanted[i][0].length, token.index).trim());
  const found: { sentence: OwnSentence; marked: boolean; original: string }[] = [];
  for (const entry of saved) {
    if (entry.status === "retired" || entry.masked || !entry.text) continue;
    const { text } = entry;
    const tokens = [...text.matchAll(TOKEN)];
    const spans: [number, number][] = [];
    for (let i = 0; i + want.length <= tokens.length; i++) {
      const token = spellingOf(tokens[i][0]);
      const possessive = forms && noun && token.endsWith("'s") && forms.has(token.slice(0, -2));
      const fits = forms
        ? forms.has(token) || possessive
        : want.every((part, k) => spellingOf(tokens[i + k][0]) === part && (
          k === 0 || text.slice(tokens[i + k - 1].index + tokens[i + k - 1][0].length, tokens[i + k].index).trim() === separators[k - 1]
        ));
      const last = tokens[i + want.length - 1];
      if (fits) spans.push([tokens[i].index, last.index + last[0].length - (possessive ? 2 : 0)]);
    }
    if (!spans.length) continue;
    const focusAt = entry.focus ? text.toLowerCase().indexOf(entry.focus.toLowerCase()) : -1;
    const focusEnd = focusAt + (entry.focus?.length ?? 0);
    const inFocus = focusAt < 0 ? undefined : spans.find(([start, end]) => start >= focusAt && end <= focusEnd);
    const [start, end] = inFocus ?? spans[0];
    const from = cutBefore(text, start);
    const to = cutAfter(text, end);
    found.push({
      marked: !!inFocus,
      original: text.replace(/\s+/g, " ").trim(),
      sentence: {
        id: entry.id,
        before: `${from > 0 ? "…" : ""}${text.slice(from, start)}`.replace(/\s+/g, " "),
        hit: text.slice(start, end),
        after: `${text.slice(end, to)}${to < text.length ? "…" : ""}`.replace(/\s+/g, " "),
        sourceType: entry.sourceType,
        sourceTitle: entry.sourceTitle,
        at: entry.occurredAt ?? entry.createdAt,
      },
    });
  }
  const unique = new Map<string, OwnSentence>();
  for (const item of found.sort((a, b) => Number(b.marked) - Number(a.marked))) {
    if (!unique.has(item.original)) unique.set(item.original, item.sentence);
  }
  return [...unique.values()];
}

function cutBefore(text: string, start: number): number {
  if (start <= AROUND) return 0;
  const space = text.indexOf(" ", start - AROUND);
  return space >= 0 && space < start ? space + 1 : start - AROUND;
}

function cutAfter(text: string, end: number): number {
  if (text.length - end <= AROUND) return text.length;
  const space = text.lastIndexOf(" ", end + AROUND);
  return space > end ? space : end + AROUND;
}
