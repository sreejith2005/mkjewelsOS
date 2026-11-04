import { useMemo, useState } from "react";
import { Archive, MessageSquarePlus, Search } from "lucide-react";
import { kiaraDateTime } from "@jewelos/core";
import type { KiaraConversationSummary } from "@jewelos/data/assistant/api";

const when = (iso: string) => kiaraDateTime(iso) ?? "";

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
  // Filters the chats already loaded; nothing extra is fetched.
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle)) : conversations;
  }, [conversations, query]);
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <button className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-task-accent px-4 text-sm font-semibold text-white hover:opacity-90" onClick={onNew} type="button">
      <MessageSquarePlus aria-hidden className="size-4" /> New chat
    </button>
    {loading && conversations.length === 0 ? <p className="px-1 text-sm text-task-text-muted">Loading your chats…</p> : null}
    {!loading && conversations.length === 0 ? <p className="px-1 text-sm text-task-text-muted">Your chats will appear here.</p> : null}
    {conversations.length > 5 ? <label className="relative block"><span className="sr-only">Search your chats</span><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-task-text-muted" /><input className="task-field min-h-10 pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" type="search" value={query} /></label> : null}
    {query && shown.length === 0 ? <p className="px-1 text-sm text-task-text-muted">No chats match.</p> : null}
    <p aria-hidden className="px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-task-text-muted">{conversations.length ? "Recent chats" : null}</p>
    <ul aria-label="Your chats" className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1">
      {shown.map((conversation) => <li className="group flex items-stretch gap-1" key={conversation.id}>
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
