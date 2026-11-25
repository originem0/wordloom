import { create } from "zustand";

export type ExpressionLayer = "all" | "active" | "seen" | "retired";
type ReadingPage = "cards" | "expressions";
const cardsInitial = { input: "", cefr: "All", paging: { filterKey: '["","All"]', page: 1 } };
const expressionsInitial = { query: "", layer: "all" as ExpressionLayer, page: 1 };
const positions = new Map<ReadingPage, number>();
let generation = 0;

// Reading state outlives a route, but never leaves this browser session. In
// particular, expression searches must not enter URLs or persistent storage.
interface ReadingStore {
  cards: typeof cardsInitial;
  expressions: typeof expressionsInitial;
  setCardInput: (input: string) => void;
  setCardCefr: (cefr: string) => void;
  setCardPage: (filterKey: string, page: number) => void;
  clearCardFilters: () => void;
  setExpressionQuery: (query: string) => void;
  setExpressionLayer: (layer: ExpressionLayer) => void;
  setExpressionPage: (page: number) => void;
  reset: () => void;
}

export const useReadingStore = create<ReadingStore>((set) => ({
  cards: cardsInitial,
  expressions: expressionsInitial,
  setCardInput: (input) => set((s) => ({ cards: { ...s.cards, input } })),
  setCardCefr: (cefr) => set((s) => ({ cards: { ...s.cards, cefr } })),
  setCardPage: (filterKey, page) => set((s) => ({ cards: { ...s.cards, paging: { filterKey, page } } })),
  clearCardFilters: () => set({ cards: cardsInitial }),
  setExpressionQuery: (query) => set((s) => ({ expressions: { ...s.expressions, query, page: 1 } })),
  setExpressionLayer: (layer) => set((s) => ({ expressions: { ...s.expressions, layer, page: 1 } })),
  setExpressionPage: (page) => set((s) => ({ expressions: { ...s.expressions, page } })),
  reset: () => {
    generation++;
    positions.clear();
    set({ cards: cardsInitial, expressions: expressionsInitial });
  },
}));

export const readingPosition = (page: ReadingPage) => positions.get(page) ?? 0;
export const rememberReadingPosition = (page: ReadingPage, top: number) => positions.set(page, top);
export const readingGeneration = () => generation;
