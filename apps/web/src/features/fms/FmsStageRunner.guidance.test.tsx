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
  expect(screen.getByRole("button", { name: "Fill the form: Call report" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Complete stage" })).toBeNull();
  expect(screen.getByText('Fill and submit the form "Call report"')).toBeTruthy();
  expect(screen.getByText(/Submitting the form also completes this step/)).toBeTruthy();
});
