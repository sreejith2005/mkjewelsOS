import type { KiaraChatResult, KiaraCitationData, KiaraStreamEvent } from "@jewelos/core";
import type { KiaraConversation } from "./api";

/**
 * The chat as both clients draw it: one bubble per question, answer, or
 * person's answer. Built from a stored conversation, then updated by the
 * streamed events of a new question. Web and Android share these rules so the
 * same conversation reads the same on both.
 */
export type KiaraChatEscalation = Readonly<{ id: string; status: "open" | "answered" | "withdrawn"; answeredBy: string | null }>;

export type KiaraChatBubble = Readonly<{
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
  escalation?: KiaraChatEscalation | undefined;
  /** Human answers: who answered ("Name (Designation)"), and when. */
  answeredBy?: string | undefined;
  createdAt?: string | undefined;
}>;

/** Display bubbles for a stored conversation. A question without an answer says why. */
export function kiaraChatBubbles(conversation: KiaraConversation): KiaraChatBubble[] {
  const answered = new Set(conversation.messages.flatMap((message) => message.reply_to_message_id ? [message.reply_to_message_id] : []));
  return conversation.messages.flatMap((message): KiaraChatBubble[] => {
    if (message.role === "user") {
      const bubble: KiaraChatBubble = { id: message.id, role: "user", text: message.display_text };
      if (answered.has(message.id)) return [bubble];
      return [bubble, { id: `${message.id}:missing`, role: "assistant", text: "", note: message.refunded ? "Kiara could not answer this one, so it was not counted." : "No answer was saved for this question." }];
    }
    if (message.role === "human_answer") {
      return [{ id: message.id, role: "human", text: message.display_text, answeredBy: message.answered_by ?? undefined, createdAt: message.created_at }];
    }
    return [{
      id: message.id,
      role: "assistant",
      text: message.display_text,
      citations: message.citations,
      ...(message.escalation_offer ? { offer: { messageId: message.id, summary: message.escalation_offer.summary_en } } : {}),
      ...(message.escalation ? { escalation: { id: message.escalation.id, status: message.escalation.status, answeredBy: message.escalation.answered_by } } : {}),
    }];
  });
}

/** The pending answer bubble after one streamed event (meta and status change the screen, not the bubble). */
export function kiaraAnswerAfterEvent(bubble: KiaraChatBubble, event: KiaraStreamEvent): KiaraChatBubble {
  if (event.event === "delta") return { ...bubble, text: bubble.text + event.data.text };
  if (event.event === "citation") return { ...bubble, citations: [...(bubble.citations ?? []), event.data] };
  if (event.event === "escalation_offer") return { ...bubble, offer: { messageId: event.data.message_id, summary: event.data.summary } };
  if (event.event === "done") return { ...bubble, text: event.data.display_text, pending: false };
  return bubble;
}

/** The finished answer: the authoritative text, citations, and any offer. */
export function kiaraAnswerFromResult(bubble: KiaraChatBubble, result: KiaraChatResult): KiaraChatBubble {
  const offer = result.escalation_offer;
  return {
    ...bubble,
    text: result.display_text,
    pending: false,
    citations: result.citations,
    ...(offer ? { offer: { messageId: offer.message_id, summary: offer.summary } } : {}),
  };
}

/** Marks the bubble that carries this offer as escalated (after "Ask a person"). */
export function kiaraBubblesWithEscalation(bubbles: readonly KiaraChatBubble[], messageId: string, escalation: KiaraChatEscalation): KiaraChatBubble[] {
  return bubbles.map((bubble) => bubble.offer?.messageId === messageId ? { ...bubble, escalation } : bubble);
}

/** Marks a withdrawn escalation. */
export function kiaraBubblesWithdrawn(bubbles: readonly KiaraChatBubble[], escalationId: string): KiaraChatBubble[] {
  return bubbles.map((bubble) => bubble.escalation?.id === escalationId ? { ...bubble, escalation: { ...bubble.escalation, status: "withdrawn" } } : bubble);
}
