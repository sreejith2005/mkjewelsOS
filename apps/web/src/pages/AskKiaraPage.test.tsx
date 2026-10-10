// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskKiaraOptions } from "@jewelos/data/assistant/api";

const data = vi.hoisted(() => ({
  askKiara: vi.fn(),
  listMyKiaraConversations: vi.fn(),
  getMyKiaraConversation: vi.fn(),
  getMyKiaraQuota: vi.fn(),
  archiveMyKiaraConversation: vi.fn(),
}));
vi.mock("@jewelos/data/assistant/api", () => ({ ...data, KIARA_CONVERSATION_QUESTION_LIMIT: 15, KIARA_QUESTION_MAX_LENGTH: 2000 }));
const escalations = vi.hoisted(() => ({ createKiaraEscalation: vi.fn(), withdrawMyKiaraEscalation: vi.fn(), getKiaraEscalationBadge: vi.fn() }));
vi.mock("@jewelos/data/assistant/escalations", () => escalations);
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => () => {} }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "p1", tenant_id: "t1", employee_name: "Asha Rao", user_role: "staff" } }) }));

import { AskKiaraPage, bubblesFor, kiaraLocation } from "./AskKiaraPage";

const extra = { escalation_offer: null, escalation: null, answered_by: null };

const quota = { used: 2, limit: 10, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" };

beforeEach(() => {
  for (const mock of Object.values(data)) mock.mockReset();
  for (const mock of Object.values(escalations)) mock.mockReset();
  data.listMyKiaraConversations.mockResolvedValue([]);
  data.getMyKiaraQuota.mockResolvedValue(quota);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("AskKiaraPage", () => {
  it("greets the user with suggestions and the quota chip", async () => {
    render(<AskKiaraPage onNavigate={vi.fn()} />);
    expect(screen.getByText("Namaste, Asha! I'm Kiara.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aaj mera kya pending hai?" })).toBeTruthy();
    expect(await screen.findByText(/8 of 10 questions left today/)).toBeTruthy();
    expect(screen.getByText("Your chats will appear here.")).toBeTruthy();
  });

  it("streams an answer into the chat and replaces it with the final text", async () => {
    data.askKiara.mockImplementation(async (options: AskKiaraOptions) => {
      options.onEvent?.({ event: "meta", data: { conversation_id: "c1", user_message_id: "u1", quota: { ...quota, used: 3 } } });
      options.onEvent?.({ event: "status", data: { phase: "tool", label: "Checking your work" } });
      options.onEvent?.({ event: "delta", data: { text: "Aapke 2 task " } });
      options.onEvent?.({ event: "done", data: { assistant_message_id: "a1", stop_reason: "end_turn", quota: { ...quota, used: 3 }, display_text: "Aapke 2 task pending hain." } });
      return { ok: true, requestId: "r1", result: { conversation_id: "c1", user_message_id: "u1", assistant_message_id: "a1", stop_reason: "end_turn", display_text: "Aapke 2 task pending hain.", quota: { ...quota, used: 3 } } };
    });
    render(<AskKiaraPage onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Aaj mera kya pending hai?" }));
    expect(await screen.findByText("Aapke 2 task pending hain.")).toBeTruthy();
    expect(screen.getByText("Aaj mera kya pending hai?")).toBeTruthy();
    expect(screen.getByText(/7 of 10 questions left today/)).toBeTruthy();
    expect(data.askKiara).toHaveBeenCalledWith(expect.objectContaining({ conversationId: null, message: "Aaj mera kya pending hai?", client: "web" }));
  });

  it("puts a refused question back in the box and explains why", async () => {
    data.askKiara.mockResolvedValue({ ok: false, requestId: "r1", conversationId: null, code: "daily_limit_reached", message: "You have used all your questions for today.", quota: { ...quota, used: 10 } });
    render(<AskKiaraPage onNavigate={vi.fn()} />);
    const box = screen.getByLabelText("Your question");
    fireEvent.change(box, { target: { value: "One more?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("You have used all your questions for today.")).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).value).toBe("One more?"));
  });

  it("locks the composer when the day's questions are used up", async () => {
    data.getMyKiaraQuota.mockResolvedValue({ ...quota, used: 10 });
    render(<AskKiaraPage onNavigate={vi.fn()} />);
    expect(await screen.findByText(/You have used all 10 questions for today. They reset at 12:00 am on 10 Oct./)).toBeTruthy();
    expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("explains a stored question that has no answer", () => {
    const bubbles = bubblesFor({
      id: "c1", title: "t", created_at: "x", last_message_at: "x", question_count: 2,
      messages: [
        { id: "m1", ordinal: 1, role: "user", display_text: "Q1", reply_to_message_id: null, refunded: true, stop_reason: null, created_at: "x", citations: [], ...extra },
        { id: "m2", ordinal: 2, role: "user", display_text: "Q2", reply_to_message_id: null, refunded: false, stop_reason: null, created_at: "x", citations: [], ...extra },
        { id: "m3", ordinal: 3, role: "assistant", display_text: "A2", reply_to_message_id: "m2", refunded: false, stop_reason: "end_turn", created_at: "x", citations: [], ...extra },
      ],
    });
    expect(bubbles.map((bubble) => bubble.note ?? bubble.text)).toEqual(["Q1", "Kiara could not answer this one, so it was not counted.", "Q2", "A2"]);
  });

  it("offers to ask a person, sends it on confirmation, and can withdraw it", async () => {
    const offerId = "3f1c9a52-7f0e-4c43-9d2a-2b6a1f0e9c11";
    data.askKiara.mockImplementation(async (options: AskKiaraOptions) => {
      options.onEvent?.({ event: "meta", data: { conversation_id: "c1", user_message_id: "u1", quota } });
      options.onEvent?.({ event: "escalation_offer", data: { message_id: "a1", offer_id: offerId, reason: "no_kb_match", summary: "Synthetic pets question" } });
      return { ok: true, requestId: "r1", result: { conversation_id: "c1", user_message_id: "u1", assistant_message_id: "a1", stop_reason: "end_turn", display_text: "I could not find this.", quota, citations: [], escalation_offer: { message_id: "a1", offer_id: offerId, reason: "no_kb_match", summary: "Synthetic pets question" } } };
    });
    escalations.createKiaraEscalation.mockResolvedValue({ escalationId: "e1", recipients: 1 });
    escalations.withdrawMyKiaraEscalation.mockResolvedValue(undefined);
    render(<AskKiaraPage onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Can I bring my dog?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask a person" }));
    expect(await screen.findByText(/Sent to a person/)).toBeTruthy();
    expect(escalations.createKiaraEscalation).toHaveBeenCalledWith("a1");
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(await screen.findByText("You withdrew this question.")).toBeTruthy();
    expect(escalations.withdrawMyKiaraEscalation).toHaveBeenCalledWith("e1");
  });

  it("shows a person's answer with who answered", () => {
    const bubbles = bubblesFor({
      id: "c1", title: "t", created_at: "x", last_message_at: "x", question_count: 1,
      messages: [
        { id: "m1", ordinal: 1, role: "user", display_text: "Q1", reply_to_message_id: null, refunded: false, stop_reason: null, created_at: "x", citations: [], ...extra },
        { id: "m2", ordinal: 2, role: "assistant", display_text: "Not found.", reply_to_message_id: "m1", refunded: false, stop_reason: "end_turn", created_at: "x", citations: [], ...extra,
          escalation_offer: { offer_id: "3f1c9a52-7f0e-4c43-9d2a-2b6a1f0e9c11", reason: "no_kb_match", summary_en: "S" },
          escalation: { id: "e1", status: "answered", answered_by: "Meera (Store Manager)", answered_at: "2026-10-10T10:00:00Z" } },
        { id: "m3", ordinal: 3, role: "human_answer", display_text: "No pets, please.", reply_to_message_id: null, refunded: false, stop_reason: null, created_at: "2026-10-10T10:00:00Z", citations: [], ...extra, answered_by: "Meera (Store Manager)" },
      ],
    });
    expect(bubbles[1]).toMatchObject({ offer: { messageId: "m2" }, escalation: { id: "e1", status: "answered", answeredBy: "Meera (Store Manager)" } });
    expect(bubbles[2]).toMatchObject({ role: "human", text: "No pets, please.", answeredBy: "Meera (Store Manager)" });
  });

  it("reads notification links", () => {
    expect(kiaraLocation("?tab=questions&escalation=e1")).toEqual({ tab: "questions", escalationId: "e1", conversationId: null });
    expect(kiaraLocation("?conversation=c9")).toEqual({ tab: "chat", escalationId: null, conversationId: "c9" });
    expect(kiaraLocation("?tab=other").tab).toBe("chat");
  });

  it("opens the conversation a notification points at", async () => {
    data.getMyKiaraConversation.mockResolvedValue({ id: "c9", title: "t", created_at: "x", last_message_at: "x", question_count: 1, messages: [
      { id: "m1", ordinal: 1, role: "user", display_text: "Synthetic earlier question", reply_to_message_id: null, refunded: false, stop_reason: null, created_at: "x", citations: [], ...extra },
    ] });
    render(<AskKiaraPage onNavigate={vi.fn()} search="?conversation=c9" />);
    expect(await screen.findByText("Synthetic earlier question")).toBeTruthy();
    expect(data.getMyKiaraConversation).toHaveBeenCalledWith("c9");
  });
});
