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
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "p1", tenant_id: "t1", employee_name: "Asha Rao", user_role: "staff" } }) }));

import { AskKiaraPage, bubblesFor } from "./AskKiaraPage";

const quota = { used: 2, limit: 10, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" };

beforeEach(() => {
  for (const mock of Object.values(data)) mock.mockReset();
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
        { id: "m1", ordinal: 1, role: "user", display_text: "Q1", reply_to_message_id: null, refunded: true, stop_reason: null, created_at: "x" },
        { id: "m2", ordinal: 2, role: "user", display_text: "Q2", reply_to_message_id: null, refunded: false, stop_reason: null, created_at: "x" },
        { id: "m3", ordinal: 3, role: "assistant", display_text: "A2", reply_to_message_id: "m2", refunded: false, stop_reason: "end_turn", created_at: "x" },
      ],
    });
    expect(bubbles.map((bubble) => bubble.note ?? bubble.text)).toEqual(["Q1", "Kiara could not answer this one, so it was not counted.", "Q2", "A2"]);
  });
});
