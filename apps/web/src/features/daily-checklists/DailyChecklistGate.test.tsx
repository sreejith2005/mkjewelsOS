// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DailyChecklistGate } from "./DailyChecklistGate";

const apiMocks = vi.hoisted(() => ({ loadMyDailyChecklistStatus: vi.fn(), acknowledgeDailyChecklist: vi.fn() }));
vi.mock("./api", () => apiMocks);

const required = { required: true, date: "2026-08-25", checklist: { id: "10000000-0000-4000-8000-000000000001", designationId: "10000000-0000-4000-8000-000000000002", title: "CRM daily routine", instruction: null, confirmationText: "I am ready for today", revision: 1, items: [{ id: "10000000-0000-4000-8000-000000000003", text: "Review pending follow-ups." }, { id: "10000000-0000-4000-8000-000000000004", text: "Confirm today's priorities." }] } } as const;

describe("DailyChecklistGate", () => {
  beforeEach(() => { vi.useFakeTimers(); apiMocks.loadMyDailyChecklistStatus.mockResolvedValue(required); apiMocks.acknowledgeDailyChecklist.mockResolvedValue(undefined); });

  it("requires every visible item before enabling affirmation", async () => {
    render(<DailyChecklistGate profileId="profile-1" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(1500); });
    const confirm = screen.getByRole("button", { name: "I am ready for today" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Review pending follow-ups." }));
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });
});
