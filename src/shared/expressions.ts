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
//   GET    /:id/scene                       SceneResponse | 404 { code: "NO_SCENE" }
//   POST   /:id/attempts                    AttemptRequest   → 201 AttemptResponse | 409 { code: "NOT_ACTIVE" }
//   POST   /attempts/:encounterId/judge     → AttemptResponse
//   POST   /attempts/:encounterId/overturn  OverturnRequest  → AttemptResponse | 409 { code: "NOT_JUDGED" }
//   GET    /try?exclude=1,2                 TryResponse
//   POST   /talk                            TalkRequest      → 201 TalkTurn | 502 { code: "TALK_FAILED", reason }
//   GET    /talk                            TalkListResponse
//   GET    /talk/:thread                    TalkThreadResponse
//   DELETE /talk/:thread                    → 204
//   POST   /pick                            PickRequest      → PickResponse | 502 { code: "PICK_FAILED" }
//   GET    /stats                           StatsResponse

export const EXPRESSION_STATUSES = ["seen", "active", "retired"] as const;
export type ExpressionStatus = (typeof EXPRESSION_STATUSES)[number];

/** The four tags on the capture box. The server alone writes a fifth value,
 *  "find", for an entry kept from what the partner wrote in 对谈. */
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
  // A message in 对谈 can become an entry's intent: it is cut to this then.
  intent: 1000,
  // One message to the partner. Also the longest question an attempt answers:
  // a masked hit is tried against the message that found it.
  said: 4000,
  attempt: 2000,
  paste: 10000,
} as const;

/** What the partner is told of a conversation: its opening turn plus the latest eleven. */
export const TALK_HISTORY_TURNS = 12;
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
  /** On `met` rows: when it was met, which the user can set. A time, so it stays on a masked row. */
  occurredAt: number | null;
  cue: Cue | null;
  outcome: Outcome | null;
  // Null on every row while the entry is masked.
  text: string | null;
  textBefore: string | null;
  myAttempt: string | null;
  sourceType: SourceType | "find" | null;
  sourceTitle: string | null;
  sourceLocator: string | null;
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
   *  for an entry kept from 对谈, its `textBefore` is the message of that turn
   *  and its `myAttempt` the words of it that were put right. */
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
  /** Kept from something the partner wrote in 对谈: the message of that turn
   *  becomes the scene (and `attempt` the words of it that were put right),
   *  and the server sets the source to "find". */
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

/** "masked": revealed from 对谈, the list or the detail. Anything else is the
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

// --- 对谈 ---

/** One message to the partner. Without `thread` it opens a new conversation. */
export interface TalkRequest {
  said: string;
  /** The conversation it continues: the `thread` of its turns. */
  thread?: number;
}

export interface Suggestion {
  /** A fix: the whole message as it would be said. Something worth keeping:
   *  the sentence of the turn it stands in. */
  text: string;
  why: string;
  /** The expression itself, when it is only part of `text`. */
  focus?: string;
}

export interface TalkHit {
  /** As this answer shows it: a hit in 想用 keeps its English back unless the
   *  message it answers was written in English. */
  expression: ExpressionSummary;
  /** Withheld while the hit is masked: it tends to give the answer away. */
  why: string | null;
}

/**
 * One turn of a conversation: the message, the partner's reply, and what came
 * with it. Wherever a string says the target of an entry whose English this
 * answer holds back, those words are "____": in the reply, in every note, and
 * when a conversation is read again later in the user's own message too.
 */
export interface TalkTurn {
  id: number;
  /** When the conversation was opened; identifies it. */
  thread: number;
  createdAt: number;
  said: string;
  reply: string;
  /** How an articulate speaker would have put `said`. Null when it needs no change. */
  fix: Suggestion | null;
  /** At most three; every `from` stands in `said` word for word. */
  rewrites: Rewrite[];
  /** At most two expressions worth keeping, each inside a sentence the reply or the fix really has. */
  fresh: Suggestion[];
  /** What the library has for what was said. */
  mine: TalkHit[];
  /** How many entries fitted into the index this time, out of how many. */
  searched: number;
  total: number;
  /** The reply is kept even when its separate coaching call did not finish. */
  coachingFailure?: TalkFailure["reason"];
  /** An occasional scene the server chose from expressions due for recall. */
  review?: { id: number; scene: string };
  /** The previous scene answered by this turn, using the usual attempt rules. */
  reviewResult?: AttemptResponse;
}

export interface TalkThread {
  thread: number;
  /** The start of its opening message. */
  title: string;
  turns: number;
  updatedAt: number;
}

export interface TalkListResponse {
  /** Latest first. */
  threads: TalkThread[];
}

export interface TalkThreadResponse {
  /** Oldest first, each as the library stands now: a hit is masked or not by
   *  what it is today. */
  turns: TalkTurn[];
}

/** 502 from POST /talk: the model gave no usable answer and nothing was written. */
export interface TalkFailure {
  error: string;
  code: "TALK_FAILED";
  reason: "not configured" | "timeout" | "busy" | "failed";
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
