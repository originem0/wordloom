// Labels, colours and form parsing shared by the chunk components. Kept out
// of the component files so React Fast Refresh can hot-swap those.

const CATEGORY_LABELS: Record<string, { code: string; full: string }> = {
  "prep-intuition": { code: "PI", full: "Preposition intuition" },
  "sentence-stem": { code: "SS", full: "Sentence stem" },
  "verb-collocation": { code: "VC", full: "Verb collocation" },
  "noun-prep": { code: "NP", full: "Noun + preposition" },
  "discourse-marker": { code: "DM", full: "Discourse marker" },
};

// Solarized accents, one per category
const CATEGORY_COLORS: Record<string, string> = {
  "prep-intuition": "#268bd2",   // blue
  "sentence-stem": "#2aa198",    // cyan
  "verb-collocation": "#859900", // green
  "noun-prep": "#b58900",        // yellow
  "discourse-marker": "#d33682", // magenta
};

const ANCHOR_LABELS: Record<string, string> = {
  "idiom-principle": "Idiom Principle",
  "formulaic-sequence": "Formulaic Sequence",
  "lexical-priming": "Lexical Priming",
  "cognitive-chunk": "Cognitive Chunk",
  "grammaticalized-lexis": "Grammaticalized Lexis",
};

export function getCategoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? { code: "??", full: category };
}

export function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category] ?? "#93a1a1";
}

export function getAnchorLabel(anchor: string) {
  return ANCHOR_LABELS[anchor] ?? anchor;
}

/**
 * Render the canonical form with slot placeholders highlighted.
 * Recognizes single uppercase letters (X, Y, Z), and tokens like `sb`, `sth`,
 * `V`, `V-ing`, `V-ed` as slots.
 */
export function renderForm(form: string) {
  const SLOT_RE = /\b([XYZ]|sb|sth|V-ing|V-ed|V)\b/g;
  const parts: Array<{ text: string; slot: boolean }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = SLOT_RE.exec(form)) != null) {
    if (m.index > last) {
      parts.push({ text: form.slice(last, m.index), slot: false });
    }
    parts.push({ text: m[0], slot: true });
    last = m.index + m[0].length;
  }
  if (last < form.length) parts.push({ text: form.slice(last), slot: false });
  return parts;
}
