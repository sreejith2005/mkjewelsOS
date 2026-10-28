// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
vi.mock("./useFmsHandoffConfirmation", () => ({ useFmsHandoffConfirmation: () => ({ confirmWork: vi.fn(), result: null, confirmation: null }) }));
import { FmsStageRunner } from "./FmsStageRunner";
type Props = ComponentProps<typeof FmsStageRunner>;

const decisionStage = { id: "call", fms_flow_id: "flow", stage_key: "call", name: "Introduction call", sort_order: 1, step_type: "task", requires_remark: true,
  planned_time_rule: { decisionMode: "yes_no" } } as unknown as Props["definition"];
const props: Props = {
  instance: { id: "instance", fms_flow_id: "flow", status: "active", assignment_version: 2 } as unknown as Props["instance"],
  stage: { id: "visit", fms_instance_id: "instance", fms_stage_id: "call", status: "in_progress", assigned_to: ["employee-a"], planned_datetime: null } as unknown as Props["stage"],
  instanceStages: [], definition: decisionStage, definitions: [{ ...decisionStage, id: "initial", stage_key: "initial", sort_order: 0 }, decisionStage],
  checklist: [], evidence: [], users: [{ id: "employee-a", employee_name: "Employee A" }] as unknown as Props["users"], branches: [], departments: [], forms: [],
  formOptions: { users: [], branches: [], departments: [], masters: [] },
  profile: { id: "employee-a", user_role: "staff" } as unknown as Props["profile"], onRefresh: async () => {},
};
afterEach(cleanup);

it("tells the employee exactly what is missing and ticks items off as they are done", async () => {
  const user = userEvent.setup();
  render(<FmsStageRunner {...props} />);
  const list = screen.getByText("Before you complete this step").parentElement!;
  expect(within(list).getByText("Choose a decision")).toBeTruthy();
  expect(within(list).getByText("Write a remark")).toBeTruthy();
  expect(screen.getByText("In progress")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Submit decision" }) as HTMLButtonElement).disabled).toBe(true);

  await user.click(screen.getByRole("button", { name: "Yes" }));
  expect(screen.getByRole("button", { name: "Yes" }).getAttribute("aria-pressed")).toBe("true");
  expect(within(list).getByText(/Choose a decision/).textContent).toContain("(done)");
  expect((screen.getByRole("button", { name: "Submit decision" }) as HTMLButtonElement).disabled).toBe(false);
});

it("leads with the form when the stage needs one, instead of a disabled Complete button", () => {
  const formStage = { ...decisionStage, planned_time_rule: { completionFormRequired: true }, requires_remark: false, form_template_id: "form-1" } as unknown as Props["definition"];
  const form = { id: "form-1", name: "Call report", description: null, version: 2, sections: [], fields: [] } as unknown as Props["forms"][number];
  render(<FmsStageRunner {...props} definition={formStage} definitions={[{ ...formStage, id: "initial", stage_key: "initial", sort_order: 0 }, formStage]} forms={[form]} />);
  expect(screen.getByRole("button", { name: "Fill the form" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark as done" })).toBeNull();
  // The button already says to fill the form, so the list does not repeat it.
  expect(screen.queryByText('Fill and submit the form "Call report"')).toBeNull();
  expect(screen.queryByText(/Submitting the form also completes this step/)).toBeNull();
});

it("has no claim button, outcome box or optional remark box", () => {
  const plain = { ...decisionStage, planned_time_rule: {}, requires_remark: false, form_template_id: null } as unknown as Props["definition"];
  render(<FmsStageRunner {...props} definition={plain} definitions={[{ ...plain, id: "initial", stage_key: "initial", sort_order: 0 }, plain]} />);
  expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
  expect(screen.queryByText(/Outcome/)).toBeNull();
  expect(screen.queryByText(/Remark/)).toBeNull();
  expect(screen.getByRole("button", { name: "Mark as done" })).toBeTruthy();
});

it("shows the remark box only when the step requires one", () => {
  const remarkStage = { ...decisionStage, planned_time_rule: {}, requires_remark: true, form_template_id: null } as unknown as Props["definition"];
  render(<FmsStageRunner {...props} definition={remarkStage} definitions={[{ ...remarkStage, id: "initial", stage_key: "initial", sort_order: 0 }, remarkStage]} />);
  expect(screen.getByLabelText("Remark *")).toBeTruthy();
});
