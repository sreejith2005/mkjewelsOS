import { describe, expect, it } from "vitest";
import type { KiaraConversation, KiaraMessage } from "./api";
import { kiaraAnswerAfterEvent, kiaraAnswerFromResult, kiaraBubblesWithEscalation, kiaraBubblesWithdrawn, kiaraChatBubbles, type KiaraChatBubble } from "./chat";

const quota = { used: 1, limit: 10, resets_at: "2026-10-13T18:30:00.000Z" };
const message = (fields: Partial<KiaraMessage> & Pick<KiaraMessage, "id" | "role" | "display_text">): KiaraMessage => ({
  ordinal: 1, reply_to_message_id: null, refunded: false, stop_reason: null, created_at: "2026-10-13T05:00:00Z",
  citations: [], escalation_offer: null, escalation: null, answered_by: null, ...fields,
});
const conversation = (messages: KiaraMessage[]): KiaraConversation => ({ id: "c1", title: "t", created_at: "x", last_message_at: "x", question_count: 1, messages });

describe("kiaraChatBubbles", () => {
  it("shows answers, a person's answer with their name, and the reason for a missing answer", () => {
    const bubbles = kiaraChatBubbles(conversation([
      message({ id: "u1", role: "user", display_text: "Q1" }),
      message({ id: "a1", role: "assistant", display_text: "A1", reply_to_message_id: "u1", escalation_offer: { offer_id: "o1", reason: "no_kb_match", summary_en: "Leave rule" }, escalation: { id: "e1", status: "answered", answered_by: "Asha (Manager)", answered_at: "y" } }),
      message({ id: "h1", role: "human_answer", display_text: "Two days.", answered_by: "Asha (Manager)" }),
      message({ id: "u2", role: "user", display_text: "Q2", refunded: true }),
    ]));
    expect(bubbles.map((bubble) => [bubble.role, bubble.text, bubble.note ?? null])).toEqual([
      ["user", "Q1", null], ["assistant", "A1", null], ["human", "Two days.", null],
      ["user", "Q2", null], ["assistant", "", "Kiara could not answer this one, so it was not counted."],
    ]);
    expect(bubbles[1]).toMatchObject({ offer: { messageId: "a1", summary: "Leave rule" }, escalation: { id: "e1", status: "answered", answeredBy: "Asha (Manager)" } });
    expect(bubbles[2]).toMatchObject({ answeredBy: "Asha (Manager)" });
  });
});

describe("streamed answer updates", () => {
  const pending: KiaraChatBubble = { id: "x", role: "assistant", text: "", pending: true };

  it("appends deltas and citations, records an offer, and takes the final text from done", () => {
    let bubble = kiaraAnswerAfterEvent(pending, { event: "delta", data: { text: "Aap" } });
    bubble = kiaraAnswerAfterEvent(bubble, { event: "delta", data: { text: "ke 2 task" } });
    bubble = kiaraAnswerAfterEvent(bubble, { event: "citation", data: { marker: 1, chunk_id: "k", document_id: "d", title: "SOP", heading_path: "" } });
    bubble = kiaraAnswerAfterEvent(bubble, { event: "escalation_offer", data: { message_id: "a9", offer_id: "o", reason: "no_kb_match", summary: "S" } });
    expect(bubble).toMatchObject({ text: "Aapke 2 task", pending: true, citations: [{ marker: 1 }], offer: { messageId: "a9", summary: "S" } });
    bubble = kiaraAnswerAfterEvent(bubble, { event: "done", data: { assistant_message_id: "a9", stop_reason: "end_turn", quota, display_text: "Aapke 2 task pending hain." } });
    expect(bubble).toMatchObject({ text: "Aapke 2 task pending hain.", pending: false });
  });

  it("ignores meta and status, which change the screen and not the bubble", () => {
    expect(kiaraAnswerAfterEvent(pending, { event: "status", data: { phase: "tool", label: "Checking" } })).toBe(pending);
  });

  it("finishes from the JSON result", () => {
    const bubble = kiaraAnswerFromResult(pending, { conversation_id: "c", user_message_id: "u", assistant_message_id: "a", stop_reason: "end_turn", display_text: "Done", quota, citations: [], escalation_offer: { message_id: "a", offer_id: "o", reason: "needs_judgment", summary: "S" } });
    expect(bubble).toMatchObject({ text: "Done", pending: false, offer: { messageId: "a", summary: "S" } });
  });

  it("marks escalations sent and withdrawn", () => {
    const offered: KiaraChatBubble = { id: "a", role: "assistant", text: "t", offer: { messageId: "a", summary: "S" } };
    const sent = kiaraBubblesWithEscalation([offered], "a", { id: "e1", status: "open", answeredBy: null });
    expect(sent[0]!.escalation).toEqual({ id: "e1", status: "open", answeredBy: null });
    expect(kiaraBubblesWithdrawn(sent, "e1")[0]!.escalation?.status).toBe("withdrawn");
  });
});
