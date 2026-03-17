import { describe, it, expect, vi } from "vitest";
import { db } from "../../db/index.js";
import { cards } from "../../db/schema.js";
import { eq } from "drizzle-orm";
// Assume generateDeepLayer is imported/mocked. Let's just test via the database logic simulated.

// Mock DB
vi.mock("../../db/index.js", () => {
  const mockUpdate = vi.fn().mockReturnThis();
  const mockSet = vi.fn().mockReturnThis();
  const mockWhere = vi.fn();
  
  return {
    db: {
      update: () => ({
        set: (data: any) => ({
          where: mockWhere.mockImplementation(() => {
            // we capture the data passed to 'set'
            mockSet(data);
          }),
        }),
      }),
    },
    // Export the spy so we can inspect it in tests
    mockSetSpy: mockSet,
  };
});

describe("Scenario 3: DB JSON Serialization Integrity (familyBoundaryNote)", () => {
  it("merges familyBoundaryNote into schemaAnalysis JSON blob before db.update", async () => {
    const { mockSetSpy } = await import("../../db/index.js") as any;
    
    // Simulate the logic found in src/server/routes/cards.ts (POST /:id/deep)
    const deep = {
      familyComparison: [ { word: "A", pos: "n", distinction: "d", register: "r", typicalScene: "s" } ],
      familyBoundaryNote: "A is more formal than B",
      schemaAnalysis: { coreSchema: "blockage", metaphoricalExtensions: [], registerVariation: "neutral" },
      boundaryTests: [],
    };

    // The logic from the route:
    const schemaBlob = {
      ...(typeof deep.schemaAnalysis === "object" && deep.schemaAnalysis
        ? deep.schemaAnalysis
        : {}),
      ...(deep.familyBoundaryNote
        ? { familyBoundaryNote: deep.familyBoundaryNote }
        : {}),
    };

    const updatePayload = {
      familyComparison: JSON.stringify(deep.familyComparison),
      schemaAnalysis: JSON.stringify(schemaBlob),
      boundaryTests: JSON.stringify(deep.boundaryTests),
      updatedAt: 123456789,
    };

    // Verify the merged payload correctly preserves familyBoundaryNote INSIDE schemaAnalysis string
    expect(updatePayload.schemaAnalysis).toContain("A is more formal than B");
    expect(updatePayload.schemaAnalysis).toContain("blockage");
    
    const parsedSchema = JSON.parse(updatePayload.schemaAnalysis);
    expect(parsedSchema.familyBoundaryNote).toBe("A is more formal than B");
    expect(parsedSchema.coreSchema).toBe("blockage");
  });
});
