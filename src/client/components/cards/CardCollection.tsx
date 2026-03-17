import { useState, useEffect, useCallback } from "react";
import { Search, Trash2, Loader2 } from "lucide-react";
import { Input } from "@/client/components/ui/input";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { useCards, useDeleteCard } from "@/client/hooks/useCards";
import { WordCard } from "./WordCard";
import type { Card } from "@/shared/types";

const CEFR_LEVELS = ["All", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

export function CardCollection() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cefr, setCefr] = useState<string>("All");
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);

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

  const handleDelete = useCallback(
    (e: React.MouseEvent, cardId: number) => {
      e.stopPropagation();
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
        <div className="flex flex-wrap gap-1.5">
          {CEFR_LEVELS.map((level) => (
            <Badge
              key={level}
              variant={cefr === level ? "default" : "outline"}
              className="cursor-pointer select-none min-h-8 px-3"
              onClick={() => setCefr(level)}
            >
              {level}
            </Badge>
          ))}
        </div>
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
        <div className="flex items-center justify-between pt-2">
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

      {/* Detail dialog */}
      <Dialog
        open={selectedCard !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCard(null);
        }}
      >
        <DialogContent className="max-h-[100dvh] overflow-y-auto max-w-full h-full rounded-none sm:max-h-[85vh] sm:max-w-2xl sm:h-auto sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>{selectedCard?.word}</DialogTitle>
          </DialogHeader>
          {selectedCard && <WordCard card={selectedCard} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
