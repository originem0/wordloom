// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { PrototypeWordCard } from "../PrototypeWordCard";
import type { Card } from "@/shared/types";

let isAdmin: boolean;
let deep: { isPending: boolean; isError: boolean; data: unknown; error?: Error };
const mutate = vi.fn();

vi.mock("@/client/hooks/useCards", () => ({
  useGenerateDeep: () => ({ mutate, ...deep }),
}));
vi.mock("@/client/hooks/useAuth", () => ({ useIsAdmin: () => isAdmin }));

beforeEach(() => {
  mutate.mockClear();
  isAdmin = false;
  deep = { isPending: false, isError: false, data: null };
});

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
    expect(screen.queryByText("这张词卡还没有深度分析。")).toBeNull();
  });
});

// Reading a card is public. Generating its deep layer is a model call, and the
// admin's: opening a card must never start one by itself.
describe("a card without a deep layer", () => {
  const bare = () => makeCard({ id: 42, schemaAnalysis: null, familyComparison: [], boundaryTests: [] });

  it("tells a visitor it is missing and offers no way to generate it", () => {
    render(<PrototypeWordCard card={bare()} />);
    expect(screen.getByText("这张词卡还没有深度分析。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成深度分析" })).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("waits for the admin to ask before generating", () => {
    isAdmin = true;
    render(<PrototypeWordCard card={bare()} />, { wrapper: MemoryRouter });
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "生成深度分析" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(42);
  });

  it("shows progress in place of the offer while generating", () => {
    isAdmin = true;
    deep = { isPending: true, isError: false, data: null };
    render(<PrototypeWordCard card={bare()} />, { wrapper: MemoryRouter });
    expect(screen.getByText("正在生成深度分析…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "生成深度分析" })).toBeNull();
  });

  it("says why an attempt failed and offers another", () => {
    isAdmin = true;
    deep = { isPending: false, isError: true, data: null, error: new Error("upstream timeout") };
    render(<PrototypeWordCard card={bare()} />, { wrapper: MemoryRouter });
    expect(screen.getByText("深度分析生成失败：upstream timeout")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mutate).toHaveBeenCalledWith(42);
  });

  it("shows the layer once it has been generated", () => {
    isAdmin = true;
    deep = {
      isPending: false,
      isError: false,
      data: { schemaAnalysis: { coreSchema: "blockage", coreImageText: "Something in the way." } },
    };
    render(<PrototypeWordCard card={bare()} />, { wrapper: MemoryRouter });
    expect(screen.getByText("Something in the way.")).toBeInTheDocument();
    expect(screen.queryByText("这张词卡还没有深度分析。")).toBeNull();
  });
});

// 收 saves nothing by itself: it leads to the capture box. The word travels in
// the fragment, the one part of a URL that is never sent to a server.
describe("收 on a card", () => {
  it("is not offered to a visitor", () => {
    render(<PrototypeWordCard card={makeCard({})} />);
    expect(screen.queryByRole("link", { name: "收" })).toBeNull();
  });

  it("takes the admin to the capture box with the word as the focus", () => {
    isAdmin = true;
    render(<PrototypeWordCard card={makeCard({ word: "rock & roll" })} />, { wrapper: MemoryRouter });
    expect(screen.getByRole("link", { name: "收" })).toHaveAttribute("href", "/#focus=rock%20%26%20roll");
  });
});
