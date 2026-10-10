import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, SendHorizontal, Sparkles } from "lucide-react";
import type { KiaraCitationData } from "@jewelos/core";
import { CitationChips } from "./CitationChips";
import { KiaraMarkdown } from "./KiaraMarkdown";

export type ChatBubble = Readonly<{
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Streaming in progress for this answer. */
  pending?: boolean | undefined;
  /** A note shown instead of an answer (failure, refund, interruption). */
  note?: string | undefined;
  /** Knowledge-base sources for the answer's [n] markers. */
  citations?: readonly KiaraCitationData[] | undefined;
}>;

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
        : <div className="flex justify-start gap-2" key={bubble.id}>
          <span aria-hidden className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-task-accent text-xs font-bold text-white">K</span>
          <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-task-border bg-task-bg px-4 py-2.5 text-sm text-task-text">
            <span className="sr-only">Kiara: </span>
            {bubble.text ? <KiaraMarkdown onNavigate={onNavigate} text={bubble.text} /> : null}
            {bubble.pending && !bubble.text ? <span className="inline-flex items-center gap-2 text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />{status ?? "Thinking"}…</span> : null}
            {bubble.pending && bubble.text && status ? <span className="mt-2 flex items-center gap-2 text-xs text-task-text-muted"><Loader2 aria-hidden className="size-3 animate-spin" />{status}…</span> : null}
            {bubble.note ? <p className="mt-1 text-xs text-task-text-muted">{bubble.note}</p> : null}
            {!bubble.pending && bubble.citations?.length ? <CitationChips citations={bubble.citations} /> : null}
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
