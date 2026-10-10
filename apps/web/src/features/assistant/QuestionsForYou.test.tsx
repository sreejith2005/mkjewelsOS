// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KiaraEscalationItem } from "@jewelos/data/assistant/escalations";

const realtime = vi.hoisted(() => ({ refresh: null as null | (() => unknown) }));
const escalations = vi.hoisted(() => ({ getKiaraEscalationBadge: vi.fn(), listKiaraEscalations: vi.fn(), answerKiaraEscalation: vi.fn() }));
vi.mock("@jewelos/data/assistant/escalations", () => ({ ...escalations, KIARA_ANSWER_MAX_LENGTH: 4000 }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { tenant_id: "t1" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({
  useTenantRealtimeRefresh: ({ tenantId, refresh }: { tenantId: string | null; refresh: () => unknown }) => {
    if (tenantId) realtime.refresh = refresh;
    return () => {};
  },
}));

import { NavCountBadge } from "@/components/shell/MobileNavigationDrawer";
import { QuestionsForYou } from "./QuestionsForYou";
import { useKiaraEscalationBadge } from "./useKiaraEscalationBadge";

afterEach(() => { cleanup(); vi.clearAllMocks(); realtime.refresh = null; });

const item = (change: Partial<KiaraEscalationItem> = {}): KiaraEscalationItem => ({
  id: "e1", status: "open", reason: "no_kb_match", question: "Synthetic: may staff bring pets?", summary: "Pets in the showroom",
  created_at: new Date(Date.now() - 5 * 60000).toISOString(), asker_name: "Asha Rao", asker_designation: "Sales Executive",
  department: "Sales", branch: "Bandra", answered_by: null, answered_at: null, answer: null, saved_document_id: null, ...change,
});

describe("QuestionsForYou", () => {
  it("lists questions and sends an answer saved to the knowledge base", async () => {
    const list = vi.fn().mockResolvedValue([item()]);
    const answer = vi.fn().mockResolvedValue({ savedDocumentId: "d1" });
    render(<QuestionsForYou answer={answer} list={list} />);
    expect(await screen.findByText("Synthetic: may staff bring pets?")).toBeTruthy();
    expect(screen.getByText("Not in the SOPs")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Answer" }));
    fireEvent.change(screen.getByLabelText(/Your answer/), { target: { value: "No pets inside." } });
    fireEvent.click(screen.getByLabelText(/Save to knowledge base/));
    expect((screen.getByLabelText("Title for the knowledge base") as HTMLInputElement).value).toBe("Pets in the showroom");
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(answer).toHaveBeenCalledWith({ escalationId: "e1", answer: "No pets inside.", saveToKnowledgeBase: true, knowledgeTitle: "Pets in the showroom" }));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("explains when someone else answered first", async () => {
    const list = vi.fn().mockResolvedValue([item()]);
    const answer = vi.fn().mockRejectedValue(new Error("This question was already answered by Meera (Store Manager)."));
    render(<QuestionsForYou answer={answer} focusId="e1" list={list} />);
    fireEvent.change(await screen.findByLabelText(/Your answer/), { target: { value: "Late answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(await screen.findByText(/already answered by Meera/)).toBeTruthy();
  });

  it("says when a notified question is no longer waiting", async () => {
    render(<QuestionsForYou focusId="gone" list={vi.fn().mockResolvedValue([])} />);
    expect(await screen.findByText(/no longer waiting/)).toBeTruthy();
  });
});

describe("useKiaraEscalationBadge", () => {
  it("counts open questions and refreshes through the assistant realtime topic", async () => {
    escalations.getKiaraEscalationBadge.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const { result } = renderHook(() => useKiaraEscalationBadge("t1", true));
    await waitFor(() => expect(result.current).toBe(2));
    await realtime.refresh?.();
    await waitFor(() => expect(result.current).toBe(1));
  });

  it("stays at zero and asks nothing without the permission", () => {
    const { result } = renderHook(() => useKiaraEscalationBadge("t1", false));
    expect(result.current).toBe(0);
    expect(escalations.getKiaraEscalationBadge).not.toHaveBeenCalled();
  });

  it("draws the count on the navigation item", () => {
    render(<NavCountBadge count={3} label="open questions for you" />);
    expect(screen.getByRole("status", { name: "3 open questions for you" }).textContent).toBe("3");
    cleanup();
    const { container } = render(<NavCountBadge count={0} label="x" />);
    expect(container.textContent).toBe("");
  });
});
