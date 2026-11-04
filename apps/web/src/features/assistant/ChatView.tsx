import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, SendHorizontal, Sparkles, UserRound } from "lucide-react";
import { KIARA_DRAFT_COUNTER_FROM, KIARA_SUGGESTIONS, kiaraDateTime } from "@jewelos/core";
import type { KiaraChatBubble, KiaraChatEscalation } from "@jewelos/data/assistant/chat";
import { CitationChips } from "./CitationChips";
import { KiaraMicButton, KiaraVoiceStatus, appendTranscript, useKiaraVoice } from "./KiaraVoiceButton";
import { KiaraMarkdown } from "./KiaraMarkdown";

/** The bubble model is shared with Android (`@jewelos/data/assistant/chat`). */
export type ChatEscalation = KiaraChatEscalation;
export type ChatBubble = KiaraChatBubble;

const answeredAt = (value: string | undefined) => kiaraDateTime(value) ?? "";

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

export { KIARA_SUGGESTIONS };

const COUNTER_FROM = KIARA_DRAFT_COUNTER_FROM;

export function ChatView({
  bubbles,
  canUseVoice = false,
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
  /** Shows the mic button (`assistant.voice`; the server checks it again). */
  canUseVoice?: boolean | undefined;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // The composer grows with the question, up to its max height, like a chat app.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [draft]);
  const lastText = bubbles[bubbles.length - 1]?.text;
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [bubbles.length, lastText, status]);

  // Spoken words land in the input box for editing; they are never sent here.
  const voice = useKiaraVoice((text) => onDraftChange(appendTranscript(draft, text, maxLength)));
  const voiceBusy = canUseVoice && voice.state !== "idle";
  const locked = sending || disabledReason !== null;
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || locked || voiceBusy) return;
    onSend(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return <div className="flex min-h-0 flex-1 flex-col">
    <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2 sm:px-4"><div className="mx-auto w-full max-w-3xl space-y-6">
      {bubbles.length === 0 ? <div className="mx-auto flex min-h-[50dvh] max-w-xl flex-col items-center justify-center py-8 text-center">
        <span aria-hidden className="flex size-14 items-center justify-center rounded-2xl bg-gold-sheen text-on-gold shadow-gold"><Sparkles className="size-7" /></span>
        <h2 className="mt-4 text-2xl font-semibold text-task-text">Namaste{firstName ? `, ${firstName}` : ""}! I'm Kiara.</h2>
        <p className="mt-2 text-sm text-task-text-muted">Ask me about your work, how to use JewelOS, or company procedures. You can write in English, Hindi, or Hinglish.</p>
        <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
          {KIARA_SUGGESTIONS.map((suggestion) => <button
            className="min-h-12 rounded-xl border border-task-border bg-task-bg px-4 py-2 text-left text-sm text-task-text transition-colors hover:border-task-accent hover:bg-task-accent-soft disabled:opacity-50"
            disabled={locked || voiceBusy}
            key={suggestion}
            onClick={() => onSend(suggestion)}
            type="button"
          >{suggestion}</button>)}
        </div>
      </div> : null}
      {bubbles.map((bubble) => bubble.role === "user"
        ? <div className="flex justify-end" key={bubble.id}>
          <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-task-accent-soft px-4 py-2.5 text-[15px] leading-relaxed text-task-text sm:max-w-[75%]">{bubble.text}</p>
        </div>
        : bubble.role === "human"
        ? <div className="flex justify-start gap-2" key={bubble.id}>
          <span aria-hidden className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border border-task-accent bg-task-bg text-task-accent"><UserRound className="size-4" /></span>
          <div className="max-w-[85%] rounded-2xl rounded-bl-md border-2 border-task-accent/50 bg-task-bg px-4 py-2.5 text-sm text-task-text">
            <p className="mb-1 text-xs font-semibold text-task-accent">Answered by {bubble.answeredBy ?? "a person"}{bubble.createdAt ? ` · ${answeredAt(bubble.createdAt)}` : ""}</p>
            <p className="whitespace-pre-wrap break-words">{bubble.text}</p>
          </div>
        </div>
        : <div className="flex justify-start gap-3" key={bubble.id}>
          <span aria-hidden className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-sheen text-xs font-bold text-on-gold shadow-gold">K</span>
          <div className="min-w-0 flex-1 pt-1 text-[15px] leading-relaxed text-task-text">
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
    </div></div>
    <form className="mx-auto w-full max-w-3xl px-1 pb-1 pt-2 sm:px-4" onSubmit={submit}>
      {disabledReason ? <p className="mb-2 rounded-lg bg-task-muted px-3 py-2 text-sm text-task-text">{disabledReason}</p> : null}
      {canUseVoice ? <KiaraVoiceStatus voice={voice} /> : null}
      <div className="flex items-end gap-2 rounded-3xl border border-task-border bg-task-bg p-1.5 pl-3 shadow-card transition-colors focus-within:border-task-accent/60">
        <label className="sr-only" htmlFor="kiara-question">Your question</label>
        <textarea
          className="max-h-40 min-h-10 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-base leading-relaxed text-task-text placeholder:text-task-text-muted/80 focus-visible:ring-0 focus-visible:ring-offset-0 md:text-[15px]"
          disabled={disabledReason !== null}
          id="kiara-question"
          maxLength={maxLength}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={canUseVoice ? "Ask Kiara, or tap the mic…" : "Ask Kiara…"}
          ref={inputRef}
          rows={1}
          value={draft}
        />
        {canUseVoice ? <KiaraMicButton disabled={locked} voice={voice} /> : null}
        <button aria-label="Send" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-task-accent text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40" disabled={locked || voiceBusy || !draft.trim()} type="submit">
          {sending ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <SendHorizontal aria-hidden className="size-5" />}
        </button>
      </div>
      {draft.length >= COUNTER_FROM ? <p className="mt-1 text-right text-xs text-task-text-muted">{draft.length} / {maxLength}</p> : <p className="mt-1.5 hidden text-center text-[11px] text-task-text-muted sm:block">Enter sends · Shift+Enter adds a new line</p>}
    </form>
  </div>;
}
