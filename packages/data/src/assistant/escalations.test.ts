import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc: api.rpc }) }));

import { answerKiaraEscalation, asEscalationItem, createKiaraEscalation, escalationErrorMessage, getKiaraEscalationBadge, listKiaraEscalations } from "./escalations";

beforeEach(() => api.rpc.mockReset());

describe("escalations data API", () => {
  it("confirms an offer by the answer message id", async () => {
    api.rpc.mockResolvedValue({ data: { escalation_id: "e1", status: "open", recipients_count: 2 }, error: null });
    await expect(createKiaraEscalation("m1")).resolves.toEqual({ escalationId: "e1", recipients: 2 });
    expect(api.rpc).toHaveBeenCalledWith("create_kiara_escalation", { p_message_id: "m1" });
  });

  it("explains the documented failures", () => {
    expect(escalationErrorMessage({ message: "kiara_escalation_already_answered", details: "Meera (Store Manager)" })).toBe("This question was already answered by Meera (Store Manager).");
    expect(escalationErrorMessage({ message: "kiara_escalation_withdrawn" })).toBe("The employee withdrew this question.");
    expect(escalationErrorMessage({ code: "42501", message: "Question not found" })).toBe("You cannot do that for this question.");
  });

  it("answers with the title only when saving to the knowledge base", async () => {
    api.rpc.mockResolvedValue({ data: { status: "answered", saved_document_id: null }, error: null });
    await answerKiaraEscalation({ escalationId: "e1", answer: "  No pets.  ", saveToKnowledgeBase: false, knowledgeTitle: "Ignored" });
    expect(api.rpc).toHaveBeenCalledWith("answer_kiara_escalation_with_audit", { p_escalation_id: "e1", p_answer: "No pets.", p_save_to_kb: false, p_kb_title: null });
    api.rpc.mockResolvedValue({ data: { status: "answered", saved_document_id: "d1" }, error: null });
    await expect(answerKiaraEscalation({ escalationId: "e1", answer: "No pets.", saveToKnowledgeBase: true, knowledgeTitle: " Pets " })).resolves.toEqual({ savedDocumentId: "d1" });
    expect(api.rpc).toHaveBeenLastCalledWith("answer_kiara_escalation_with_audit", { p_escalation_id: "e1", p_answer: "No pets.", p_save_to_kb: true, p_kb_title: "Pets" });
  });

  it("reads the list and the badge defensively", async () => {
    api.rpc.mockResolvedValueOnce({ data: [{ id: "e1", question: "Q", created_at: "2026-10-10T00:00:00Z", status: "weird", reason: "x" }, { id: 2 }], error: null });
    const [item, ...rest] = await listKiaraEscalations("open");
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ id: "e1", status: "open", reason: "no_kb_match", asker_name: "A colleague" });
    api.rpc.mockResolvedValueOnce({ data: 3, error: null });
    await expect(getKiaraEscalationBadge()).resolves.toBe(3);
    expect(asEscalationItem(null)).toBeNull();
  });
});
