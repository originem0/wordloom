import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useExpressions } from "@/client/hooks/useExpressions";
import { useI18n } from "@/client/lib/i18n";
import type { ExpressionSummary } from "@/shared/expressions";
import { day, sourceLabel } from "../expressions/shared";
import { ownSentences } from "./card-detail";

const EMPTY: ExpressionSummary[] = [];
const BATCH = 3;
type WordProps = { word: string; pos?: string | null };

function SavedSentences({ word, pos }: WordProps) {
  const { t } = useI18n();
  // Same private cache as the expression page: its writes invalidate this list,
  // and signing out clears it. A separate per-word cache could keep old answers.
  const list = useExpressions(true);
  const saved = list.data?.expressions ?? EMPTY;
  const sentences = useMemo(() => ownSentences(saved, word, pos), [saved, word, pos]);
  const [visible, setVisible] = useState(BATCH);

  if (list.error) return <>
    <p className="own-note" role="alert">{t("原句读取失败。", "Could not load saved sentences.")}</p>
    <button type="button" className="reveal-btn" disabled={list.isFetching} onClick={() => void list.refetch()}>{t("重试", "Retry")}</button>
  </>;
  if (list.isPending) return <p className="own-note" role="status">{t("正在读取表达库…", "Loading your expression library…")}</p>;

  return <>
    {sentences.length ? (
      <ul className="own-sentences">
        {sentences.slice(0, visible).map((sentence) => (
          <li key={sentence.id}>
            <Link className="own-sentence-link" to={`/?expression=${sentence.id}`} state={{ expressionDetail: true }}>
              <p>{sentence.before}<mark>{sentence.hit}</mark>{sentence.after}</p>
              <span className="own-sentence-meta">
                <span>{[sourceLabel(sentence.sourceType), sentence.sourceTitle, day(sentence.at)].filter(Boolean).join(" · ")}</span>
                <span className="own-sentence-open">{t("查看记录", "Open entry")} →</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    ) : <>
      <p className="own-note">{saved.length ? t("还没有可显示的相关原句。", "No matching sentences to show yet.") : t("还没有收下任何表达。", "No expressions saved yet.")}</p>
      <Link className="reveal-btn" to={`/#focus=${encodeURIComponent(word)}`}>{t("收一条原句", "Save a sentence")}</Link>
    </>}
    {saved.some((entry) => entry.masked) && <p className="own-note">{t("练习中隐藏的原文不在这里显示。", "Text hidden for practice stays hidden here.")}</p>}
    {sentences.length > BATCH && (
      <button type="button" className="reveal-btn" disabled={visible >= sentences.length} onClick={() => setVisible((count) => count + BATCH)}>
        {visible < sentences.length ? t(`再看 ${Math.min(BATCH, sentences.length - visible)} 条`, `Show ${Math.min(BATCH, sentences.length - visible)} more`) : t("已显示全部", "All shown")}
      </button>
    )}
  </>;
}

/** Mounted only for the admin; opening a public word card reads no private data. */
export function OwnSentencesSection({ word, pos }: WordProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <details className="tests-toggle own-sentences-section" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="tests-summary">
        <span className="chevron" aria-hidden="true">&#9654;</span> {t("我收过的原句", "My saved sentences")}
      </summary>
      {/* Mount the query only after opening, rather than fetching the library
          for every card the reader opens. Collapsing it drops the excerpts. */}
      {open && <div className="tests-body"><SavedSentences word={word} pos={pos} /></div>}
    </details>
  );
}
