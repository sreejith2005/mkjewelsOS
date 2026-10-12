import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, SendHorizontal, Sparkles, UserRound } from "lucide-react";
import type { KiaraCitationData } from "@jewelos/core";
import { CitationChips } from "./CitationChips";
import { KiaraMarkdown } from "./KiaraMarkdown";

export type ChatEscalation = Readonly<{ id: string; status: "open" | "answered" | "withdrawn"; answeredBy: string | null }>;

export type ChatBubble = Readonly<{
  id: string;
  /** "human": an answer from a person the question was sent to. */
  role: "user" | "assistant" | "human";
  text: string;
  /** Streaming in progress for this answer. */
  pending?: boolean | undefined;
  /** A note shown instead of an answer (failure, refund, interruption). */
  note?: string | undefined;
  /** Knowledge-base sources for the answer's [n] markers. */
  citations?: readonly KiaraCitationData[] | undefined;
  /** Kiara offered to pass the question to a person (its answer message id). */
  offer?: Readonly<{ messageId: string; summary: string }> | undefined;
  /** The escalation made from that offer. */
  escalation?: ChatEscalation | undefined;
  /** Human answers: who answered, and when. */
  answeredBy?: string | undefined;
  createdAt?: string | undefined;
}>;

const answeredAt = (value: string | undefined) => value
  ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value))
  : "";

/** The "Ask a person" card under an answer, and what happened to the question after. */
function EscalationCard({ bubble, busy, onAskPerson, onWithdraw }: {
  bubble: ChatBubble;
  busy: boolean;
  onAskPerson: (messageId: string) => void;
  onWithdraw: (escalationId: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (!bubble.offer || bubble.pending) return null;
  const escalation = bubble.escalation;
  if (!escalation) {
    if (dismissed) return null;
    return <div className="mt-3 rounded-xl border border-task-accent/40 bg-task-accent-soft p-3">
      <p className="text-sm text-task-text">Kiara could not answer this confidently. Send your question to a person who can, such as your manager? It does not use one of your daily questions.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-task-accent px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50" disabled={busy} onClick={() => onAskPerson(bubble.offer!.messageId)} type="button">
          {busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <UserRound aria-hidden className="size-4" />}Ask a person
        </button>
        <button className="min-h-9 rounded-lg border border-task-border px-3 text-sm text-task-text hover:bg-task-muted" disabled={busy} onClick={() => setDismissed(true)} type="button">No thanks</button>
      </div>
    </div>;
  }
  if (escalation.status === "open") {
    return <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-task-border bg-task-muted p-3 text-sm text-task-text">
      <span className="flex-1">Sent to a person. You will get a notification when someone answers.</span>
      <button className="min-h-8 rounded-lg border border-task-border px-3 text-xs font-semibold text-task-text hover:bg-task-bg disabled:opacity-50" disabled={busy} onClick={() => onWithdraw(escalation.id)} type="button">Withdraw</button>
    </div>;
  }
  return <p className="mt-2 text-xs text-task-text-muted">{escalation.status === "answered" ? `Answered by ${escalation.answeredBy ?? "a person"} (below).` : "You withdrew this question."}</p>;
}

export const KIARA_SUGGESTIONS = [
  "What is pending for me today?",
  "Aaj mera kya pending hai?",
  "How do I apply for leave?",
  "Mere overdue tasks kaun se hain?",
] as const;

const COUNTER_FROM = 1800;

export function ChatView({
  bubbles,
  disabledReason,
  escalationBusy = false,
  onAskPerson = () => {},
  onWithdraw = () => {},
  draft,
  firstName,
  maxLength,
  onDraftChange,
  onNavigate,
  onSend,
  sending,
  status,
}: {
  bubbles: readonly ChatBubble[];
  /** When set, the composer is locked and this explains why. */
  disabledReason: string | null;
  /** An "Ask a person" or "Withdraw" request is in flight. */
  escalationBusy?: boolean | undefined;
  onAskPerson?: ((messageId: string) => void) | undefined;
  onWithdraw?: ((escalationId: string) => void) | undefined;
  draft: string;
  firstName: string;
  maxLength: number;
  onDraftChange: (value: string) => void;
  onNavigate: (path: string) => void;
  onSend: (text: string) => void;
  sending: boolean;
  status: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const lastText = bubbles[bubbles.length - 1]?.text;
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [bubbles.length, lastText, status]);

  const locked = sending || disabledReason !== null;
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || locked) return;
    onSend(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return <div className="flex min-h-0 flex-1 flex-col">
    <div aria-live="polite" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-2">
      {bubbles.length === 0 ? <div className="mx-auto max-w-lg py-8 text-center">
        <Sparkles aria-hidden className="mx-auto size-8 text-task-accent" />
        <h2 className="mt-3 text-xl font-bold text-task-text">Namaste{firstName ? `, ${firstName}` : ""}! I'm Kiara.</h2>
        <p className="mt-2 text-sm text-task-text-muted">Ask me about your work, how to use JewelOS, or company procedures. You can write in English, Hindi, or Hinglish.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {KIARA_SUGGESTIONS.map((suggestion) => <button
            className="min-h-10 rounded-full border border-task-border bg-task-bg px-4 text-sm text-task-text hover:border-task-accent hover:bg-task-accent-soft disabled:opacity-50"
            disabled={locked}
            key={suggestion}
            onClick={() => onSend(suggestion)}
            type="button"
          >{suggestion}</button>)}
        </div>
      </div> : null}
      {bubbles.map((bubble) => bubble.role === "user"
        ? <div className="flex justify-end" key={bubble.id}>
          <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-task-accent-soft px-4 py-2.5 text-sm text-task-text">{bubble.text}</p>
        </div>
        : bubble.role === "human"
        ? <div className="flex justify-start gap-2" key={bubble.id}>
          <span aria-hidden className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border border-task-accent bg-task-bg text-task-accent"><UserRound className="size-4" /></span>
          <div className="max-w-[85%] rounded-2xl rounded-bl-md border-2 border-task-accent/50 bg-task-bg px-4 py-2.5 text-sm text-task-text">
            <p className="mb-1 text-xs font-semibold text-task-accent">Answered by {bubble.answeredBy ?? "a person"}{bubble.createdAt ? ` · ${answeredAt(bubble.createdAt)}` : ""}</p>
            <p className="whitespace-pre-wrap break-words">{bubble.text}</p>
          </div>
        </div>
        : <div className="flex justify-start gap-2" key={bubble.id}>
          <span aria-hidden className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-task-accent text-xs font-bold text-white">K</span>
          <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-task-border bg-task-bg px-4 py-2.5 text-sm text-task-text">
            <span className="sr-only">Kiara: </span>
            {bubble.text ? <KiaraMarkdown onNavigate={onNavigate} text={bubble.text} /> : null}
            {bubble.pending && !bubble.text ? <span className="inline-flex items-center gap-2 text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />{status ?? "Thinking"}…</span> : null}
            {bubble.pending && bubble.text && status ? <span className="mt-2 flex items-center gap-2 text-xs text-task-text-muted"><Loader2 aria-hidden className="size-3 animate-spin" />{status}…</span> : null}
            {bubble.note ? <p className="mt-1 text-xs text-task-text-muted">{bubble.note}</p> : null}
            {!bubble.pending && bubble.citations?.length ? <CitationChips citations={bubble.citations} /> : null}
            <EscalationCard bubble={bubble} busy={escalationBusy} onAskPerson={onAskPerson} onWithdraw={onWithdraw} />
          </div>
        </div>)}
      <div ref={endRef} />
    </div>
    <form className="border-t border-task-border pt-3" onSubmit={submit}>
      {disabledReason ? <p className="mb-2 rounded-lg bg-task-muted px-3 py-2 text-sm text-task-text">{disabledReason}</p> : null}
      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor="kiara-question">Your question</label>
        <textarea
          className="task-field max-h-40 min-h-11 flex-1 resize-none"
          disabled={disabledReason !== null}
          id="kiara-question"
          maxLength={maxLength}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask Kiara…"
          rows={1}
          value={draft}
        />
        <button aria-label="Send" className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-task-accent text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" disabled={locked || !draft.trim()} type="submit">
          {sending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <SendHorizontal aria-hidden className="size-5" />}
        </button>
      </div>
      {draft.length >= COUNTER_FROM ? <p className="mt-1 text-right text-xs text-task-text-muted">{draft.length} / {maxLength}</p> : null}
    </form>
  </div>;
}
