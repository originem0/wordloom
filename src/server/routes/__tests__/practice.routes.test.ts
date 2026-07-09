import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PracticeBrief, PracticeFeedback } from "../../../shared/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dbState: {
  inserted: Record<string, unknown> | null;
  insertReturning: Record<string, unknown> | null;
  selectGet: Record<string, unknown> | null | undefined;
  selectAll: Record<string, unknown>[];
  selectCount: number;
  deleted: boolean;
} = {
  inserted: null,
  insertReturning: null,
  selectGet: null,
  selectAll: [],
  selectCount: 0,
  deleted: false,
};

function resetDbState() {
  dbState.inserted = null;
  dbState.insertReturning = null;
  dbState.selectGet = null;
  dbState.selectAll = [];
  dbState.selectCount = 0;
  dbState.deleted = false;
}

const mockBrief = vi.fn();
const mockImage = vi.fn();
const mockGrade = vi.fn();

vi.mock("../../db/index.js", () => {
  const insert = vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      dbState.inserted = v;
      return { returning: () => [dbState.insertReturning ?? { id: 1, ...v }] };
    },
  }));

  const select = vi.fn(() => {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      get: () => (dbState.selectGet !== null ? dbState.selectGet : { total: dbState.selectCount }),
      all: () => dbState.selectAll,
    };
    return chain;
  });

  const del = vi.fn(() => ({ where: () => { dbState.deleted = true; return Promise.resolve(); } }));

  return { db: { select, insert, delete: del } };
});

vi.mock("../../services/ai-router.js", () => ({
  generatePracticeBrief: (...a: unknown[]) => mockBrief(...a),
  generatePracticeImage: (...a: unknown[]) => mockImage(...a),
  gradePracticeDescription: (...a: unknown[]) => mockGrade(...a),
}));

vi.mock("../../services/image.js", () => ({
  compressImage: vi.fn(async (buf: Buffer) => ({ buffer: buf, mimeType: "image/jpeg" })),
}));

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from("img")),
  unlink: vi.fn(async () => undefined),
}));

vi.mock("../../services/ai-shared.js", () => ({ AI_BUSY: "AI_BUSY", getSetting: vi.fn(async () => "") }));

vi.mock("../../middleware/rateLimit.js", () => ({
  rateLimit: () => null,
  dailyLimit: async () => null,
}));

vi.mock("../../services/jobs.js", () => ({
  createJob: vi.fn(async () => "job-1"),
  isJobCancelled: vi.fn(async () => false),
  setJobCancelled: vi.fn(async () => undefined),
  setJobDone: vi.fn(async () => undefined),
  setJobFailed: vi.fn(async () => undefined),
  setJobRunning: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
import { Hono } from "hono";
import { practiceRoutes } from "../practice.js";

function buildApp() {
  const app = new Hono();
  app.route("/practice", practiceRoutes);
  return app;
}

function makeBrief(over: Partial<PracticeBrief> = {}): PracticeBrief {
  return {
    visualPrompt: "A busy autumn morning farmers market, misty golden light, off-center candid framing.",
    sceneFrame: { subjects: ["a vendor"], actions: ["arranging produce"], setting: "a market", mood: "lively" },
    taskBrief: "用英语描述这个市场",
    suggestedChunks: [
      { form: "what strikes me is X", example: "What strikes me is how busy it is." },
      { form: "in the background, X", example: "In the background, stalls line the street." },
    ],
    starterLine: "This looks like an early autumn market, and...",
    ...over,
  };
}

function makeFeedback(): PracticeFeedback {
  return {
    overall: "Good start.",
    good: ["You named the place."],
    improve: [{ point: "主谓一致", suggestion: "A woman is selling vegetables." }],
    usedSuggestions: [{ form: "what strikes me is X", used: false }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbState();
});

// ---------------------------------------------------------------------------
describe("POST /practice/generate (sync)", () => {
  it("brief → image(with style suffix) → insert → returns practice", async () => {
    mockBrief.mockResolvedValue(makeBrief());
    mockImage.mockResolvedValue(Buffer.from("fake-png"));
    const app = buildApp();
    const res = await app.request("/practice/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "farmers market", style: "documentary" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; style: string; suggestedChunks: unknown[]; starterLine: string };
    // brief receives the new input shape
    expect(mockBrief).toHaveBeenCalledWith(expect.objectContaining({ topic: "farmers market" }));
    // image prompt = visualPrompt + style suffix (suffix appended, so it contains the visualPrompt)
    expect(mockImage).toHaveBeenCalledWith(expect.stringContaining(makeBrief().visualPrompt));
    // persisted JSON columns
    expect(dbState.inserted!.style).toBe("documentary");
    expect(typeof dbState.inserted!.suggestedChunks).toBe("string");
    expect(dbState.inserted!.starterLine).toBe(makeBrief().starterLine);
    // response parsed back
    expect(body.style).toBe("documentary");
    expect(Array.isArray(body.suggestedChunks)).toBe(true);
    expect(body.suggestedChunks.length).toBe(2);
  });

  it("brief throws AI_BUSY → 429 AI_BUSY", async () => {
    mockBrief.mockRejectedValue(new Error("AI_BUSY"));
    const app = buildApp();
    const res = await app.request("/practice/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x", style: "anime" }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("AI_BUSY");
  });

  it("image generation failure → 500 PRACTICE_FAILED", async () => {
    mockBrief.mockResolvedValue(makeBrief());
    mockImage.mockRejectedValue(new Error("upstream 500"));
    const app = buildApp();
    const res = await app.request("/practice/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "x" }),
    });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { code: string }).code).toBe("PRACTICE_FAILED");
  });
});

describe("POST /practice/:id/grade", () => {
  it("valid description → 200 feedback; grades against stored chunks (not persisted)", async () => {
    dbState.selectGet = {
      id: 5,
      visualPrompt: "a market",
      suggestedChunks: '[{"form":"what strikes me is X","example":"e"}]',
    };
    mockGrade.mockResolvedValue(makeFeedback());
    const app = buildApp();
    const res = await app.request("/practice/5/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "There are many people." }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PracticeFeedback;
    expect(body.improve[0].point).toBe("主谓一致");
    expect(mockGrade).toHaveBeenCalledWith({
      visualPrompt: "a market",
      suggestedChunks: ["what strikes me is X"],
      description: "There are many people.",
    });
    expect(dbState.inserted).toBeNull(); // grading never writes
  });

  it("practice not found → 404", async () => {
    dbState.selectGet = undefined;
    const app = buildApp();
    const res = await app.request("/practice/999/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "hi" }),
    });
    expect(res.status).toBe(404);
  });

  it("empty description → 400 INVALID_REQUEST, grade not called", async () => {
    dbState.selectGet = { id: 5, visualPrompt: "a market", suggestedChunks: "[]" };
    const app = buildApp();
    const res = await app.request("/practice/5/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "" }),
    });
    expect(res.status).toBe(400);
    expect(mockGrade).not.toHaveBeenCalled();
  });
});

describe("GET /practice & DELETE /practice/:id", () => {
  it("GET / → list with parsed JSON columns + pagination shape", async () => {
    dbState.selectCount = 1;
    dbState.selectAll = [
      {
        id: 1,
        imagePath: "data/images/a.jpg",
        topic: "t",
        style: "anime",
        visualPrompt: "v",
        sceneFrame: '{"subjects":["s"],"actions":[],"setting":"","mood":""}',
        suggestedChunks: '[{"form":"f","example":"e"}]',
        starterLine: "Start here…",
        taskBrief: "b",
        createdAt: 1,
      },
    ];
    const app = buildApp();
    const res = await app.request("/practice");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      practices: Array<{ style: string; suggestedChunks: Array<{ form: string }>; starterLine: string }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.practices[0].style).toBe("anime");
    expect(body.practices[0].suggestedChunks[0].form).toBe("f");
    expect(body.practices[0].starterLine).toBe("Start here…");
  });

  it("DELETE /:id → 200 ok and db.delete called", async () => {
    dbState.selectGet = { id: 3, imagePath: "data/images/x.jpg" };
    const app = buildApp();
    const res = await app.request("/practice/3", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(dbState.deleted).toBe(true);
  });

  it("DELETE missing → 404", async () => {
    dbState.selectGet = undefined;
    const app = buildApp();
    const res = await app.request("/practice/999", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
