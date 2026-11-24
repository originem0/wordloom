// The contract between the expressions API (/api/expressions, admin only) and
// the 表达 page: types, plus the few constants both sides must agree on.
// Everything that travels in these shapes is private data.
//
//   GET    /                 ExpressionListResponse
//   POST   /                 CaptureRequest   → 201 ExpressionDetail | 409 DuplicateResponse
//   GET    /:id              ExpressionDetail
//   PATCH  /:id              ExpressionPatch  → ExpressionDetail
//   POST   /:id/encounters   EncounterRequest → 201 ExpressionDetail
//   POST   /:id/annotate     → ExpressionDetail | 502 { code: "ANNOTATE_FAILED" }

export const EXPRESSION_STATUSES = ["seen", "active", "retired"] as const;
export type ExpressionStatus = (typeof EXPRESSION_STATUSES)[number];

/** The four tags on the capture box. The server alone writes a fifth value,
 *  "find", for an entry kept from an AI suggestion. */
export const SOURCE_TYPES = ["chat", "book", "video", "other"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type EncounterKind = "met" | "looked_up" | "reveal" | "attempt" | "used";
export type IntentBy = "self" | "find" | "paste" | "ai";
/** What the user had seen before an attempt; "masked" marks a hit that was
 *  served with its English withheld, or a reveal outside 试一条. */
export type Cue = "none" | "need" | "scene" | "revealed" | "masked";
export type Outcome = "pass" | "fail";

/** Upper bounds the server enforces and the page mirrors with maxLength. */
export const EXPRESSION_LIMITS = {
  text: 4000,
  focus: 200,
  sourceTitle: 200,
  sourceLocator: 500,
  note: 4000,
  intent: 300,
} as const;

/** One entry as the list shows it. */
export interface ExpressionSummary {
  id: number;
  status: ExpressionStatus;
  /** The server withheld the English: `text` and `focus` are null here, and so
   *  are `note`, `gloss` and every text on the timeline in the detail. Only
   *  entries in the 想用 layer are ever masked. */
  masked: boolean;
  text: string | null;
  focus: string | null;
  intent: string | null;
  intentBy: IntentBy | null;
  /** Where it was first met: the earliest `met` row. */
  sourceType: SourceType | "find" | null;
  sourceTitle: string | null;
  occurredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface EncounterView {
  id: number;
  kind: EncounterKind;
  createdAt: number;
  cue: Cue | null;
  outcome: Outcome | null;
  // Null on every row while the entry is masked.
  text: string | null;
  textBefore: string | null;
  myAttempt: string | null;
  sourceType: SourceType | "find" | null;
  sourceTitle: string | null;
  sourceLocator: string | null;
  occurredAt: number | null;
}

export interface ExpressionDetail extends ExpressionSummary {
  note: string | null;
  gloss: string | null;
  aiIntent: string | null;
  /** The annotate call has run; readable even while the gloss is withheld. */
  annotated: boolean;
  activeSince: number | null;
  /** Oldest first. The earliest `met` row is the scene the entry came from. */
  timeline: EncounterView[];
}

export interface ExpressionListResponse {
  /** Newest first. */
  expressions: ExpressionSummary[];
}

/** Where and when something was met; every field is optional. */
export interface EncounterSource {
  textBefore?: string;
  sourceType?: SourceType;
  sourceTitle?: string;
  sourceLocator?: string;
  /** Milliseconds since the epoch; the server uses now when absent. */
  occurredAt?: number;
}

export interface CaptureRequest extends EncounterSource {
  /** Verbatim, the only required field. */
  text: string;
  focus?: string;
  /** Save as a separate entry although one with the same norm exists. */
  force?: boolean;
}

/** Met again: one more `met` row on an existing entry. */
export interface EncounterRequest extends EncounterSource {
  text: string;
}

/** An absent field is left alone; null clears it. */
export interface ExpressionPatch {
  note?: string | null;
  focus?: string | null;
  intent?: string | null;
  intentBy?: IntentBy;
  status?: ExpressionStatus;
  /** Corrects when the entry was first met (the earliest `met` row). */
  occurredAt?: number;
}

/** 409 from POST /: an entry with the same norm exists. Nothing was saved. */
export interface DuplicateResponse {
  error: string;
  code: "DUPLICATE";
  /** Newest first. */
  existing: Pick<ExpressionSummary, "id" | "masked" | "text" | "intent" | "createdAt">[];
}
