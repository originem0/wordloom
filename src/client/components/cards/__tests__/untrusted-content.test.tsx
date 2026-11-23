// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PrototypeWordCard } from "../PrototypeWordCard";
import type { Card } from "@/shared/types";

vi.mock("@/client/hooks/useCards", () => ({
  useGenerateDeep: () => ({ mutate: vi.fn(), isPending: false, isError: false, data: null }),
}));

// Deep-layer fields are model output, and what the model reads (a word, or a
// passage pasted in for extraction) can come from anywhere. Everything below
// is what a prompt-injected response could store in the card.
const HOSTILE_SVG =
  '<svg onload=alert(1) viewBox="0 0 600 180" xmlns="http://www.w3.org/2000/svg">' +
  "<script>window.__pwned = 1</script>" +
  '<a href="java&#115;cript:alert(2)"><text x="10" y="20">label</text></a></svg>';

function hostileCard(): Card {
  return {
    id: 1,
    word: "obscure",
    usageCount: 0,
    createdAt: 0,
    updatedAt: 0,
    storyId: null,
    ipa: null,
    pos: "adj",
    cefr: "C1",
    cefrConfidence: null,
    coreMeaning: "hard to see",
    wad: null,
    wap: null,
    etymology: null,
    collocations: [],
    examples: [],
    contextLadder: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    minPair: null,
    familyComparison: [
      { word: "obscure", pos: "adj", distinction: "d", register: "r", typicalScene: "s" },
    ],
    schemaAnalysis: {
      coreSchema: "blockage",
      coreSvg: HOSTILE_SVG,
      metaphoricalExtensions: [],
      registerVariation: "neutral",
      sceneActivation: [
        {
          title: "Fog",
          description: "desc",
          example: 'The sign was **obscured** by fog <img src=x onerror="alert(3)">',
          associatedWords: [],
        },
      ],
      familyBoundaryNote: 'first line\nsecond line <img src=x onerror="alert(4)">',
    },
    boundaryTests: [],
  } as unknown as Card;
}

describe("PrototypeWordCard treats model output as text, never as markup", () => {
  it("does not materialise HTML embedded in a scene example", () => {
    const { container } = render(<PrototypeWordCard card={hostileCard()} />);
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(3)">');
  });

  it("still renders **bold** emphasis in a scene example", () => {
    const { container } = render(<PrototypeWordCard card={hostileCard()} />);
    const strong = Array.from(container.querySelectorAll("strong")).map((el) => el.textContent);
    expect(strong).toContain("obscured");
    expect(container.textContent).not.toContain("**");
  });

  it("does not materialise HTML embedded in the family boundary note", () => {
    const { container } = render(<PrototypeWordCard card={hostileCard()} />);
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(container.textContent).toContain("second line <img src=x");
  });
});

describe("PrototypeWordCard core image", () => {
  it("never inserts the model's SVG into the page DOM", () => {
    const { container } = render(<PrototypeWordCard card={hostileCard()} />);
    expect(container.querySelector("[onload]")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="java"]')).toBeNull();
  });

  it("shows the SVG as an image, where browsers run no script and load no subresources", () => {
    const { container } = render(<PrototypeWordCard card={hostileCard()} />);
    const img = container.querySelector(".custom-schema-svg img");
    expect(img).not.toBeNull();
    const src = img!.getAttribute("src") ?? "";
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(src.split(",")[1])).toContain('<text x="10" y="20">label</text>');
  });

  it("falls back to the built-in schema drawing when the field holds no SVG", () => {
    const card = hostileCard();
    card.schemaAnalysis!.coreSvg = "not an svg at all";
    const { container } = render(<PrototypeWordCard card={card} />);
    expect(container.querySelector(".custom-schema-svg")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});
