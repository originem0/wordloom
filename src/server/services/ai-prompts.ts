import { getSetting } from "./ai-shared.js";

// ---------------------------------------------------------------------------
// System prompt for story generation (picture description)
// ---------------------------------------------------------------------------

export const STORY_SYSTEM_PROMPT = `Write a compact, essay-style paragraph (100-180 words) inspired by the image.

Style: tight prose like a good blog post or short essay — no filler, every sentence earns its place. Vary rhythm (mix short punchy sentences with longer ones). Show, don't tell.

Mark 2-3 useful expressions in **double asterisks** (e.g. **catch someone's eye**). No other Markdown — no headings, lists, or rules.

Only describe what's visible; use "someone" if identity is unclear. Use search for recognizable people/places.

Output must sound natural read aloud (TTS).`;

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
