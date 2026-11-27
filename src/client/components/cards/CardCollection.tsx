import { useEffect, useState, useRef, useCallback, memo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Trash2, Loader2, Flame } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useCards, useCard, useDeleteCard, useMissingDeep } from "@/client/hooks/useCards";
import { useReadingPosition } from "@/client/hooks/useReadingPosition";
import { useReadingStore, rememberReadingPosition } from "@/client/store/reading";
import { PaginationControls } from "@/client/components/ui/pagination-controls";
import { useIsAdmin } from "@/client/hooks/useAuth";
import { apiPost } from "@/client/lib/api";
import { errorMessage, useI18n } from "@/client/lib/i18n";
import { queryClient } from "@/client/lib/query-client";
import { PrototypeWordCard } from "./PrototypeWordCard";
import type { Card, CardSummary } from "@/shared/types";
import { AdminOnly } from "@/client/components/auth/AdminOnly";

const CEFR_LEVELS = ["All", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

interface CardCollectionProps {
  /** External search query — owned by WordForgePage so the unified input drives both
   *  the generation CTA (WordInput) and this filtered grid. */
  searchInput: string;
}

export function CardCollection({ searchInput }: CardCollectionProps) {
  const { t } = useI18n();
  const cefr = useReadingStore((s) => s.cards.cefr);
  const setCefr = useReadingStore((s) => s.setCardCefr);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [lastCard, setLastCard] = useState<CardSummary | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const listStart = useRef<HTMLDivElement>(null);
  const candidate = Number(searchParams.get("card"));
  const selectedId = Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;

  const limit = 20;

  // A page number only means something for the search/filter it was reached
  // under, so it is stored together with that combination and read back as 1
  // whenever the combination differs. Resetting it from an effect instead ran
  // one render late: every filter change first fetched the old page number
  // under the new filter, then fetched page 1.
  const filterKey = JSON.stringify([searchInput, cefr]);
  const paging = useReadingStore((s) => s.cards.paging);
  const savePage = useReadingStore((s) => s.setCardPage);
  const page = paging.filterKey === filterKey ? paging.page : 1;
  const changePage = (next: number) => {
    savePage(filterKey, next);
    listStart.current?.scrollIntoView?.({ block: "start" });
  };

  const { data, isLoading, isPlaceholderData, isError, error, refetch } = useCards({
    search: searchInput || undefined,
    cefr: cefr === "All" ? undefined : cefr,
    page,
    limit,
  });
  const lastPage = Math.max(1, Math.ceil((data?.total ?? 0) / limit));
  useEffect(() => { if (data && !isPlaceholderData && page > lastPage) savePage(filterKey, lastPage); }, [data, isPlaceholderData, page, lastPage, filterKey, savePage]);
  const changing = isLoading || isPlaceholderData;
  useReadingPosition("cards", !!data && !changing);
  const knownCard = data?.cards.find((card) => card.id === selectedId)
    ?? (lastCard?.id === selectedId ? lastCard : undefined);
  const legacyCard = knownCard && "familyComparison" in knownCard ? knownCard as Card : undefined;
  const detail = useCard(selectedId, legacyCard);
  const dialogCard = detail.data ?? legacyCard;

  const openCard = useCallback((card: CardSummary, button: HTMLButtonElement) => {
    opener.current = button;
    setLastCard(card);
    rememberReadingPosition("cards", window.scrollY);
    const next = new URLSearchParams(searchParams);
    next.set("card", String(card.id));
    // One history entry for the detail: Back closes it before leaving the library.
    setSearchParams(next, { state: { ...location.state, wordCard: true } });
  }, [searchParams, setSearchParams, location.state]);

  const closeCard = useCallback(() => {
    if (location.state?.wordCard) {
      navigate(-1);
    } else {
      const next = new URLSearchParams(searchParams);
      next.delete("card");
      setSearchParams(next, { replace: true });
    }
  }, [navigate, location.state, searchParams, setSearchParams]);

  const deleteCard = useDeleteCard();
  const { mutate: deleteCardMutate, isPending: deletePending } = deleteCard;
  const isAdmin = useIsAdmin();
  const missingDeep = useMissingDeep(isAdmin);
  const batch = missingDeep.data?.batch;
  const [starting, setStarting] = useState(false);
  const retryingDeep = starting || batch?.status === "queued" || batch?.status === "running";
  const retryProgress = batch?.progress ?? { done: 0, total: missingDeep.data?.total ?? 0, fail: 0 };
  const retryAllDeep = async () => {
    setStarting(true);
    try {
      await apiPost("/api/cards/deep-batch", {});
      await queryClient.invalidateQueries({ queryKey: ["cards", "missing-deep"] });
    } catch (err) { toast.error(errorMessage(err)); }
    finally { setStarting(false); }
  };
  useEffect(() => {
    if (batch?.status === "done") void queryClient.invalidateQueries({ queryKey: ["cards", "detail"] });
  }, [batch?.id, batch?.status]);

  // Only a deletion of the currently open card closes its detail.
  const handleDelete = useCallback(
    (e: React.MouseEvent, cardId: number) => {
      e.stopPropagation();
      if (!window.confirm(t("确定删除这张词卡吗？", "Delete this card?"))) return;
      deleteCardMutate(cardId, {
        onSuccess: () => {
          setLastCard((curr) => (curr?.id === cardId ? null : curr));
          if (selectedId === cardId) closeCard();
        },
        onError: (error) => toast.error(`${t("删除失败：", "Could not delete card: ")}${errorMessage(error)}`),
      });
    },
    [deleteCardMutate, selectedId, closeCard, t],
  );

  const cards = data?.cards ?? [];
  const total = data?.total ?? 0;
  return (
    <div ref={listStart} tabIndex={-1} className="space-y-4 outline-none scroll-mt-4" role="region" aria-label={t("词卡列表", "Card library")}>
      {/* CEFR filter + batch deep retry */}
      <div className="space-y-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={t("级别筛选", "Filter by level")}>
          {CEFR_LEVELS.map((level) => (
            <Button
              key={level}
              variant={cefr === level ? "default" : "outline"}
              size="sm"
              className="min-h-11 px-3 shrink-0"
              aria-pressed={cefr === level}
              onClick={() => setCefr(level)}
            >
              {level === "All" ? t("全部", "All") : level}
            </Button>
          ))}
        </div>

        {/* Batch retry deep. isAdmin is checked as well as the data: a count
            cached before sign-out is still in memory after it. */}
        {isAdmin && (retryingDeep || (missingDeep.data?.total ?? 0) > 0) && (
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
                ? t(`深度分析 ${retryProgress.done}/${retryProgress.total}`, `Deep ${retryProgress.done}/${retryProgress.total}`)
                : t(`补全深度分析 (${missingDeep.data?.total})`, `Retry Deep (${missingDeep.data?.total})`)}
            </Button>
            {retryingDeep && retryProgress.fail > 0 && (
              <span className="text-[11px] text-red-500">{t(`${retryProgress.fail} 失败`, `${retryProgress.fail} failed`)}</span>
            )}
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div role="status" aria-label={t("加载词卡中", "Loading cards")} className="flex justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {isPlaceholderData && <p role="status" className="text-sm text-muted-foreground">{t("正在更新词卡…", "Updating cards…")}</p>}

      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
          <span>{t("词卡加载失败：", "Could not load cards: ")}{errorMessage(error)}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>{t("重试", "Retry")}</Button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && cards.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {searchInput || cefr !== "All" ? t("没有匹配的词卡。", "No matching cards.") : t("词库里还没有词卡。", "No cards in the library yet.")}
        </p>
      )}

      {/* Card grid */}
      {cards.length > 0 && (
        <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3${isPlaceholderData ? " opacity-50" : ""}`} aria-busy={changing}>
          {cards.map((card) => (
            <CardListItem
              key={card.id}
              card={card}
              onSelect={openCard}
              disabled={changing}
              onDelete={handleDelete}
              deletePending={deletePending}
            />
          ))}
        </div>
      )}

      <PaginationControls page={page} total={total} pageSize={limit} noun={t("条", "cards")} label={t("词卡分页", "Card pages")} busy={changing} onChange={changePage} />

      {/* Radix owns focus and scroll locking on phones as well as on desktop. */}
      <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open) closeCard(); }}>
        <DialogContent className="word-dialog" showCloseButton={!dialogCard} aria-describedby={undefined} onCloseAutoFocus={(event) => {
          event.preventDefault();
          (opener.current?.isConnected ? opener.current : listStart.current)?.focus({ preventScroll: true });
        }}>
          <DialogTitle className="sr-only">{dialogCard?.word ?? t("词卡详情", "Word card")}</DialogTitle>
          {dialogCard ? <PrototypeWordCard card={dialogCard} onClose={closeCard} /> : detail.error ? (
            <div className="space-y-3 p-6" role="alert">
              <p>{t("词卡读取失败：", "Could not load card: ")}{errorMessage(detail.error)}</p>
              <Button variant="outline" onClick={closeCard}>{t("返回词库", "Return to library")}</Button>
            </div>
          ) : <div className="flex justify-center p-12" role="status"><Loader2 className="size-5 animate-spin" /></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The open button and the admin's delete button are siblings: no nested
// buttons, and a keyboard reader can open a card without visiting Delete.
interface CardListItemProps {
  card: CardSummary;
  onSelect: (card: CardSummary, button: HTMLButtonElement) => void;
  onDelete: (e: React.MouseEvent, cardId: number) => void;
  deletePending: boolean;
  disabled: boolean;
}

const CardListItem = memo(function CardListItem({
  card,
  onSelect,
  onDelete,
  deletePending,
  disabled,
}: CardListItemProps) {
  const { t } = useI18n();
  return (
    <article className="group relative rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button type="button" disabled={disabled} aria-label={t(`打开词卡 ${card.word}`, `Open card ${card.word}`)} className="block w-full rounded-lg p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait" onClick={(e) => onSelect(card, e.currentTarget)}>
        <div className="min-w-0 pr-10">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="break-words font-semibold">{card.word}</span>
            {card.cefr && (
              <Badge variant="outline" className="text-[10px]">
                {card.cefr}
              </Badge>
            )}
          </div>
          {card.coreMeaning && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {card.coreMeaning.slice(0, 40)}
              {card.coreMeaning.length > 40 ? "..." : ""}
            </p>
          )}
        </div>
      </button>
        <AdminOnly>
          <Button
            variant="ghost"
            size="icon-xs"
            className="absolute right-2 top-2 min-h-11 min-w-11 opacity-100 sm:opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 text-muted-foreground hover:text-destructive"
            disabled={deletePending}
            aria-label={t(`删除 ${card.word}`, `Delete ${card.word}`)}
            onClick={(e) => onDelete(e, card.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </AdminOnly>
    </article>
  );
});
