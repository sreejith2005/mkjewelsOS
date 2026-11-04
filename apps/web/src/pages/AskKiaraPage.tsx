import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, BarChart3, BookOpen, ChevronUp, Gauge, MessageCircleQuestion, MessagesSquare, Settings2, X, type LucideIcon } from "lucide-react";
import { hasPermission, kiaraComposerDisabledReason, kiaraLocation, type KiaraQuota, type KiaraTab } from "@jewelos/core";
import {
  KIARA_CONVERSATION_QUESTION_LIMIT,
  KIARA_QUESTION_MAX_LENGTH,
  archiveMyKiaraConversation,
  askKiara,
  getMyKiaraConversation,
  getMyKiaraQuota,
  listMyKiaraConversations,
  type KiaraConversationSummary,
} from "@jewelos/data/assistant/api";
import {
  kiaraAnswerAfterEvent,
  kiaraAnswerFromResult,
  kiaraBubblesWithEscalation,
  kiaraBubblesWithdrawn,
  kiaraChatBubbles,
} from "@jewelos/data/assistant/chat";
import { createKiaraEscalation, withdrawMyKiaraEscalation } from "@jewelos/data/assistant/escalations";
import { useAuth } from "@/auth/AuthContext";
import { Notice } from "@/components/ui";
import { ChatView, type ChatBubble } from "@/features/assistant/ChatView";
import { QuestionsForYou } from "@/features/assistant/QuestionsForYou";
import { useKiaraEscalationBadge } from "@/features/assistant/useKiaraEscalationBadge";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { ConversationList } from "@/features/assistant/ConversationList";
import { QuotaChip } from "@/features/assistant/QuotaChip";
import { KnowledgeBaseView } from "@/features/assistant/knowledge/KnowledgeBaseView";
import { InsightsView } from "@/features/assistant/InsightsView";
import { LimitsView } from "@/features/assistant/LimitsView";
import { useFillViewport } from "@/lib/useFillViewport";

/** The tab and item a URL opens, and the bubbles for a stored chat: shared with Android. */
export { kiaraLocation };
export const bubblesFor = kiaraChatBubbles;

const errorText = (caught: unknown, fallback: string) => caught instanceof Error && caught.message ? caught.message : fallback;

export function AskKiaraPage({ onNavigate, search = window.location.search }: { onNavigate: (path: string) => void; search?: string }) {
  const { access, profile } = useAuth();
  // Screen aids only: every knowledge and escalation RPC re-checks its permission.
  const canManageKnowledge = access ? hasPermission(access, "assistant.manage_knowledge") : false;
  const canAnswer = access ? hasPermission(access, "assistant.answer_escalations") : false;
  const canViewInsights = access ? hasPermission(access, "assistant.view_insights") : false;
  const canManageLimits = access ? hasPermission(access, "assistant.manage_limits") : false;
  const canUseVoice = access ? hasPermission(access, "assistant.voice") : false;
  const waitingQuestions = useKiaraEscalationBadge(profile?.tenant_id, canAnswer);
  const location = kiaraLocation(search);
  const [tab, setTab] = useState<KiaraTab>(location.tab);
  const showTab = (next: KiaraTab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "chat") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  };
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
  const [escalationBusy, setEscalationBusy] = useState(false);
  const workspace = useFillViewport<HTMLDivElement>({ minHeight: 420 });
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

  // A notification link (?conversation=, ?tab=questions&escalation=) opens its place.
  useEffect(() => {
    setTab(location.tab);
    if (location.conversationId) void openConversation(location.conversationId);
  }, [location.conversationId, location.tab, openConversation]);

  // A person's answer arrives through the assistant realtime topic.
  const sendingRef = useRef(false);
  sendingRef.current = sending;
  const refreshActive = useCallback(async () => {
    const id = activeRef.current;
    if (!id || sendingRef.current) return;
    try {
      const conversation = await getMyKiaraConversation(id);
      if (activeRef.current === id && !sendingRef.current) setBubbles(bubblesFor(conversation));
    } catch {
      // The next open reloads it.
    }
  }, []);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["assistant"], refresh: refreshActive });

  const updateBubbleEscalation = (messageId: string, escalation: NonNullable<ChatBubble["escalation"]>) =>
    setBubbles((current) => kiaraBubblesWithEscalation(current, messageId, escalation));
  const askPerson = async (messageId: string) => {
    setEscalationBusy(true);
    setNotice(null);
    try {
      const { escalationId } = await createKiaraEscalation(messageId);
      updateBubbleEscalation(messageId, { id: escalationId, status: "open", answeredBy: null });
    } catch (caught) {
      setNotice(errorText(caught, "Your question could not be sent. Please try again."));
    } finally {
      setEscalationBusy(false);
    }
  };
  const withdraw = async (escalationId: string) => {
    setEscalationBusy(true);
    setNotice(null);
    try {
      await withdrawMyKiaraEscalation(escalationId);
      setBubbles((current) => kiaraBubblesWithdrawn(current, escalationId));
    } catch (caught) {
      setNotice(errorText(caught, "The question could not be withdrawn."));
      void refreshActive();
    } finally {
      setEscalationBusy(false);
    }
  };

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
        } else {
          updateAnswer((bubble) => kiaraAnswerAfterEvent(bubble, event));
          if (event.event === "done") applyQuota(event.data.quota);
        }
      },
    });
    setStatus(null);
    setSending(false);
    if (outcome.ok) {
      updateAnswer((bubble) => kiaraAnswerFromResult(bubble, outcome.result));
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

  const disabledReason = kiaraComposerDisabledReason({ quota, activeConversationId: activeId, questionCount, conversationLimit: KIARA_CONVERSATION_QUESTION_LIMIT });
  const firstName = (profile?.employee_name ?? "").trim().split(/\s+/)[0] ?? "";

  const tabList = ([
    ["chat", "Chat", MessagesSquare, true],
    ["questions", "Questions for you", MessageCircleQuestion, canAnswer],
    ["knowledge", "Knowledge base", BookOpen, canManageKnowledge],
    ["insights", "Insights", BarChart3, canViewInsights],
    ["limits", "Limits", Gauge, canManageLimits],
  ] as const).filter(([, , , shown]) => shown);
  const current = tabList.find(([id]) => id === tab) ?? tabList[0]!;
  const showChat = tab === "chat" || !tabList.some(([id]) => id === tab);
  const selectConversation = (id: string) => { if (!showChat) showTab("chat"); void openConversation(id); };
  const startChat = () => { if (!showChat) showTab("chat"); newChat(); };

  // The admin areas, opened from Kiara tools. Each keeps its own permission check above.
  const adminBody: ReactNode = canAnswer && tab === "questions" ? <QuestionsForYou focusId={location.escalationId} />
    : canViewInsights && tab === "insights" ? <InsightsView />
    : canManageLimits && tab === "limits" ? <LimitsView />
    : canManageKnowledge && tab === "knowledge" ? <KnowledgeBaseView />
    : null;
  const adminSubtitle: Partial<Record<KiaraTab, string>> = {
    questions: "Questions Kiara could not answer. The first answer goes to the employee.",
    knowledge: "The SOPs and articles Kiara answers from. Employees see cited sections only, never files.",
    insights: "What people ask Kiara about, to plan SOP training.",
    limits: "Daily question limits, personal exceptions, and usage. Super Admin only.",
  };

  const sidebar = <>
    <ConversationList activeId={showChat ? activeId : null} conversations={conversations} loading={listLoading} onArchive={(id) => void archive(id)} onNew={startChat} onSelect={selectConversation} />
    {tabList.length > 1 ? <KiaraTools current={current[0]} items={tabList.map(([id, label, Icon]) => ({ id, label, Icon, badge: id === "questions" ? waitingQuestions : 0 }))} onSelect={(id) => { setShowList(false); showTab(id); }} /> : null}
  </>;

  // An immersive workspace: it fills the content area edge to edge and the room
  // left in the window, with chats on the left and the conversation beside them.
  return <div className="relative -m-4 flex min-h-0 overflow-hidden border-t border-task-border bg-task-bg sm:-m-6 md:border-t-0" ref={workspace.ref} style={workspace.style}>
    <aside aria-label="Your Kiara chats" className="hidden w-72 shrink-0 flex-col gap-3 border-r border-task-border bg-task-muted/50 p-3 md:flex lg:w-80">{sidebar}</aside>
    {showList ? <div className="absolute inset-0 z-30 flex md:hidden">
      <aside aria-label="Your Kiara chats" className="flex w-[86%] max-w-sm flex-col gap-3 border-r border-task-border bg-task-bg p-3 shadow-lift">
        <div className="flex items-center justify-between"><p className="text-sm font-semibold text-task-text">Chats</p><button aria-label="Close chats" className="flex size-10 items-center justify-center rounded-lg text-task-text-muted hover:bg-task-muted" onClick={() => setShowList(false)} type="button"><X aria-hidden className="size-5" /></button></div>
        {sidebar}
      </aside>
      <button aria-label="Close chats" className="flex-1 bg-obsidian/40" onClick={() => setShowList(false)} tabIndex={-1} type="button" />
    </div> : null}
    <section aria-label={showChat ? "Chat with Kiara" : current[1]} className="flex min-w-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-task-border px-2 py-1.5 sm:px-4">
        <button aria-expanded={showList} aria-label="Chats" className="flex size-10 shrink-0 items-center justify-center rounded-lg text-task-text hover:bg-task-muted md:hidden" onClick={() => setShowList(true)} type="button"><MessagesSquare aria-hidden className="size-5" /></button>
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gold-sheen text-[11px] font-bold text-on-gold shadow-gold">K</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-task-text">{showChat ? "Kiara" : current[1]}</h1>
          <p className="truncate text-[11px] text-task-text-muted">{showChat ? "Answers use only what you can already see in JewelOS." : adminSubtitle[tab] ?? ""}</p>
        </div>
        {showChat ? <QuotaChip quota={quota} /> : <button className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border border-task-border px-3 text-sm font-semibold text-task-text hover:bg-task-muted" onClick={() => showTab("chat")} type="button"><ArrowLeft aria-hidden className="size-4" />Chat</button>}
      </header>
      {notice ? <div className="px-3 pt-2 sm:px-4"><Notice tone="danger">{notice}</Notice></div> : null}
      {showChat ? <div className="flex min-h-0 flex-1 flex-col px-1 pb-1 sm:px-3">
        <ChatView
          bubbles={bubbles}
          canUseVoice={canUseVoice}
          disabledReason={disabledReason}
          escalationBusy={escalationBusy}
          onAskPerson={(messageId) => void askPerson(messageId)}
          onWithdraw={(escalationId) => void withdraw(escalationId)}
          draft={draft}
          firstName={firstName}
          maxLength={KIARA_QUESTION_MAX_LENGTH}
          onDraftChange={setDraft}
          onNavigate={onNavigate}
          onSend={(text) => void send(text)}
          sending={sending}
          status={status}
        />
      </div> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5">{adminBody}</div>}
    </section>
  </div>;
}

type KiaraToolItem = Readonly<{ id: KiaraTab; label: string; Icon: LucideIcon; badge: number }>;

/** Kiara tools: the chat and the admin areas the signed-in person may open. Not the JewelOS Settings page. */
function KiaraTools({ items, current, onSelect }: { items: readonly KiaraToolItem[]; current: KiaraTab; onSelect: (id: KiaraTab) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const waiting = items.reduce((total, item) => total + item.badge, 0);
  return <div className="relative mt-auto border-t border-task-border pt-2" ref={rootRef}>
    {open ? <div aria-label="Kiara tools" className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-task-border bg-task-bg p-1 shadow-lift" id="kiara-tools" role="menu">
      {items.map(({ id, label, Icon, badge }) => <button aria-current={current === id ? "page" : undefined} className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium ${current === id ? "bg-task-accent-soft text-task-text" : "text-task-text hover:bg-task-muted"}`} key={id} onClick={() => { setOpen(false); onSelect(id); }} role="menuitem" type="button">
        <Icon aria-hidden className="size-4 shrink-0 text-task-text-muted" /><span className="flex-1">{label}</span>
        {badge > 0 ? <span aria-label={`${badge} waiting`} className="rounded-full bg-task-accent px-1.5 text-xs text-white">{badge}</span> : null}
      </button>)}
    </div> : null}
    <button aria-controls="kiara-tools" aria-expanded={open} aria-haspopup="menu" className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-semibold text-task-text hover:bg-task-muted" onClick={() => setOpen((value) => !value)} type="button">
      <Settings2 aria-hidden className="size-4 text-task-text-muted" /><span className="flex-1">Kiara tools</span>
      {waiting > 0 ? <span aria-label={`${waiting} open questions for you`} className="rounded-full bg-task-accent px-1.5 text-xs text-white">{waiting}</span> : null}
      <ChevronUp aria-hidden className={`size-4 text-task-text-muted transition-transform ${open ? "" : "rotate-180"}`} />
    </button>
  </div>;
}
