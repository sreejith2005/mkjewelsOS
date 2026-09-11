// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@jewelos/core";
import { DailyChecklistManager } from "./DailyChecklistManager";

const apiMocks = vi.hoisted(() => ({
  loadDailyChecklistManagement: vi.fn(),
  saveDailyChecklist: vi.fn(),
}));
const signedIn = vi.hoisted(() => ({ role: "hr" as UserRole }));

vi.mock("./api", () => apiMocks);
// Management is gated by the daily_checklists.manage permission; the built-in
// access for a role reproduces the defaults (Super Admin and HR).
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return { useAuth: () => ({ access: builtinAccessContext({ id: "signed-in", user_role: signedIn.role }) }) };
});

describe("DailyChecklistManager", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.loadDailyChecklistManagement.mockResolvedValue({
      checklists: [],
      designations: [{ id: "designation-1", label: "CRM Executive" }],
    });
    apiMocks.saveDailyChecklist.mockResolvedValue({ id: "checklist-1", revision: 1 });
  });

  it("does not expose checklist management to staff", () => {
    signedIn.role = "staff";
    render(<DailyChecklistManager />);
    expect(screen.queryByRole("heading", { name: "Daily checklists" })).toBeNull();
  });

  it("replaces checklist items from pasted non-empty lines", async () => {
    signedIn.role = "hr";
    render(<DailyChecklistManager />);
    await screen.findByRole("option", { name: "CRM Executive" });

    fireEvent.change(screen.getByLabelText("Designation"), { target: { value: "designation-1" } });
    fireEvent.change(screen.getByLabelText("Paste SOP checklist lines"), {
      target: { value: "Review follow-ups.\n\nUpdate CRM notes.\nEscalate pending issues." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Replace checklist lines" }));

    expect(screen.getByDisplayValue("Review follow-ups.")).toBeTruthy();
    expect(screen.getByDisplayValue("Update CRM notes.")).toBeTruthy();
    expect(screen.getByDisplayValue("Escalate pending issues.")).toBeTruthy();
  });

  it("confirms a successful save without waiting for another management reload", async () => {
    signedIn.role = "hr";
    render(<DailyChecklistManager />);
    await screen.findByRole("option", { name: "CRM Executive" });

    fireEvent.change(screen.getByLabelText("Designation"), { target: { value: "designation-1" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "CRM daily routine" } });
    fireEvent.change(screen.getByLabelText("Paste SOP checklist lines"), { target: { value: "Review follow-ups." } });
    fireEvent.click(screen.getByRole("button", { name: "Replace checklist lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Save checklist" }));

    expect(await screen.findByText("Checklist saved.")).toBeTruthy();
    expect(apiMocks.loadDailyChecklistManagement).toHaveBeenCalledTimes(1);
  });

  it("shows the server save error instead of a generic message", async () => {
    apiMocks.saveDailyChecklist.mockRejectedValue({ message: "Daily checklist changed; refresh and retry" });
    signedIn.role = "hr";
    render(<DailyChecklistManager />);
    await screen.findByRole("option", { name: "CRM Executive" });

    fireEvent.change(screen.getByLabelText("Designation"), { target: { value: "designation-1" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "CRM daily routine" } });
    fireEvent.change(screen.getByLabelText("Paste SOP checklist lines"), { target: { value: "Review follow-ups." } });
    fireEvent.click(screen.getByRole("button", { name: "Replace checklist lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Save checklist" }));

    expect(await screen.findByText("Daily checklist changed; refresh and retry")).toBeTruthy();
  });
});
