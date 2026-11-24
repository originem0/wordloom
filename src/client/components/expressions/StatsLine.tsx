import { useStats } from "@/client/hooks/useExpressions";
import { day } from "./shared";

/**
 * The only numbers on the page: how many entries have been produced, on how
 * many days something was due, and on how many of those an attempt was made.
 * Not the size of the library, no ratio, no bar, no streak: the two day counts
 * are there to be read once, on the day named after them.
 */
export function StatsLine() {
  const { data } = useStats(true);
  // Loading, failed, or an empty library (no first entry, so no day to judge on): nothing, not a row of zeroes.
  if (!data?.judgeAt) return null;
  return (
    <p className="text-sm text-muted-foreground">
      用出过 {data.produced} 条<span className="text-xs">（隔了一天以上、作答前没看答案、在新句子里打出来过）</span>
      {` · 可测 ${data.testableDays} 天，其中作答 ${data.attemptDays} 天 · 判定日 ${day(data.judgeAt)}`}
    </p>
  );
}
