import { Button } from "./button";
import { useI18n } from "@/client/lib/i18n";

export function PaginationControls({ page, total, pageSize, noun, label, busy = false, onChange }: {
  page: number;
  total: number;
  pageSize: number;
  noun: string;
  label: string;
  busy?: boolean;
  onChange: (page: number) => void;
}) {
  const { t } = useI18n();
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const count = t(`第 ${page} / ${pages} 页 · 共 ${total} 条`, `Page ${page} of ${pages} · ${total} ${noun}`);
  if (pages === 1) return <p className="text-sm text-muted-foreground" role="status">{count}</p>;

  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-2 pt-2">
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={page === 1 || busy} onClick={() => onChange(page - 1)}>
        {t("上一页", "Previous")}
      </Button>
      <span className="text-sm text-muted-foreground" role="status" aria-live="polite">{count}</span>
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={page >= pages || busy} onClick={() => onChange(page + 1)}>
        {t("下一页", "Next")}
      </Button>
    </nav>
  );
}
