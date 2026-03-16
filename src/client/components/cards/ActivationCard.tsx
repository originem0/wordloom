import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Flame } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { useIncrementUsage, useGenerateDeep } from "@/client/hooks/useCards";
import type { Card } from "@/shared/types";

// -- Surface layer (always visible) --

function SurfaceLayer({ card }: { card: Card }) {
  const increment = useIncrementUsage();

  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight">{card.word}</span>
          {card.ipa && (
            <span className="font-mono text-sm text-muted-foreground">
              {card.ipa}
            </span>
          )}
          {card.pos && <Badge variant="secondary">{card.pos}</Badge>}
          {card.cefr && <Badge variant="outline">{card.cefr}</Badge>}
        </div>
        {card.coreMeaning && (
          <p className="text-sm text-muted-foreground">{card.coreMeaning}</p>
        )}
        <div className="flex gap-3 text-xs text-muted-foreground">
          {card.wad != null && <span>WAD: {card.wad.toFixed(1)}</span>}
          {card.wap != null && <span>WAP: {card.wap.toFixed(1)}</span>}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={increment.isPending}
        onClick={(e) => {
          e.stopPropagation();
          increment.mutate(card.id);
        }}
      >
        {increment.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Flame className="size-3.5" />
        )}
        Used it! {card.usageCount > 0 && `(${card.usageCount})`}
      </Button>
    </div>
  );
}

// -- Middle layer --

function MiddleLayer({ card }: { card: Card }) {
  return (
    <div className="space-y-4 text-sm">
      {/* Collocations */}
      {card.collocations.length > 0 && (
        <Section title="Collocations">
          <div className="flex flex-wrap gap-1.5">
            {card.collocations.map((c) => (
              <Badge key={c} variant="secondary">
                {c}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {/* Context Ladder */}
      {card.contextLadder.length > 0 && (
        <Section title="Context Ladder">
          <ol className="space-y-2">
            {card.contextLadder.map((lvl) => (
              <li key={lvl.level} className="space-y-0.5">
                <p>
                  <Badge variant="outline" className="mr-1.5 text-[10px]">
                    L{lvl.level}
                  </Badge>
                  {lvl.sentence}
                </p>
                <p className="pl-7 text-muted-foreground">{lvl.context}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Examples */}
      {card.examples.length > 0 && (
        <Section title="Examples">
          <ol className="space-y-2">
            {card.examples.map((ex, i) => (
              <li key={i} className="space-y-0.5">
                <p>
                  <Badge variant="outline" className="mr-1.5 text-[10px] capitalize">
                    {ex.level}
                  </Badge>
                  {ex.sentence}
                </p>
                <p className="pl-7 text-muted-foreground">{ex.translation}</p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Etymology */}
      {card.etymology && (
        <Section title="Etymology">
          <p className="text-muted-foreground">{card.etymology}</p>
        </Section>
      )}

      {/* Synonyms / Antonyms */}
      {(card.synonyms.length > 0 || card.antonyms.length > 0) && (
        <Section title="Synonyms & Antonyms">
          <div className="grid grid-cols-2 gap-3">
            {card.synonyms.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Synonyms
                </p>
                <div className="flex flex-wrap gap-1">
                  {card.synonyms.map((s) => (
                    <Badge key={s} variant="secondary">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {card.antonyms.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Antonyms
                </p>
                <div className="flex flex-wrap gap-1">
                  {card.antonyms.map((a) => (
                    <Badge key={a} variant="outline">
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Phrases */}
      {card.phrases.length > 0 && (
        <Section title="Phrases">
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">
            {card.phrases.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Section>
      )}

      {/* Min Pair */}
      {card.minPair && (
        <Section title="Minimal Pair">
          <p className="text-muted-foreground">{card.minPair}</p>
        </Section>
      )}
    </div>
  );
}

// -- Deep layer --

function DeepLayer({ card }: { card: Card }) {
  const [open, setOpen] = useState(false);
  const generateDeep = useGenerateDeep();

  const hasDeep =
    card.familyComparison != null ||
    card.schemaAnalysis != null ||
    card.boundaryTests != null;

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    // Generate deep data on first open if not present
    if (next && !hasDeep && !generateDeep.isPending && !generateDeep.data) {
      generateDeep.mutate(card.id);
    }
  };

  // Use freshly-generated data if available, otherwise fall back to card props
  const deep = generateDeep.data ?? card;

  return (
    <div className="border-t pt-3">
      <button
        onClick={handleToggle}
        className="flex w-full items-center justify-between min-h-11 text-sm font-medium hover:text-foreground text-muted-foreground transition-colors"
      >
        Deep Analysis
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>

      {open && (
        <div className="mt-3 space-y-4 text-sm">
          {generateDeep.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Generating deep analysis...
            </div>
          )}

          {generateDeep.isError && (
            <p className="text-destructive text-sm">
              {generateDeep.error.message}
            </p>
          )}

          {/* Family Comparison Table */}
          {deep.familyComparison && deep.familyComparison.length > 0 && (
            <Section title="Family Comparison">
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="px-1 py-1.5 font-medium">Word</th>
                      <th className="px-1 py-1.5 font-medium">POS</th>
                      <th className="px-1 py-1.5 font-medium">Distinction</th>
                      <th className="px-1 py-1.5 font-medium">Register</th>
                      <th className="px-1 py-1.5 font-medium">Typical Scene</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deep.familyComparison.map((entry) => (
                      <tr key={entry.word} className="border-b last:border-0">
                        <td className="px-1 py-1.5 font-medium">{entry.word}</td>
                        <td className="px-1 py-1.5">{entry.pos}</td>
                        <td className="px-1 py-1.5">{entry.distinction}</td>
                        <td className="px-1 py-1.5">{entry.register}</td>
                        <td className="px-1 py-1.5">{entry.typicalScene}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Schema Analysis */}
          {deep.schemaAnalysis && (
            <Section title="Schema Analysis">
              <div className="space-y-2">
                <p>
                  <span className="font-medium">Core Schema: </span>
                  <span className="text-muted-foreground">
                    {deep.schemaAnalysis.coreSchema}
                  </span>
                </p>
                {deep.schemaAnalysis.metaphoricalExtensions.length > 0 && (
                  <div>
                    <span className="font-medium">Metaphorical Extensions:</span>
                    <ul className="mt-1 list-inside list-disc text-muted-foreground">
                      {deep.schemaAnalysis.metaphoricalExtensions.map((ext, i) => (
                        <li key={i}>{ext}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p>
                  <span className="font-medium">Register Variation: </span>
                  <span className="text-muted-foreground">
                    {deep.schemaAnalysis.registerVariation}
                  </span>
                </p>
              </div>
            </Section>
          )}

          {/* Boundary Tests */}
          {deep.boundaryTests && deep.boundaryTests.length > 0 && (
            <Section title="Boundary Tests">
              <div className="space-y-2">
                {deep.boundaryTests.map((bt, i) => (
                  <details key={i} className="group">
                    <summary className="cursor-pointer list-none font-medium hover:text-foreground text-muted-foreground">
                      <span className="group-open:hidden">&#9654;</span>
                      <span className="hidden group-open:inline">&#9660;</span>
                      {" "}
                      {bt.scenario}
                    </summary>
                    <div className="mt-1 ml-4 space-y-0.5 text-muted-foreground">
                      <p>
                        <span className="font-medium text-foreground">Answer: </span>
                        {bt.answer}
                      </p>
                      <p>
                        <span className="font-medium text-foreground">Why: </span>
                        {bt.explanation}
                      </p>
                    </div>
                  </details>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// -- Shared section wrapper --

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

// -- Main export --

export function ActivationCard({ card }: { card: Card }) {
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
      <SurfaceLayer card={card} />
      <div className="border-t pt-4">
        <MiddleLayer card={card} />
      </div>
      <DeepLayer card={card} />
    </div>
  );
}
