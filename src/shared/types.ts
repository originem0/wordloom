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
}
