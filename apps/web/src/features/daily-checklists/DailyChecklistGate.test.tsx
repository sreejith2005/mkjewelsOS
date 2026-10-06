// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyChecklistStatus } from "@jewelos/core";
import { DailyChecklistGate } from "./DailyChecklistGate";

const mocks = vi.hoisted(() => ({ load: vi.fn(), acknowledge: vi.fn(), refresh: undefined as (() => Promise<void> | void) | undefined }));
vi.mock("./api", () => ({ loadMyDailyChecklistStatus: mocks.load, acknowledgeDailyChecklist: mocks.acknowledge }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "user-1", tenant_id: "tenant-1" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: ({ refresh }: { refresh: () => Promise<void> | void }) => { mocks.refresh = refresh; } }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); mocks.refresh = undefined; });

const required = { required: true, date: "2026-08-25", checklist: { id: "10000000-0000-4000-8000-000000000001", designationId: "10000000-0000-4000-8000-000000000002", title: "CRM daily routine", instruction: null, confirmationText: "I am ready for today", revision: 1, items: [{ id: "10000000-0000-4000-8000-000000000003", text: "Review pending follow-ups." }, { id: "10000000-0000-4000-8000-000000000004", text: "Confirm today's priorities." }] } } as const;

describe("DailyChecklistGate", () => {
  beforeEach(() => { vi.useFakeTimers(); mocks.load.mockResolvedValue(required); mocks.acknowledge.mockResolvedValue(undefined); });

  it("requires every visible item before enabling affirmation", async () => {
    render(<DailyChecklistGate profileId="profile-1" />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(1500); });
    const confirm = screen.getByRole("button", { name: "I am ready for today" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Review pending follow-ups." }));
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not hide the next day's checklist when an earlier acknowledgement returns late", async () => {
    let finish: (() => void) | undefined;
    mocks.acknowledge.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<DailyChecklistGate profileId="profile-1" />);
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1500); });
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: required.checklist.confirmationText }));
    mocks.load.mockResolvedValue({ ...required, date: "2026-08-26" });
    await act(async () => { await mocks.refresh?.(); });
    await act(async () => { finish?.(); });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(false);
  });
  it("ignores a delayed acknowledgement after the profile changes", async () => {
    let finish: (() => void) | undefined;
    mocks.acknowledge.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<DailyChecklistGate profileId="profile-1" />);
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1500); });
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: required.checklist.confirmationText }));
    view.rerender(<DailyChecklistGate profileId="profile-2" />);
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1500); finish?.(); });
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});

it("preserves checked items on refresh and closes after another device acknowledges", async () => {
  vi.useFakeTimers();
  const status: DailyChecklistStatus = { required: true, date: "2026-10-06", checklist: { id: "checklist-1", designationId: "designation-1", title: "Opening routine", instruction: null, items: [{ id: "item-1", text: "Check counter" }], confirmationText: "Confirm routine", revision: 1 } };
  mocks.load.mockResolvedValue(status);
  render(<DailyChecklistGate profileId="user-1" />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  fireEvent.click(screen.getByRole("checkbox", { name: "Check counter" }));
  expect(typeof mocks.refresh).toBe("function");
  await act(async () => { await mocks.refresh?.(); });
  expect((screen.getByRole("checkbox", { name: "Check counter" }) as HTMLInputElement).checked).toBe(true);
  mocks.load.mockResolvedValue({ required: false, date: status.date, checklist: null });
  await act(async () => { await mocks.refresh?.(); });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.acknowledge).not.toHaveBeenCalled();
});
