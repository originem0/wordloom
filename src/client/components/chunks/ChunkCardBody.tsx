import type { Chunk } from "@/shared/types";

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

// ---------------------------------------------------------------------------
// Section primitives
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </h3>
  );
}

interface ChunkCardBodyProps {
  chunk: Chunk;
  showHeader?: boolean;
  /** When provided, slot filler chips become buttons that trigger search. */
  onFillerClick?: (filler: string) => void;
  /** When provided, contrast `form` strings become buttons that trigger search. */
  onContrastClick?: (form: string) => void;
}

export function ChunkCardBody({
  chunk,
  showHeader = true,
  onFillerClick,
  onContrastClick,
}: ChunkCardBodyProps) {
  const cat = getCategoryLabel(chunk.category);
  const color = getCategoryColor(chunk.category);
  const formParts = renderForm(chunk.form);

  return (
    <div className="space-y-6 font-sans">
      {showHeader && (
        <header className="space-y-4">
          {/* Form — the poster line */}
          <div className="relative pl-4">
            <span
              aria-hidden
              className="absolute left-0 top-1 bottom-1 w-1 rounded-full"
              style={{ backgroundColor: color }}
            />
            <div className="font-mono text-2xl leading-tight tracking-tight md:text-[28px]">
              {formParts.map((p, i) =>
                p.slot ? (
                  <span
                    key={i}
                    className="font-bold"
                    style={{ color }}
                  >
                    {p.text}
                  </span>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
            </div>
          </div>

          {/* Metadata chips */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className="rounded-full px-2.5 py-0.5 font-semibold uppercase tracking-wider"
              style={{ backgroundColor: color, color: "#fdf6e3" }}
              title={cat.full}
            >
              {cat.code} · {cat.full}
            </span>
            <span className="rounded-full border px-2.5 py-0.5 text-muted-foreground">
              {chunk.register}
            </span>
            <span className="rounded-full border px-2.5 py-0.5 text-muted-foreground">
              freq · {chunk.frequency}
            </span>
          </div>
        </header>
      )}

      {/* Core mechanic — the soul label */}
      {chunk.coreMechanic && (
        <div
          className="relative rounded-lg border-l-4 bg-accent/30 px-4 py-3"
          style={{ borderLeftColor: color }}
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Core Mechanic · 张力机制
          </div>
          <p className="mt-1 text-base italic leading-relaxed">
            {chunk.coreMechanic}
          </p>
        </div>
      )}

      {/* Meaning — EN main + ZH gloss */}
      <section>
        <SectionLabel>Meaning</SectionLabel>
        <p className="text-base leading-relaxed">{chunk.coreMeaning}</p>
        {chunk.coreMeaningZh && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {chunk.coreMeaningZh}
          </p>
        )}
      </section>

      {/* Examples — one card per sentence */}
      {chunk.examples.length > 0 && (
        <section>
          <SectionLabel>Examples</SectionLabel>
          <ul className="space-y-2">
            {chunk.examples.map((ex, i) => (
              <li
                key={i}
                className="rounded-md border bg-card/50 p-3 text-sm leading-relaxed"
              >
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 select-none font-mono text-xs font-bold"
                    style={{ color }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 space-y-1">
                    <p>{ex.sentence}</p>
                    <span className="inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {ex.register}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Slots — one block per slot */}
      {chunk.slots.length > 0 && (
        <section>
          <SectionLabel>Slots</SectionLabel>
          <ul className="space-y-3">
            {chunk.slots.map((s, i) => (
              <li key={i} className="rounded-md border bg-card/50 p-3">
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-mono text-lg font-bold"
                    style={{ color }}
                  >
                    {s.placeholder}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    — {s.type}
                  </span>
                </div>
                {s.fillers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.fillers.map((f, j) =>
                      onFillerClick ? (
                        <button
                          key={j}
                          type="button"
                          onClick={() => onFillerClick(f)}
                          className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
                          title={`Search chunks containing "${f}"`}
                        >
                          {f}
                        </button>
                      ) : (
                        <span
                          key={j}
                          className="rounded-md bg-muted px-2 py-0.5 text-xs text-foreground/80"
                        >
                          {f}
                        </span>
                      ),
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pitfall — warning band */}
      {chunk.pitfall && (
        <section>
          <SectionLabel>Pitfall</SectionLabel>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
            <span aria-hidden className="mt-0.5 text-amber-500">⚠</span>
            <p className="text-sm leading-relaxed">{chunk.pitfall}</p>
          </div>
        </section>
      )}

      {/* Contrast — sibling chunks */}
      {chunk.contrast && chunk.contrast.length > 0 && (
        <section>
          <SectionLabel>Contrast</SectionLabel>
          <ul className="space-y-2">
            {chunk.contrast.map((c, i) => {
              const formNode = onContrastClick ? (
                <button
                  type="button"
                  onClick={() => onContrastClick(c.form)}
                  className="font-mono text-sm text-foreground transition-colors hover:underline"
                  title={`Search chunks matching "${c.form}"`}
                >
                  {c.form}
                </button>
              ) : (
                <span className="font-mono text-sm">{c.form}</span>
              );
              return (
                <li
                  key={i}
                  className="rounded-md border bg-card/50 px-3 py-2 text-sm leading-relaxed"
                >
                  <div>{formNode}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {c.diff}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Anchors — theoretical labels */}
      {chunk.theoreticalAnchors && chunk.theoreticalAnchors.length > 0 && (
        <section>
          <SectionLabel>Theoretical Anchors</SectionLabel>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {chunk.theoreticalAnchors.map((a) => (
              <span
                key={a}
                className="rounded-md border bg-muted/40 px-2.5 py-1 font-medium text-foreground/80"
              >
                {getAnchorLabel(a)}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
