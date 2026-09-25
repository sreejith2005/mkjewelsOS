// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveApplications } from "./LeaveApplications";

const leave = (id: string, reference: string) => ({
  id, reference_code: reference, applicant_id: "me", tenant_id: "t", branch_id: "b", leave_type: "Casual Leave", duration: "FULL DAY",
  reason: "Family", leave_start: "2026-10-01", leave_end: "2026-10-01", work_start_date: "2026-10-02", work_start_in: "1ST HALF",
  submitted_at: "2026-09-25T10:00:00Z", inform_status: "Inform Adv", total_leave_count: 1, tl_approval_path: `t/me/tl/${id}.png`,
  handover_to: null, handover_approval_path: null, handed_over_at: null, status: "pending", hr_remark: null,
  reviewed_by: null, reviewed_at: null, updated_at: "2026-09-25T10:00:00Z",
});

const api = vi.hoisted(() => ({
  canSubmitLeave: vi.fn(), editPendingLeave: vi.fn(), leaveHandoverCandidates: vi.fn(), leaveTypes: vi.fn(),
  listLeaveRequests: vi.fn(), reviewLeave: vi.fn(), signedLeaveImage: vi.fn(), submitHandover: vi.fn(), submitLeave: vi.fn(),
}));
vi.mock("@jewelos/data/leave/api", () => api);
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  const profile = { id: "me", tenant_id: "t", employee_name: "Richelle", user_role: "staff" as const };
  return { useAuth: () => ({ access: builtinAccessContext(profile), branch: { name: "Main" }, profile }) };
});

describe("LeaveApplications handover", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    api.canSubmitLeave.mockResolvedValue(true);
    api.leaveTypes.mockResolvedValue([{ value: "Casual Leave", label: "Casual Leave" }]);
    api.leaveHandoverCandidates.mockResolvedValue([{ id: "me", employee_name: "Richelle" }, { id: "peer", employee_name: "Asha" }]);
    api.listLeaveRequests.mockResolvedValue([leave("one", "RICHELLE-25-SEP-2026-100000"), leave("two", "RICHELLE-25-SEP-2026-110000")]);
  });

  it("Fill handover selects the leave, scrolls to the form, and focuses it", async () => {
    render(<LeaveApplications />);
    fireEvent.click(await screen.findByRole("tab", { name: /Handover/ }));
    const fill = await screen.findAllByRole("button", { name: "Fill handover" });
    fireEvent.click(fill[1]!);

    expect(screen.getByLabelText("Selected leave (Unique ID)")).toHaveProperty("value", "RICHELLE-25-SEP-2026-110000");
    expect(screen.getByRole("button", { name: "Selected" })).toBeTruthy();
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Handover done?")));
  });
});
