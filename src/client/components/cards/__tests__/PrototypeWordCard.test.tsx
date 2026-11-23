// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PrototypeWordCard } from "../PrototypeWordCard";
import type { Card } from "@/shared/types";

vi.mock("@/client/hooks/useCards", () => ({
  useGenerateDeep: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: null }),
}));

function makeCard(overrides: Record<string, unknown>): Card {
  return {
    id: 1,
    word: "block",
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
    storyId: null,
    ipa: "/blɒk/",
    pos: "noun",
    cefr: "B1",
    cefrConfidence: 0.9,
    coreMeaning: "Solid piece of material.",
    wad: 1.0,
    wap: 1.0,
    etymology: "From Old French",
    collocations: [],
    examples: [],
    contextLadder: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    minPair: null,
    familyComparison: [],
    schemaAnalysis: {
      coreSchema: "blockage",
      metaphoricalExtensions: [],
      registerVariation: "neutral",
    },
    boundaryTests: [],
    ...overrides,
  } as unknown as Card;
}

// The library holds cards generated under earlier prompts; their deep layer is
// stored as it was written and is never migrated.
describe("cards stored in an older or partial shape", () => {
  it("shows a boundary test saved as { scenario, answer, explanation }", () => {
    render(
      <PrototypeWordCard
        card={makeCard({
          boundaryTests: [
            { scenario: "Old scenario without blanks", answer: "yes", explanation: "Old reason" },
          ],
        })}
      />,
    );
    expect(screen.getByText("Old scenario without blanks")).toBeInTheDocument();
    expect(screen.getByText("— Old reason")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("leaves out the sections a partial deep layer has no data for", () => {
    render(
      <PrototypeWordCard
        card={makeCard({
          word: "fragment",
          etymology: null,
          // not one of the built-in schema drawings, and nothing else filled in
          schemaAnalysis: { coreSchema: "unknown", metaphoricalExtensions: [], registerVariation: "formal" },
          boundaryTests: null,
        })}
      />,
    );
    expect(screen.getByText("fragment")).toBeInTheDocument();
    expect(screen.getByText("unknown")).toBeInTheDocument();
    expect(screen.queryByText(/Etymology/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Boundary tests/)).not.toBeInTheDocument();
  });
});
