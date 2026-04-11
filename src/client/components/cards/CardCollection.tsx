import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, Trash2, Loader2, Flame } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/client/components/ui/input";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useCards, useDeleteCard, useMissingDeep } from "@/client/hooks/useCards";
import { apiPost } from "@/client/lib/api";
import { PrototypeWordCard } from "./PrototypeWordCard";
import type { Card } from "@/shared/types";

/** Use fullscreen overlay on mobile + tablet portrait (≤ 768px) */
function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 768,
  );
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return mobile;
}

const CEFR_LEVELS = ["All", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

export function CardCollection() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cefr, setCefr] = useState<string>("All");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const isMobile = useIsMobile();

  // Lock body scroll when mobile overlay is open
  useEffect(() => {
    if (selectedCard && isMobile) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [selectedCard, isMobile]);

  // 300ms debounce for search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, cefr]);

  const [page, setPage] = useState(1);
  const limit = 20;
  const { data, isLoading } = useCards({
    search: debouncedSearch || undefined,
    cefr: cefr === "All" ? undefined : cefr,
    page,
    limit,
  });

  const deleteCard = useDeleteCard();
  const missingDeep = useMissingDeep();
  const [retryingDeep, setRetryingDeep] = useState(false);
  const [retryProgress, setRetryProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 });

  const retryAllDeep = useCallback(async () => {
    const list = missingDeep.data?.cards;
    if (!list?.length) return;
    setRetryingDeep(true);
    setRetryProgress({ done: 0, total: list.length, ok: 0, fail: 0 });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        await apiPost(`/api/cards/${list[i].id}/deep`, {});
        ok++;
      } catch {
        fail++;
      }
      setRetryProgress({ done: i + 1, total: list.length, ok, fail });
    }
    setRetryingDeep(false);
    missingDeep.refetch();
    toast.success(`Deep retry done: ${ok} ok, ${fail} failed`);
  }, [missingDeep]);

  const handleDelete = useCallback(
    (e: React.MouseEvent, cardId: number) => {
      e.stopPropagation();
      if (!window.confirm("确定删除这张词卡吗？")) return;
      deleteCard.mutate(cardId, {
        onSuccess: () => {
          if (selectedCard?.id === cardId) setSelectedCard(null);
        },
      });
    },
    [deleteCard, selectedCard],
  );

  const cards = data?.cards ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-4">
      {/* Search + CEFR filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search cards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {CEFR_LEVELS.map((level) => (
            <Badge
              key={level}
              variant={cefr === level ? "default" : "outline"}
              className="cursor-pointer select-none min-h-8 px-3 shrink-0"
              onClick={() => setCefr(level)}
            >
              {level}
            </Badge>
          ))}
        </div>

        {/* Batch retry deep */}
        {(missingDeep.data?.total ?? 0) > 0 && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={retryAllDeep}
              disabled={retryingDeep}
              className="shrink-0"
            >
              {retryingDeep ? <Loader2 className="size-3.5 animate-spin" /> : <Flame className="size-3.5" />}
              {retryingDeep
                ? `Deep ${retryProgress.done}/${retryProgress.total}`
                : `Retry Deep (${missingDeep.data?.total})`}
            </Button>
            {retryingDeep && retryProgress.fail > 0 && (
              <span className="text-[11px] text-red-500">{retryProgress.fail} failed</span>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && cards.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No cards yet. Generate some from the input above!
        </p>
      )}

      {/* Card grid */}
      {cards.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.id}
              className="group cursor-pointer rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              onClick={() => setSelectedCard(card)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{card.word}</span>
                    {card.cefr && (
                      <Badge variant="outline" className="text-[10px]">
                        {card.cefr}
                      </Badge>
                    )}
                  </div>
                  {card.coreMeaning && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {card.coreMeaning.slice(0, 40)}
                      {card.coreMeaning.length > 40 ? "..." : ""}
                    </p>
                  )}
                  {card.usageCount > 0 && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Used {card.usageCount}x
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 min-h-8 min-w-8 opacity-100 sm:opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  disabled={deleteCard.isPending}
                  onClick={(e) => handleDelete(e, card.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || isLoading}
          >
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            第 {page} / {totalPages} 页 · 共 {total} 条
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={isLoading || page >= totalPages}
          >
            下一页
          </Button>
        </div>
      )}

      {/* Detail view — mobile: native fullscreen overlay; desktop: Dialog */}
      {selectedCard && isMobile &&
        createPortal(
          <div
            className="fixed inset-0 z-50 overflow-y-auto bg-[var(--bg,#f4f1eb)]"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <PrototypeWordCard
              card={selectedCard}
              onClose={() => setSelectedCard(null)}
            />
          </div>,
          document.body,
        )}

      {!isMobile && (
        <Dialog
          open={selectedCard !== null}
          onOpenChange={(open) => {
            if (!open) setSelectedCard(null);
          }}
        >
          <DialogContent
            className="max-h-[85vh] overflow-y-auto h-auto rounded-lg p-0 border-0 bg-transparent shadow-lg w-[min(900px,calc(100vw-4rem))] max-w-none xl:w-[960px]"
            showCloseButton={false}
          >
            <DialogTitle className="sr-only">{selectedCard?.word}</DialogTitle>
            {selectedCard && (
              <PrototypeWordCard
                card={selectedCard}
                onClose={() => setSelectedCard(null)}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
