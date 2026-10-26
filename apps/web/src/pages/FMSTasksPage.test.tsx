// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FMSTasksPage } from "./FMSTasksPage";

const step = (id: string, name: string, sort: number, next: string | null, type = "task") => ({ id, fms_flow_id: "flow", stage_key: id, name, method: null, step_type: type, sort_order: sort, is_required: true, planned_time_rule: {}, completion_rule: "any_doer", allow_multiple_doers: false, requires_upload: false, requires_remark: false, checklist_definition: [], form_template_id: null, requires_next_doer_handoff: false, can_move_backward: false, can_reject: false, can_request_revision: false, can_escalate: false, default_next_stage_id: next, parallel_target_stage_ids: [], join_rule: null, join_required_stage_ids: null, split_to_flow_id: null });
const run = (id: string, status: string) => ({ id, fms_flow_id: "flow", reference_number: `FMS-${id}`, title: "INSTAGRAM LEADS · Form submission", status, priority: "medium", context: {}, branch_id: null, department_id: null, started_by: "me", started_at: "2026-10-20T10:00:00Z", completed_at: status === "completed" ? "2026-10-25T10:00:00Z" : null, parent_instance_id: null, flow_version: 1 });
const visit = (id: string, instance: string, stage: string, status: string, assigned: string) => ({ id, fms_instance_id: instance, fms_stage_id: stage, status, assigned_to: [assigned], planned_datetime: null, actual_datetime: null, delay_minutes: null, sla_breached: null, form_submission_id: null, remark: null, outcome: null, completed_by: status === "completed" ? assigned : null, escalation_count: 0 });

const runtime = {
  instances: [run("1", "active"), run("2", "active"), run("3", "completed")],
  stages: [
    visit("a", "1", "enquiry", "completed", "me"), visit("b", "1", "follow", "in_progress", "sales"),
    visit("c", "2", "proposal", "pending", "me"),
    visit("d", "3", "proposal", "completed", "sales"),
  ],
  definitions: [step("enquiry", "Enquiry", 0, "follow", "form"), step("follow", "Follow up", 1, "proposal"), step("proposal", "Proposal", 2, null)],
  flows: [{ id: "flow", family_id: "fam", version: 1, name: "Instagram Leads", description: null, status: "published", scope_type: "tenant", branch_id: null, department_id: null, is_active: true, usage_count: 3 }],
  checklist: [], evidence: [], logs: [],
  users: [{ id: "me", employee_name: "Meera" }, { id: "sales", employee_name: "Sunil" }],
};

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "me", tenant_id: "t", user_role: "staff" } }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/forms/api", () => ({ loadForms: async () => ({ bundles: [] }), loadFormDynamicOptions: async () => ({ users: [], branches: [], departments: [], masters: [] }) }));
vi.mock("@/features/fms/FmsStageRunner", () => ({ FmsStageRunner: ({ stage }: { stage: { id: string } }) => <div>Work for visit {stage.id}</div> }));
vi.mock("@/features/fms/FmsContextFirst", () => ({ FmsContextFirst: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/features/fms/api", () => ({
  loadFmsRuntime: async () => runtime,
  loadFmsRunNames: async () => new Map([["1", "Asha Rao"], ["2", "Ravi Kumar"], ["3", "Priya Shah"]]),
  setFmsInstanceStatus: async () => undefined,
}));

afterEach(cleanup);

describe("FMS runs board", () => {
  it("shows each client by name under the step they are on", async () => {
    render(<FMSTasksPage flowIds={["flow"]} heading="Instagram Leads" />);
    const follow = await screen.findByRole("region", { name: "Follow up, 1" });
    expect(within(follow).getByText("Asha Rao")).toBeTruthy();
    expect(within(follow).getByText("With Sunil")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Proposal, 1" })).getByText("Ravi Kumar")).toBeTruthy();
    expect(screen.queryByText("Priya Shah")).toBeNull();
    expect(screen.queryByText("My Stages")).toBeNull();
    expect(screen.queryByText("INSTAGRAM LEADS · Form submission")).toBeNull();
  });
  it("shows finished runs and filters to my work", async () => {
    const user = userEvent.setup();
    render(<FMSTasksPage flowIds={["flow"]} heading="Instagram Leads" />);
    await screen.findByText("Asha Rao");
    await user.click(screen.getByRole("button", { name: "Finished" }));
    expect(within(screen.getByRole("region", { name: "Finished, 1" })).getByText("Priya Shah")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "In progress" }));
    await user.click(screen.getByRole("checkbox", { name: "Only my work" }));
    // Meera started both, so both stay; the search narrows to one.
    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "ravi");
    expect(screen.queryByText("Asha Rao")).toBeNull();
    expect(screen.getByText("Ravi Kumar")).toBeTruthy();
  });
  it("opens a run with its whole path", async () => {
    const user = userEvent.setup();
    render(<FMSTasksPage flowIds={["flow"]} heading="Instagram Leads" />);
    await user.click(await screen.findByText("Asha Rao"));
    const path = screen.getByRole("region", { name: "Workflow path" });
    expect(within(path).getByText("Enquiry")).toBeTruthy();
    expect(within(path).getByText(/Done · Meera/)).toBeTruthy();
    expect(within(path).getByText(/Now · Sunil/)).toBeTruthy();
    expect(within(path).getByText("Next")).toBeTruthy();
    expect(screen.getByText("Work for visit b")).toBeTruthy();
  }, 20_000);
});
