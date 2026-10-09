import { useCallback, useEffect, useRef, useState } from "react";
import { MessagesSquare, Sparkles } from "lucide-react";
import { formatQuotaReset, isQuotaExhausted, type KiaraQuota } from "@jewelos/core";
import {
  KIARA_CONVERSATION_QUESTION_LIMIT,
  KIARA_QUESTION_MAX_LENGTH,
  archiveMyKiaraConversation,
  askKiara,
  getMyKiaraConversation,
  getMyKiaraQuota,
  listMyKiaraConversations,
  type KiaraConversation,
  type KiaraConversationSummary,
} from "@jewelos/data/assistant/api";
import { useAuth } from "@/auth/AuthContext";
import { Notice } from "@/components/ui";
import { ChatView, type ChatBubble } from "@/features/assistant/ChatView";
import { ConversationList } from "@/features/assistant/ConversationList";
import { QuotaChip } from "@/features/assistant/QuotaChip";

/** Display bubbles for a stored conversation. A question without an answer says why. */
export function bubblesFor(conversation: KiaraConversation): ChatBubble[] {
  const answered = new Set(conversation.messages.flatMap((message) => message.reply_to_message_id ? [message.reply_to_message_id] : []));
  return conversation.messages.flatMap((message): ChatBubble[] => {
    if (message.role === "user") {
      const bubble: ChatBubble = { id: message.id, role: "user", text: message.display_text };
      if (answered.has(message.id)) return [bubble];
      return [bubble, { id: `${message.id}:missing`, role: "assistant", text: "", note: message.refunded ? "Kiara could not answer this one, so it was not counted." : "No answer was saved for this question." }];
    }
    return [{ id: message.id, role: "assistant", text: message.display_text }];
  });
}

const errorText = (caught: unknown, fallback: string) => caught instanceof Error && caught.message ? caught.message : fallback;

export function AskKiaraPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { profile } = useAuth();
  const [conversations, setConversations] = useState<KiaraConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(0);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [quota, setQuota] = useState<KiaraQuota | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  // A quota read that started before a newer quota arrived (from a send) is stale.
  const quotaVersion = useRef(0);
  const applyQuota = useCallback((next: KiaraQuota) => {
    quotaVersion.current += 1;
    setQuota(next);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      setConversations(await listMyKiaraConversations());
    } catch (caught) {
      setNotice(errorText(caught, "Your chats could not be loaded."));
    } finally {
      setListLoading(false);
    }
  }, []);
  const refreshQuota = useCallback(async () => {
    const version = quotaVersion.current;
    try {
      const next = await getMyKiaraQuota();
      if (quotaVersion.current === version) applyQuota(next);
    } catch {
      // The chip is informational; the server enforces the limit on every question.
    }
  }, [applyQuota]);
  useEffect(() => {
    void refreshList();
    void refreshQuota();
  }, [refreshList, refreshQuota]);

  const openConversation = useCallback(async (id: string) => {
    setShowList(false);
    setNotice(null);
    setActiveId(id);
    try {
      const conversation = await getMyKiaraConversation(id);
      if (activeRef.current !== id) return;
      setBubbles(bubblesFor(conversation));
      setQuestionCount(conversation.question_count);
    } catch (caught) {
      setNotice(errorText(caught, "This chat could not be loaded."));
    }
  }, []);

  const newChat = () => {
    setShowList(false);
    setActiveId(null);
    setBubbles([]);
    setQuestionCount(0);
    setNotice(null);
  };

  const archive = async (id: string) => {
    try {
      await archiveMyKiaraConversation(id);
      if (activeRef.current === id) newChat();
      await refreshList();
    } catch (caught) {
      setNotice(errorText(caught, "This chat could not be archived."));
    }
  };

  const send = async (text: string) => {
    if (sending) return;
    const question = text.trim().slice(0, KIARA_QUESTION_MAX_LENGTH);
    if (!question) return;
    const localId = `local-${Date.now()}`;
    const answerId = `${localId}:answer`;
    setSending(true);
    setNotice(null);
    setDraft("");
    setStatus("Thinking");
    setBubbles((current) => [...current, { id: localId, role: "user", text: question }, { id: answerId, role: "assistant", text: "", pending: true }]);
    const updateAnswer = (change: (bubble: ChatBubble) => ChatBubble) =>
      setBubbles((current) => current.map((bubble) => bubble.id === answerId ? change(bubble) : bubble));
    let started = false;
    const outcome = await askKiara({
      conversationId: activeRef.current,
      message: question,
      client: "web",
      onEvent: (event) => {
        if (event.event === "meta") {
          started = true;
          setActiveId(event.data.conversation_id);
          applyQuota(event.data.quota);
          setQuestionCount((count) => count + 1);
        } else if (event.event === "status") {
          setStatus(event.data.label);
        } else if (event.event === "delta") {
          updateAnswer((bubble) => ({ ...bubble, text: bubble.text + event.data.text }));
        } else if (event.event === "done") {
          updateAnswer((bubble) => ({ ...bubble, text: event.data.display_text, pending: false }));
          applyQuota(event.data.quota);
        }
      },
    });
    setStatus(null);
    setSending(false);
    if (outcome.ok) {
      updateAnswer((bubble) => ({ ...bubble, text: outcome.result.display_text, pending: false }));
      void refreshList();
      return;
    }
    if (outcome.quota) applyQuota(outcome.quota);
    if (!started) {
      // The question never reached the conversation: take it back off the screen.
      setBubbles((current) => current.filter((bubble) => bubble.id !== localId && bubble.id !== answerId));
      setDraft(question);
      setNotice(outcome.message);
    } else {
      updateAnswer((bubble) => ({ ...bubble, pending: false, note: outcome.message }));
    }
    void refreshQuota();
    void refreshList();
  };

  const conversationFull = activeId !== null && questionCount >= KIARA_CONVERSATION_QUESTION_LIMIT;
  const disabledReason = quota && isQuotaExhausted(quota)
    ? `You have used all ${quota.limit} questions for today. They reset at ${formatQuotaReset(quota)}.`
    : conversationFull ? "This chat is full. Press \"New chat\" to keep asking." : null;
  const firstName = (profile?.employee_name ?? "").trim().split(/\s+/)[0] ?? "";

  return <div className="flex h-[calc(100dvh-9rem)] min-h-[32rem] flex-col gap-4 md:h-[calc(100dvh-7rem)]">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-task-border bg-task-bg px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2">
        <Sparkles aria-hidden className="size-6 text-task-accent" />
        <div>
          <h1 className="text-xl font-bold text-task-text">Ask Kiara</h1>
          <p className="text-xs text-task-text-muted">Answers use only what you can already see in JewelOS.</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <QuotaChip quota={quota} />
        <button aria-expanded={showList} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-task-border px-3 text-sm font-semibold text-task-text md:hidden" onClick={() => setShowList((open) => !open)} type="button">
          <MessagesSquare aria-hidden className="size-4" /> Chats
        </button>
      </div>
    </header>
    {notice ? <Notice tone="danger">{notice}</Notice> : null}
    <div className="flex min-h-0 flex-1 gap-4">
      <aside className={`${showList ? "flex" : "hidden"} w-full flex-col rounded-2xl border border-task-border bg-task-bg p-3 md:flex md:w-72 md:shrink-0`}>
        <ConversationList activeId={activeId} conversations={conversations} loading={listLoading} onArchive={(id) => void archive(id)} onNew={newChat} onSelect={(id) => void openConversation(id)} />
      </aside>
      <section aria-label="Chat with Kiara" className={`${showList ? "hidden" : "flex"} min-w-0 flex-1 flex-col rounded-2xl border border-task-border bg-task-bg p-3 sm:p-4 md:flex`}>
        <ChatView
          bubbles={bubbles}
          disabledReason={disabledReason}
          draft={draft}
          firstName={firstName}
          maxLength={KIARA_QUESTION_MAX_LENGTH}
          onDraftChange={setDraft}
          onNavigate={onNavigate}
          onSend={(text) => void send(text)}
          sending={sending}
          status={status}
        />
      </section>
    </div>
  </div>;
}
