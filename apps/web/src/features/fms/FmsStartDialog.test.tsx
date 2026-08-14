// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/types";
import type { FmsData } from "./api";
import { FmsStartDialog } from "./FmsStartDialog";

const apiMocks = vi.hoisted(() => ({ startFmsInstance: vi.fn() }));
vi.mock("./api", async () => ({ startFmsInstance: apiMocks.startFmsInstance }));

const data: FmsData = {
  flows: [{ id: "flow", family_id: "family", version: 1, name: "Sales intake", description: null, status: "published", scope_type: "branch", branch_id: "andheri", department_id: "sales-a", is_active: true, usage_count: 0 }],
  stages: [{ id: "stage", fms_flow_id: "flow", stage_key: "form", name: "Lead form", method: null, step_type: "form", sort_order: 0, is_required: true, planned_time_rule: {}, completion_rule: "any_doer", allow_multiple_doers: false, requires_upload: false, requires_remark: false, checklist_definition: [], form_template_id: "form", requires_next_doer_handoff: false, can_move_backward: false, can_reject: false, can_request_revision: false, can_escalate: false, default_next_stage_id: null, parallel_target_stage_ids: [], join_rule: null, join_required_stage_ids: null, split_to_flow_id: null }],
  assignees: [{ fms_stage_id: "stage", assignee_type: "specific_user", user_profile_id: "u1", fallback_user_profile_id: null, role_value: null, allow_next_selection: false, sort_order: 0 }],
  branchRules: [], forms: [], availability: [{ user_profile_id: "u3", status: "absent" }],
  branches: [{ id: "andheri", name: "Andheri" }, { id: "bandra", name: "Bandra" }],
  departments: [{ id: "sales-a", branch_id: "andheri", name: "Sales" }, { id: "sales-b", branch_id: "bandra", name: "Sales" }],
  users: [
    { id: "u1", employee_name: "Andheri Owner", employee_code: "A-1", account_status: "active", user_role: "staff", branch_id: "andheri", department_id: "sales-a", working_status: "active", is_login_enabled: true },
    { id: "u2", employee_name: "Bandra Owner", employee_code: "B-1", account_status: "invited", user_role: "staff", branch_id: "bandra", department_id: "sales-b", working_status: "active", is_login_enabled: false },
    { id: "u3", employee_name: "Absent Person", employee_code: "B-2", account_status: "active", user_role: "staff", branch_id: "bandra", department_id: "sales-b", working_status: "active", is_login_enabled: true },
  ],
};
const profile = { id: "admin", branch_id: "andheri", department_id: "sales-a", user_role: "admin" } as UserProfile;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("FMS start dialog", () => {
  it("lets an administrator replace an old branch scope and choose the concrete first owner", async () => {
    apiMocks.startFmsInstance.mockResolvedValue({ instance_id: "instance", reference_number: "FMS-1" });
    const onStarted = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FmsStartDialog data={data} initialFlowId="flow" onClose={() => undefined} onStarted={onStarted} profile={profile} />);

    const branch = screen.getByLabelText("Branch");
    expect((branch as HTMLSelectElement).disabled).toBe(false);
    await user.selectOptions(branch, "bandra");
    await user.selectOptions(screen.getByLabelText("Department"), "sales-b");
    const assignee = screen.getByLabelText("Starting assignee");
    expect(assignee.textContent).toContain("Bandra Owner");
    expect(assignee.textContent).toContain("invited");
    expect((screen.getByRole("option", { name: /Absent Person/ }) as HTMLOptionElement).disabled).toBe(true);
    await user.selectOptions(assignee, "u2");
    await user.type(screen.getByLabelText("Instance title"), "Bandra sales run");
    await user.click(screen.getByRole("button", { name: "Start workflow" }));

    expect(apiMocks.startFmsInstance).toHaveBeenCalledWith(expect.objectContaining({ flowId: "flow", branchId: "bandra", departmentId: "sales-b", firstAssigneeId: "u2" }));
    expect(onStarted).toHaveBeenCalledWith({ instance_id: "instance", reference_number: "FMS-1" });
  });
});
