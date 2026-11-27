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
- coreMeaning: a concise core meaning in the selected explanation language
- wad: word acquisition difficulty (1-5, where 5 is hardest)
- wap: word academic prevalence (1-5, where 5 is most academic)
- etymology: brief etymology in the selected explanation language, including origin and semantic change
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
   Each entry: { word, pos, distinction (核心区别 in the explanation language), register (情感/语域 in the explanation language), typicalScene (典型场景 in the explanation language) }
   Include the target word itself as the first entry (highlighted).
   Include 3-5 comparison words.

2. familyAxes: The 2-3 dimensions along which this family really differs, in the explanation language, as one string joined by " / " (e.g. "起因：内心涌出还是外部安排 / 有没有想过后果 / 褒贬").
   Choose axes that fit the word type: force, direction or degree for spatial and action words; register and domain for academic words; cause, intent or attitude for abstract words.
   Every distinction in familyComparison should read as a position on these axes.

3. familyBoundaryNote: 2-3 key pairs from the family in the explanation language, ONE PAIR PER LINE, each line in the form "X vs Y：X 是…；Y 是…". Use concrete metaphors. Separate the pairs with a line break; no bullets, no numbering.

4. familyChoiceRule: One sentence in the explanation language that a learner can apply while writing: a decision rule that names the words (e.g. "心里一动就做 → spontaneous；没想后果 → impulsive；没准备却要当场讲 → impromptu").

5. schemaAnalysis: Cognitive schema analysis.
   {
     wordType: the type chosen in Step 0,
     coreImageText: Choose one everyday use of the word. In one or two short sentences in the learner's explanation language, describe a concrete moment and the detail that makes the word fit. Keep the people, objects and action consistent across the caption, example and any drawing,
     coreImageExample: One natural English sentence using the target word in that same moment and sense. Wrap the actual word form in double asterisks (e.g. "After lunch, they **resumed** their discussion."). Always include this example and coreImageText, even for a text-only scene,
     coreSchema: one of "blockage" | "container" | "path" | "link" | "balance" | "none". Use "none" when no such schema fits, including text-only scenes,
     coreSvg: OPTIONAL. Draw the actual scene when a visible detail clarifies this use. For a process, show the same subject before and after the change. If the meaning rests on intent, timing or context that the caption conveys better, omit coreSvg and use coreSchema "none".
       - Supply one complete SVG string with xmlns="http://www.w3.org/2000/svg" and viewBox="0 0 392 180". Use simple shapes, a transparent canvas, dark ink (#302D26), muted ink (#625846), teal (#245C54), pale green (#D8E3D2) and paper (#F2E8D5).
       - Default to a static drawing. Only use motion to show a meaningful change; keep the information visible in a still frame and honor prefers-reduced-motion. No decorative loops.
       - Include at most three short labels if needed, in the explanation language, at least 18 SVG units high, with room around the edges. Keep it under 2KB. Do not use scripts, <image>, <foreignObject> or external resources.
     etymologyChain: Array of 2-4 short labels in the explanation language showing the semantic evolution stages (e.g. ["物理：昏暗/被遮挡", "认知：晦涩难懂", "社会：默默无闻"]),
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
       { verdict: "yes" | "no" | "maybe", word: the candidate word, reason: short explanation in the explanation language }
   }
   Include the target word and at least one confusable word from familyComparison in the options.

Return as a single JSON object.

Hard requirements:
- schemaAnalysis MUST be present.
- schemaAnalysis.coreSchema MUST be one of: blockage, container, path, link, balance, none.

Follow the language preference for all explanatory fields.`;

// ---------------------------------------------------------------------------
// Language instruction helper
// ---------------------------------------------------------------------------

export async function getExplanationLanguageInstruction(): Promise<string> {
  const pref = ((await getSetting("analysis_language")).trim() || "zh-CN").toLowerCase();
  if (pref === "en") {
    return "Use English for explanatory text such as meanings, etymology, distinctions, notes, reasons, and core image descriptions. Keep English examples in English and their Chinese translations in Chinese.";
  }
  if (pref === "bilingual") {
    return "Use concise bilingual explanations: English first, then Simplified Chinese where it helps learners. Keep them compact.";
  }
  return "Use Simplified Chinese for explanatory text unless a field explicitly requires English.";
}
