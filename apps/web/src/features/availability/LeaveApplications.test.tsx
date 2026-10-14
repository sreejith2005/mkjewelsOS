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
  canSubmitLeave: vi.fn(), editPendingLeave: vi.fn(), leaveHandoverCandidates: vi.fn(), leaveSummaryApplicants: vi.fn(), leaveTypes: vi.fn(),
  listLeaveRequests: vi.fn(), deleteLeaveRequests: vi.fn(), reviewLeave: vi.fn(), signedLeaveImage: vi.fn(), submitHandover: vi.fn(), submitLeave: vi.fn(),
}));
const actor = vi.hoisted(() => ({ role: "staff" as "staff" | "super_admin" }));
vi.mock("@jewelos/data/leave/api", () => api);
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: vi.fn() }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  const staffProfile = { id: "me", tenant_id: "t", employee_name: "Richelle", user_role: "staff" as const };
  const adminProfile = { ...staffProfile, user_role: "super_admin" as const };
  return { useAuth: () => {
    const profile = actor.role === "super_admin" ? adminProfile : staffProfile;
    return { access: builtinAccessContext(profile), branch: { name: "Main" }, profile };
  } };
});

describe("LeaveApplications handover", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    actor.role = "staff";
    Element.prototype.scrollIntoView = vi.fn();
    api.canSubmitLeave.mockResolvedValue(true);
    api.leaveTypes.mockResolvedValue([{ value: "Casual Leave", label: "Casual Leave" }]);
    api.leaveHandoverCandidates.mockResolvedValue([{ id: "me", employee_name: "Richelle" }, { id: "peer", employee_name: "Asha" }]);
    api.leaveSummaryApplicants.mockResolvedValue([{ id: "peer", employee_name: "Asha" }]);
    api.listLeaveRequests.mockResolvedValue([leave("one", "RICHELLE-25-SEP-2026-100000"), leave("two", "RICHELLE-25-SEP-2026-110000")]);
  });

  it("shows office totals and another employee's request to a Super Admin", async () => {
    actor.role = "super_admin";
    api.canSubmitLeave.mockResolvedValue(false);
    api.listLeaveRequests.mockResolvedValue([{ ...leave("peer-leave", "ASHA-26-SEP-2026"), applicant_id: "peer", status: "approved" }]);
    render(<LeaveApplications />);
    expect(await screen.findByText("Office leave history")).toBeTruthy();
    expect(screen.getByText("Office days requested")).toBeTruthy();
    expect(screen.getByText("Asha · Casual Leave · FULL DAY")).toBeTruthy();
    expect(screen.getByText("Reason: Family")).toBeTruthy();
    expect(api.listLeaveRequests).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
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

  it("confirms individual removal and refreshes the summary", async () => {
    actor.role = "super_admin";
    api.canSubmitLeave.mockResolvedValue(false);
    api.deleteLeaveRequests.mockResolvedValue(1);
    render(<LeaveApplications />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[0]!);
    expect(api.deleteLeaveRequests).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete leave requests" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.deleteLeaveRequests).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]!);
    api.listLeaveRequests.mockResolvedValue([leave("two", "RICHELLE-25-SEP-2026-110000")]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(screen.queryByText("RICHELLE-25-SEP-2026-100000")).toBeNull());
    expect(api.deleteLeaveRequests).toHaveBeenCalledWith(["one"]);
    expect(screen.getByText("1 leave request deleted.")).toBeTruthy();
  });

  it("selects all for bulk removal and keeps entries on failure", async () => {
    actor.role = "super_admin";
    api.canSubmitLeave.mockResolvedValue(false);
    api.deleteLeaveRequests.mockRejectedValue(new Error("Deletion denied"));
    render(<LeaveApplications />);
    fireEvent.click(await screen.findByLabelText("Select all leave requests"));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText("Deletion denied")).toBeTruthy();
    expect(api.deleteLeaveRequests).toHaveBeenCalledWith(["one", "two"]);
    expect(screen.getAllByText("RICHELLE-25-SEP-2026-100000").length).toBeGreaterThan(0);
  });

  it("does not offer deletion to ordinary users", async () => {
    render(<LeaveApplications />);
    fireEvent.click(await screen.findByRole("tab", { name: "Leave summary" }));
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByLabelText("Select all leave requests")).toBeNull();
  });
});
