import { Archive, MessageSquarePlus } from "lucide-react";
import type { KiaraConversationSummary } from "@jewelos/data/assistant/api";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));

/** The asker's own chats, newest first. Nobody else can list them (RLS and RPC). */
export function ConversationList({
  activeId,
  conversations,
  loading,
  onArchive,
  onNew,
  onSelect,
}: {
  activeId: string | null;
  conversations: readonly KiaraConversationSummary[];
  loading: boolean;
  onArchive: (id: string) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
}) {
  return <div className="flex min-h-0 flex-col gap-3">
    <button className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-task-accent px-4 text-sm font-semibold text-white hover:opacity-90" onClick={onNew} type="button">
      <MessageSquarePlus aria-hidden className="size-4" /> New chat
    </button>
    {loading && conversations.length === 0 ? <p className="px-1 text-sm text-task-text-muted">Loading your chats…</p> : null}
    {!loading && conversations.length === 0 ? <p className="px-1 text-sm text-task-text-muted">Your chats will appear here.</p> : null}
    <ul aria-label="Your chats" className="min-h-0 space-y-1 overflow-y-auto">
      {conversations.map((conversation) => <li className="group flex items-stretch gap-1" key={conversation.id}>
        <button
          aria-current={conversation.id === activeId ? "true" : undefined}
          className={conversation.id === activeId
            ? "min-w-0 flex-1 rounded-lg bg-task-accent-soft px-3 py-2 text-left"
            : "min-w-0 flex-1 rounded-lg px-3 py-2 text-left hover:bg-task-muted"}
          onClick={() => onSelect(conversation.id)}
          type="button"
        >
          <span className="block truncate text-sm font-semibold text-task-text">{conversation.title}</span>
          <span className="block text-xs text-task-text-muted">{when(conversation.last_message_at)} · {conversation.question_count} {conversation.question_count === 1 ? "question" : "questions"}</span>
        </button>
        <button aria-label={`Archive ${conversation.title}`} className="flex w-9 shrink-0 items-center justify-center rounded-lg text-task-text-muted hover:bg-task-muted hover:text-task-text" onClick={() => onArchive(conversation.id)} title="Archive" type="button">
          <Archive aria-hidden className="size-4" />
        </button>
      </li>)}
    </ul>
  </div>;
}
