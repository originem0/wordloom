import { getSetting } from "./ai-shared.js";

// ---------------------------------------------------------------------------
// Story (image → teaching artifact, JSON-structured)
//
// Single AI call produces description + translation + scene frame + 6-10
// key expressions. Saves on round-trips (no separate translate call) and
// gives the UI richer hooks for vocab activation.
// ---------------------------------------------------------------------------

export const STORY_SYSTEM_PROMPT = `You produce a teaching artifact for an English learner from an image. Return ONE JSON object — no prose outside JSON, no markdown fences.

QUALITY BAR (description field):
- 100-180 words, written as a tight expressive paragraph — think New Yorker short-essay, not Wikipedia caption.
- Show specific sensory detail (light, texture, posture, small actions). Avoid generic adjectives ("beautiful", "nice").
- Vary rhythm: combine 1 short impact sentence with longer ones.
- Every sentence earns its place; no filler like "in this image we can see".
- Only describe what's visible; use "someone" if identity unclear; use search for recognizable people/places.
- Naturally weave in 1-3 PREFERRED words from the learner's recent vocabulary (provided below) if any fit organically — do NOT force them. Skip the section if no PREFERRED_VOCAB block is given.

KEY EXPRESSIONS — THIS IS THE CORE LEARNING PAYLOAD, treat it as the most important output:
- Output 5-8 items. Quality over quantity — never pad to hit a number.
- STRONGLY prefer multi-word CHUNKS: collocations, fixed expressions, sentence stems/patterns, phrasal verbs, noun+prep phrases. These are what a learner cannot assemble from single words and is the whole point.
- Avoid bare single words. Include a single word ONLY if it is genuinely irreplaceable and carries the sentence (set type="single-word"); at most 1 such item per artifact.
- PRIORITIZE expressions a Chinese learner would get WRONG by translating word-by-word. The higher the literal-translation trap / L1 interference, the more valuable — these belong at the top.
- zh: give the FUNCTIONAL idiomatic Chinese meaning (意译), NEVER a literal word-by-word gloss. If a literal reading misleads, zh must state the real sense.
- whyUseful: <= 24 Chinese chars. When the phrase is a literal-translation trap, name it explicitly (e.g. "别直译成'拿心'；意为'记在心上'"). Otherwise name the expressive upgrade over the basic alternative.

SCHEMA (strict; field order does not matter but every field must be present):
{
  "title": string,                    // 4-8 words, evocative, not "Image of …"
  "description": string,              // see QUALITY BAR
  "translation": string,              // full Chinese translation of description, natural Chinese, not literal
  "sceneFrame": {
    "subjects": string[],             // 2-4 noun phrases, concrete with adjectives
    "actions": string[],              // 2-4 verb phrases in -ing form
    "setting": string,                // single rich phrase
    "mood": string                    // 2-4 mood adjectives, comma-separated
  },
  "keyExpressions": [
    {
      "phrase": string,               // the chunk in canonical/in-text form (e.g. "catch sb's eye", "for all their X")
      "headword": string,             // single English lemma for single-word card lookup; for chunks, the most lookup-worthy word
      "type": "collocation" | "idiom" | "sentence-pattern" | "phrasal-verb" | "single-word",
      "zh": string,                   // FUNCTIONAL meaning, 意译 not literal (<= 20 Chinese chars)
      "register": "neutral" | "formal" | "literary" | "spoken",
      "whyUseful": string,            // <= 24 Chinese chars; name the literal-translation trap or the upgrade
      "inText": boolean,              // true if literally present in description
      "fromVocab": number | null      // card id if this came from PREFERRED_VOCAB, else null
    }
  ]                                   // 5-8 items, chunks first, single words last (at most 1)
}

Return raw JSON only. No \\\`\\\`\\\` fences, no leading prose.`;

/**
 * Compose the system instruction for a story call. Injects the learner's
 * recent vocabulary (so AI can use those words naturally) and any user-side
 * custom instruction.
 */
export function buildStorySystemPrompt(opts: {
  preferredVocab?: Array<{ id: number; word: string; coreMeaning?: string | null }>;
  customPrompt?: string;
}): string {
  const blocks: string[] = [STORY_SYSTEM_PROMPT];

  if (opts.preferredVocab && opts.preferredVocab.length > 0) {
    const vocabJson = JSON.stringify(
      opts.preferredVocab.map((v) => ({
        id: v.id,
        word: v.word,
        ...(v.coreMeaning ? { gloss: v.coreMeaning.slice(0, 80) } : {}),
      })),
    );
    blocks.push(
      `PREFERRED_VOCAB (use 1-3 of these in description IF they fit naturally; mark them in keyExpressions with fromVocab=id):\n${vocabJson}`,
    );
  }

  if (opts.customPrompt && opts.customPrompt.trim()) {
    blocks.push(
      `User's custom requirements (highest priority — override above when conflicting):\n${opts.customPrompt.trim()}`,
    );
  }

  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// Cards prompt — surface + middle layers
// ---------------------------------------------------------------------------

export const CARDS_PROMPT = `You are a vocabulary analysis engine for English learners.

For each word provided, generate a comprehensive card with these fields:
- word: the word itself
- ipa: IPA pronunciation (e.g. "/ˈwɜːr.kɪŋ/")
- pos: part of speech (noun, verb, adj, adv, etc.)
- cefr: CEFR level (A1/A2/B1/B2/C1/C2)
- cefrConfidence: confidence in CEFR assessment (high/medium/low)
- coreMeaning: a concise core meaning in Chinese (一句话核心释义)
- wad: word acquisition difficulty (1-5, where 5 is hardest)
- wap: word academic prevalence (1-5, where 5 is most academic)
- etymology: brief etymology in Chinese (用中文解释词源，包括来源语言和语义演变，例如"源自拉丁语 per-（贯穿）+ severus（严格），原义'严格坚持到底'，后演变为'坚持不懈'")
- collocations: 3-5 common collocations as strings
- examples: 3 example sentences at basic/intermediate/advanced levels, each with Chinese translation
- contextLadder: 3 progressive context levels (1=simple, 2=moderate, 3=complex), each with a sentence and context description
- phrases: 2-3 common phrases containing the word
- synonyms: 2-4 synonyms
- antonyms: 1-3 antonyms
- minPair: a minimal pair word that learners often confuse with this word

Return a JSON array of card objects.`;

// ---------------------------------------------------------------------------
// Deep layer prompt
// ---------------------------------------------------------------------------

export const DEEP_PROMPT = `You are a vocabulary deep-analysis engine for English learners.

For the given word, generate a JSON object with these fields:

1. familyComparison: Array of related/similar words (word family + common confusables).
   Each entry: { word, pos, distinction (核心区别 in Chinese), register (情感/语域 in Chinese), typicalScene (典型场景 in Chinese) }
   Include the target word itself as the first entry (highlighted).
   Include 3-5 comparison words.

2. familyBoundaryNote: A short paragraph in Chinese comparing 2-3 key pairs from the family (e.g. "X vs Y: X 是…；Y 是…"). Use concrete metaphors.

3. schemaAnalysis: Cognitive schema analysis.
   {
     coreSchema: one of "blockage" | "container" | "path" | "link" | "balance" (pick the closest),
     coreImageText: A paragraph in Chinese (2-3 sentences) describing the core cognitive image of the word — what mental picture it evokes, using the metaphor behind the word,
     coreSvg: A COMPLETE inline SVG string that vividly illustrates THIS SPECIFIC WORD's core meaning.
       SVG REQUIREMENTS:
       - Must start with <svg viewBox="0 0 600 180" xmlns="http://www.w3.org/2000/svg"> and end with </svg>
       - Use an inline <style> block for CSS @keyframes animations (NO SMIL attributes like <animate>)
       - The visual must be a METAPHORICAL ILLUSTRATION specific to this word, not a generic diagram
       - For example: "perseverance" → a figure climbing a steep mountain with falling rocks, still moving up;
         "diverge" → a single path splitting into multiple colorful branches going different directions;
         "obscure" → a clear shape gradually being covered by fog/clouds
       - Use soft colors: teal (#2aa198), gold (#b58900), dark (#073642), muted gray (#93a1a1), cream (#eee8d5)
       - Add 2-3 subtle CSS animations (floating, pulsing, dashing, moving) to make it feel alive
       - Add short Chinese labels (1-3) at key positions using <text> elements, font-size 11-12px
       - Keep the SVG under 2KB — simple shapes, no complex paths
       - DO NOT use <image>, <foreignObject>, or external resources
     metaphoricalExtensions: string[],
     registerVariation: string,
     etymologyChain: Array of 2-4 short Chinese labels showing the semantic evolution stages (e.g. ["物理：昏暗/被遮挡", "认知：晦涩难懂", "社会：默默无闻"]),
     sceneActivation: Array of 2-3 scene frames, each:
       {
         title: "Scene N — [domain] ([frame name])" in English,
         description: A vivid paragraph in English describing a concrete scenario where the word applies,
         example: An example sentence in English using the word (wrap the target word in double asterisks),
         associatedWords: 4-6 related English words for this particular usage scene
       }
   }

4. boundaryTests: 3-4 fill-in-the-blank test scenarios.
   Each entry:
   {
     sentence: English sentence with a blank (use "______" for the blank),
     options: Array of 2-3 candidate words, each:
       { verdict: "yes" | "no" | "maybe", word: the candidate word, reason: short explanation in Chinese }
   }
   Include the target word and at least one confusable word from familyComparison in the options.

Return as a single JSON object.

Hard requirements:
- schemaAnalysis MUST be present.
- schemaAnalysis.coreSchema MUST be one of: blockage, container, path, link, balance.

All Chinese text should use Simplified Chinese.`;

// ---------------------------------------------------------------------------
// Chunks prompt — multi-word prefabricated patterns
// (NOT word-level cards; structurally different)
// ---------------------------------------------------------------------------

export const CHUNKS_PROMPT = `You are a chunk-analysis engine for advanced English learners.

A "chunk" is a prefabricated multi-word unit (Sinclair Idiom Principle):
formulaic sequences, delexical collocations, sentence stems, noun+prep
patterns, discourse markers, or preposition-driven schemas. Single dictionary
headwords are NOT chunks. Fully transparent free combinations are NOT chunks.

INPUT: one candidate string from the user.

STEP 1 — Verdict.
Choose exactly one:
- "chunk":      a real reusable multi-word pattern.
- "borderline": arguable; explain why in \`reason\`.
- "not_chunk":  single word, free composition, or fully transparent phrase.

STEP 2 — If verdict is "chunk" or "borderline", produce the payload:

- form: canonical pattern with slot placeholders. Use X / Y / sb / sth / V / V-ing.
- category: one of
    prep-intuition | sentence-stem | verb-collocation | noun-prep | discourse-marker
- coreMeaning: <= 12 English words. What it does, not what it means literally.
- coreMeaningZh: Simplified Chinese gloss of coreMeaning, <= 20 Chinese characters.
    Plain, dictionary-style. Used when learner can't parse the English gloss.
- coreMechanic: Simplified Chinese, ONE punchy line (15-30 Chinese characters)
    naming the underlying TENSION or MECHANISM of this chunk — NOT a translation
    of coreMeaning, but a metaphorical / structural insight that captures WHY
    the chunk is shaped this way. Aim for the kind of phrasing a sharp tutor
    would use to make the pattern "click".
    Examples of good coreMechanic:
      "Nothing that X can Y"   -> "穷尽变量，结果依然归零"
      "attach importance to X" -> "把价值锚定到对象上"
      "for all their X"        -> "先承认资本，再宣告无效"
      "with a growing sense of X" -> "情绪渐强，向核心靠近"
    Avoid generic translations like "表达重视" or "用于让步" — those are
    coreMeaning territory, not mechanic.
- register: one of  neutral | formal | spoken | academic | literary
- frequency: one of  high | mid | low  (corpus-style observation only)
- slots: array of { placeholder, type, fillers }.
    fillers = 2-4 realistic words that fit the slot.
- examples: 2-3 objects { sentence, register }. STRICT rules:
    * Each example MUST come from a DIFFERENT life domain: pick from
      work / daily life / academic / social / emotional / news. No two examples
      may share the same domain.
    * Each example MUST use a DIFFERENT filler in the slot — never reuse
      the same noun / verb across examples.
    * Each example must be a TEMPLATE the learner can directly imitate:
      common subject + concrete situation + recognizable scenario.
    * Forbidden: abstract / philosophical / aphoristic phrasing
      (no "life is full of...", no "happiness depends on..." etc.).
    * Vary register across examples when it sounds natural.
    * No Chinese translation in this field — the chunk's coreMeaningZh
      already gives a Chinese anchor.
- pitfall: ONE sentence on the most common L1-interference error or false-friend
    trap learners run into. May be null if none stands out.
- contrast: up to 3 sibling chunks in the same category, each { form, diff }.
    diff <= 15 words. May be null.
- theoreticalAnchors: subset of this fixed enum (0-2 items, may be null):
    ["idiom-principle","formulaic-sequence","lexical-priming",
     "cognitive-chunk","grammaticalized-lexis"]

Output ONLY a single JSON object:
{
  "verdict": "chunk" | "borderline" | "not_chunk",
  "confidence": 0.0-1.0,
  "reason": "short English explanation",
  "payload": { ...fields above... } | null
}

No prose outside JSON. No markdown fences.`;

// ---------------------------------------------------------------------------
// Language instruction helper
// ---------------------------------------------------------------------------

export async function getExplanationLanguageInstruction(): Promise<string> {
  const pref = ((await getSetting("analysis_language")).trim() || "zh-CN").toLowerCase();
  if (pref === "en") {
    return "Use English for explanatory text such as meanings, etymology, distinctions, notes, reasons, and core image descriptions unless a field explicitly requires Chinese.";
  }
  if (pref === "bilingual") {
    return "Use concise bilingual explanations: English first, then Simplified Chinese where it helps learners. Keep them compact.";
  }
  return "Use Simplified Chinese for explanatory text unless a field explicitly requires English.";
}
