import type { BoundaryTest, BoundaryTestOption } from "@/shared/types";

// ---------------------------------------------------------------------------
// Backward-compat adapter for BoundaryTest
// Old format: { scenario, answer, explanation }
// New format: { sentence, options: [{ verdict, word, reason }] }
// ---------------------------------------------------------------------------

export interface NormalizedBoundaryTest {
  sentence: string;
  options: BoundaryTestOption[];
}

export function normalizeBoundaryTests(
  tests: BoundaryTest[],
): NormalizedBoundaryTest[] {
  return tests.map((t) => {
    // New format — has sentence + options
    if (t.sentence && t.options && t.options.length > 0) {
      return { sentence: t.sentence, options: t.options };
    }
    // Legacy format — convert { scenario, answer, explanation } → new shape
    return {
      sentence: t.scenario ?? "",
      options: [
        {
          verdict: (t.answer === "yes" ? "yes" : t.answer === "no" ? "no" : "maybe") as "yes" | "no" | "maybe",
          word: "—",
          reason: t.explanation ?? "",
        },
      ],
    };
  });
}
