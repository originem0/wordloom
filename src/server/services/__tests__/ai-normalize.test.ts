import { describe, it, expect } from "vitest";
import { normalizeCoreSchema, withCoreSchema } from "../ai-normalize.js";

describe("the schema a deep layer names", () => {
  it("keeps the ones the card can draw, and none", () => {
    for (const schema of ["blockage", "container", "path", "link", "balance", "none"]) {
      expect(normalizeCoreSchema(` ${schema.toUpperCase()} `)).toBe(schema);
    }
  });

  it("maps a near label onto its schema", () => {
    expect(normalizeCoreSchema("trade-off")).toBe("balance");
    expect(normalizeCoreSchema("pressure")).toBe("blockage");
    expect(normalizeCoreSchema("blocked")).toBe("blockage");
    expect(normalizeCoreSchema("journey/progress")).toBe("path");
    expect(normalizeCoreSchema("containment")).toBe("container");
    expect(normalizeCoreSchema("connection")).toBe("link");
  });

  // It used to become "blockage", and the card drew a wall for any such word.
  it("draws nothing for a label it cannot place", () => {
    expect(normalizeCoreSchema("emergence")).toBe("none");
    expect(normalizeCoreSchema("")).toBe("none");
    expect(normalizeCoreSchema(undefined)).toBe("none");
  });

  it("gives a layer without an analysis one that draws nothing", () => {
    expect(withCoreSchema({ familyComparison: [], boundaryTests: [] }).schemaAnalysis).toEqual({ coreSchema: "none" });
    expect(
      withCoreSchema({ familyComparison: [], boundaryTests: [], schemaAnalysis: { coreSchema: "Route", coreImageText: "x" } }).schemaAnalysis,
    ).toEqual({ coreSchema: "path", coreImageText: "x" });
  });
});
