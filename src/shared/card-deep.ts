const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Old cards can contain valid JSON with no teachable content. Use this same
 * test for generation, repair and the read-only card. */
export function hasDeepData(card: { familyComparison?: unknown; boundaryTests?: unknown; schemaAnalysis?: unknown }): boolean {
  const family = card.familyComparison;
  if (Array.isArray(family) && family.some((item) => hasText(item?.word) &&
    [item.distinction, item.register, item.typicalScene].some(hasText))) return true;
  const tests = card.boundaryTests;
  if (Array.isArray(tests) && tests.some((item) =>
    (hasText(item?.scenario) && hasText(item.answer)) ||
    (hasText(item?.sentence) && Array.isArray(item.options) && item.options.some((option: { word?: unknown } | null) => hasText(option?.word))))) return true;
  if (!card.schemaAnalysis || typeof card.schemaAnalysis !== "object") return false;
  const schema = card.schemaAnalysis as Record<string, unknown>;
  return (hasText(schema.coreSchema) && schema.coreSchema.trim().toLowerCase() !== "none")
    || [schema.coreImageText, schema.coreImageExample, schema.coreSvg].some(hasText)
    || (Array.isArray(schema.etymologyChain) && schema.etymologyChain.some(hasText))
    || (Array.isArray(schema.sceneActivation) && schema.sceneActivation.some((scene) => [scene?.title, scene?.description, scene?.example].some(hasText)));
}
