// The contract between the expressions API (/api/expressions, admin only) and
// the 表达 page: types, plus the few constants both sides must agree on.
// Everything that travels in these shapes is private data.
//
//   GET    /                                ExpressionListResponse
//   POST   /                                CaptureRequest   → 201 ExpressionDetail | 409 DuplicateResponse
//   GET    /:id                             ExpressionDetail
//   PATCH  /:id                             ExpressionPatch  → ExpressionDetail | 400 { code: "INTENT_REQUIRED" }
//   POST   /:id/encounters                  EncounterRequest → 201 ExpressionDetail
//   POST   /:id/annotate                    → ExpressionDetail | 502 { code: "ANNOTATE_FAILED" }
//   POST   /:id/reveal                      RevealRequest    → ExpressionDetail, unmasked this once
//   GET    /:id/scene                       SceneResponse | 404
//   POST   /:id/attempts                    AttemptRequest   → 201 AttemptResponse | 409 { code: "NOT_ACTIVE" }
//   POST   /attempts/:encounterId/judge     → AttemptResponse
//   POST   /attempts/:encounterId/overturn  OverturnRequest  → AttemptResponse
//   GET    /try?exclude=1,2                 TryResponse
//   POST   /find                            FindRequest      → FindResponse | 502 { code: "FIND_FAILED" }
//   POST   /pick                            PickRequest      → PickResponse | 502 { code: "PICK_FAILED" }
//   GET    /stats                           StatsResponse

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
  // As long as a need: in 找 the need of the turn becomes the intent.
  intent: 1000,
  need: 1000,
  attempt: 2000,
  paste: 10000,
} as const;

/** A 找 thread sends its opening turn plus the latest five. */
export const FIND_HISTORY_TURNS = 6;
/** Settings key ("1" = on): show 帮我起草 whatever the automatic rule says. */
export const DRAFT_SETTING_KEY = "expressions_draft";

/** One entry as the list shows it. */
export interface ExpressionSummary {
  id: number;
  status: ExpressionStatus;
  /** The server withheld the English: `text` and `focus` are null here, and in
   *  the detail so are `note`, `gloss`, `aiIntent` and everything on the
   *  timeline but each row's kind, time, cue and outcome. True for entries in
   *  the 想用 layer that have not graduated. */
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
  /** 用出过: at least one pass that counted, which takes a day or more since
   *  the answer was last on screen and no hint beyond the intent. */
  produced: boolean;
  /** Five such passes: no longer asked, no longer masked. */
  graduated: boolean;
  /** In 想用 but over its cap of twelve: not asked until an earlier entry
   *  moves up or leaves. */
  queued: boolean;
}

export interface Rewrite {
  from: string;
  to: string;
  why: string;
}

/** What an `attempt` row keeps besides the sentence itself. */
export interface AttemptFeedback {
  /** The question as it was shown. */
  prompt: string;
  status: "pending" | "done" | "failed";
  used?: boolean;
  conveyed?: boolean;
  rewrites?: Rewrite[];
  /** When the judgement that stands was made: the model's, or the user's when
   *  they overturned it. */
  judgedAt?: number;
  /** The outcome that stands is not the model's. */
  overturned?: boolean;
  /** What the model had said; set the first time the user overturns it. */
  modelOutcome?: Outcome;
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
  /** Attempt rows only. */
  feedback: AttemptFeedback | null;
}

export interface ExpressionDetail extends ExpressionSummary {
  note: string | null;
  gloss: string | null;
  aiIntent: string | null;
  /** The annotate call has run; readable even while the gloss is withheld. */
  annotated: boolean;
  activeSince: number | null;
  /** Oldest first. The earliest `met` row is the scene the entry came from:
   *  for an entry kept from 找, its `textBefore` is the need of that turn and
   *  its `myAttempt` the English the user had tried. */
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
  /** Kept from an AI suggestion in 找: the need and the attempt of that turn
   *  become the scene, and the server sets the source to "find". */
  found?: { need: string; attempt?: string };
}

/** Met again: one more `met` row on an existing entry. */
export interface EncounterRequest extends EncounterSource {
  text: string;
}

/** An absent field is left alone; null clears it. An entry in 想用 always has
 *  an intent: moving to "active" without one, here or already saved, is
 *  refused, and so is clearing it there. A change of layer is not an event
 *  and writes nothing to the timeline. */
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

// --- 揭晓 ---

/** "masked": revealed from 找, the list or the detail. Anything else is the
 *  hint level at which the user gave up inside 试一条. Revealing an entry that
 *  is not masked writes nothing. */
export interface RevealRequest {
  cue: "masked" | "none" | "need" | "scene";
}

// --- 试一条 ---

export interface TryItem {
  id: number;
  /** The question: a stored fresh scene when there is one, else the intent. */
  prompt: string;
  /** Where this question starts on the hint ladder. */
  cue: "none" | "need";
  /** First hint. Not to be shown while the level is "none". */
  intent: string;
  /** Whether GET /:id/scene can serve the second hint. */
  hasScene: boolean;
}

export interface TryResponse {
  /** At most three, longest overdue first. */
  items: TryItem[];
}

/** The earliest `met` row with the focus blanked out. */
export interface SceneResponse {
  scene: string;
  before: string | null;
}

export interface AttemptRequest {
  text: string;
  /** The highest hint level seen before answering. */
  cue: "none" | "need" | "scene" | "revealed";
  /** The question as it was shown. */
  prompt: string;
}

/** 用上了 / 绕开但说通了 / 没说通 */
export type Verdict = "used" | "conveyed" | "missed";

export interface AttemptResponse {
  encounterId: number;
  /** "failed": the judgement did not come back. The sentence is saved, nothing
   *  is counted, and POST /attempts/:encounterId/judge retries on the same row. */
  status: "done" | "failed";
  /** The model's reading, in the three wordings the page uses. */
  verdict: Verdict | null;
  /** What counts. Differs from the verdict once the user has overturned it. */
  outcome: Outcome | null;
  overturned: boolean;
  /** At most two. Empty whenever `answer` is withheld: a rewrite gives it away. */
  rewrites: Rewrite[];
  /** The English. Withheld after a miss that had only the fresh scene, and
   *  while there is no judgement. */
  answer: { text: string; focus: string | null; gloss: string | null } | null;
  /** Set instead of `answer` after such a miss: try again with this hint. */
  intent: string | null;
}

export interface OverturnRequest {
  outcome: Outcome;
}

// --- 找 ---

/** One earlier turn of the thread, as the page remembers it. */
export interface FindTurn {
  need: string;
  attempt?: string;
  mine: number[];
  fix: string | null;
  fresh: string[];
}

export interface FindRequest {
  need: string;
  /** The user's own English for it, if any. */
  attempt?: string;
  /** Oldest first, at most FIND_HISTORY_TURNS. The server keeps no session. */
  history: FindTurn[];
  /** 1 for the opening turn. */
  turn: number;
  /** Timestamp of the opening turn; identifies the thread. */
  thread: number;
}

export interface Suggestion {
  text: string;
  why: string;
}

export interface FindHit {
  /** As this answer shows it: a hit in 想用 is masked only when the question
   *  came without an attempt. */
  expression: ExpressionSummary;
  /** Withheld while the hit is masked: it tends to give the answer away. */
  why: string | null;
}

export interface FindResponse {
  /** The need was a single English word that has a card: no model was asked. */
  card: { id: number; word: string } | null;
  mine: FindHit[];
  /** Only when an attempt was sent: the smallest change that makes it work. */
  fix: Suggestion | null;
  /** At most two. The page holds them back while a masked hit is unresolved. */
  fresh: Suggestion[];
  /** How many entries fitted into the index this time, out of how many. */
  searched: number;
  total: number;
}

// --- 帮我挑 ---

export interface PickRequest {
  /** The pasted conversation. */
  text: string;
}

export interface PickResponse {
  /** At most three; every `text` is a verbatim substring of the input. */
  picks: { text: string; before: string | null; why: string }[];
}

// --- 首页的数 ---

export interface StatsResponse {
  /** Entries with at least one pass that counted. */
  produced: number;
  /** Days (UTC+8) with a write from this page while something was due. */
  testableDays: number;
  /** Of those, days with an attempt. */
  attemptDays: number;
  /** When the first entry was saved, and four weeks after that. */
  since: number | null;
  judgeAt: number | null;
}
