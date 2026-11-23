// --- Story ---

export interface GroundingSource {
  web?: { uri: string; title: string };
}

/**
 * Structured teaching artifact produced by the new story prompt.
 * One AI call yields description + translation + scene frame + expression list.
 */
export type StoryExpressionType =
  | "collocation"
  | "idiom"
  | "sentence-pattern"
  | "phrasal-verb"
  | "single-word";

export type StoryRegister =
  | "neutral"
  | "formal"
  | "literary"
  | "spoken";

export interface StoryKeyExpression {
  phrase: string;
  headword: string;
  type: StoryExpressionType;
  zh: string;
  register: StoryRegister;
  whyUseful: string;
  inText: boolean;
  /** Set when this came from PREFERRED_VOCAB injected into the prompt. */
  fromVocab: number | null;
  /** Server-filled: id of an existing card whose word matches the headword. */
  existingCardId?: number | null;
}

export interface StorySceneFrame {
  subjects: string[];
  actions: string[];
  setting: string;
  mood: string;
}

export interface StoryArtifact {
  title: string;
  description: string;
  translation: string;
  sceneFrame: StorySceneFrame;
  keyExpressions: StoryKeyExpression[];
}

export interface Story {
  id: number;
  imagePath: string;
  prompt: string;
  /** Plain text fallback / TTS source (mirrors artifact.description when available). */
  story: string;
  /** Structured artifact for the new UI. Null on legacy rows. */
  artifact: StoryArtifact | null;
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
