import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { useIsAdmin } from "@/client/hooks/useAuth";
import { useExpressions, useGlossWatch } from "@/client/hooks/useExpressions";
import { useSettings } from "@/client/hooks/useSettings";
import { ApiError } from "@/client/lib/api";
import { DRAFT_SETTING_KEY, type ExpressionSummary } from "@/shared/expressions";
import { CaptureBox } from "./CaptureBox";
import { ExpressionDetailDialog, Marked } from "./ExpressionDetail";
import { StatsLine } from "./StatsLine";
import { TryPanel } from "./TryPanel";
import { noAuthNote, sourceLabel, day, titleOf } from "./shared";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import { useReadingStore } from "@/client/store/reading";
import { useReadingPosition } from "@/client/hooks/useReadingPosition";
import { PaginationControls } from "@/client/components/ui/pagination-controls";

// 全部 leaves out only what was put away, and comes first: an entry just saved
// or just moved to the other layer is then still on top of what is shown.
const LAYERS = [["all", "全部", "All"], ["active", "想用", "To use"], ["seen", "见过", "Seen"], ["retired", "已收起", "Archived"]] as const;
const PAGE_SIZE = 20;
const NO_EXPRESSIONS: ExpressionSummary[] = [];

function ExpressionsInner() {
  const { t } = useI18n();
  // The route only brings an admin here; asking again keeps the rule in the
  // page itself: no admin, no request for private data.
  const isAdmin = useIsAdmin();
  const list = useExpressions(isAdmin);
  const [glossing, watchGloss] = useGlossWatch();
  const query = useReadingStore((s) => s.expressions.query);
  const layer = useReadingStore((s) => s.expressions.layer);
  const savedPage = useReadingStore((s) => s.expressions.page);
  const setQuery = useReadingStore((s) => s.setExpressionQuery);
  const setLayer = useReadingStore((s) => s.setExpressionLayer);
  const setPage = useReadingStore((s) => s.setExpressionPage);
  const [openId, setOpenId] = useState<number | null>(null);
  const [focusCue, setFocusCue] = useState(false);
  const all = list.data?.expressions ?? NO_EXPRESSIONS;
  const listStart = useRef<HTMLElement>(null);
  const captureStart = useRef<HTMLDivElement>(null);
  useReadingPosition("expressions", !!list.data);

  // 帮我起草 is on once it was switched on in Settings, or by itself under the
  // rule written down before launch: two weeks in, twenty or more kept in 见过
  // and fewer than five moved to 想用. Counted when the page reads the list.
  const settings = useSettings({ enabled: isAdmin });
  const [now] = useState(Date.now);
  const inLayer = (status: string) => all.filter((e) => e.status === status).length;
  const draft =
    settings.data?.[DRAFT_SETTING_KEY] === "1" ||
    (all.some((e) => now - e.createdAt >= 14 * 86_400_000) && inLayer("seen") >= 20 && inLayer("active") < 5);

  // Filtered here: the library stays in the hundreds, and a search term sent
  // to the server would be private text in a URL.
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => all.filter(
    (e) =>
      (layer === "all" ? e.status !== "retired" : e.status === layer) &&
      (!needle || [e.text, e.focus, e.intent, e.sourceTitle].some((field) => field?.toLowerCase().includes(needle))),
  ), [all, layer, needle]);
  // A layer change or an archive can remove the last page. Clamp before
  // slicing, so a populated library never briefly presents an empty page.
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(savedPage, pages);
  // Remember the clamped page too: a later insertion must not jump back to
  // a page that disappeared when its last entry was archived.
  useEffect(() => {
    if (list.data && savedPage > pages) setPage(pages);
  }, [list.data, savedPage, pages, setPage]);
  const visible = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const starter = all.find((entry) => entry.status === "seen");
  const chooseSaved = starter ? () => {
    setFocusCue(true);
    setQuery("");
    setLayer("seen");
    setOpenId(starter.id);
  } : undefined;
  const startCapture = () => captureStart.current?.querySelector("textarea")?.focus();
  const changePage = (next: number) => {
    setPage(next);
    listStart.current?.scrollIntoView?.({ block: "start" });
  };
  const saved = (id: number) => {
    watchGloss(id);
    setQuery("");
    setLayer("all");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:space-y-8 md:p-6">
      <section className="space-y-1">
        <h2 className="text-2xl font-semibold">{t("表达", "Expressions")}</h2>
        <p className="text-sm text-muted-foreground">{t("遇到想留下的说法就收下，原文逐字保存。收下之后，原文会发给你配置的模型补一条注。", "Save expressions you want to keep, with their exact original text. After saving, your configured model adds an annotation.")}</p>
        {/* This and 试一条 ask the server on their own. They wait for the list, which only an admin is given. */}
        {list.data && <StatsLine />}
      </section>
      {list.error instanceof ApiError && list.error.code === "AUTH_NOT_CONFIGURED" ? (
        <p className="rounded-md border p-4 text-sm">{noAuthNote()}</p>
      ) : (
        <>
          <div ref={captureStart}><CaptureBox onSaved={saved} /></div>
          {list.data && <TryPanel onChooseSaved={layer === "active" && !shown.length && !needle ? undefined : chooseSaved} />}
          <section ref={listStart} tabIndex={-1} className="space-y-3 scroll-mt-4 outline-none" aria-label={t("你的表达", "Your expressions")}>
            <h3 className="text-base font-semibold">{t("你的表达", "Your expressions")}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label={t("筛选", "Filter")} className="sm:max-w-xs sm:flex-1" placeholder={t("筛选：原文、焦点、意思、出处", "Filter by text, focus, meaning, or source")} value={query} onChange={(e) => setQuery(e.target.value)} />
              {LAYERS.map(([value, chinese, english]) => (
                <Button key={value} size="sm" className="min-h-11" variant={layer === value ? "default" : "outline"} aria-pressed={layer === value} onClick={() => setLayer(value)}>{t(chinese, english)}</Button>
              ))}
            </div>
            {list.isLoading && <Loader2 className="mx-auto my-8 size-5 animate-spin text-muted-foreground" />}
            {list.error && <p className="text-sm text-destructive">{t("读取失败：", "Could not load: ")}{errorMessage(list.error)}</p>}
            {list.data && shown.length === 0 && (
              <div className="space-y-3 py-6 text-center text-sm text-muted-foreground">
                <p>
                {needle ? t("没有匹配的条目。", "No matching expressions.") : list.data.expressions.length ? t("这一栏是空的。", "This section is empty.") : t("还没有收下任何表达。", "No expressions saved yet.")}
                </p>
                {!needle && layer === "active" && chooseSaved && <Button variant="outline" onClick={chooseSaved}>{t("从见过选一条", "Choose an expression from Seen")}</Button>}
                {!all.length && <Button variant="outline" onClick={startCapture}>{t("收下第一条表达", "Save your first expression")}</Button>}
                {needle && <Button variant="outline" onClick={() => setQuery("")}>{t("清除筛选", "Clear filter")}</Button>}
              </div>
            )}
            <ul className="space-y-2">
              {visible.map((e) => (
                <li key={e.id}>
                  <button type="button" className="block w-full rounded-lg border bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => { setFocusCue(false); setOpenId(e.id); }}>
                    <span className="line-clamp-3 whitespace-pre-line text-sm">
                      <Marked text={titleOf(e)} mark={e.text ? e.focus : null} />
                    </span>
                    {/* What the timeline says of the entry, in words: no level, no due date, nothing to keep score with. */}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {[
                        e.status === "active" && t("想用", "To use"), e.queued && t("排队中", "Queued"), e.graduated && t("已毕业", "Graduated"), e.produced && t("用出过", "Used before"),
                        sourceLabel(e.sourceType), e.sourceTitle, day(e.occurredAt ?? e.createdAt), glossing === e.id && t("补注中", "Annotating"),
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <PaginationControls page={page} total={shown.length} pageSize={PAGE_SIZE} noun={t("条", "expressions")} label={t("表达分页", "Expression pages")} onChange={changePage} />
          </section>
          <ExpressionDetailDialog id={openId} glossing={glossing === openId} draft={draft} focusCue={focusCue} onClose={() => setOpenId(null)} />
        </>
      )}
    </div>
  );
}

export function ExpressionsPage() {
  return (
    <ModuleErrorBoundary>
      <ExpressionsInner />
    </ModuleErrorBoundary>
  );
}
