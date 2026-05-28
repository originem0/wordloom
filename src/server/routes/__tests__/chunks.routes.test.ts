import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChunkGenerateResult, ChunkPayload } from "../../../shared/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture-able state for assertions
const dbState: {
  inserted: Record<string, unknown> | null;
  onConflictArgs: Record<string, unknown> | null;
  insertReturning: Record<string, unknown> | null;
  updated: Record<string, unknown> | null;
  updateShouldThrow: Error | null;
  selectGet: Record<string, unknown> | null;
  selectAll: Record<string, unknown>[];
  selectCount: number;
  // Captured chained calls for list assertions
  selectChain: {
    fromCalled: boolean;
    whereArg: unknown;
    orderByArg: unknown;
    limitArg: number | null;
    offsetArg: number | null;
  };
} = {
  inserted: null,
  onConflictArgs: null,
  insertReturning: null,
  updated: null,
  updateShouldThrow: null,
  selectGet: null,
  selectAll: [],
  selectCount: 0,
  selectChain: {
    fromCalled: false,
    whereArg: undefined,
    orderByArg: undefined,
    limitArg: null,
    offsetArg: null,
  },
};

function resetDbState() {
  dbState.inserted = null;
  dbState.onConflictArgs = null;
  dbState.insertReturning = null;
  dbState.updated = null;
  dbState.updateShouldThrow = null;
  dbState.selectGet = null;
  dbState.selectAll = [];
  dbState.selectCount = 0;
  dbState.selectChain = {
    fromCalled: false,
    whereArg: undefined,
    orderByArg: undefined,
    limitArg: null,
    offsetArg: null,
  };
}

const mockGenerateChunk = vi.fn();

vi.mock("../../db/index.js", () => {
  // insert(...).values(v).onConflictDoUpdate(args).returning() => [row]
  const insert = vi.fn(() => ({
    values: (v: Record<string, unknown>) => {
      dbState.inserted = v;
      return {
        onConflictDoUpdate: (args: Record<string, unknown>) => {
          dbState.onConflictArgs = args;
          return {
            returning: () => {
              const row = dbState.insertReturning ?? {
                id: 1,
                ...v,
                usageCount: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              return [row];
            },
          };
        },
      };
    },
  }));

  // update(...).set(v).where(...) — Drizzle returns a thenable; we mimic by returning a promise
  const update = vi.fn(() => ({
    set: (v: Record<string, unknown>) => {
      dbState.updated = v;
      return {
        where: () => {
          if (dbState.updateShouldThrow) throw dbState.updateShouldThrow;
          return Promise.resolve();
        },
      };
    },
  }));

  // select() supports two chain shapes:
  //   select(...).from(t).where(w).get()      → row
  //   select().from(t).orderBy(o).limit(l).offset(off).where(w).all() → rows
  //   select({total: count()}).from(t).where(w).get() → { total: n }
  //   select({total: count()}).from(t).get() → { total: n }
  const select = vi.fn(() => {
    const chain = {
      from: () => {
        dbState.selectChain.fromCalled = true;
        return chain;
      },
      where: (w: unknown) => {
        dbState.selectChain.whereArg = w;
        return chain;
      },
      orderBy: (o: unknown) => {
        dbState.selectChain.orderByArg = o;
        return chain;
      },
      limit: (n: number) => {
        dbState.selectChain.limitArg = n;
        return chain;
      },
      offset: (n: number) => {
        dbState.selectChain.offsetArg = n;
        return chain;
      },
      get: () => {
        // If a count is expected, prefer that
        if (dbState.selectCount > 0 || dbState.selectGet === null) {
          // If list test set selectCount, return that shape; otherwise return single-row get
          if (dbState.selectGet) return dbState.selectGet;
          return { total: dbState.selectCount };
        }
        return dbState.selectGet;
      },
      all: () => dbState.selectAll,
    };
    return chain;
  });

  const del = vi.fn(() => ({
    where: () => Promise.resolve(),
  }));

  return {
    db: { select, insert, update, delete: del },
  };
});

vi.mock("../../services/ai-router.js", () => ({
  generateChunk: (...args: unknown[]) => mockGenerateChunk(...args),
}));

vi.mock("../../services/ai-shared.js", () => ({
  AI_BUSY: "AI_BUSY",
}));

vi.mock("../../middleware/rateLimit.js", () => ({
  rateLimit: () => null,
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { chunkRoutes } from "../chunks.js";

function buildApp() {
  const app = new Hono();
  app.route("/chunks", chunkRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePayload(over: Partial<ChunkPayload> = {}): ChunkPayload {
  return {
    form: "make a difference",
    category: "verb-collocation",
    coreMeaning: "produce a noticeable effect",
    coreMeaningZh: null,
    coreMechanic: null,
    register: "neutral",
    frequency: "high",
    slots: [],
    examples: [{ sentence: "He really made a difference.", register: "neutral" }],
    pitfall: null,
    contrast: null,
    theoreticalAnchors: null,
    ...over,
  };
}

function makeResult(over: Partial<ChunkGenerateResult> = {}): ChunkGenerateResult {
  return {
    verdict: "chunk",
    confidence: 0.9,
    reason: "Looks like a verb+noun collocation",
    payload: makePayload(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbState();
});

// ---------------------------------------------------------------------------
// SCENARIO #1 — verdict routing
// ---------------------------------------------------------------------------

describe("POST /chunks/generate — verdict routing", () => {
  it("verdict=chunk → 200, payload + chunk in response, db.insert called", async () => {
    mockGenerateChunk.mockResolvedValue(makeResult());
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChunkGenerateResult;
    expect(body.verdict).toBe("chunk");
    expect(body.payload).not.toBeNull();
    expect(body.chunk).toBeDefined();
    expect(body.chunk?.form).toBe("make a difference");
    expect(dbState.inserted).not.toBeNull();
  });

  it("verdict=borderline → 200, payload + chunk in response (still upserted)", async () => {
    mockGenerateChunk.mockResolvedValue(
      makeResult({ verdict: "borderline", confidence: 0.55 }),
    );
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "open the door" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChunkGenerateResult;
    expect(body.verdict).toBe("borderline");
    expect(body.chunk).toBeDefined();
    expect(dbState.inserted).not.toBeNull();
  });

  it("verdict=not_chunk → 200, payload=null, db.insert NOT called", async () => {
    mockGenerateChunk.mockResolvedValue(
      makeResult({ verdict: "not_chunk", payload: null }),
    );
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "happiness" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChunkGenerateResult;
    expect(body.verdict).toBe("not_chunk");
    expect(body.payload).toBeNull();
    expect(body.chunk).toBeUndefined();
    expect(dbState.inserted).toBeNull();
  });

  it("verdict=chunk but payload missing → returns AI result without persisting", async () => {
    mockGenerateChunk.mockResolvedValue(
      makeResult({ verdict: "chunk", payload: null }),
    );
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "something" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChunkGenerateResult;
    expect(body.payload).toBeNull();
    expect(body.chunk).toBeUndefined();
    expect(dbState.inserted).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SCENARIO #2 — upsert behavior
// ---------------------------------------------------------------------------

describe("POST /chunks/generate — upsert behavior", () => {
  it("calls onConflictDoUpdate with target = [form, category]", async () => {
    mockGenerateChunk.mockResolvedValue(makeResult());
    const app = buildApp();
    await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    expect(dbState.onConflictArgs).not.toBeNull();
    const target = (dbState.onConflictArgs as { target: unknown[] }).target;
    expect(Array.isArray(target)).toBe(true);
    expect(target.length).toBe(2);
  });

  it("update SET does NOT include usageCount (preserves count on re-analyze)", async () => {
    mockGenerateChunk.mockResolvedValue(makeResult());
    const app = buildApp();
    await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    const setObj = (dbState.onConflictArgs as { set: Record<string, unknown> }).set;
    expect(setObj).toBeDefined();
    expect("usageCount" in setObj).toBe(false);
    expect("createdAt" in setObj).toBe(false);
  });

  it("update SET DOES include updatedAt and core fields", async () => {
    mockGenerateChunk.mockResolvedValue(makeResult());
    const app = buildApp();
    await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    const setObj = (dbState.onConflictArgs as { set: Record<string, unknown> }).set;
    expect("updatedAt" in setObj).toBe(true);
    expect("coreMeaning" in setObj).toBe(true);
    expect("coreMeaningZh" in setObj).toBe(true);
    expect("coreMechanic" in setObj).toBe(true);
    expect("examples" in setObj).toBe(true);
    expect("register" in setObj).toBe(true);
    expect("frequency" in setObj).toBe(true);
  });

  it("persists coreMechanic + coreMeaningZh when AI returns them", async () => {
    mockGenerateChunk.mockResolvedValue(
      makeResult({
        payload: makePayload({
          coreMechanic: "把价值锚定到对象上",
          coreMeaningZh: "认为某事很重要",
        }),
      }),
    );
    const app = buildApp();
    await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "attach importance to" }),
    });
    const ins = dbState.inserted!;
    expect(ins.coreMechanic).toBe("把价值锚定到对象上");
    expect(ins.coreMeaningZh).toBe("认为某事很重要");
  });

  it("response includes wasExisting=false when insert creates a new row", async () => {
    mockGenerateChunk.mockResolvedValue(makeResult());
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    const body = (await res.json()) as { wasExisting?: boolean };
    expect(body.wasExisting).toBe(false);
  });

  it("response includes wasExisting=true when upsert hits an existing row", async () => {
    // Simulate an existing row by making RETURNING give back an older createdAt
    dbState.insertReturning = {
      id: 99,
      form: "make a difference",
      category: "verb-collocation",
      coreMeaning: "produce a noticeable effect",
      coreMeaningZh: null,
      coreMechanic: null,
      register: "neutral",
      frequency: "high",
      slots: "[]",
      examples: '[{"sentence":"x","register":"neutral"}]',
      pitfall: null,
      contrast: null,
      theoreticalAnchors: null,
      usageCount: 7, // preserved across re-analyze
      createdAt: 1000, // way before Date.now() => signal an existing row
      updatedAt: 2000,
    };
    mockGenerateChunk.mockResolvedValue(makeResult());
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    const body = (await res.json()) as {
      wasExisting?: boolean;
      chunk?: { usageCount: number };
    };
    expect(body.wasExisting).toBe(true);
    expect(body.chunk?.usageCount).toBe(7);
  });

  it("JSON fields (slots, examples, contrast, theoreticalAnchors) are stringified on insert", async () => {
    mockGenerateChunk.mockResolvedValue(
      makeResult({
        payload: makePayload({
          slots: [{ placeholder: "X", type: "noun", fillers: ["a", "b"] }],
          contrast: [{ form: "do a difference", diff: "ungrammatical" }],
          theoreticalAnchors: ["idiom-principle"],
        }),
      }),
    );
    const app = buildApp();
    await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    const ins = dbState.inserted!;
    expect(typeof ins.slots).toBe("string");
    expect(typeof ins.examples).toBe("string");
    expect(typeof ins.contrast).toBe("string");
    expect(typeof ins.theoreticalAnchors).toBe("string");
    expect(JSON.parse(ins.slots as string)[0].placeholder).toBe("X");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO #5 — error paths
// ---------------------------------------------------------------------------

describe("POST /chunks/generate — error paths", () => {
  it("empty input → 400 VALIDATION_ERROR", async () => {
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockGenerateChunk).not.toHaveBeenCalled();
  });

  it("whitespace-only input → 400 VALIDATION_ERROR (after trim)", async () => {
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "   " }),
    });
    expect(res.status).toBe(400);
    expect(mockGenerateChunk).not.toHaveBeenCalled();
  });

  it("input > 200 chars → 400", async () => {
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "a".repeat(201) }),
    });
    expect(res.status).toBe(400);
  });

  it("generateChunk throws AI_BUSY → 429 with code AI_BUSY", async () => {
    mockGenerateChunk.mockRejectedValue(new Error("AI_BUSY"));
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("AI_BUSY");
  });

  it("generateChunk throws generic error → 500 with code GENERATION_FAILED", async () => {
    mockGenerateChunk.mockRejectedValue(new Error("OpenAI 401 Unauthorized"));
    const app = buildApp();
    const res = await app.request("/chunks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "make a difference" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("GENERATION_FAILED");
    expect(body.error).toMatch(/Unauthorized/);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO #6 — PATCH unique constraint
// ---------------------------------------------------------------------------

describe("PATCH /chunks/:id — unique constraint", () => {
  it("valid partial update → 200 with updated chunk", async () => {
    dbState.selectGet = {
      id: 1,
      form: "f",
      category: "verb-collocation",
      coreMeaning: "m",
      register: "neutral",
      frequency: "mid",
      slots: "[]",
      examples: '[{"sentence":"x","register":"neutral"}]',
      pitfall: null,
      contrast: null,
      theoreticalAnchors: null,
      usageCount: 0,
      createdAt: 1,
      updatedAt: 2,
    };
    const app = buildApp();
    const res = await app.request("/chunks/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pitfall: "new pitfall text" }),
    });
    expect(res.status).toBe(200);
    expect(dbState.updated).not.toBeNull();
    expect((dbState.updated as Record<string, unknown>).pitfall).toBe("new pitfall text");
  });

  it("db.update throws UNIQUE constraint failed → 409 DUPLICATE", async () => {
    dbState.selectGet = {
      id: 1,
      form: "old",
      category: "verb-collocation",
      coreMeaning: "m",
      register: "neutral",
      frequency: "mid",
      slots: "[]",
      examples: '[{"sentence":"x","register":"neutral"}]',
      pitfall: null,
      contrast: null,
      theoreticalAnchors: null,
      usageCount: 0,
      createdAt: 1,
      updatedAt: 2,
    };
    dbState.updateShouldThrow = new Error(
      "SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: chunks.form, chunks.category",
    );
    const app = buildApp();
    const res = await app.request("/chunks/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ form: "make a difference" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("DUPLICATE");
  });

  it("id not found → 404", async () => {
    dbState.selectGet = undefined as unknown as Record<string, unknown>;
    const app = buildApp();
    const res = await app.request("/chunks/9999", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pitfall: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("invalid enum in body → 400 VALIDATION_ERROR", async () => {
    const app = buildApp();
    const res = await app.request("/chunks/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "nonsense-category" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO #7 — list, filter, search, pagination
// ---------------------------------------------------------------------------

describe("GET /chunks — list, filter, search, pagination", () => {
  const sampleRow = {
    id: 1,
    form: "make a difference",
    category: "verb-collocation",
    coreMeaning: "produce a noticeable effect",
    register: "neutral",
    frequency: "high",
    slots: "[]",
    examples: '[{"sentence":"x","register":"neutral"}]',
    pitfall: null,
    contrast: null,
    theoreticalAnchors: null,
    usageCount: 0,
    createdAt: 1,
    updatedAt: 2,
  };

  it("no params → 200 with default pagination (page=1, limit=20)", async () => {
    dbState.selectCount = 0;
    dbState.selectAll = [];
    const app = buildApp();
    const res = await app.request("/chunks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number; limit: number; total: number };
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBe(0);
    expect(dbState.selectChain.limitArg).toBe(20);
    expect(dbState.selectChain.offsetArg).toBe(0);
    expect(dbState.selectChain.whereArg).toBeUndefined();
  });

  it("?category=verb-collocation → where condition set", async () => {
    dbState.selectCount = 1;
    dbState.selectAll = [sampleRow];
    const app = buildApp();
    const res = await app.request("/chunks?category=verb-collocation");
    expect(res.status).toBe(200);
    expect(dbState.selectChain.whereArg).toBeDefined();
  });

  it("?frequency=high → where condition set", async () => {
    dbState.selectCount = 1;
    dbState.selectAll = [sampleRow];
    const app = buildApp();
    await app.request("/chunks?frequency=high");
    expect(dbState.selectChain.whereArg).toBeDefined();
  });

  it("?search=importance → where condition set + returns matching rows", async () => {
    dbState.selectCount = 1;
    dbState.selectAll = [sampleRow];
    const app = buildApp();
    const res = await app.request("/chunks?search=importance");
    expect(res.status).toBe(200);
    expect(dbState.selectChain.whereArg).toBeDefined();
    const body = (await res.json()) as { chunks: unknown[] };
    expect(body.chunks.length).toBe(1);
  });

  it("?category=X&frequency=Y&search=Z → combined where condition", async () => {
    dbState.selectCount = 1;
    dbState.selectAll = [sampleRow];
    const app = buildApp();
    await app.request("/chunks?category=verb-collocation&frequency=high&search=make");
    expect(dbState.selectChain.whereArg).toBeDefined();
  });

  it("?page=2&limit=10 → offset = 10, limit = 10", async () => {
    dbState.selectCount = 25;
    dbState.selectAll = [];
    const app = buildApp();
    const res = await app.request("/chunks?page=2&limit=10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number; limit: number };
    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);
    expect(dbState.selectChain.limitArg).toBe(10);
    expect(dbState.selectChain.offsetArg).toBe(10);
  });

  it("limit clamped to max 500", async () => {
    dbState.selectCount = 0;
    dbState.selectAll = [];
    const app = buildApp();
    await app.request("/chunks?limit=9999");
    expect(dbState.selectChain.limitArg).toBe(500);
  });

  it("page < 1 is normalized to 1", async () => {
    dbState.selectCount = 0;
    dbState.selectAll = [];
    const app = buildApp();
    const res = await app.request("/chunks?page=0");
    const body = (await res.json()) as { page: number };
    expect(body.page).toBe(1);
    expect(dbState.selectChain.offsetArg).toBe(0);
  });

  it("toChunk parses JSON fields on response", async () => {
    dbState.selectCount = 1;
    dbState.selectAll = [
      {
        ...sampleRow,
        slots: '[{"placeholder":"X","type":"n","fillers":["a"]}]',
        examples: '[{"sentence":"E","register":"neutral"}]',
        contrast: null,
        theoreticalAnchors: '["idiom-principle"]',
      },
    ];
    const app = buildApp();
    const res = await app.request("/chunks");
    const body = (await res.json()) as { chunks: Array<Record<string, unknown>> };
    expect(Array.isArray(body.chunks[0].slots)).toBe(true);
    expect(Array.isArray(body.chunks[0].examples)).toBe(true);
    expect(Array.isArray(body.chunks[0].theoreticalAnchors)).toBe(true);
    expect(body.chunks[0].contrast).toBeNull();
  });

  it("toChunk gracefully handles corrupted JSON in fields", async () => {
    dbState.selectCount = 1;
    dbState.selectAll = [
      {
        ...sampleRow,
        slots: "{not json{{",
        examples: "[broken",
      },
    ];
    const app = buildApp();
    const res = await app.request("/chunks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chunks: Array<Record<string, unknown>> };
    // Falls back to []
    expect(body.chunks[0].slots).toEqual([]);
    expect(body.chunks[0].examples).toEqual([]);
  });
});
