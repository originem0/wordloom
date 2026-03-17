// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import "@testing-library/jest-dom/vitest";
import { WordCard, normalizeBoundaryTests } from "../WordCard";
import type { Card } from "@/shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock the API hooks so it doesn't actually try to fetch
vi.mock("@/client/hooks/useCards", () => ({
  useGenerateDeep: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    data: null,
  }),
}));

const queryClient = new QueryClient();

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe("Scenario 2: Legacy Card Backward Compatibility", () => {
  it("normalizeBoundaryTests adapter seamlessly converts old format to new layout", () => {
    const legacyTests: any[] = [
      {
        scenario: "When something blocks your way",
        answer: "yes",
        explanation: "Blockage schema applies here.",
      },
    ];

    const normalized = normalizeBoundaryTests(legacyTests);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].sentence).toBe("When something blocks your way");
    expect(normalized[0].options[0].verdict).toBe("yes");
    expect(normalized[0].options[0].reason).toBe("Blockage schema applies here.");
  });

  it("WordCard component renders legacy tests without crashing", () => {
    const legacyCard = {
      id: 1,
      word: "block",
      // Partial mock Card Surface/Middle
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
      boundaryTests: [
        {
          scenario: "Old scenario without blanks",
          answer: "yes",
          explanation: "Old reason",
        },
      ] as any[],
    } as unknown as Card;

    renderWithProviders(<WordCard card={legacyCard} />);

    // Should render the old scenario text in the UI
    expect(screen.getByText("Old scenario without blanks")).toBeInTheDocument();
  });
});

describe("Scenario 5: UI Graceful Degradation", () => {
  it("does not crash and degrades gracefully when deep data is missing or incomplete", () => {
    // A card with missing chunks of data
    const incompleteCard = {
      id: 2,
      word: "fragment",
      usageCount: 0,
      createdAt: 0,
      updatedAt: 0,
      storyId: null,
      ipa: null,
      pos: "noun",
      cefr: null,
      cefrConfidence: null,
      coreMeaning: "A broken part.",
      wad: null,
      wap: null,
      etymology: null, // missing etymology completely
      collocations: [],
      examples: [],
      contextLadder: [],
      phrases: [],
      synonyms: [],
      antonyms: [],
      minPair: null,
      familyComparison: [], // empty family
      schemaAnalysis: {
        coreSchema: "unknown", // not a recognized schema like blockage
        metaphoricalExtensions: [],
        registerVariation: "formal",
        // no coreImageText, no sceneActivation, no etymologyChain
      },
      boundaryTests: null, // missing tests completely
    } as unknown as Card;

    const { container } = renderWithProviders(<WordCard card={incompleteCard} />);

    // Renders the header ok
    expect(screen.getByText("fragment")).toBeInTheDocument();
    
    // Core Schema fallback logic shows coreSchema name ("unknown") when coreImageText is missing
    expect(screen.getByText("unknown")).toBeInTheDocument();

    // Etymology section should not be in the DOM at all (degrades gracefully)
    expect(screen.queryByText("词根词源 Etymology")).not.toBeInTheDocument();

    // Boundary Tests section should not be in the DOM
    expect(screen.queryByText("边界测试 Boundary Tests")).not.toBeInTheDocument();

    // Does not crash!
    expect(container).not.toBeEmptyDOMElement();
  });
});
