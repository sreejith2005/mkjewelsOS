// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
vi.mock("./useFmsHandoffConfirmation", () => ({ useFmsHandoffConfirmation: () => ({ confirmWork: vi.fn(), result: null, confirmation: null }) }));
vi.mock("@/features/forms/api", () => ({ signedFormFileUrl: vi.fn(), uploadFormFile: vi.fn() }));
import { FmsEarlierAnswersContext } from "./earlierAnswers";
import { FmsStageRunner } from "./FmsStageRunner";
type Props = ComponentProps<typeof FmsStageRunner>;

const stage = { id: "call", fms_flow_id: "flow", stage_key: "call", name: "Call", sort_order: 1, step_type: "task", form_template_id: "form-1",
  planned_time_rule: { completionFormRequired: true } } as unknown as Props["definition"];
const form = { id: "form-1", name: "Call report", description: null, version: 1, sections: [],
  fields: [{ key: "outcome", label: "Call outcome", type: "text", sortOrder: 0 }] } as unknown as Props["forms"][number];
const props: Props = {
  instance: { id: "instance", fms_flow_id: "flow", status: "active", assignment_version: 2 } as unknown as Props["instance"],
  stage: { id: "visit", fms_instance_id: "instance", fms_stage_id: "call", status: "in_progress", assigned_to: ["employee-a"], planned_datetime: null } as unknown as Props["stage"],
  instanceStages: [], definition: stage, definitions: [{ ...stage, id: "initial", stage_key: "initial", sort_order: 0 }, stage],
  checklist: [], evidence: [], users: [{ id: "employee-a", employee_name: "Employee A" }] as unknown as Props["users"], branches: [], departments: [], forms: [form],
  formOptions: { users: [], branches: [], departments: [], masters: [] },
  profile: { id: "employee-a", user_role: "staff" } as unknown as Props["profile"], onRefresh: async () => {},
};
afterEach(cleanup);

it("opens the stage form in the work page, not in a dialog over the earlier answers", async () => {
  const user = userEvent.setup();
  const openEarlier = vi.fn();
  render(<FmsEarlierAnswersContext.Provider value={openEarlier}><FmsStageRunner {...props} compact /></FmsEarlierAnswersContext.Provider>);
  await user.click(screen.getByRole("button", { name: "Fill the form" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("region", { name: "Your form: Call report" })).toBeTruthy();
  expect(screen.getByLabelText("Call outcome")).toBeTruthy();
  // Shown once the form is open, so the employee is not offered the same form twice.
  expect(screen.queryByRole("button", { name: "Fill the form" })).toBeNull();
  await user.type(screen.getByLabelText("Call outcome"), "Interested");
  await user.click(screen.getByRole("button", { name: "See earlier answers" }));
  expect(openEarlier).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText("Call outcome") as HTMLInputElement).value).toBe("Interested");
});

it("keeps the dialog on other surfaces", async () => {
  const user = userEvent.setup();
  render(<FmsStageRunner {...props} />);
  await user.click(screen.getByRole("button", { name: "Fill the form" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "See earlier answers" })).toBeNull();
});
