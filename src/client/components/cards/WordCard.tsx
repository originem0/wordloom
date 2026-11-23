import { useState } from "react";
import { useGenerateDeep } from "@/client/hooks/useCards";
import { SchemaBlockageSvg } from "./SchemaBlockageSvg";
import type { Card } from "@/shared/types";
import "./word-card.css";
import { BoldMarkup } from "./UntrustedText";
import { normalizeBoundaryTests, type NormalizedBoundaryTest } from "./boundaryTests";

// ---------------------------------------------------------------------------
// Section: Word Header
// ---------------------------------------------------------------------------

function WordCardHeader({ card }: { card: Card }) {
  const posLabels = card.pos
    ? card.pos.split(/[,/]/).map((p) => p.trim()).filter(Boolean)
    : [];

  return (
    <header className="wc-header">
      <h1>{card.word}</h1>
      {card.ipa && <span className="wc-ipa">{card.ipa}</span>}
      <div className="wc-chips">
        {posLabels.map((p) => (
          <span key={p} className="wc-chip wc-chip--accent">{p}</span>
        ))}
        {card.cefr && <span className="wc-chip">CEFR {card.cefr}</span>}
        {card.wad != null && (
          <span className="wc-chip">WAD {card.wad.toFixed(1)}</span>
        )}
        {card.wap != null && (
          <span className="wc-chip">WAP {card.wap.toFixed(1)}</span>
        )}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Section: Core Image (animated SVG schema + description)
// ---------------------------------------------------------------------------

function CoreImageSection({ card }: { card: Card }) {
  const schema = card.schemaAnalysis;
  if (!schema) return null;

  const coreImageText = schema.coreImageText || schema.coreSchema;
  const schemaType = schema.coreSchema?.toLowerCase();

  return (
    <section className="wc-core-image">
      <h2>核心意象 Core Image</h2>
      {/* Render schema SVG — currently only "blockage" is implemented */}
      {schemaType === "blockage" && <SchemaBlockageSvg />}
      <p>{coreImageText}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Etymology (with evolution chain)
// ---------------------------------------------------------------------------

function EtymologySection({ card }: { card: Card }) {
  if (!card.etymology) return null;

  const chain = card.schemaAnalysis?.etymologyChain;

  return (
    <section className="wc-etymology">
      <h2>词根词源 Etymology</h2>
      <p>{card.etymology}</p>
      {chain && chain.length > 0 && (
        <div className="wc-evolution-chain">
          {chain.map((stage, i) => (
            <span key={i}>
              {i > 0 && <span className="wc-evolution-arrow">→ </span>}
              <span className="wc-evolution-stage">{stage}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Scene Activation
// ---------------------------------------------------------------------------

function SceneActivationSection({ card }: { card: Card }) {
  const scenes = card.schemaAnalysis?.sceneActivation;
  if (!scenes || scenes.length === 0) return null;

  return (
    <section>
      <h2>场景激活 Frame Activation</h2>
      {scenes.map((scene, i) => (
        <div key={i} className="wc-scene">
          <h3>{scene.title}</h3>
          <p>{scene.description}</p>
          <p className="wc-scene-example">
            <BoldMarkup text={scene.example} />
          </p>
          {scene.associatedWords.length > 0 && (
            <div className="wc-associated-words">
              {scene.associatedWords.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Family Comparison Table
// ---------------------------------------------------------------------------

function FamilyComparisonSection({ card }: { card: Card }) {
  if (!card.familyComparison || card.familyComparison.length === 0)
    return null;

  // Extract familyBoundaryNote — stored inside schemaAnalysis blob
  const boundaryNote = (
    card.schemaAnalysis as (typeof card.schemaAnalysis) & {
      familyBoundaryNote?: string;
    }
  )?.familyBoundaryNote;

  return (
    <section>
      <h2>家族对比 Family Comparison</h2>
      <div className="wc-table-scroll">
        <table className="wc-family-table">
          <thead>
            <tr>
              <th>词</th>
              <th>核心区别</th>
              <th>情感 / 语域</th>
              <th>典型场景</th>
            </tr>
          </thead>
          <tbody>
            {card.familyComparison.map((entry) => (
              <tr
                key={entry.word}
                className={
                  entry.word.toLowerCase() === card.word.toLowerCase()
                    ? "wc-highlight"
                    : ""
                }
              >
                <td className="wc-word-col">{entry.word}</td>
                <td>{entry.distinction}</td>
                <td>{entry.register}</td>
                <td>{entry.typicalScene}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {boundaryNote && (
        <div className="wc-boundary-note" style={{ whiteSpace: "pre-line" }}>
          {boundaryNote}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: Boundary Tests (collapsible, with reveal)
// ---------------------------------------------------------------------------

function BoundaryTestItem({ test }: { test: NormalizedBoundaryTest }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div>
      <div className="wc-test-blank">
        {test.sentence.split("______").map((part, i, arr) => (
          <span key={i}>
            {part}
            {i < arr.length - 1 && (
              <span className="wc-blank" aria-hidden="true">
                ______
              </span>
            )}
          </span>
        ))}
      </div>
      {!revealed && (
        <button
          type="button"
          className="wc-reveal-btn"
          onClick={() => setRevealed(true)}
        >
          显示答案
        </button>
      )}
      {revealed && (
        <div className="wc-test-options">
          {test.options.map((opt, i) => (
            <div key={i} className="wc-opt">
              <span
                className={`wc-verdict wc-verdict--${opt.verdict}`}
              >
                {opt.verdict === "yes" ? "✓" : opt.verdict === "no" ? "✗" : "?"}
              </span>
              <span className="wc-word-choice">{opt.word}</span>
              <span className="wc-reason">— {opt.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BoundaryTestSection({ card }: { card: Card }) {
  if (!card.boundaryTests || card.boundaryTests.length === 0) return null;

  const tests = normalizeBoundaryTests(card.boundaryTests);

  return (
    <details className="wc-tests-toggle">
      <summary className="wc-tests-summary">
        <span className="wc-chevron">&#9654;</span>
        边界测试 Boundary Tests
      </summary>
      <div className="wc-tests-body">
        {tests.map((test, i) => (
          <BoundaryTestItem key={i} test={test} />
        ))}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Main: WordCard
// ---------------------------------------------------------------------------

export function WordCard({ card }: { card: Card }) {
  const generateDeep = useGenerateDeep();
  const hasDeep =
    card.familyComparison != null ||
    card.schemaAnalysis != null ||
    card.boundaryTests != null;

  // Use freshly-generated data if available, otherwise fall back to card props
  const deepCard = generateDeep.data
    ? { ...card, ...generateDeep.data }
    : card;

  const handleGenerateDeep = () => {
    if (!hasDeep && !generateDeep.isPending && !generateDeep.data) {
      generateDeep.mutate(card.id);
    }
  };

  return (
    <div className="word-card">
      {/* 1. Header */}
      <WordCardHeader card={deepCard} />

      {/* 2. Core Image — shown when deep data exists */}
      <CoreImageSection card={deepCard} />

      {/* 3. Etymology */}
      <EtymologySection card={deepCard} />

      {/* 4. Scene Activation — from deep data */}
      <SceneActivationSection card={deepCard} />

      {/* 5. Family Comparison */}
      <FamilyComparisonSection card={deepCard} />

      {/* 6. Boundary Tests */}
      <BoundaryTestSection card={deepCard} />

      {/* Deep trigger button — show when deep data hasn't been generated */}
      {!hasDeep && !generateDeep.data && (
        <button
          type="button"
          className="wc-deep-trigger"
          disabled={generateDeep.isPending}
          onClick={handleGenerateDeep}
        >
          {generateDeep.isPending ? (
            <>
              <span className="wc-spinner" />
              正在生成深度分析…
            </>
          ) : (
            "🔍 生成深度分析 Generate Deep Analysis"
          )}
        </button>
      )}

      {generateDeep.isError && (
        <p style={{ color: "var(--wc-error)", fontSize: 14 }}>
          {generateDeep.error.message}
        </p>
      )}
    </div>
  );
}
