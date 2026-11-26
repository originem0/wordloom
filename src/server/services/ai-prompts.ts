import { getSetting } from "./ai-shared.js";

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
- collocations: 4-6 common collocations and set phrases as strings — the chunks a learner would reuse whole (e.g. "a spontaneous decision", "on the spur of the moment")
- examples: 3 example sentences at basic/intermediate/advanced levels, each with Chinese translation
- antonyms: 1-3 antonyms
- minPair: a minimal pair word that learners often confuse with this word

Return a JSON array of card objects.`;

// ---------------------------------------------------------------------------
// Deep layer prompt
// ---------------------------------------------------------------------------

// The word is classified first because the fields that follow depend on it:
// which axes separate the family, and whether a drawing says anything at all.
// A diagram was mandatory once, and abstract words got one that fit nothing.
export const DEEP_PROMPT = `You are a vocabulary deep-analysis engine for English learners.

Step 0 — classify the word before writing anything else. Not every word deserves every kind of analysis; the type decides what the fields below should contain:
- "spatial": prepositions, particles and words of direction, position or force (over, through, against, withstand). The image IS the meaning.
- "action": concrete physical verbs whose literal action carries the abstract senses (grasp, shatter, stumble).
- "light": high-frequency verbs with many senses (get, take, run, set). One prototype scene should explain the senses.
- "abstract": states, qualities, attitudes and judgements (spontaneous, reluctant, subtle). The family comparison carries the weight.
- "academic": formal or discipline vocabulary (hypothesis, allocate, empirical). Register and collocation carry the weight.
- "scene": words that only make sense inside a situation with roles (bargain, verdict, tip). The scene frames carry the weight.
- "general": none of the above.

For the given word, generate a JSON object with these fields:

1. familyComparison: Array of related/similar words (word family + common confusables).
   Each entry: { word, pos, distinction (核心区别 in Chinese), register (情感/语域 in Chinese), typicalScene (典型场景 in Chinese) }
   Include the target word itself as the first entry (highlighted).
   Include 3-5 comparison words.

2. familyAxes: The 2-3 dimensions along which this family really differs, in Chinese, as one string joined by " / " (e.g. "起因：内心涌出还是外部安排 / 有没有想过后果 / 褒贬").
   Choose axes that fit the word type: force, direction or degree for spatial and action words; register and domain for academic words; cause, intent or attitude for abstract words.
   Every distinction in familyComparison should read as a position on these axes.

3. familyBoundaryNote: 2-3 key pairs from the family in Chinese, ONE PAIR PER LINE, each line in the form "X vs Y：X 是…；Y 是…". Use concrete metaphors. Separate the pairs with a line break; no bullets, no numbering.

4. familyChoiceRule: One sentence in Chinese that a learner can apply while writing: a decision rule that names the words (e.g. "心里一动就做 → spontaneous；没想后果 → impulsive；没准备却要当场讲 → impromptu").

5. schemaAnalysis: Cognitive schema analysis.
   {
     wordType: the type chosen in Step 0,
     coreSchema: one of "blockage" | "container" | "path" | "link" | "balance" | "none". Use "none" when no schema honestly fits; never pick the closest one just to fill the field,
     coreImageText: A paragraph in Chinese (2-3 sentences) describing the prototype of the word — the concrete situation its meaning grows from and the mental picture it evokes. Always required, also when nothing is drawn,
     coreSvg: OPTIONAL. Include it for "spatial" and "action" words, and for any other word only when one concrete picture really explains it. Otherwise omit the field: a forced diagram is worse than none.
       When included, it is a COMPLETE inline SVG string that vividly illustrates THIS SPECIFIC WORD's core meaning.
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
     etymologyChain: Array of 2-4 short Chinese labels showing the semantic evolution stages (e.g. ["物理：昏暗/被遮挡", "认知：晦涩难懂", "社会：默默无闻"]),
     sceneActivation: Array of 2-3 scene frames, each:
       {
         title: "Scene N — [domain] ([frame name])" in English,
         description: A vivid paragraph in English describing a concrete scenario where the word applies,
         example: An example sentence in English using the word (wrap the target word in double asterisks),
         associatedWords: 4-6 related English words for this particular usage scene
       }
   }

6. boundaryTests: 3-4 fill-in-the-blank test scenarios.
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
- schemaAnalysis.coreSchema MUST be one of: blockage, container, path, link, balance, none.

All Chinese text should use Simplified Chinese.`;

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
