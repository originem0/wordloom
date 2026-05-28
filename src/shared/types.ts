// --- Story ---

export interface GroundingSource {
  web?: { uri: string; title: string };
}

export interface Story {
  id: number;
  imagePath: string;
  prompt: string;
  story: string;
  sources: GroundingSource[];
  createdAt: number;
}

// --- Card layers ---

export interface CardSurface {
  id: number;
  word: string;
  ipa: string | null;
  pos: string | null;
  cefr: string | null;
  cefrConfidence: string | null;
  coreMeaning: string | null;
  wad: number | null;
  wap: number | null;
}

export interface CardExample {
  level: "basic" | "intermediate" | "advanced";
  sentence: string;
  translation: string;
}

export interface ContextLevel {
  level: number;
  sentence: string;
  context: string;
}

export interface CardMiddle {
  etymology: string | null;
  collocations: string[];
  examples: CardExample[];
  contextLadder: ContextLevel[];
  phrases: string[];
  synonyms: string[];
  antonyms: string[];
  minPair: string | null;
}

export interface FamilyEntry {
  word: string;
  pos: string;
  distinction: string;
  register: string;
  typicalScene: string;
}

export interface SchemaAnalysis {
  coreSchema: string;
  coreImageText?: string;
  coreSvg?: string;
  metaphoricalExtensions: string[];
  registerVariation: string;
  etymologyChain?: string[];
  sceneActivation?: SceneFrame[];
}

export interface SceneFrame {
  title: string;
  description: string;
  example: string;
  associatedWords: string[];
}

export interface BoundaryTestOption {
  verdict: "yes" | "no" | "maybe";
  word: string;
  reason: string;
}

export interface BoundaryTest {
  /** New format: fill-in-blank sentence */
  sentence?: string;
  options?: BoundaryTestOption[];
  /** Legacy format fields (backward compat) */
  scenario?: string;
  answer?: string;
  explanation?: string;
}

export interface CardDeep {
  familyComparison: FamilyEntry[] | null;
  familyBoundaryNote?: string | null;
  schemaAnalysis: SchemaAnalysis | null;
  boundaryTests: BoundaryTest[] | null;
}

export interface Card extends CardSurface, CardMiddle, CardDeep {
  usageCount: number;
  storyId: number | null;
  createdAt: number;
  updatedAt: number;
}

// --- API responses ---

export interface CardGenerateResult {
  success: Card[];
  failed: { word: string; error: string }[];
  existing?: Card[];
}

// --- Chunks ---
// A "chunk" is a multi-word prefabricated pattern (sentence stems, delexical
// collocations, noun+prep, discourse markers, preposition schemas). Independent
// from word-level Cards: no IPA / POS / etymology / SVG schema.

export type ChunkCategory =
  | "prep-intuition"
  | "sentence-stem"
  | "verb-collocation"
  | "noun-prep"
  | "discourse-marker";

export type ChunkRegister =
  | "neutral"
  | "formal"
  | "spoken"
  | "academic"
  | "literary";

export type ChunkFrequency = "high" | "mid" | "low";

export type TheoreticalAnchor =
  | "idiom-principle"
  | "formulaic-sequence"
  | "lexical-priming"
  | "cognitive-chunk"
  | "grammaticalized-lexis";

export interface ChunkSlot {
  placeholder: string; // "X" / "sb" / "V-ing"
  type: string;        // "abstract noun" / "verb infinitive"
  fillers: string[];   // ["dread", "relief"]
}

export interface ChunkExample {
  sentence: string;
  register: ChunkRegister;
}

export interface ChunkContrast {
  form: string;
  diff: string;
}

export interface Chunk {
  id: number;
  form: string;
  category: ChunkCategory;
  coreMeaning: string;
  coreMeaningZh: string | null;
  coreMechanic: string | null;
  register: ChunkRegister;
  frequency: ChunkFrequency;
  slots: ChunkSlot[];
  examples: ChunkExample[];
  pitfall: string | null;
  contrast: ChunkContrast[] | null;
  theoreticalAnchors: TheoreticalAnchor[] | null;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export type ChunkVerdict = "chunk" | "borderline" | "not_chunk";

export type ChunkPayload = Omit<
  Chunk,
  "id" | "usageCount" | "createdAt" | "updatedAt"
>;

export interface ChunkGenerateResult {
  verdict: ChunkVerdict;
  confidence: number;
  reason: string;
  payload: ChunkPayload | null;
  /** Set when verdict is "chunk" or "borderline" and the row was upserted. */
  chunk?: Chunk;
  /** True if a chunk with the same (form, category) already existed and was
   * updated rather than newly created. UI uses this to warn the user that
   * they have already analyzed this chunk before. */
  wasExisting?: boolean;
}
