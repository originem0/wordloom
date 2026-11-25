import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useGenerateDeep } from "@/client/hooks/useCards";
import { AdminOnly } from "@/client/components/auth/AdminOnly";
import type { BoundaryTest, BoundaryTestOption, Card } from "@/shared/types";
import { CoreImageVisual } from "./CoreImageVisual";
import { BoldMarkup } from "./UntrustedText";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import "./prototype-word-card.css";

interface NormalizedBoundaryTest {
  sentence: string;
  options: BoundaryTestOption[];
  legacy: boolean;
}

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

function BoundaryTestItem({ test }: { test: NormalizedBoundaryTest }) {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const name = useId();
  const verdict = (value: string) => value === "yes" ? t("适用", "Fits") : value === "no" ? t("不适用", "Does not fit") : t("视情境而定", "Depends on context");
  const choices = test.legacy
    ? ["yes", "no", "maybe"].map((value) => ({ value, label: verdict(value) }))
    : test.options.map((option, i) => ({ value: String(i), label: option.word }));
  const selected = test.legacy ? choice && verdict(choice) : choice === null ? null : test.options[Number(choice)]?.word;
  const reference = test.legacy ? test.options[0]?.verdict : choice === null ? null : test.options[Number(choice)]?.verdict;

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
          <button type="button" className="reveal-btn" disabled={choice === null} onClick={() => setRevealed(true)}>
            {t("显示答案", "Show answer")}
          </button>
        </fieldset>
      )}

      {revealed && <>
      <p className="test-feedback" role="status">{t(`你选了 ${selected}，参考判断是${verdict(reference ?? "maybe")}。`, `You chose ${selected}. Reference: ${verdict(reference ?? "maybe")}.`)}</p>
      <div className="test-options visible">
        {test.options.map((opt, i) => (
          <div key={i} className={`opt${!test.legacy && choice === String(i) ? " chosen" : ""}`}>
            <span className={`verdict ${opt.verdict}`} role="img" aria-label={opt.verdict === "yes" ? t("适用", "Fits") : opt.verdict === "no" ? t("不适用", "Does not fit") : t("视情境而定", "Depends on context")}>
              {opt.verdict === "yes" ? "✓" : opt.verdict === "no" ? "✗" : "?"}
            </span>
            <span className="word-choice">{opt.word}</span>
            <span className="reason">— {opt.reason}</span>
          </div>
        ))}
      </div>
      <button type="button" className="reveal-btn" onClick={() => { setChoice(null); setRevealed(false); }}>{t("再试一次", "Try again")}</button>
      </>}
    </div>
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

  const deepData = generateDeep.data;
  const deepCard = useMemo(() => (deepData ? { ...card, ...deepData } : card), [card, deepData]);

  // Opening a card used to generate its missing deep layer on the spot. Reading
  // is public and generating is not, so a visitor would have fired a request
  // that can only be refused; it is the admin's explicit action now.
  const missingDeep = !hasDeepData(deepCard);

  const posLabels = deepCard.pos
    ? deepCard.pos.split(/[,/]/).map((p) => p.trim()).filter(Boolean)
    : [];

  const schemaType = deepCard.schemaAnalysis?.coreSchema?.toLowerCase();
  const coreImageText =
    deepCard.schemaAnalysis?.coreImageText || deepCard.schemaAnalysis?.coreSchema;

  const evolutionChain = deepCard.schemaAnalysis?.etymologyChain;

  const scenes = deepCard.schemaAnalysis?.sceneActivation ?? [];

  const family = deepCard.familyComparison ?? [];

  const boundaryNote =
    (deepCard.schemaAnalysis as (typeof deepCard.schemaAnalysis) & {
      familyBoundaryNote?: string;
    })?.familyBoundaryNote;

  const tests = deepCard.boundaryTests
    ? normalizeBoundaryTests(deepCard.boundaryTests)
    : [];

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
        {deepCard.schemaAnalysis && (
          <section className="core-image">
            <h2>{t("核心意象", "Core image")}</h2>

            <CoreImageVisual word={deepCard.word} type={schemaType ?? ""} raw={deepCard.schemaAnalysis.coreSvg} caption={coreImageText} />
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

        {/* 4. Scene activation — collapsible */}
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

        {/* 5. Family comparison — collapsible */}
        {family.length > 0 && (
          <details className="tests-toggle">
            <summary className="tests-summary">
              <span className="chevron">&#9654;</span> {t("家族对比", "Family comparison")}
            </summary>
            <div className="tests-body">
              {compact ? <div className="family-cards">
                {family.map((entry) => <article key={entry.word} className={entry.word.toLowerCase() === deepCard.word.toLowerCase() ? "highlight" : ""}>
                  <h3>{entry.word}</h3>
                  <p>{entry.distinction}</p>
                  <details className="word-meta">
                    <summary>{t("语域与场景", "Register and context")}</summary>
                    <dl>
                      <dt>{t("情感 / 语域", "Tone / register")}</dt><dd>{entry.register}</dd>
                      <dt>{t("典型场景", "Typical context")}</dt><dd>{entry.typicalScene}</dd>
                    </dl>
                  </details>
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
                        <td className="word-col">{entry.word}</td>
                        <td>{entry.distinction}</td>
                        <td>{entry.register}</td>
                        <td>{entry.typicalScene}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
              {boundaryNote && (
                <div className="boundary-note" style={{ whiteSpace: "pre-line" }}>
                  {boundaryNote}
                </div>
              )}
            </div>
          </details>
        )}

        {/* 6. Boundary tests (collapsed, answers hidden) */}
        {tests.length > 0 && (
          <details className="tests-toggle">
            <summary className="tests-summary">
              <span className="chevron">&#9654;</span> {t("边界测试", "Boundary tests")}
            </summary>
            <div className="tests-body">
              {tests.map((t, i) => (
                <BoundaryTestItem key={i} test={t} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
