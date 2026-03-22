import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

// Mock db — Proxy-based to support drizzle's chained API
function mockDbChain(result: unknown) {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "all") return () => result;
        if (prop === "get") return () => result;
        if (prop === "returning") return () => [result];
        // Everything else returns the proxy for chaining
        return () => proxy;
      },
    },
  );
  return proxy;
}

const mockSelectResult: { word: string }[] = [];
const mockGenerateCards = vi.fn();

vi.mock("../../db/index.js", () => ({
  db: {
    select: vi.fn(() => mockDbChain(mockSelectResult)),
    insert: vi.fn(() => mockDbChain({})),
    update: vi.fn(() => mockDbChain({})),
    delete: vi.fn(() => mockDbChain({})),
  },
}));

vi.mock("../../services/ai-router.js", () => ({
  generateCards: (...args: unknown[]) => mockGenerateCards(...args),
  generateDeepLayer: vi.fn(),
  extractWords: vi.fn(),
}));

vi.mock("../../services/ai-shared.js", () => ({
  AI_BUSY: "AI_BUSY",
}));

// Import after mocks
import { Hono } from "hono";
import { cardRoutes } from "../cards.js";
import { db } from "../../db/index.js";

function buildApp() {
  const app = new Hono();
  app.route("/cards", cardRoutes);
  return app;
}

describe("POST /cards/generate — deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResult.length = 0;
  });

  it('returns "All words already exist" when all words exist', async () => {
    // db.select chain returns these existing words
    const existingWords = [{ word: "hello" }, { word: "world" }];
    vi.mocked(db.select).mockReturnValue(mockDbChain(existingWords) as never);

    const app = buildApp();
    const res = await app.request("/cards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: ["hello", "world"] }),
    });

    const body = await res.json();
    expect(body.message).toBe("All words already exist");
    expect(mockGenerateCards).not.toHaveBeenCalled();
  });

  it("only generates cards for new words (case-insensitive)", async () => {
    vi.mocked(db.select).mockReturnValue(
      mockDbChain([{ word: "hello" }]) as never,
    );
    mockGenerateCards.mockResolvedValue({ success: [], failed: [] });

    const app = buildApp();
    await app.request("/cards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: ["HELLO", "world"] }),
    });

    expect(mockGenerateCards).toHaveBeenCalledWith(["world"]);
  });

  it("skips all when duplicates differ only by case", async () => {
    vi.mocked(db.select).mockReturnValue(
      mockDbChain([{ word: "hello" }]) as never,
    );

    const app = buildApp();
    const res = await app.request("/cards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: ["HELLO", "hello"] }),
    });

    const body = await res.json();
    expect(body.message).toBe("All words already exist");
    expect(mockGenerateCards).not.toHaveBeenCalled();
  });
});
