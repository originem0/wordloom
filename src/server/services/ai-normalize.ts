// ---------------------------------------------------------------------------
// Lenient JSON parsing (some models wrap JSON in markdown fences)
// ---------------------------------------------------------------------------

export function extractJsonCandidate(raw: string): string {
  const text = raw.trim();
  if (!text) return text;

  // Common case: ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Fallback: grab the largest {...} or [...] block
  const firstObj = text.indexOf("{");
  const lastObj = text.lastIndexOf("}");
  const firstArr = text.indexOf("[");
  const lastArr = text.lastIndexOf("]");

  const candidates: string[] = [];
  if (firstArr !== -1 && lastArr !== -1 && lastArr > firstArr) {
    candidates.push(text.slice(firstArr, lastArr + 1));
  }
  if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
    candidates.push(text.slice(firstObj, lastObj + 1));
  }

  if (candidates.length) {
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0].trim();
  }

  return text;
}

export function parseJsonLenient(raw: string): unknown {
  const candidate = extractJsonCandidate(raw);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const snippet = raw.trim().slice(0, 220);
    throw new Error(
      `Failed to parse JSON from model output (${reason}). Snippet: ${snippet}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Type guards and coercion helpers
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function coerceStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string") {
    const parts = value
      .split(/[,，;；\n]/g)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Normalize AI output — tolerate common schema drift across models/proxies
// ---------------------------------------------------------------------------

export function normalizeCefr(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim().toUpperCase();
  if (/^(A1|A2|B1|B2|C1|C2)$/.test(v)) return v;
  return value;
}

export function normalizeConfidence(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const v = value.trim().toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  if (v === "med") return "medium";
  return value;
}

export function normalizeExamples(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const normalized = value
    .map((item, idx) => {
      if (!isRecord(item)) return null;

      const levelRaw = item.level;
      let level: unknown = levelRaw;
      if (typeof levelRaw === "number") {
        level = levelRaw <= 1 ? "basic" : levelRaw === 2 ? "intermediate" : "advanced";
      } else if (typeof levelRaw === "string") {
        const l = levelRaw.toLowerCase();
        if (l === "beginner" || l === "easy" || l === "simple") level = "basic";
        else if (l === "intermediate" || l === "medium") level = "intermediate";
        else if (l === "advanced" || l === "hard") level = "advanced";
      } else if (levelRaw == null) {
        level = idx === 0 ? "basic" : idx === 1 ? "intermediate" : "advanced";
      }

      const sentence =
        (typeof item.sentence === "string" ? item.sentence : undefined) ??
        (typeof item.en === "string" ? item.en : undefined) ??
        (typeof item.english === "string" ? item.english : undefined) ??
        (typeof item.text === "string" ? item.text : undefined) ??
        (typeof item.example === "string" ? item.example : undefined);

      if (!sentence) return null;

      const translation =
        (typeof item.translation === "string" ? item.translation : undefined) ??
        (typeof item.zh === "string" ? item.zh : undefined) ??
        (typeof item.cn === "string" ? item.cn : undefined) ??
        (typeof item.chinese === "string" ? item.chinese : undefined) ??
        "";

      return { level, sentence, translation };
    })
    .filter(Boolean);

  return normalized;
}

export function normalizeContextLadder(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const normalized = value
    .map((item, idx) => {
      if (!isRecord(item)) return null;

      const level = coerceNumber(item.level) ?? idx + 1;
      const sentence =
        (typeof item.sentence === "string" ? item.sentence : undefined) ??
        (typeof item.en === "string" ? item.en : undefined) ??
        (typeof item.text === "string" ? item.text : undefined);

      if (!sentence) return null;

      const context =
        (typeof item.context === "string" ? item.context : undefined) ??
        (typeof item.contextDescription === "string" ? item.contextDescription : undefined) ??
        (typeof item.context_description === "string" ? item.context_description : undefined) ??
        (typeof item.description === "string" ? item.description : undefined) ??
        (typeof item.desc === "string" ? item.desc : undefined) ??
        "";

      return { level, sentence, context };
    })
    .filter(Boolean);

  return normalized;
}

export function normalizeCardObject(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = { ...value };

  // Field aliases
  if (out.partOfSpeech && !out.pos) out.pos = out.partOfSpeech;
  if (out.meaning && !out.coreMeaning) out.coreMeaning = out.meaning;
  if (out.definition && !out.coreMeaning) out.coreMeaning = out.definition;
  if (out.minimalPair && !out.minPair) out.minPair = out.minimalPair;

  out.cefr = normalizeCefr(out.cefr);
  out.cefrConfidence = normalizeConfidence(out.cefrConfidence);

  const wad = coerceNumber(out.wad);
  if (wad != null) out.wad = wad;
  const wap = coerceNumber(out.wap);
  if (wap != null) out.wap = wap;

  out.collocations = coerceStringArray(out.collocations) ?? out.collocations;
  out.phrases = coerceStringArray(out.phrases) ?? out.phrases;
  out.synonyms = coerceStringArray(out.synonyms) ?? out.synonyms;
  out.antonyms = coerceStringArray(out.antonyms) ?? out.antonyms;

  out.examples = normalizeExamples(out.examples);
  out.contextLadder = normalizeContextLadder(out.contextLadder);

  return out;
}

export function normalizeCardsPayload(parsed: unknown): unknown {
  let payload: unknown = parsed;

  // Some models wrap the array in an object.
  if (isRecord(payload)) {
    if (Array.isArray(payload.cards)) payload = payload.cards;
    else if (Array.isArray(payload.data)) payload = payload.data;
    else if (Array.isArray(payload.items)) payload = payload.items;
  }

  if (Array.isArray(payload)) return payload.map(normalizeCardObject);
  return payload;
}

// ---------------------------------------------------------------------------
// Story artifact
// ---------------------------------------------------------------------------

const STORY_EXPR_TYPES = new Set([
  "collocation",
  "idiom",
  "sentence-pattern",
  "phrasal-verb",
  "single-word",
]);

const STORY_REGISTERS = new Set([
  "neutral",
  "formal",
  "literary",
  "spoken",
]);

function normalizeStoryExpression(value: unknown): unknown | null {
  if (!isRecord(value)) return null;
  const out = { ...value };

  const phrase =
    typeof out.phrase === "string"
      ? out.phrase
      : typeof out.text === "string"
        ? out.text
        : "";
  if (!phrase.trim()) return null;
  out.phrase = phrase.trim();

  // Headword: fall back to phrase's most-letter-y token.
  let headword =
    typeof out.headword === "string" && out.headword.trim()
      ? out.headword.trim()
      : "";
  if (!headword) {
    const tokens = phrase
      .toLowerCase()
      .split(/[^a-z'-]+/)
      .filter((t) => t.length > 1 && !/^(a|an|the|to|of|in|on|at|by|for|with|sb|sth|one|s)$/.test(t));
    headword = tokens[0] ?? phrase.toLowerCase();
  }
  out.headword = headword;

  out.type = STORY_EXPR_TYPES.has(String(out.type)) ? out.type : "collocation";
  out.register = STORY_REGISTERS.has(String(out.register)) ? out.register : "neutral";

  out.zh = typeof out.zh === "string" ? out.zh : String(out.zh ?? "");
  out.whyUseful =
    typeof out.whyUseful === "string"
      ? out.whyUseful
      : typeof out.why === "string"
        ? out.why
        : "";

  out.inText = out.inText === true;

  const fromVocab = coerceNumber(out.fromVocab);
  out.fromVocab = fromVocab != null && fromVocab > 0 ? fromVocab : null;

  // existingCardId is filled server-side after this normalize step.
  if (out.existingCardId !== undefined) {
    const eid = coerceNumber(out.existingCardId);
    out.existingCardId = eid != null && eid > 0 ? eid : null;
  }

  return out;
}

function normalizeSceneFrame(value: unknown): unknown {
  const def = { subjects: [], actions: [], setting: "", mood: "" };
  if (!isRecord(value)) return def;
  return {
    subjects: coerceStringArray(value.subjects) ?? [],
    actions: coerceStringArray(value.actions) ?? [],
    setting: typeof value.setting === "string" ? value.setting : "",
    mood: typeof value.mood === "string" ? value.mood : "",
  };
}

/**
 * Normalize a possibly-loose model output into a StoryArtifact shape.
 * Returns null if essential fields (description) are missing — the caller
 * should fall back to building a minimal artifact from plain text.
 */
export function normalizeStoryArtifact(parsed: unknown): unknown | null {
  if (!isRecord(parsed)) return null;
  const out = { ...parsed };

  // description is the only must-have field.
  const description =
    typeof out.description === "string"
      ? out.description
      : typeof out.story === "string"
        ? out.story
        : typeof out.text === "string"
          ? out.text
          : "";
  if (!description.trim()) return null;

  out.title = typeof out.title === "string" ? out.title : "";
  out.description = description.trim();
  out.translation =
    typeof out.translation === "string" ? out.translation.trim() : "";

  out.sceneFrame = normalizeSceneFrame(out.sceneFrame);

  const exprArr = Array.isArray(out.keyExpressions)
    ? out.keyExpressions
    : Array.isArray(out.expressions)
      ? out.expressions
      : [];
  out.keyExpressions = exprArr
    .map(normalizeStoryExpression)
    .filter((e): e is Record<string, unknown> => e !== null)
    .slice(0, 8); // hard cap — prompt asks for 5-8, defend against over-generation

  return out;
}

/**
 * Build a minimal artifact from a plain-text description (used when JSON
 * parsing fails entirely — keeps the UI working with just the paragraph).
 */
export function buildFallbackStoryArtifact(description: string): unknown {
  return {
    title: "",
    description: description.trim(),
    translation: "",
    sceneFrame: { subjects: [], actions: [], setting: "", mood: "" },
    keyExpressions: [],
  };
}
