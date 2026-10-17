// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi, type Mock } from "vitest";
import type { FmsWorkResult } from "@jewelos/core";
import type { ComponentProps } from "react";
const outcome = vi.hoisted(() => ({ value: null as FmsWorkResult | null }));
const confirmWork: Mock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("./useFmsHandoffConfirmation", () => ({ useFmsHandoffConfirmation: () => ({ confirmWork, result: outcome.value, confirmation: null }) }));
vi.mock("@/components/assignees/AssigneePicker", () => ({ AssigneePicker: ({ onChange }: { onChange: (ids: string[]) => void }) => <button onClick={() => onChange(["employee-d"])}>Choose legacy employee</button> }));
import { FmsStageRunner } from "./FmsStageRunner";
type Props = ComponentProps<typeof FmsStageRunner>;
const definition = { id: "approval", fms_flow_id: "flow", stage_key: "approval", name: "Approval", sort_order: 1, step_type: "approval", requires_next_doer_handoff: true, can_reject: true, planned_time_rule: {} } as unknown as Props["definition"];
const props: Props = {
  instance: { id: "instance", fms_flow_id: "flow", status: "active", assignment_version: 1 } as unknown as Props["instance"],
  stage: { id: "visit", fms_instance_id: "instance", fms_stage_id: "approval", status: "in_review", assigned_to: ["employee-b"] } as unknown as Props["stage"],
  instanceStages: [], definition, definitions: [{ ...definition, id: "initial", stage_key: "initial", sort_order: 0 }, definition],
  checklist: [], evidence: [], users: [], branches: [], departments: [], forms: [], formOptions: { users: [], branches: [], departments: [], masters: [] },
  profile: { id: "reviewer", user_role: "admin" } as unknown as Props["profile"], onRefresh: async () => {},
};
afterEach(() => { cleanup(); confirmWork.mockClear(); outcome.value = null; });
it.each([["Approve", "approved"], ["Reject", "rejected"]])("preserves the legacy next employee on %s", async (button, decision) => {
  const user = userEvent.setup(); render(<FmsStageRunner {...props} />);
  await user.click(screen.getByRole("button", { name: "Choose legacy employee" }));
  await user.click(screen.getByRole("button", { name: button }));
  await waitFor(() => expect(confirmWork).toHaveBeenCalledWith(expect.objectContaining({ kind: "review", decision, nextAssigneeId: "employee-d" })));
});

it.each(["awaiting_approval", "awaiting_other_doers"] as const)("retains approval controls after a saved form in state %s", state => {
  outcome.value = { state, submissionId: "saved", instanceId: "instance", referenceNumber: "FMS-41", sourceInstanceStageId: "visit", destinations: [], ownWorkTargets: [] };
  render(<FmsStageRunner {...props} />);
  expect(screen.getByRole("button", { name: "Approve", exact: true })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reject", exact: true })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Form submitted successfully" })).toBeTruthy();
});
it("replaces completed stage controls once successors are activated", () => {
  outcome.value = { state: "successors_activated", submissionId: "saved", instanceId: "instance", referenceNumber: "FMS-41", sourceInstanceStageId: "visit", destinations: [], ownWorkTargets: [] };
  render(<FmsStageRunner {...props} />);
  expect(screen.queryByRole("button", { name: "Approve", exact: true })).toBeNull();
  expect(screen.queryByText("Stage is not actionable for this user")).toBeNull();
  expect(screen.getByRole("heading", { name: "Form submitted successfully" })).toBeTruthy();
});
