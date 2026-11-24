import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { useIsAdmin } from "@/client/hooks/useAuth";
import { useExpressions, useGlossWatch } from "@/client/hooks/useExpressions";
import { useSettings } from "@/client/hooks/useSettings";
import { ApiError } from "@/client/lib/api";
import { DRAFT_SETTING_KEY } from "@/shared/expressions";
import { CaptureBox } from "./CaptureBox";
import { ExpressionDetailDialog, Marked } from "./ExpressionDetail";
import { StatsLine } from "./StatsLine";
import { TryPanel } from "./TryPanel";
import { SOURCE_LABELS, day, titleOf } from "./shared";

// 全部 leaves out only what was put away, and comes first: an entry just saved
// or just moved to the other layer is then still on top of what is shown.
const LAYERS = [["all", "全部"], ["active", "想用"], ["seen", "见过"], ["retired", "已收起"]] as const;

function ExpressionsInner() {
  // The route only brings an admin here; asking again keeps the rule in the
  // page itself: no admin, no request for private data.
  const isAdmin = useIsAdmin();
  const list = useExpressions(isAdmin);
  const [glossing, watchGloss] = useGlossWatch();
  const [query, setQuery] = useState("");
  const [layer, setLayer] = useState<(typeof LAYERS)[number][0]>("all");
  const [openId, setOpenId] = useState<number | null>(null);
  const all = list.data?.expressions ?? [];

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
  const shown = all.filter(
    (e) =>
      (layer === "all" ? e.status !== "retired" : e.status === layer) &&
      (!needle || [e.text, e.focus, e.intent, e.sourceTitle].some((field) => field?.toLowerCase().includes(needle))),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:space-y-8 md:p-6">
      <section className="space-y-1">
        <h2 className="text-2xl font-semibold">表达</h2>
        <p className="text-sm text-muted-foreground">遇到想留下的说法就收下，原文逐字保存。收下之后，原文会发给你配置的模型补一条注。</p>
        {/* This and 试一条 ask the server on their own. They wait for the list, which only an admin is given. */}
        {list.data && <StatsLine />}
      </section>
      {/* Without AUTH_TOKEN the app treats everyone as the admin, and the server refuses to serve private data. */}
      {list.error instanceof ApiError && list.error.code === "AUTH_NOT_CONFIGURED" ? (
        <p className="rounded-md border p-4 text-sm">表达库是私人数据，服务器没有设置 AUTH_TOKEN 时不提供：请设置 AUTH_TOKEN、重启服务，然后登录。</p>
      ) : (
        <>
          <CaptureBox onSaved={watchGloss} />
          {list.data && <TryPanel />}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input aria-label="筛选" className="max-w-xs flex-1" placeholder="筛选：原文、焦点、意思、出处" value={query} onChange={(e) => setQuery(e.target.value)} />
              {LAYERS.map(([value, label]) => (
                <Button key={value} size="sm" variant={layer === value ? "default" : "outline"} aria-pressed={layer === value} onClick={() => setLayer(value)}>{label}</Button>
              ))}
            </div>
            {list.isLoading && <Loader2 className="mx-auto my-8 size-5 animate-spin text-muted-foreground" />}
            {list.error && <p className="text-sm text-destructive">读取失败：{list.error.message}</p>}
            {list.data && shown.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {needle ? "没有匹配的条目。" : list.data.expressions.length ? "这一栏是空的。" : "还没有收下任何表达。"}
              </p>
            )}
            <ul className="space-y-2">
              {shown.map((e) => (
                <li key={e.id}>
                  <button type="button" className="block w-full rounded-lg border bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => setOpenId(e.id)}>
                    <span className="line-clamp-3 whitespace-pre-line text-sm">
                      <Marked text={titleOf(e)} mark={e.text ? e.focus : null} />
                    </span>
                    {/* What the timeline says of the entry, in words: no level, no due date, nothing to keep score with. */}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {[
                        e.status === "active" && "想用", e.queued && "排队中", e.graduated && "已毕业", e.produced && "用出过",
                        e.sourceType ? SOURCE_LABELS[e.sourceType] : "未记录", e.sourceTitle, day(e.occurredAt ?? e.createdAt), glossing === e.id && "补注中",
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <ExpressionDetailDialog id={openId} glossing={glossing === openId} draft={draft} onClose={() => setOpenId(null)} />
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
