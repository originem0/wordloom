import { useStats } from "@/client/hooks/useExpressions";
import { day } from "./shared";
import { useI18n } from "@/client/lib/i18n";

/**
 * The only numbers on the page: how many entries have been produced, on how
 * many days something was due, and on how many of those an attempt was made.
 * Not the size of the library, no ratio, no bar, no streak: the two day counts
 * are there to be read once, on the day named after them.
 */
export function StatsLine() {
  const { t } = useI18n();
  const { data } = useStats(true);
  // Loading, failed, or an empty library (no first entry, so no day to judge on): nothing, not a row of zeroes.
  if (!data?.judgeAt) return null;
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>{t(`用出过 ${data.produced} 条`, `Used ${data.produced} expression${data.produced === 1 ? "" : "s"}`)}
      {t(` · 可测 ${data.testableDays} 天，其中作答 ${data.attemptDays} 天 · 判定日 ${day(data.judgeAt)}`, ` · Due on ${data.testableDays} days; answered on ${data.attemptDays} · Review date ${day(data.judgeAt)}`)}
      </p>
      <details className="reading-help">
        <summary>{t("怎样才算用出过", "What counts as used")}</summary>
        <p>{t("隔了一天以上、作答前没看答案、在新句子里打出来过。", "Written in a new sentence after at least a day, without seeing the answer first.")}</p>
      </details>
    </div>
  );
}
