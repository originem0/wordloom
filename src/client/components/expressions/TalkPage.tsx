import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ModuleErrorBoundary } from "@/client/components/layout/ErrorBoundary";
import { Button } from "@/client/components/ui/button";
import { useIsAdmin } from "@/client/hooks/useAuth";
import { useDropThread, useTalk, useTalkThread, useTalkThreads } from "@/client/hooks/useExpressions";
import { ApiError } from "@/client/lib/api";
import { EXPRESSION_LIMITS, type TalkFailure, type TalkTurn } from "@/shared/expressions";
import { TurnView } from "./TalkTurn";
import { AREA_CLASS, noAuthNote, day, openThread, useOpenThread } from "./shared";
import { errorMessage, useI18n } from "@/client/lib/i18n";

const MUTED = "text-xs text-muted-foreground";

// Why a message got no answer, in the server's own four words for it.
const WHY: Record<TalkFailure["reason"], readonly [string, string]> = {
  "not configured": ["还没有配模型。", "No model is configured yet."],
  timeout: ["对方 45 秒内没有答完。", "The reply did not finish within 45 seconds."],
  busy: ["模型那边正忙，过一会儿再发。", "The model service is busy. Send again later."],
  failed: ["没有答成。", "The reply could not be completed."],
};

// `unsure`: no answer of the server's own came back, so the turn may have been written all the same.
type Failure = { why: readonly [string, string]; error?: Error; setup?: boolean; unsure?: boolean };

function failureOf(e: Error): Failure {
  if (!(e instanceof ApiError) || e.status === 0 || (e.status >= 500 && e.code !== "TALK_FAILED")) return { why: ["没有收到回答：网络断了，或者服务器没应。", "No reply arrived. The network or server may be unavailable."], unsure: true };
  if (e.status === 404) return { why: ["这场对话已经在别处删掉了，再发一次会开一场新的。", "This conversation was deleted elsewhere. Sending again will start a new one."] };
  if (e.code !== "TALK_FAILED") return { why: ["没有发出去：", "Could not send: "], error: e };
  const reason = (e.body as Partial<TalkFailure> | undefined)?.reason ?? "failed";
  return { why: WHY[reason] ?? WHY.failed, setup: reason === "not configured" };
}

// A phone has no Shift+Enter worth the name: there Enter is a new line and the button sends.
const coarse = () => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

/**
 * One conversation: what was said so far, and the box the next message is
 * written in. `onGone` is told when the server no longer has it, so that the
 * list stops offering it.
 */
function Conversation({ thread, onGone }: { thread: number | null; onGone: () => void }) {
  const { t } = useI18n();
  // A new conversation gets its id with its first answer.
  const [id, setId] = useState(thread);
  // What is on screen, held here and nowhere else: the answer to a message
  // shows what a later read does not. Null until an old conversation has been read.
  const [turns, setTurns] = useState<TalkTurn[] | null>(thread == null ? [] : null);
  const [box, setBox] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [touch] = useState(coarse);
  const reading = useTalkThread();
  const talk = useTalk((text) => setDraft((previous) => previous + text));
  const list = useRef<HTMLOListElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // How many answers have come in on this visit.
  const [answered, setAnswered] = useState(0);

  const read = () => {
    if (thread == null) return;
    reading.mutate(thread, {
      onSuccess: (r) => setTurns(r.turns),
      onError: (e) => {
        if (!(e instanceof ApiError && e.status === 404)) return;
        toast.info(t("这场对话已经删掉了", "This conversation has been deleted"));
        onGone();
        openThread(null);
      },
    });
  };
  // Read once, when the conversation is opened. `thread` also changes when a
  // new conversation gets its id, and that is no reason to read it back.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(read, []);

  // To the end when a conversation opens and when a message goes out. When the
  // answer comes, its turn goes to the top of the screen instead: an answer is
  // read from its first line, with the whole screen for it. (jsdom has no scrollIntoView.)
  const loaded = turns !== null;
  useEffect(() => {
    if (loaded) end.current?.scrollIntoView?.({ block: "end" });
  }, [loaded]);
  useEffect(() => {
    if (sent !== null) end.current?.scrollIntoView?.({ block: "end" });
  }, [sent]);
  useEffect(() => {
    if (answered) list.current?.lastElementChild?.scrollIntoView?.({ block: "start" });
  }, [answered]);

  const delivery = useRef<{ said: string; thread?: number; messageId: string } | null>(null);
  const send = () => {
    const said = box.trim();
    if (!said || talk.isPending || !loaded) return;
    setSent(said);
    setDraft("");
    setBox("");
    setFailure(null);
    const thread = id ?? undefined;
    if (!delivery.current || delivery.current.said !== said || delivery.current.thread !== thread) delivery.current = { said, thread, messageId: crypto.randomUUID() };
    talk.mutate(delivery.current, {
      onSuccess: (turn) => {
        delivery.current = null;
        setTurns((earlier) => [...(earlier ?? []), turn]);
        setSent(null);
        setDraft("");
        setAnswered((n) => n + 1);
        if (id != null) return;
        setId(turn.thread);
        // Not a choice of another conversation: this one stays as it is on screen.
        useOpenThread.setState({ thread: turn.thread });
      },
      // Nothing was written: the message goes back into the box, to be sent again as it is.
      onError: (e) => {
        setSent(null);
        setDraft("");
        setBox(said);
        setFailure(failureOf(e));
        // Deleted from somewhere else: what is left here is a conversation not
        // yet begun, and the same message sent again opens it.
        if (!(e instanceof ApiError && e.status === 404)) return;
        setId(null);
        setTurns([]);
        useOpenThread.setState({ thread: null });
        onGone();
      },
    });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An Enter that ends an IME composition belongs to the IME. Safari reports
    // it as not composing any more, and gives it away only by this key code.
    if (e.key !== "Enter" || e.shiftKey || touch || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    send();
  };

  return (
    <>
      <ol ref={list} className="flex-1 space-y-8">
        {!loaded && !reading.error && <li><Loader2 className="mx-auto my-8 size-5 animate-spin text-muted-foreground" /></li>}
        {!loaded && reading.error && (
          <li className="flex items-center gap-2 text-sm text-destructive">
            {t("读取失败：", "Could not load: ")}{errorMessage(reading.error)}
            <Button size="sm" variant="outline" onClick={read}>{t("重试", "Retry")}</Button>
          </li>
        )}
        {loaded && turns.length === 0 && sent === null && (
          <li className="space-y-4 py-8 text-center text-sm text-muted-foreground">
            <p>{t("想到什么说什么：英文、中文、混着说都行，对方只说英文。每句话下面会有可以改的地方、更自然的整句说法、你库里已有的说法，看中的点「收」。", "Talk about whatever is on your mind, in English, Chinese, or both. Your partner replies in English. Corrections, natural alternatives, and expressions from your library appear below each reply; save any you want to keep.")}</p>
            <Button variant="outline" className="min-h-11" onClick={() => {
              setBox(t("我今天临时改变了计划，想聊聊这件事。", "I changed my plans at the last minute today. Can we talk about that?"));
              requestAnimationFrame(() => input.current?.focus());
            }}>{t("填入一个开场例子", "Start with an example")}</Button>
          </li>
        )}
        {turns?.map((turn) => <TurnView key={turn.id} turn={turn} />)}
        {sent !== null && (
          <li className="space-y-3">
            <p className="ml-auto w-fit max-w-[85%] break-words whitespace-pre-line rounded-lg bg-muted px-3 py-2">{sent}</p>
            {draft && <p className="break-words whitespace-pre-line leading-relaxed">{draft}</p>}
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {draft ? t("正在回复并整理批注…", "Replying and preparing coaching…") : t("对方在写…", "Your partner is writing…")}
            </p>
          </li>
        )}
      </ol>
      {/* Above the bottom navigation on a phone. Opaque: the turns scroll by under it. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] space-y-2 bg-background pb-4 pt-2 md:bottom-0">
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {t(...failure.why)}{failure.error && errorMessage(failure.error)}
            {failure.setup && <Link className="underline" to="/providers">{t("去配一个", "Configure a model")}</Link>}
            {/* Only the server's own refusal says that nothing was written. */}
            {failure.unsure ? t(" 这句话还在下面的框里；它也可能已经记下了，离开这一页再回来就能看到。", " Your message is back in the box. It may already be saved; reopen this page to check.") : t(" 这句话没有记下，还在下面的框里。", " Your message was not saved and is back in the box.")}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={input}
            aria-label={t("说点什么", "Say something")}
            className={`${AREA_CLASS} field-sizing-content max-h-60 min-h-[4.5rem] resize-none`}
            placeholder={touch ? t("英文、中文、混着说都行。", "English, Chinese, or both.") : t("英文、中文、混着说都行。Enter 发送，Shift+Enter 换行。", "English, Chinese, or both. Enter to send; Shift+Enter for a new line.")}
            maxLength={EXPRESSION_LIMITS.said}
            value={box}
            readOnly={talk.isPending}
            onChange={(e) => setBox(e.target.value)}
            onKeyDown={onKey}
          />
          <Button disabled={!box.trim() || talk.isPending || !loaded} onClick={send}>{t("发送", "Send")}</Button>
        </div>
        {/* Told, not stopped: it leaves through the provider the user set up themselves. */}
        <p className={MUTED}>{t("每句话会连同表达库的索引（每条的英文和提示句；「想用」里的不带英文）发给你配置的模型。对话存在服务器上，可以整场删掉。", "Each message and your expression index go to your configured model. The index includes expressions and cues; English targets in To use stay hidden. Conversations are stored on the server and can be deleted.")}</p>
      </div>
      <div ref={end} />
    </>
  );
}

/** Forgetting a conversation takes two clicks: there is no getting it back. */
function Drop({ thread }: { thread: number }) {
  const { t } = useI18n();
  const drop = useDropThread();
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>{t("删除", "Delete")}</Button>;
  const forget = () => drop.mutate(thread, { onSuccess: () => openThread(null), onError: (e) => toast.error(t(`没有删掉：${errorMessage(e)}`, `Could not delete: ${errorMessage(e)}`)) });
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${MUTED}`}>
      {t("删掉这场对话？收下的表达和练习记录都留着。", "Delete this conversation? Saved expressions and practice records stay.")}
      <Button size="sm" variant="destructive" disabled={drop.isPending} onClick={forget}>{t("删掉", "Delete conversation")}</Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>{t("取消", "Cancel")}</Button>
    </span>
  );
}

function TalkInner() {
  const { t } = useI18n();
  // The route only brings an admin here; asking again keeps the rule in the
  // page itself: no admin, no request for private data.
  const isAdmin = useIsAdmin();
  const list = useTalkThreads(isAdmin);
  const { thread, visit } = useOpenThread();
  const threads = list.data?.threads;
  // Nothing chosen on this visit: the latest conversation, once the list says
  // which that is; a new one if the list cannot be had.
  const current = thread !== undefined ? thread : threads ? (threads[0]?.thread ?? null) : list.isError ? null : undefined;
  // And held to it from then on: a list that reloads does not change what is open.
  useEffect(() => {
    if (thread === undefined && current !== undefined) useOpenThread.setState({ thread: current });
  }, [thread, current]);
  const refused = list.error instanceof ApiError && list.error.code === "AUTH_NOT_CONFIGURED";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh_-_4rem_-_env(safe-area-inset-bottom))] max-w-3xl flex-col gap-4 px-4 pt-4 md:min-h-dvh md:px-6 md:pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-semibold">{t("对谈", "Conversation")}</h2>
        {threads && threads.length > 0 && (
          <select
            aria-label={t("对话", "Conversation")}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            value={current ?? ""}
            onChange={(e) => openThread(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t("新对话", "New conversation")}</option>
            {/* One that has just begun is not on the list until the list has loaded again. */}
            {current != null && !threads.some((entry) => entry.thread === current) && <option value={current}>{t("这场对话", "This conversation")}</option>}
            {threads.map((entry) => (
              <option key={entry.thread} value={entry.thread}>{day(entry.updatedAt)} · {entry.title}{t(`（${entry.turns}）`, ` (${entry.turns})`)}</option>
            ))}
          </select>
        )}
        {current != null && <Button size="sm" variant="outline" onClick={() => openThread(null)}>{t("新对话", "New conversation")}</Button>}
        {current != null && <Drop key={current} thread={current} />}
      </div>
      {refused && <p className="rounded-md border p-4 text-sm">{noAuthNote()}</p>}
      {list.error && !refused && <p className="text-sm text-destructive">{t("读取失败：", "Could not load: ")}{errorMessage(list.error)}</p>}
      {isAdmin && !refused && current !== undefined && <Conversation key={visit} thread={current} onGone={() => void list.refetch()} />}
    </div>
  );
}

export function TalkPage() {
  return (
    <ModuleErrorBoundary>
      <TalkInner />
    </ModuleErrorBoundary>
  );
}
