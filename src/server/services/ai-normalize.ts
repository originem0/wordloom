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
        (typeof (item as any).context_description === "string" ? (item as any).context_description : undefined) ??
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
