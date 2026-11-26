import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useGenerateDeep } from "@/client/hooks/useCards";
import { AdminOnly } from "@/client/components/auth/AdminOnly";
import { useReadingStore } from "@/client/store/reading";
import type { BoundaryTest, BoundaryTestOption, Card, FamilyEntry } from "@/shared/types";
import { CoreImageVisual } from "./CoreImageVisual";
import { OwnSentencesSection } from "./OwnSentencesSection";
import { BoldMarkup } from "./UntrustedText";
import { mergePhrases, seedOf, shuffleOptions, splitBoundaryNote } from "./card-detail";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import "./prototype-word-card.css";

type Verdict = BoundaryTestOption["verdict"];

interface NormalizedBoundaryTest {
  sentence: string;
  options: BoundaryTestOption[];
  legacy: boolean;
}

// Step 0 of the method the deep layer follows: what kind of word this is.
// Cards generated before the field existed simply show no chip.
const WORD_TYPES: Record<string, readonly [string, string]> = {
  spatial: ["空间词", "Spatial"],
  action: ["动作词", "Action"],
  light: ["高频大词", "Light verb"],
  academic: ["学术词", "Academic"],
  abstract: ["抽象词", "Abstract"],
  scene: ["场景词", "Frame word"],
};

function normalizeBoundaryTests(tests: BoundaryTest[]): NormalizedBoundaryTest[] {
  return tests.map((t) => {
    if (t.sentence && t.options && t.options.length > 0) {
      return { sentence: t.sentence, options: t.options, legacy: false };
    }
    return {
      sentence: t.scenario ?? "",
      legacy: true,
      options: [
        {
          verdict: (t.answer === "yes"
            ? "yes"
            : t.answer === "no"
              ? "no"
              : "maybe") as "yes" | "no" | "maybe",
          word: "—",
          reason: t.explanation ?? "",
        },
      ],
    };
  });
}

function hasDeepData(card: Card): boolean {
  const fam = card.familyComparison;
  const tests = card.boundaryTests;
  const schema = card.schemaAnalysis;
  return (
    !!schema ||
    (Array.isArray(fam) && fam.length > 0) ||
    (Array.isArray(tests) && tests.length > 0)
  );
}

function BoundaryTestItem({ test, seed, onReveal, children }: { test: NormalizedBoundaryTest; seed: number; onReveal: (verdict: Verdict) => void; children?: ReactNode }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const name = useId();
  const verdict = (value: string) => value === "yes" ? t("适用", "Fits") : value === "no" ? t("不适用", "Does not fit") : t("视情境而定", "Depends on context");
  // Stored order puts the fitting word first; a retry draws a new order.
  const options = useMemo(
    () => (test.legacy ? test.options : shuffleOptions(test.options, seedOf(seed, attempt))),
    [test, seed, attempt],
  );
  const choices = test.legacy
    ? ["yes", "no", "maybe"].map((value) => ({ value, label: verdict(value) }))
    : options.map((option, i) => ({ value: String(i), label: option.word }));
  const selected = test.legacy ? choice && verdict(choice) : choice === null ? null : options[Number(choice)]?.word;
  const reference = test.legacy ? options[0]?.verdict : choice === null ? null : options[Number(choice)]?.verdict;
  const reveal = () => {
    setRevealed(true);
    // A legacy question asks for the verdict itself; a word question is right
    // when the chosen word fits.
    onReveal(test.legacy ? (choice === reference ? "yes" : "no") : reference ?? "maybe");
  };

  return (
    <div className="test-item">
      <div className="test-blank">
        {test.sentence.split("______").map((part, i, arr) => (
          <span key={i}>
            {part}
            {i < arr.length - 1 && (
              <span className="blank" aria-hidden="true">
                ______
              </span>
            )}
          </span>
        ))}
      </div>

      {!revealed && (
        <fieldset className="test-choices">
          <legend>{test.legacy ? t("你认为这个词适用吗", "Does this word fit?") : t("你会选哪个词", "Which word would you choose?")}</legend>
          {choices.map((option) => <label key={option.value} className="test-choice">
            <input type="radio" name={name} value={option.value} checked={choice === option.value} onChange={() => setChoice(option.value)} />
            <span>{option.label}</span>
          </label>)}
          <button type="button" className="reveal-btn" disabled={choice === null} onClick={reveal}>
            {t("显示答案", "Show answer")}
          </button>
        </fieldset>
      )}

      {revealed && <>
      <p className="test-feedback" role="status">{t(`你选了 ${selected}，参考判断是${verdict(reference ?? "maybe")}。`, `You chose ${selected}. Reference: ${verdict(reference ?? "maybe")}.`)}</p>
      <div className="test-options visible">
        {options.map((opt, i) => (
          <div key={i} className={`opt${!test.legacy && choice === String(i) ? " chosen" : ""}`}>
            <span className={`verdict ${opt.verdict}`} role="img" aria-label={opt.verdict === "yes" ? t("适用", "Fits") : opt.verdict === "no" ? t("不适用", "Does not fit") : t("视情境而定", "Depends on context")}>
              {opt.verdict === "yes" ? "✓" : opt.verdict === "no" ? "✗" : "?"}
            </span>
            <span className="word-choice">{opt.word}</span>
            <span className="reason">— {opt.reason}</span>
          </div>
        ))}
      </div>
      </>}
      <div className="test-actions">
        {revealed && <button type="button" className="reveal-btn" onClick={() => { setChoice(null); setRevealed(false); setAttempt((n) => n + 1); }}>{t("再试一次", "Try again")}</button>}
        {children}
      </div>
    </div>
  );
}

/** One question at a time: four open questions pushed the comparison that
 * explains them a full screen further down. */
function BoundaryTests({ tests, cardId, onAnswer }: { tests: NormalizedBoundaryTest[]; cardId: number; onAnswer: () => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [round, setRound] = useState(0);
  // Only the first answer to a question counts: a retry has read the reasons.
  const [first, setFirst] = useState<Record<number, Verdict>>({});
  const current = Math.min(index, tests.length - 1);
  const answered = first[current] !== undefined;
  const last = current === tests.length - 1;
  const right = Object.values(first).filter((value) => value === "yes").length;

  return (
    <section className="boundary-tests">
      <h2>
        {t("边界测试", "Boundary tests")}
        {tests.length > 1 && <span className="test-progress">{current + 1} / {tests.length}</span>}
      </h2>
      <BoundaryTestItem
        key={`${round}:${current}`}
        test={tests[current]}
        seed={seedOf(cardId, round, current)}
        onReveal={(value) => {
          setFirst((previous) => (previous[current] === undefined ? { ...previous, [current]: value } : previous));
          onAnswer();
        }}
      >
        {answered && !last && <button type="button" className="reveal-btn" onClick={() => setIndex(current + 1)}>{t("下一题", "Next")}</button>}
        {answered && last && tests.length > 1 && <button type="button" className="reveal-btn" onClick={() => { setFirst({}); setIndex(0); setRound((n) => n + 1); }}>{t("再来一遍", "Start over")}</button>}
      </BoundaryTestItem>
      {answered && last && tests.length > 1 && (
        <p className="test-summary" role="status">{t(`${tests.length} 题里，第一次就选对 ${right} 题。`, `Right on the first try: ${right} of ${tests.length}.`)}</p>
      )}
    </section>
  );
}

function useCompactCard() {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 768px)").matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 768px)");
    const change = (event: MediaQueryListEvent) => setCompact(event.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return compact;
}

export function PrototypeWordCard({ card, onClose }: { card: Card; onClose?: () => void }) {
  const { t } = useI18n();
  const generateDeep = useGenerateDeep();
  const compact = useCompactCard();
  const setCardInput = useReadingStore((s) => s.setCardInput);
  // null until the reader or a first answer decides; see the family section.
  const [familyOpen, setFamilyOpen] = useState<boolean | null>(null);

  const deepData = generateDeep.data;
  const deepCard = useMemo(() => (deepData ? { ...card, ...deepData } : card), [card, deepData]);

  // Opening a card used to generate its missing deep layer on the spot. Reading
  // is public and generating is not, so a visitor would have fired a request
  // that can only be refused; it is the admin's explicit action now.
  const missingDeep = !hasDeepData(deepCard);

  const posLabels = deepCard.pos
    ? deepCard.pos.split(/[,/]/).map((p) => p.trim()).filter(Boolean)
    : [];

  const schema = deepCard.schemaAnalysis;
  const schemaType = schema?.coreSchema?.toLowerCase();
  const wordType = WORD_TYPES[schema?.wordType?.toLowerCase() ?? ""];
  // "none" is the model saying no schema fits: neither a drawing nor a caption.
  const coreImageText = schema?.coreImageText || (schemaType !== "none" ? schema?.coreSchema : undefined);
  const hasCoreImage = !!schema && (schemaType !== "none" || !!schema.coreSvg || !!coreImageText);

  const evolutionChain = schema?.etymologyChain;

  const scenes = schema?.sceneActivation ?? [];

  const family = deepCard.familyComparison ?? [];
  const noteLines = schema?.familyBoundaryNote ? splitBoundaryNote(schema.familyBoundaryNote) : [];

  const boundaryTests = deepCard.boundaryTests;
  const tests = useMemo(() => (boundaryTests ? normalizeBoundaryTests(boundaryTests) : []), [boundaryTests]);

  const phrases = mergePhrases(deepCard.collocations, deepCard.phrases);
  const examples = (Array.isArray(deepCard.examples) ? deepCard.examples : []).filter((example) => typeof example?.sentence === "string" && example.sentence);
  const antonyms = mergePhrases(deepCard.antonyms);
  const minPair = typeof deepCard.minPair === "string" ? deepCard.minPair.trim() : "";

  // A family word leads to its own card, or to the box that can generate one:
  // the library's search takes the word and the detail closes onto it.
  const familyWord = (entry: FamilyEntry) =>
    !onClose || entry.word.toLowerCase() === deepCard.word.toLowerCase() ? entry.word : (
      <button type="button" className="family-link" title={t(`在词库里查 ${entry.word}`, `Look up ${entry.word} in the library`)} onClick={() => { setCardInput(entry.word); onClose(); }}>
        {entry.word}
      </button>
    );

  return (
    <div className="proto-page">
      <div className="card">
        {/* Close button */}
        {onClose && (
          <button
            type="button"
            className="close-btn"
            onClick={onClose}
            aria-label={t("关闭", "Close")}
          >
            ✕
          </button>
        )}
        {/* 1. Word header — single line */}
        <header className="word-header">
          <h1>{deepCard.word}</h1>
          {deepCard.ipa && <span className="ipa">{deepCard.ipa}</span>}
          <div className="chips">
            {posLabels.map((p) => (
              <span key={p} className="chip accent">
                {p}
              </span>
            ))}
            {deepCard.cefr && <span className="chip">CEFR {deepCard.cefr}</span>}
            {wordType && <span className="chip">{t(...wordType)}</span>}
          </div>
          {/* Leads to the capture box with this word as the focus. Nothing is
              saved until the admin presses 收下 there. */}
          <AdminOnly>
            <Link className="reveal-btn" title={t("收进表达库", "Save to expressions")} to={`/#focus=${encodeURIComponent(deepCard.word)}`}>
              {t("收", "Save")}
            </Link>
          </AdminOnly>
        </header>

        {/* 2. Core image — custom SVG or fallback template */}
        {hasCoreImage && (
          <section className="core-image">
            <h2>{t("核心意象", "Core image")}</h2>

            <CoreImageVisual word={deepCard.word} type={schemaType ?? ""} raw={schema.coreSvg} caption={coreImageText} />
          </section>
        )}

        {/* Deep layer: missing / loading / error — top-level so it's always visible */}
        {missingDeep && !generateDeep.isPending && (
          <div className="deep-missing">
            <span>{t("这张词卡还没有深度分析。", "This card has no deep analysis yet.")}</span>
            <AdminOnly>
              <button
                type="button"
                className="reveal-btn"
                onClick={() => generateDeep.mutate(card.id)}
              >
                {generateDeep.isError ? t("重试", "Retry") : t("生成深度分析", "Generate deep analysis")}
              </button>
            </AdminOnly>
          </div>
        )}

        {generateDeep.isPending && (
          <div className="deep-loading">
            <span className="deep-spinner" />
            {t("正在生成深度分析…", "Generating deep analysis…")}
          </div>
        )}

        {generateDeep.isError && (
          <div className="deep-error">
            {t("深度分析生成失败：", "Deep analysis failed: ")}{errorMessage(generateDeep.error)}
          </div>
        )}

        {/* 3. Etymology */}
        {deepCard.etymology && (
          <section className="etymology">
            <h2>{t("词根词源", "Etymology")}</h2>
            <p>{deepCard.etymology}</p>
            {evolutionChain && evolutionChain.length > 0 && (
              <div className="evolution-chain">
                {evolutionChain.map((stage, i) => (
                  <span key={i}>
                    {i > 0 && <span className="arrow">→</span>}
                    <span className="stage">{stage}</span>
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 4. Boundary tests — answered before the comparison that explains them */}
        {tests.length > 0 && (
          <BoundaryTests tests={tests} cardId={deepCard.id} onAnswer={() => setFamilyOpen((open) => open ?? true)} />
        )}

        {/* 5. Family comparison. Its typical scenes are the scenes the tests
            ask about, so it stays folded until a first answer is in; a card
            with no tests opens with it. */}
        {family.length > 0 && (
          <details className="tests-toggle" open={familyOpen ?? tests.length === 0} onToggle={(event) => setFamilyOpen(event.currentTarget.open)}>
            <summary className="tests-summary">
              <span className="chevron">&#9654;</span> {t("家族对比", "Family comparison")}
            </summary>
            <div className="tests-body">
              {schema?.familyAxes && <p className="family-line"><span>{t("区分轴", "Axes")}</span>{schema.familyAxes}</p>}
              {schema?.familyChoiceRule && <p className="family-line"><span>{t("怎么选", "How to choose")}</span>{schema.familyChoiceRule}</p>}
              {noteLines.length > 0 && (
                <ul className="boundary-note">
                  {noteLines.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              )}
              {compact ? <div className="family-cards">
                {family.map((entry) => <article key={entry.word} className={entry.word.toLowerCase() === deepCard.word.toLowerCase() ? "highlight" : ""}>
                  <h3>{familyWord(entry)}</h3>
                  <p>{entry.distinction}</p>
                  {entry.register && <p className="family-line"><span>{t("语域", "Register")}</span>{entry.register}</p>}
                  {entry.typicalScene && <p className="family-line"><span>{t("场景", "Scene")}</span>{entry.typicalScene}</p>}
                </article>)}
              </div> : <div className="table-scroll">
                <table className="family-table">
                  <thead>
                    <tr>
                      <th>{t("词", "Word")}</th>
                      <th>{t("核心区别", "Key distinction")}</th>
                      <th>{t("情感 / 语域", "Tone / register")}</th>
                      <th>{t("典型场景", "Typical scene")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {family.map((entry) => (
                      <tr
                        key={entry.word}
                        className={
                          entry.word.toLowerCase() === deepCard.word.toLowerCase()
                            ? "highlight"
                            : ""
                        }
                      >
                        <td className="word-col">{familyWord(entry)}</td>
                        <td>{entry.distinction}</td>
                        <td>{entry.register}</td>
                        <td>{entry.typicalScene}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
            </div>
          </details>
        )}

        <AdminOnly>
          <OwnSentencesSection key={deepCard.id} word={deepCard.word} pos={deepCard.pos} />
        </AdminOnly>

        {/* 7. Collocations and examples — folded: the top of the card stays
            with the image, and usage is one tap away. */}
        {(phrases.length > 0 || examples.length > 0 || antonyms.length > 0 || minPair) && (
          <details className="tests-toggle">
            <summary className="tests-summary">
              <span className="chevron">&#9654;</span> {t("搭配与例句", "Collocations and examples")}
            </summary>
            <div className="tests-body">
              {phrases.length > 0 && (
                <ul className="usage-phrases">
                  {phrases.map((phrase) => <li key={phrase}>{phrase}</li>)}
                </ul>
              )}
              {examples.map((example, i) => (
                <div key={i} className="usage-example">
                  <p>{example.sentence}</p>
                  {example.translation && <p className="usage-translation">{example.translation}</p>}
                </div>
              ))}
              {minPair && <p className="family-line"><span>{t("易混", "Often confused")}</span>{minPair}</p>}
              {antonyms.length > 0 && <p className="family-line"><span>{t("反义", "Opposites")}</span>{antonyms.join(" · ")}</p>}
            </div>
          </details>
        )}

        {/* 8. Scene activation — collapsible */}
        {scenes.length > 0 && (
          <details className="tests-toggle">
            <summary className="tests-summary">
              <span className="chevron">&#9654;</span> {t("场景激活", "Frame activation")}
            </summary>
            <div className="tests-body">
              {scenes.map((scene, i) => (
                <div key={i} className="scene">
                  <h3>{scene.title}</h3>
                  <p>{scene.description}</p>
                  <p className="scene-example">
                    <BoldMarkup text={scene.example} />
                  </p>
                  {scene.associatedWords?.length > 0 && (
                    <div className="associated-words">
                      {scene.associatedWords.map((w) => (
                        <span key={w}>{w}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
