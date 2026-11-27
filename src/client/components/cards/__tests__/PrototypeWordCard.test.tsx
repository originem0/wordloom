// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";
import { PrototypeWordCard } from "../PrototypeWordCard";
import type { Card } from "@/shared/types";
import { useAppStore } from "@/client/store";
import { useReadingStore } from "@/client/store/reading";

let isAdmin: boolean;
let deep: { isPending: boolean; isError: boolean; data: unknown; error?: Error };
const mutate = vi.fn();

vi.mock("@/client/hooks/useCards", () => ({
  useGenerateDeep: () => ({ mutate, ...deep }),
}));
vi.mock("@/client/hooks/useAuth", () => ({ useIsAdmin: () => isAdmin }));

beforeEach(() => {
  useAppStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  useAppStore.getState().setUiLanguage("zh-CN");
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
    expect(screen.queryByText("— Old reason")).toBeNull();
    expect(screen.getByRole("button", { name: "显示答案" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "适用" }));
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
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
    expect(screen.queryByText("词根词源")).not.toBeInTheDocument();
    expect(screen.queryByText("边界测试")).not.toBeInTheDocument();
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

describe("the card interface language", () => {
  it("updates labels and schema text while preserving the revealed answer and stored content", () => {
    isAdmin = true;
    const { container } = render(<PrototypeWordCard card={makeCard({
      etymology: "生成过的解释保持中文。",
      boundaryTests: [{ sentence: "A ______ in the road.", options: [{ verdict: "yes", word: "block", reason: "生成过的理由。" }] }],
    })} onClose={vi.fn()} />, { wrapper: MemoryRouter });
    const tests = container.querySelector(".boundary-tests")!;
    fireEvent.click(screen.getByRole("radio", { name: "block" }));
    fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
    expect(container.querySelector(".test-options")).toHaveClass("visible");
    act(() => useAppStore.getState().setUiLanguage("en"));
    expect(screen.getByRole("heading", { name: "Core image" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Etymology" })).toBeInTheDocument();
    expect(screen.getByText("Boundary tests")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Save" })).toHaveAttribute("title", "Save to expressions");
    expect(screen.getByRole("img", { name: "Blocking schema — observer, obstacle, hidden target" })).toBeInTheDocument();
    expect(screen.getByText("hidden target")).toBeInTheDocument();
    expect(screen.getByText("生成过的解释保持中文。")).toBeInTheDocument();
    expect(screen.getByText("— 生成过的理由。")).toBeInTheDocument();
    expect(container.querySelector(".test-options")).toHaveClass("visible");
    expect(container.querySelector(".boundary-tests")).toBe(tests);
    expect(screen.queryByRole("button", { name: "Show answer" })).toBeNull();
    expect(mutate).not.toHaveBeenCalled();
  });
});

const FAMILY = [
  { word: "block", pos: "v", distinction: "完全挡住", register: "中性", typicalScene: "道路" },
  { word: "hinder", pos: "v", distinction: "拖慢", register: "正式", typicalScene: "进展" },
];
const TESTS = [
  { sentence: "Fallen trees ______ the road.", options: [
    { verdict: "yes", word: "block", reason: "路完全不通。" },
    { verdict: "no", word: "hinder", reason: "只是变慢。" },
    { verdict: "no", word: "clog", reason: "用于管道。" },
  ] },
  { sentence: "Red tape ______ the project.", options: [
    { verdict: "yes", word: "hinder", reason: "进展被拖慢。" },
    { verdict: "no", word: "block", reason: "项目没有停。" },
  ] },
];
const answer = (word: string) => {
  fireEvent.click(screen.getByRole("radio", { name: word }));
  fireEvent.click(screen.getByRole("button", { name: "显示答案" }));
};

// Models write the fitting word first. The card must not show that order, and
// must still judge a choice by the word chosen, wherever it landed.
describe("boundary tests", () => {
  it("does not always offer the options in stored order", () => {
    const first = new Set<string>();
    for (let id = 1; id <= 12; id++) {
      const { unmount } = render(<PrototypeWordCard card={makeCard({ id, boundaryTests: TESTS })} />);
      first.add(screen.getAllByRole("radio")[0].closest("label")!.textContent!);
      unmount();
    }
    expect(first.size).toBeGreaterThan(1);
  });

  it("judges the word that was chosen", () => {
    render(<PrototypeWordCard card={makeCard({ boundaryTests: TESTS })} />);
    answer("hinder");
    expect(screen.getByRole("status")).toHaveTextContent("你选了 hinder，参考判断是不适用。");
    expect(screen.getByText("— 只是变慢。").closest(".opt")).toHaveClass("chosen");
    expect(screen.getByText("— 路完全不通。").closest(".opt")).not.toHaveClass("chosen");
  });

  it("asks one question at a time and counts only first answers", () => {
    render(<PrototypeWordCard card={makeCard({ boundaryTests: TESTS })} />);
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.queryByText(/Red tape/)).toBeNull();
    expect(screen.queryByRole("button", { name: "下一题" })).toBeNull();

    answer("hinder");
    fireEvent.click(screen.getByRole("button", { name: "再试一次" }));
    answer("block");
    fireEvent.click(screen.getByRole("button", { name: "下一题" }));

    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.queryByText(/Fallen trees/)).toBeNull();
    answer("hinder");
    expect(screen.getByText("2 题里，第一次就选对 1 题。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "再来一遍" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.queryByText(/第一次就选对/)).toBeNull();
  });
});

// The comparison's typical scenes are the scenes the tests ask about.
describe("family comparison", () => {
  it("stays folded until a first answer has been shown", () => {
    const { container } = render(<PrototypeWordCard card={makeCard({ familyComparison: FAMILY, boundaryTests: TESTS })} />);
    const family = container.querySelector("details")!;
    expect(family.open).toBe(false);
    answer("block");
    expect(family.open).toBe(true);
  });

  it("opens with a card that has nothing to test", () => {
    const { container } = render(<PrototypeWordCard card={makeCard({ familyComparison: FAMILY })} />);
    expect(container.querySelector("details")!.open).toBe(true);
  });

  it("lists the axes, the rule and one line per compared pair", () => {
    const { container } = render(<PrototypeWordCard card={makeCard({
      familyComparison: FAMILY,
      schemaAnalysis: {
        coreSchema: "blockage",
        familyAxes: "程度 / 语域",
        familyChoiceRule: "完全不通 → block；变慢 → hinder",
        familyBoundaryNote: "block vs hinder：block 是墙；hinder 是泥地。block vs clog：clog 是管道里的淤泥。",
      },
    })} />);
    expect(screen.getByText("程度 / 语域")).toBeInTheDocument();
    expect(screen.getByText("完全不通 → block；变慢 → hinder")).toBeInTheDocument();
    expect([...container.querySelectorAll(".boundary-note li")].map((li) => li.textContent)).toEqual([
      "block vs hinder：block 是墙；hinder 是泥地。",
      "block vs clog：clog 是管道里的淤泥。",
    ]);
  });

  it("sends another family word to the library's search and closes the card", () => {
    const onClose = vi.fn();
    useReadingStore.getState().setCardInput("");
    render(<PrototypeWordCard card={makeCard({ familyComparison: FAMILY })} onClose={onClose} />);
    expect(screen.queryByRole("button", { name: "block" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "hinder" }));
    expect(useReadingStore.getState().cards.input).toBe("hinder");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers no lookup where the card cannot be closed", () => {
    render(<PrototypeWordCard card={makeCard({ familyComparison: FAMILY })} />);
    expect(screen.queryByRole("button", { name: "hinder" })).toBeNull();
    expect(screen.getByText("hinder")).toBeInTheDocument();
  });
});

describe("what the card shows beyond the deep layer", () => {
  it("lists collocations and phrases once, with the examples", () => {
    const { container } = render(<PrototypeWordCard card={makeCard({
      collocations: ["road block", "mental block"],
      phrases: ["Mental block", "a chip off the old block"],
      examples: [{ level: "basic", sentence: "A tree blocked the road.", translation: "一棵树挡住了路。" }],
      antonyms: ["clear"],
      minPair: "black",
    })} />);
    expect([...container.querySelectorAll(".usage-phrases li")].map((li) => li.textContent)).toEqual(["road block", "mental block", "a chip off the old block"]);
    expect(screen.getByText("A tree blocked the road.")).toBeInTheDocument();
    expect(screen.getByText("一棵树挡住了路。")).toBeInTheDocument();
    expect(screen.getByText("black")).toBeInTheDocument();
    expect(screen.getByText("clear")).toBeInTheDocument();
  });

  it("names the word type when the layer has one", () => {
    render(<PrototypeWordCard card={makeCard({ schemaAnalysis: { coreSchema: "blockage", wordType: "action" } })} />);
    expect(screen.getByText("动作词")).toBeInTheDocument();
  });

  it("draws nothing for a word no schema fits", () => {
    render(<PrototypeWordCard card={makeCard({ schemaAnalysis: { coreSchema: "none" } })} />);
    expect(screen.queryByText("核心意象")).toBeNull();
    expect(screen.queryByText("none")).toBeNull();
    expect(screen.getByText("这张词卡还没有深度分析。")).toBeInTheDocument();
  });

  it("keeps the written image when there is no drawing", () => {
    const { container } = render(<PrototypeWordCard card={makeCard({ schemaAnalysis: { coreSchema: "none", coreImageText: "泉水自己涌出来。" } })} />);
    expect(screen.getByText("泉水自己涌出来。")).toBeInTheDocument();
    expect(container.querySelector(".core-visual")).toBeNull();
  });
});

const oldScene = {
  coreSchema: "container",
  coreSvg: '<svg viewBox="0 0 60 30"><rect width="60" height="30" fill="#eee8d5"/></svg>',
  coreImageText: "旧图里有一堵石墙。",
};

describe("the scene, explanation and example on a word card", () => {
  it.each([
    ["grim", "adjective", "读着报告", "眉头", "Her expression was grim as she read the report.", "grim"],
    ["resume", "verb", "同一个预算问题", "同一个预算", "After lunch, they resumed their discussion.", "resumed"],
    ["spontaneous", "adj", "听众就鼓起掌来", null, "The audience broke into spontaneous applause as the speech ended.", "spontaneous"],
  ] as const)("replaces the entire old scene for %s", (word, pos, caption, alt, sentence, form) => {
    const { container } = render(<PrototypeWordCard card={makeCard({ word, pos, schemaAnalysis: oldScene })} />);
    const scene = container.querySelector(".core-image")!;
    expect(scene.querySelector(".core-caption")).toHaveTextContent(caption);
    expect(scene).not.toHaveTextContent(oldScene.coreImageText);
    expect(scene.querySelector("img")).toBeNull();
    if (alt) expect(screen.getByRole("img", { name: new RegExp(alt) })).toBeInTheDocument();
    else expect(scene.querySelector(".core-visual")).toBeNull();
    expect(scene.querySelector(".core-example")).toHaveTextContent(sentence);
    expect(scene.querySelector(".core-example strong")).toHaveTextContent(form);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("can show a reviewed scene before the rest of the deep layer exists", () => {
    const { container } = render(<PrototypeWordCard card={makeCard({ word: "grim", schemaAnalysis: null })} />);
    act(() => useAppStore.getState().setUiLanguage("en"));
    expect(screen.getByRole("img", { name: /report with a furrowed brow/ })).toBeInTheDocument();
    expect(container.querySelector(".core-caption")).toHaveTextContent("the news may be bad");
    expect(mutate).not.toHaveBeenCalled();
  });

  it.each([["resume", "noun"], ["drift", "verb"]])("keeps the saved %s scene and its isolated image", (word, pos) => {
    const { container } = render(<PrototypeWordCard card={makeCard({ word, pos, schemaAnalysis: oldScene })} />);
    const scene = container.querySelector(".core-image")!;
    expect(scene).toHaveTextContent(oldScene.coreImageText);
    expect(scene.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(scene.querySelector("svg, .core-example")).toBeNull();
  });

  it("keeps a newly generated pair together, even on a word with reviewed artwork", () => {
    const card = makeCard({ word: "grim", schemaAnalysis: {
      coreSchema: "none", coreImageText: "医生表情凝重。", coreImageExample: "The doctor's expression was **grim**.",
    } });
    const { container } = render(<PrototypeWordCard card={card} />);
    act(() => useAppStore.getState().setUiLanguage("en"));
    const scene = container.querySelector(".core-image")!;
    expect(scene).toHaveTextContent("医生表情凝重。");
    expect(scene.querySelector(".core-example")).toHaveTextContent("The doctor's expression was grim.");
    expect(scene.querySelector(".core-visual")).toBeNull();
  });

  it("retains the new caption and example if the paired image fails to load", () => {
    const { container } = render(<PrototypeWordCard card={makeCard({ word: "assume", schemaAnalysis: {
      coreSchema: "link", coreSvg: oldScene.coreSvg, coreImageText: "她接手了这个团队。",
      coreImageExample: "She **assumed** responsibility for the team.",
    } })} />);
    const scene = container.querySelector(".core-image")!;
    fireEvent.error(scene.querySelector("img")!);
    expect(scene.querySelector(".core-visual")).toBeNull();
    expect(scene).toHaveTextContent("她接手了这个团队。");
    expect(scene.querySelector(".core-example")).toHaveTextContent("She assumed responsibility for the team.");
  });
});
